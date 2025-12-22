import { Search, FileSearch, Database, Network, Code } from './icons/AnimatedIcons';

interface DataFetchingLogProps {
  query?: string;
  pattern?: string;
  files?: string[];
  endpoint?: string;
  method?: string;
  status?: 'pending' | 'success' | 'error';
}

export function DataFetchingLog({
  query,
  pattern,
  files,
  endpoint,
  method,
  status = 'pending',
}: DataFetchingLogProps) {
  return (
    <div className="data-fetching-log">
      {/* Query Section */}
      {query && (
        <div className="data-fetching-item">
          <div className="data-fetching-icon">
            <Search size={14} />
          </div>
          <div className="data-fetching-content">
            <div className="data-fetching-label">Searched</div>
            <div className="data-fetching-value">{query}</div>
          </div>
        </div>
      )}

      {/* Pattern Section */}
      {pattern && (
        <div className="data-fetching-item">
          <div className="data-fetching-icon">
            <Code size={14} />
          </div>
          <div className="data-fetching-content">
            <div className="data-fetching-label">Pattern</div>
            <div className="data-fetching-value code-text">{pattern}</div>
          </div>
        </div>
      )}

      {/* Files Section */}
      {files && files.length > 0 && (
        <div className="data-fetching-item">
          <div className="data-fetching-icon">
            <FileSearch size={14} />
          </div>
          <div className="data-fetching-content">
            <div className="data-fetching-label">Files Searched</div>
            <div className="data-fetching-value">
              {files.map((file, index) => (
                <div key={index} className="data-fetching-file">
                  {file}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* API Endpoint Section */}
      {endpoint && (
        <div className="data-fetching-item">
          <div className="data-fetching-icon">
            <Network size={14} />
          </div>
          <div className="data-fetching-content">
            <div className="data-fetching-label">API Call</div>
            <div className="data-fetching-value">
              <span className="method-badge">{method || 'GET'}</span>
              <span className="endpoint-text">{endpoint}</span>
            </div>
          </div>
        </div>
      )}

      {/* Database Query Section */}
      {status && (
        <div className="data-fetching-item">
          <div className="data-fetching-icon">
            <Database size={14} />
          </div>
          <div className="data-fetching-content">
            <div className="data-fetching-label">Status</div>
            <div className={`data-fetching-value status-${status}`}>
              {status === 'pending' && 'Fetching...'}
              {status === 'success' && 'Completed'}
              {status === 'error' && 'Failed'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
