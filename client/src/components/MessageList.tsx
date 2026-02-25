import { useEffect, useRef } from 'react';
import { Bot } from './icons/AnimatedIcons';
import { Message as MessageType, ToolUsed } from '../types';
import { Message } from './Message';
import { ActivityStatus } from './ActivityStatus';
import { WelcomeMessage } from './WelcomeMessage';

interface MessageListProps {
  messages: MessageType[];
  isLoading: boolean;
  currentTools: ToolUsed[];
  /** Backend-driven status label; when set, ActivityStatus shows this instead of default */
  activityLabel?: string | null;
}

export function MessageList({ messages, isLoading, currentTools, activityLabel }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentTools]);

  const showActivityStatus = isLoading;

  return (
    <div className="messages">
      {messages.length === 0 && <WelcomeMessage />}
      
      {messages.map((message) => {
        // Skip rendering empty streaming messages - we show ActivityStatus instead
        if (message.role === 'assistant' && message.content === '' && message.isStreaming) {
          return null;
        }
        return <Message key={message.id} message={message} />;
      })}
      
      {/* Single professional status line while waiting (no step list, no tool names) */}
      {showActivityStatus && (
        <div className="message assistant">
          <div className="message-avatar">
            <Bot size={16} />
          </div>
          <div className="message-content">
            <ActivityStatus hasActivity={currentTools.length > 0} label={activityLabel ?? undefined} />
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
}
