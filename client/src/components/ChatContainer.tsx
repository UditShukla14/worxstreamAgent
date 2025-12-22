import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { Message, ToolUsed } from '../types';

interface ChatContainerProps {
  messages: Message[];
  isLoading: boolean;
  currentTools: ToolUsed[];
  sendMessage: (message: string, files?: { oldFile?: File; newFile?: File }) => void;
}

export function ChatContainer({ messages, isLoading, currentTools, sendMessage }: ChatContainerProps) {
  return (
    <div className="chat-container">
      <MessageList 
        messages={messages} 
        isLoading={isLoading} 
        currentTools={currentTools} 
      />
      <InputArea onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
