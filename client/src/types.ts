export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: ToolUsed[];
  isStreaming?: boolean;
}

export interface ToolUsed {
  name: string;
  input?: Record<string, unknown>;
  success?: boolean;
}

export interface StreamEvent {
  type: 'start' | 'conversation_id' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  message?: string;
  conversation_id?: string;
  tool?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  content?: string;
  toolsUsed?: ToolUsed[];
  error?: string;
}
