declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: {
      ipcRenderer: {
        sendMessage(channel: string, ...args: unknown[]): void;
        on(
          channel: string,
          func: (...args: unknown[]) => void,
        ): (() => void) | undefined;
        once(channel: string, func: (...args: unknown[]) => void): void;
        invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      };
    };
  }
}

export {};
