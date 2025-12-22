import { useState } from 'react';
import { Header } from './components/Header';
import { ChatContainer } from './components/ChatContainer';
import { ConversationsSidebar } from './components/ConversationsSidebar';
import { useStreamingChat } from './hooks/useStreamingChat';

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { 
    messages, 
    isLoading, 
    currentTools, 
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
          sendMessage={sendMessage}
        />
      </div>
    </div>
  );
}

export default App;
