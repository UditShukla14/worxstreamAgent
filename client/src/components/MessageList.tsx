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
  /** Sends the clarification pick (e.g. "#2") as a normal chat message */
  onClarificationSelect?: (pick: string) => void;
  /** Approves/rejects a pending write confirmation */
  onConfirmAction?: (messageId: string, confirmationId: string, approved: boolean) => void;
}

export function MessageList({ messages, isLoading, currentTools, activityLabel, onClarificationSelect, onConfirmAction }: MessageListProps) {
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
        return (
          <Message
            key={message.id}
            message={message}
            onClarificationSelect={onClarificationSelect}
            onConfirmAction={onConfirmAction}
          />
        );
      })}
      
      {/* Single professional status line while waiting (no step list, no tool names) */}
      {showActivityStatus && (
        <div className="message assistant">
          <div className="message-avatar">
            <Bot size={16} />
          </div>
          <div className="message-content">
            <ActivityStatus isLoading={isLoading} currentTools={currentTools} activityLabel={activityLabel || 'Processing...'} />
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
}
