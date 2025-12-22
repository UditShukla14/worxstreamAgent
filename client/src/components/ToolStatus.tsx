import { Loader2, Check, X } from './icons/AnimatedIcons';
import { ToolUsed } from '../types';

interface ToolStatusProps {
  tools: ToolUsed[];
}

export function ToolStatus({ tools }: ToolStatusProps) {
  if (tools.length === 0) return null;

  return (
    <div className="tool-status">
      <div className="tool-status-header">
        <Loader2 size={14} />
        <span>Working on it...</span>
      </div>
      <div className="tool-status-list">
        {tools.map((tool, index) => (
          <div key={index} className="tool-status-item">
            {tool.success === undefined ? (
              <Loader2 size={12} />
            ) : tool.success ? (
              <Check size={12} />
            ) : (
              <X size={12} />
            )}
            <span>{formatToolName(tool.name)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
