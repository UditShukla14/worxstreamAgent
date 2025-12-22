import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Plus, ChevronLeft, ChevronRight, Trash2, Loader2 } from 'lucide-react';

const API_URL = '/api';

export interface ConversationItem {
  conversation_id: string;
  preview: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface ConversationsSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onSelectConversation: (conversationId: string | null) => void;
  currentConversationId: string | null;
  onNewChat: () => void;
}

export function ConversationsSidebar({
  isCollapsed,
  onToggle,
  onSelectConversation,
  currentConversationId,
  onNewChat,
}: ConversationsSidebarProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_URL}/chat`);
      if (!response.ok) throw new Error('Failed to fetch conversations');
      
      const data = await response.json();
      if (data.success) {
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    // Refresh conversations every 30 seconds
    const interval = setInterval(fetchConversations, 30000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  const handleDelete = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this conversation?')) return;

    try {
      setDeletingId(conversationId);
      const response = await fetch(`${API_URL}/chat/${conversationId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setConversations(prev => prev.filter(c => c.conversation_id !== conversationId));
        if (currentConversationId === conversationId) {
          onSelectConversation(null);
        }
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
      alert('Failed to delete conversation');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`conversations-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!isCollapsed && (
          <>
            <h2 className="sidebar-title">Conversations</h2>
            <button className="new-chat-sidebar-btn" onClick={onNewChat} title="New chat">
              <Plus size={18} />
            </button>
          </>
        )}
        <button className="sidebar-toggle" onClick={onToggle} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {!isCollapsed && (
        <div className="sidebar-content">
          {isLoading ? (
            <div className="sidebar-loading">
              <Loader2 size={20} className="animate-spin" />
              <span>Loading conversations...</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="sidebar-empty">
              <MessageSquare size={32} />
              <p>No conversations yet</p>
              <p className="sidebar-empty-subtitle">Start a new chat to begin</p>
            </div>
          ) : (
            <div className="conversations-list">
              {conversations.map((conv) => (
                <div
                  key={conv.conversation_id}
                  className={`conversation-item ${currentConversationId === conv.conversation_id ? 'active' : ''}`}
                  onClick={() => onSelectConversation(conv.conversation_id)}
                >
                  <div className="conversation-content">
                    <div className="conversation-preview">{conv.preview}</div>
                    <div className="conversation-meta">
                      <span className="conversation-time">{formatDate(conv.updated_at)}</span>
                      {conv.message_count > 0 && (
                        <span className="conversation-count">{conv.message_count} messages</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="conversation-delete"
                    onClick={(e) => handleDelete(conv.conversation_id, e)}
                    disabled={deletingId === conv.conversation_id}
                    title="Delete conversation"
                  >
                    {deletingId === conv.conversation_id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

