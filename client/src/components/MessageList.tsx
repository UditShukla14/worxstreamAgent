import { useEffect, useRef } from 'react';
import { Bot } from './icons/AnimatedIcons';
import { Message as MessageType, ToolUsed } from '../types';
import { Message } from './Message';
import { ToolStatus } from './ToolStatus';
import { WelcomeMessage } from './WelcomeMessage';

interface MessageListProps {
  messages: MessageType[];
  isLoading: boolean;
  currentTools: ToolUsed[];
}

export function MessageList({ messages, isLoading, currentTools }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentTools]);

  // Check if there's a streaming message with no content yet
  const lastMessage = messages[messages.length - 1];
  const isWaitingForResponse = isLoading && lastMessage?.role === 'assistant' && lastMessage?.content === '';

  return (
    <div className="messages">
      {messages.length === 0 && <WelcomeMessage />}
      
      {messages.map((message) => {
        // Skip rendering empty streaming messages - we'll show thinking indicator instead
        if (message.role === 'assistant' && message.content === '' && message.isStreaming) {
          return null;
        }
        return <Message key={message.id} message={message} />;
      })}
      
      {/* Show tool status when tools are being used */}
      {isLoading && currentTools.length > 0 && (
        <div className="message assistant">
          <div className="message-avatar">
            <Bot size={16} />
          </div>
          <div className="message-content">
            <ToolStatus tools={currentTools} />
          </div>
        </div>
      )}
      
      {/* Show thinking indicator when waiting for response (no tools, empty content) */}
      {isWaitingForResponse && currentTools.length === 0 && (
        <div className="message assistant">
          <div className="message-avatar">
            <Bot size={16} />
          </div>
          <div className="message-content">
            <div className="thinking-indicator">
              <div className="thinking-dots">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
              </div>
              <span>Thinking...</span>
            </div>
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
}
