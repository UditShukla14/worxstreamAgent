import { useMemo } from 'react';
import { User, Bot } from './icons/AnimatedIcons';
import { Message as MessageType } from '../types';
import { parseXMLContent, extractWorkflowFromXML } from '../utils/parseXML';
import { WorkflowVisualization } from './WorkflowVisualization';
import { ResponseSkeleton } from './ResponseSkeleton';
import { extractKeywords, getKeywordDisplayName, getKeywordColor } from '../utils/extractKeywords';

interface MessageProps {
  message: MessageType;
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === 'user';
  
  // Extract keywords from user messages
  const keywords = useMemo(() => {
    if (!isUser || !message.content) return [];
    return extractKeywords(message.content);
  }, [message.content, isUser]);
  
  // Extract workflow data from <workflow> XML tag
  const workflowData = useMemo(() => {
    if (isUser || !message.content) return null;
    const extracted = extractWorkflowFromXML(message.content);
    console.log('Message component - Extracted workflow data:', extracted);
    return extracted;
  }, [message.content, isUser]);

  const hasWorkflow = workflowData !== null;

  return (
    <div className={`message ${message.role}`}>
      <div className="message-avatar">
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="message-content">
        {isUser ? (
          <div className="message-bubble">
            {keywords.length > 0 && (
              <div className="keywords-badges">
                {keywords.map((keyword, index) => (
                  <span 
                    key={index} 
                    className={`keyword-badge ${getKeywordColor(keyword)}`}
                    title={`Filtering tools for ${getKeywordDisplayName(keyword)}`}
                  >
                    {getKeywordDisplayName(keyword)}
                  </span>
                ))}
              </div>
            )}
            <div className="message-text">
              {message.content}
            </div>
          </div>
        ) : (
          <>
            {hasWorkflow && !message.isStreaming && (
              <div style={{ marginBottom: '16px' }}>
                <WorkflowVisualization data={workflowData} height={500} />
              </div>
            )}
            {message.isStreaming ? (
              <ResponseSkeleton />
            ) : (
              <div
                className="message-text message-text--wrapped"
                dangerouslySetInnerHTML={{
                  __html: parseXMLContent(message.content),
                }}
              />
            )}
            {message.toolsUsed && message.toolsUsed.length > 0 && !message.isStreaming && (
              <div className="tools-used">
                <span className="tools-label">Used:</span>
                {message.toolsUsed.map((tool, index) => (
                  <span key={index} className="tool-badge">
                    {tool.name}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
