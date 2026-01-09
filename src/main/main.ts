/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import os from 'os';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import express from 'express';
import { Server } from 'http';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;
const servers = new Map<number, Server>();

// Get local IP address
function getLocalIPAddress(): string {
  const interfaces = os.networkInterfaces();
  const interfaceNames = Object.keys(interfaces);
  for (let i = 0; i < interfaceNames.length; i += 1) {
    const name = interfaceNames[i];
    const networkInterface = interfaces[name];
    if (networkInterface) {
      for (let j = 0; j < networkInterface.length; j += 1) {
        const iface = networkInterface[j];
        // Skip internal (i.e. 127.0.0.1) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }
  return 'localhost';
}

// IPC handler for starting a server
ipcMain.handle('log-server:start', async (_event, port: number) => {
  if (servers.has(port)) {
    return { success: false, error: `Server on port ${port} already exists` };
  }

  try {
    const expressApp = express();
    expressApp.use(express.text({ type: '*/*' }));

    // Catch all POST requests to any path using middleware
    expressApp.use((req, res) => {
      if (req.method === 'POST') {
        try {
          const { body } = req;
          let parsedData;
          try {
            parsedData = JSON.parse(body);
          } catch {
            parsedData = body;
          }

          console.log('parsedData', parsedData);

          const logData = {
            port,
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.path,
            headers: req.headers,
            data: parsedData,
          };

          // Send to renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('log-server:message', logData);
          }

          res.status(200).send('OK');
        } catch (error) {
          console.error('Error processing log request:', error);
          res.status(500).send('Error processing request');
        }
      } else {
        // For non-POST requests, return 404 or method not allowed
        res.status(404).send('Not Found');
      }
    });

    return new Promise((resolve) => {
      const server = expressApp.listen(port, () => {
        const ipAddress = getLocalIPAddress();
        const endpoint = `http://${ipAddress}:${port}`;
        console.log(`Log server started on port ${port}`);
        console.log(`Server endpoint: ${endpoint}`);
        servers.set(port, server);
        resolve({ success: true, port, endpoint, ipAddress });
      });

      server.on('error', (error: Error & { code?: string }) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${port} is already in use`);
          resolve({
            success: false,
            error: `Port ${port} is already in use`,
          });
        } else {
          console.error(`Server error on port ${port}:`, error);
          resolve({
            success: false,
            error: error.message || 'Failed to start server',
          });
        }
      });
    });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// IPC handler for stopping a server
ipcMain.handle('log-server:stop', async (_event, port: number) => {
  const server = servers.get(port);
  if (!server) {
    return { success: false, error: `No server found on port ${port}` };
  }

  try {
    return new Promise((resolve) => {
      server.close(() => {
        servers.delete(port);
        console.log(`Log server stopped on port ${port}`);
        resolve({ success: true, port });
      });
    });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// IPC handler for listing active servers
ipcMain.handle('log-server:list', async () => {
  return Array.from(servers.keys());
});

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    // Close all servers when window is closed
    servers.forEach((server, port) => {
      server.close();
      servers.delete(port);
    });
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
