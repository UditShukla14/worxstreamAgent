export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: ToolUsed[];
  isStreaming?: boolean;
  clarification?: ClarificationData;
  confirmation?: ConfirmationData;
}

export interface ToolUsed {
  name: string;
  input?: Record<string, unknown>;
  success?: boolean;
}

/** Option emitted by the backend `clarification` event (1-based index). */
export interface ClarificationOption {
  index: number;
  id?: string | number;
  label: string;
}

export interface ClarificationData {
  question: string;
  options: ClarificationOption[];
  /** True once the user picked an option or sent any other message */
  resolved?: boolean;
}

export type ConfirmationStatus = 'pending' | 'processing' | 'approved' | 'cancelled' | 'error';

export interface ConfirmationData {
  confirmationId: string;
  tool: string;
  input?: Record<string, unknown>;
  status: ConfirmationStatus;
  error?: string;
}

export interface StreamEvent {
  type: 'start' | 'conversation_id' | 'agent_selected' | 'status' | 'tool_use' | 'tool_result' | 'text' | 'clarification' | 'confirmation_required' | 'done' | 'error';
  message?: string;
  conversation_id?: string;
  agent?: string;
  /** Backend-driven label for activity/progress (e.g. "Checking invoices…") */
  label?: string;
  tool?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  content?: string;
  toolsUsed?: ToolUsed[];
  error?: string;
  /** `clarification` event */
  question?: string;
  options?: ClarificationOption[];
  /** `confirmation_required` event + `done` with pending_confirmation */
  confirmationId?: string;
  pending_confirmation?: boolean;
}
