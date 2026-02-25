import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { Message, ToolUsed } from '../types';

interface ChatContainerProps {
  messages: Message[];
  isLoading: boolean;
  currentTools: ToolUsed[];
  /** Backend-driven status label (e.g. "Checking invoices…"); null = use default */
  activityLabel?: string | null;
  sendMessage: (message: string, files?: { oldFile?: File; newFile?: File }) => void;
}

export function ChatContainer({ messages, isLoading, currentTools, activityLabel, sendMessage }: ChatContainerProps) {
  return (
    <div className="chat-container">
      <MessageList 
        messages={messages} 
        isLoading={isLoading} 
        currentTools={currentTools}
        activityLabel={activityLabel}
      />
      <InputArea onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
