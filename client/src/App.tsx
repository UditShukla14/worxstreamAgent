import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { ChatContainer } from './components/ChatContainer';
import { ConversationsSidebar } from './components/ConversationsSidebar';
import { RexDashboard } from './components/RexDashboard';
import { useStreamingChat } from './hooks/useStreamingChat';

interface IdentityModalProps {
  onSave: (companyId: string, userId: string) => void;
}

function IdentityModal({ onSave }: IdentityModalProps) {
  const [companyId, setCompanyId] = useState(
    window.localStorage.getItem('worxstream_company_id') || '',
  );
  const [userId, setUserId] = useState(
    window.localStorage.getItem('worxstream_user_id') || '',
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCompany = companyId.trim();
    const trimmedUser = userId.trim();
    if (!trimmedCompany || !trimmedUser) {
      setError('Both Company ID and User ID are required.');
      return;
    }
    onSave(trimmedCompany, trimmedUser);
  };

  return (
    <div className="identity-modal-backdrop">
      <div className="identity-modal">
        <h2>Set Worxstream Identity</h2>
        <p className="identity-modal-subtitle">
          Enter a Company ID and User ID to test the multi-tenant chat flow.
        </p>
        <form onSubmit={handleSubmit} className="identity-modal-form">
          <label>
            Company ID
            <input
              type="text"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="e.g. 1"
            />
          </label>
          <label>
            User ID
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          {error && <p className="identity-modal-error">{error}</p>}
          <button type="submit" className="identity-modal-submit">
            Continue to Chat
          </button>
        </form>
      </div>
    </div>
  );
}

function ChatPage() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [identity, setIdentity] = useState(() => {
    const companyId = window.localStorage.getItem('worxstream_company_id') || '';
    const userId = window.localStorage.getItem('worxstream_user_id') || '';
    return { companyId, userId };
  });
  const [showIdentityModal, setShowIdentityModal] = useState(
    !identity.companyId || !identity.userId,
  );
  const { 
    messages, 
    isLoading, 
    currentTools, 
    activityLabel, 
    sendMessage, 
    confirmAction, 
    loadConversation, 
    resetChat, 
    currentConversationId 
  } = useStreamingChat();

  const handleIdentitySave = (companyId: string, userId: string) => {
    window.localStorage.setItem('worxstream_company_id', companyId);
    window.localStorage.setItem('worxstream_user_id', userId);
    setIdentity({ companyId, userId });
    setShowIdentityModal(false);
    resetChat();
  };

  const handleSelectConversation = (conversationId: string | null) => {
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      resetChat();
    }
  };

  const handleNewChat = () => {
    resetChat();
  };

  if (showIdentityModal) {
    return <IdentityModal onSave={handleIdentitySave} />;
  }

  return (
    <div className="app">
      <ConversationsSidebar
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onSelectConversation={handleSelectConversation}
        currentConversationId={currentConversationId}
        onNewChat={handleNewChat}
      />
      <div className="container">
        <Header onNewChat={handleNewChat} />
        <ChatContainer 
          messages={messages}
          isLoading={isLoading}
          currentTools={currentTools}
          activityLabel={activityLabel}
          sendMessage={sendMessage}
          confirmAction={confirmAction}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/rex" element={<RexDashboard />} />
    </Routes>
  );
}

export default App;
