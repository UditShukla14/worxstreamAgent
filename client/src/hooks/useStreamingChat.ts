import { useState, useCallback, useRef } from 'react';
import { Message, StreamEvent, ToolUsed } from '../types';

const API_URL = '/api';

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTools, setCurrentTools] = useState<ToolUsed[]>([]);
  /** Backend-driven status label (e.g. "Checking invoices…"); null = use default */
  const [activityLabel, setActivityLabel] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_URL}/chat/${conversationId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.messages) {
        // Convert backend messages to frontend Message format
        const convertedMessages: Message[] = data.messages.map((msg: any, index: number) => {
          let content = '';
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            // Handle Anthropic message format
            const textBlocks = msg.content.filter((block: any) => block.type === 'text');
            content = textBlocks.map((block: any) => block.text).join('\n');
          } else {
            content = JSON.stringify(msg.content);
          }

          return {
            id: `${msg.role}-${index}-${Date.now()}`,
            role: msg.role,
            content,
            isStreaming: false,
          };
        });

        setMessages(convertedMessages);
        conversationIdRef.current = conversationId;
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load conversation';
      setMessages([{
        id: 'error-1',
        role: 'assistant',
        content: `<alert type="error">${errorMessage}</alert>`,
        isStreaming: false,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (
    userMessage: string, 
    files?: { oldFile?: File; newFile?: File }
  ) => {
    if ((!userMessage.trim() && !files) || isLoading) return;

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage || (files?.oldFile && files?.newFile ? 'Compare these stock files' : ''),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setCurrentTools([]);
    setActivityLabel(null);

    // Add placeholder for assistant message
    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      // If files are provided, send as FormData, otherwise send as JSON
      let response: Response;
      
      if (files?.oldFile && files?.newFile) {
        // Send files directly to chat endpoint
        const formData = new FormData();
        formData.append('oldFile', files.oldFile);
        formData.append('newFile', files.newFile);
        formData.append('message', userMessage || 'Compare these stock files and provide insights');
        if (conversationIdRef.current) {
          formData.append('conversation_id', conversationIdRef.current);
        }

        response = await fetch(`${API_URL}/agents/stream`, {
          method: 'POST',
          body: formData, // Send as FormData for file uploads
        });
      } else {
        // Regular text message
        response = await fetch(`${API_URL}/agents/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMessage,
            conversation_id: conversationIdRef.current,
          }),
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';
      const toolsCollected: ToolUsed[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));
              
              switch (event.type) {
                case 'conversation_id':
                  conversationIdRef.current = event.conversation_id || null;
                  break;

                case 'status':
                  if (event.label) setActivityLabel(event.label);
                  break;

                case 'tool_use':
                  if (event.tool) {
                    const tool: ToolUsed = { name: event.tool, input: event.input };
                    toolsCollected.push(tool);
                    setCurrentTools([...toolsCollected]);
                  }
                  break;

                case 'tool_result':
                  // Update the last tool with success status
                  if (toolsCollected.length > 0) {
                    toolsCollected[toolsCollected.length - 1].success = event.success;
                    setCurrentTools([...toolsCollected]);
                  }
                  break;

                case 'text':
                  if (event.content) {
                    setMessages(prev => 
                      prev.map(msg => 
                        msg.id === assistantMsgId 
                          ? { ...msg, content: msg.content + event.content }
                          : msg
                      )
                    );
                  }
                  break;

                case 'done':
                  setMessages(prev => 
                    prev.map(msg => 
                      msg.id === assistantMsgId 
                        ? { ...msg, isStreaming: false, toolsUsed: event.toolsUsed || toolsCollected }
                        : msg
                    )
                  );
                  break;

                case 'error':
                  setMessages(prev => 
                    prev.map(msg => 
                      msg.id === assistantMsgId 
                        ? { 
                            ...msg, 
                            content: `<alert type="error">${event.error || 'An error occurred'}</alert>`,
                            isStreaming: false 
                          }
                        : msg
                    )
                  );
                  break;
              }
            } catch {
              // Ignore JSON parse errors for incomplete data
            }
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMsgId 
            ? { 
                ...msg, 
                content: `<alert type="error">Connection error: ${errorMessage}. Make sure the server is running.</alert>`,
                isStreaming: false 
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      setCurrentTools([]);
      setActivityLabel(null);
    }
  }, [isLoading]);

  const resetChat = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = null;
  }, []);

  return {
    messages,
    isLoading,
    currentTools,
    /** Backend-driven status label; null = use default in ActivityStatus */
    activityLabel,
    sendMessage,
    resetChat,
    loadConversation,
    currentConversationId: conversationIdRef.current,
  };
}
