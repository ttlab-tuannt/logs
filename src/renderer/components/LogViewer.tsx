import React, { useState, useEffect, useCallback } from 'react';
import Split from 'react-split';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';
import './LogViewer.css';

interface LogRequest {
  id: number | string;
  port: number;
  timestamp: string;
  method: string;
  uri: string;
  headers: Record<string, string>;
  data?: any;
  queryParameters?: Record<string, string>;
}

interface LogResponse {
  id: number | string;
  port: number;
  timestamp: string;
  status: number;
  message?: string;
  uri: string;
  data?: any;
}

interface MergedLogEntry {
  id: number | string;
  port: number;
  method: string;
  uri: string;
  requestTimestamp: string;
  responseTimestamp?: string;
  duration?: number; // in milliseconds
  statusCode?: number;
  requestHeaders?: Record<string, string>;
  requestData?: any;
  requestQueryParameters?: Record<string, string>;
  responseData?: any;
  responseMessage?: string;
}

interface Tab {
  id: string;
  port: number;
  active: boolean;
  entries: MergedLogEntry[];
  endpoint?: string;
}

function LogViewer() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MergedLogEntry | null>(
    null,
  );
  const [filter, setFilter] = useState('');
  const [portInput, setPortInput] = useState('');
  const [sizes, setSizes] = useState([40, 60]); // Percentage sizes for left and right panels
  const [detailView, setDetailView] = useState<
    'headers' | 'request' | 'response'
  >('headers');

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filteredEntries =
    activeTab?.entries.filter((entry) => {
      if (!filter) return true;
      const lowerFilter = filter.toLowerCase();
      return (
        entry.method.toLowerCase().includes(lowerFilter) ||
        entry.uri.toLowerCase().includes(lowerFilter) ||
        entry.statusCode?.toString().includes(lowerFilter) ||
        JSON.stringify(entry.requestData || {})
          .toLowerCase()
          .includes(lowerFilter) ||
        JSON.stringify(entry.responseData || {})
          .toLowerCase()
          .includes(lowerFilter)
      );
    }) || [];

  // Handle incoming log messages
  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on(
      'log-server:message',
      (message: unknown) => {
        const logData = message as {
          port: number;
          timestamp: string;
          method: string;
          path: string;
          headers: Record<string, string>;
          data: any;
        };

        setTabs((prevTabs) => {
          const tab = prevTabs.find((t) => t.port === logData.port);
          if (!tab) return prevTabs;

          const parsedData = logData.data;
          if (!parsedData || typeof parsedData !== 'object') return prevTabs;

          const requestId = parsedData.id;
          if (!requestId) return prevTabs;

          // Check if this is a request or response
          const isRequest = parsedData.request !== undefined;
          const isResponse = parsedData.response !== undefined;

          return prevTabs.map((t) => {
            if (t.id !== tab.id) return t;

            const existingEntryIndex = t.entries.findIndex(
              (e) => e.id === requestId,
            );

            if (isRequest && parsedData.request) {
              const request = parsedData.request as LogRequest;
              if (existingEntryIndex >= 0) {
                // Update existing entry with request data
                const entries = [...t.entries];
                entries[existingEntryIndex] = {
                  ...entries[existingEntryIndex],
                  method: request.method,
                  uri: request.uri,
                  requestTimestamp: logData.timestamp,
                  requestHeaders: request.headers,
                  requestData: request.data,
                  requestQueryParameters: request.queryParameters,
                };
                return { ...t, entries };
              }
              // Create new entry for request
              const newEntry: MergedLogEntry = {
                id: requestId,
                port: logData.port,
                method: request.method,
                uri: request.uri,
                requestTimestamp: logData.timestamp,
                requestHeaders: request.headers,
                requestData: request.data,
                requestQueryParameters: request.queryParameters,
              };
              return { ...t, entries: [newEntry, ...t.entries] };
            }

            if (isResponse && parsedData.response) {
              const response = parsedData.response as LogResponse;
              if (existingEntryIndex >= 0) {
                // Update existing entry with response data
                const entries = [...t.entries];
                const existingEntry = entries[existingEntryIndex];
                const requestTime = new Date(
                  existingEntry.requestTimestamp,
                ).getTime();
                const responseTime = new Date(logData.timestamp).getTime();
                const duration = responseTime - requestTime;

                entries[existingEntryIndex] = {
                  ...existingEntry,
                  responseTimestamp: logData.timestamp,
                  statusCode: response.status,
                  responseMessage: response.message,
                  responseData: response.data,
                  duration,
                };
                return { ...t, entries };
              }
              // Create new entry for response (shouldn't happen, but handle it)
              const newEntry: MergedLogEntry = {
                id: requestId,
                port: logData.port,
                method: 'UNKNOWN',
                uri: response.uri,
                requestTimestamp: logData.timestamp,
                responseTimestamp: logData.timestamp,
                statusCode: response.status,
                responseMessage: response.message,
                responseData: response.data,
                duration: 0,
              };
              return { ...t, entries: [newEntry, ...t.entries] };
            }

            return t;
          });
        });
      },
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleStartServer = useCallback(async () => {
    const port = parseInt(portInput, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      // eslint-disable-next-line no-alert
      alert('Please enter a valid port number (1-65535)');
      return;
    }

    // Check if tab already exists
    if (tabs.find((t) => t.port === port)) {
      // eslint-disable-next-line no-alert
      alert(`Port ${port} is already in use`);
      return;
    }

    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'log-server:start',
        port,
      )) as {
        success: boolean;
        error?: string;
        port?: number;
        endpoint?: string;
        ipAddress?: string;
      };

      if (result.success && result.endpoint) {
        const newTab: Tab = {
          id: `tab-${port}-${Date.now()}`,
          port,
          active: tabs.length === 0,
          entries: [],
          endpoint: result.endpoint,
        };

        setTabs((prevTabs) => {
          const updated = prevTabs.map((t) => ({ ...t, active: false }));
          return [...updated, newTab];
        });
        setActiveTabId(newTab.id);
        setPortInput('');
      } else {
        // eslint-disable-next-line no-alert
        alert(`Failed to start server: ${result.error}`);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      // eslint-disable-next-line no-alert
      alert(`Error starting server: ${errorMessage}`);
    }
  }, [portInput, tabs]);

  const handleStopServer = useCallback(
    async (port: number) => {
      try {
        const result = (await window.electron.ipcRenderer.invoke(
          'log-server:stop',
          port,
        )) as { success: boolean; error?: string; port?: number };

        if (result.success) {
          setTabs((prevTabs) => {
            const remaining = prevTabs.filter((t) => t.port !== port);
            if (remaining.length > 0 && activeTabId === `tab-${port}`) {
              const firstTab = remaining[0];
              remaining[0] = { ...firstTab, active: true };
              setActiveTabId(firstTab.id);
            } else if (remaining.length === 0) {
              setActiveTabId(null);
            }
            return remaining.map((t, index) => ({
              ...t,
              active: index === 0,
            }));
          });
          setSelectedEntry(null);
        } else {
          // eslint-disable-next-line no-alert
          alert(`Failed to stop server: ${result.error}`);
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        // eslint-disable-next-line no-alert
        alert(`Error stopping server: ${errorMessage}`);
      }
    },
    [activeTabId],
  );

  const handleTabClick = (tabId: string) => {
    setTabs((prevTabs) =>
      prevTabs.map((t) => ({ ...t, active: t.id === tabId })),
    );
    setActiveTabId(tabId);
    setSelectedEntry(null);
  };

  const handleEntryClick = (entry: MergedLogEntry) => {
    setSelectedEntry(entry);
    setDetailView('headers');
  };

  const handleClearEntries = () => {
    if (activeTab) {
      setTabs((prevTabs) =>
        prevTabs.map((t) =>
          t.id === activeTab.id ? { ...t, entries: [] } : t,
        ),
      );
      setSelectedEntry(null);
    }
  };

  const handleCopyResponse = async () => {
    if (!selectedEntry?.responseData) return;
    try {
      const jsonString = JSON.stringify(selectedEntry.responseData, null, 2);
      await navigator.clipboard.writeText(jsonString);
      // eslint-disable-next-line no-alert
      alert('Response copied to clipboard!');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to copy:', error);
      // eslint-disable-next-line no-alert
      alert('Failed to copy to clipboard');
    }
  };

  const handleCopyRequest = async () => {
    if (!selectedEntry?.requestData) return;
    try {
      const jsonString = JSON.stringify(selectedEntry.requestData, null, 2);
      await navigator.clipboard.writeText(jsonString);
      // eslint-disable-next-line no-alert
      alert('Request copied to clipboard!');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to copy:', error);
      // eslint-disable-next-line no-alert
      alert('Failed to copy to clipboard');
    }
  };

  const handleCopyEndpoint = async (endpoint: string) => {
    try {
      await navigator.clipboard.writeText(endpoint);
      // eslint-disable-next-line no-alert
      alert('Endpoint copied to clipboard!');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to copy:', error);
      // eslint-disable-next-line no-alert
      alert('Failed to copy to clipboard');
    }
  };

  return (
    <div className="log-viewer">
      <div className="log-viewer-header">
        <div className="server-controls">
          <input
            type="number"
            placeholder="Enter port (e.g., 3000)"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleStartServer();
              }
            }}
            className="port-input"
          />
          <button
            type="button"
            onClick={handleStartServer}
            className="start-button"
          >
            Start Server
          </button>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="log-viewer-content">
          {activeTab && activeTab.endpoint && (
            <div className="endpoint-bar">
              <div className="endpoint-label">Server Endpoint:</div>
              <div className="endpoint-url">{activeTab.endpoint}</div>
              <button
                type="button"
                className="copy-endpoint-button"
                onClick={() => handleCopyEndpoint(activeTab.endpoint!)}
                title="Copy endpoint to clipboard"
              >
                📋
              </button>
            </div>
          )}
          <div className="tabs-container">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`tab ${tab.active ? 'active' : ''}`}
                onClick={() => handleTabClick(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleTabClick(tab.id);
                  }
                }}
                role="tab"
                tabIndex={0}
              >
                <span className="tab-label">Port {tab.port}</span>
                <span className="tab-count">({tab.entries.length})</span>
                <button
                  type="button"
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopServer(tab.port);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {activeTab && (
            <div className="log-viewer-main">
              <Split
                sizes={sizes}
                minSize={[200, 300]}
                maxSize={[800, Infinity]}
                expandToMin={false}
                gutterSize={4}
                gutterAlign="center"
                snapOffset={30}
                dragInterval={1}
                direction="horizontal"
                cursor="col-resize"
                className="split-container"
                onDragEnd={(newSizes) => {
                  setSizes(newSizes);
                }}
              >
                <div className="request-list-panel">
                  <div className="panel-header">
                    <input
                      type="text"
                      placeholder="Filter requests..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="filter-input"
                    />
                    <button
                      type="button"
                      onClick={handleClearEntries}
                      className="clear-button"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="entries-table-container">
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th className="col-url">URL</th>
                          <th className="col-method">Method</th>
                          <th className="col-duration">Duration</th>
                          <th className="col-status">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEntries.map((entry) => (
                          <tr
                            key={entry.id}
                            className={`entry-row ${
                              selectedEntry?.id === entry.id ? 'selected' : ''
                            }`}
                            onClick={() => handleEntryClick(entry)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                handleEntryClick(entry);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <td className="col-url" title={entry.uri}>
                              {entry.uri.length > 50
                                ? `${entry.uri.substring(0, 50)}...`
                                : entry.uri}
                            </td>
                            <td className="col-method">
                              <span
                                className={`method-badge method-${entry.method.toLowerCase()}`}
                              >
                                {entry.method}
                              </span>
                            </td>
                            <td className="col-duration">
                              {entry.duration !== undefined
                                ? `${entry.duration} ms`
                                : '-'}
                            </td>
                            <td className="col-status">
                              {entry.statusCode ? (
                                <span
                                  className={`status-badge status-${Math.floor(
                                    entry.statusCode / 100,
                                  )}xx`}
                                >
                                  {entry.statusCode}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredEntries.length === 0 && (
                      <div className="empty-state">
                        {filter
                          ? 'No requests match the filter'
                          : 'No requests yet. Waiting for logs...'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="request-detail-panel">
                  {selectedEntry ? (
                    <div className="request-detail">
                      <div className="detail-tabs">
                        <button
                          type="button"
                          className={`detail-tab ${
                            detailView === 'headers' ? 'active' : ''
                          }`}
                          onClick={() => setDetailView('headers')}
                        >
                          Headers
                        </button>
                        <button
                          type="button"
                          className={`detail-tab ${
                            detailView === 'request' ? 'active' : ''
                          }`}
                          onClick={() => setDetailView('request')}
                        >
                          Request
                        </button>
                        <button
                          type="button"
                          className={`detail-tab ${
                            detailView === 'response' ? 'active' : ''
                          }`}
                          onClick={() => setDetailView('response')}
                        >
                          Response
                        </button>
                      </div>
                      <div className="detail-content">
                        {detailView === 'headers' && (
                          <div className="detail-section">
                            <div className="detail-section-header">
                              <h4>Request URI</h4>
                            </div>
                            <div className="detail-value uri-display">
                              <div className="uri-value">
                                {selectedEntry.uri}
                              </div>
                              <button
                                type="button"
                                className="copy-uri-button"
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    selectedEntry.uri,
                                  );
                                  // eslint-disable-next-line no-alert
                                  alert('URI copied to clipboard!');
                                }}
                                title="Copy URI to clipboard"
                              >
                                📋
                              </button>
                            </div>
                            <div className="detail-section-header">
                              <h4>Request Headers</h4>
                            </div>
                            <div className="detail-value headers">
                              {selectedEntry.requestHeaders ? (
                                <JsonView
                                  value={selectedEntry.requestHeaders}
                                  style={darkTheme}
                                />
                              ) : (
                                <div className="empty-content">No headers</div>
                              )}
                            </div>
                          </div>
                        )}
                        {detailView === 'request' && (
                          <div className="detail-section">
                            <div className="detail-section-header">
                              <h4>Request Data</h4>
                              {selectedEntry.requestData && (
                                <button
                                  type="button"
                                  onClick={handleCopyRequest}
                                  className="copy-button"
                                >
                                  Copy Request
                                </button>
                              )}
                            </div>
                            <div className="detail-value json-viewer">
                              {selectedEntry.requestData && (
                                <JsonView
                                  value={selectedEntry.requestData}
                                  style={darkTheme}
                                />
                              )}
                              {!selectedEntry.requestData &&
                                selectedEntry.requestQueryParameters && (
                                  <JsonView
                                    value={selectedEntry.requestQueryParameters}
                                    style={darkTheme}
                                  />
                                )}
                              {!selectedEntry.requestData &&
                                !selectedEntry.requestQueryParameters && (
                                  <div className="empty-content">
                                    No request data
                                  </div>
                                )}
                            </div>
                          </div>
                        )}
                        {detailView === 'response' && (
                          <div className="detail-section">
                            <div className="detail-section-header">
                              <h4>Response Data</h4>
                              {selectedEntry.responseData && (
                                <button
                                  type="button"
                                  onClick={handleCopyResponse}
                                  className="copy-button"
                                >
                                  Copy Response
                                </button>
                              )}
                            </div>
                            <div className="detail-value json-viewer">
                              {selectedEntry.responseData ? (
                                <JsonView
                                  value={selectedEntry.responseData}
                                  style={darkTheme}
                                />
                              ) : (
                                <div className="empty-content">
                                  {selectedEntry.statusCode
                                    ? 'Response pending or empty'
                                    : 'Waiting for response...'}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="empty-detail">
                      Select a request to view details
                    </div>
                  )}
                </div>
              </Split>
            </div>
          )}
        </div>
      )}

      {tabs.length === 0 && (
        <div className="empty-state-large">
          <h2>No Active Servers</h2>
          <p>
            Enter a port number above and click &quot;Start Server&quot; to
            begin
          </p>
        </div>
      )}
    </div>
  );
}

export default LogViewer;
