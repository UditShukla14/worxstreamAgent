import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { ChatContainer } from './components/ChatContainer';
import { ConversationsSidebar } from './components/ConversationsSidebar';
import { RexDashboard } from './components/RexDashboard';
import { useStreamingChat } from './hooks/useStreamingChat';

function ChatPage() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { 
    messages, 
    isLoading, 
    currentTools, 
    activityLabel, 
    sendMessage, 
    loadConversation, 
    resetChat, 
    currentConversationId 
  } = useStreamingChat();

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
