import { Link } from 'react-router-dom';
import { Sparkles, PlusCircle } from './icons/AnimatedIcons';

interface HeaderProps {
  onNewChat?: () => void;
}

export function Header({ onNewChat }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">
          <Sparkles size={18} />
        </div>
        <h1>Worxstream</h1>
        <span className="header-subtitle">AI Assistant</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Link to="/rex" className="rex-nav-link">
          🦖 Rex
        </Link>
        {onNewChat && (
          <button className="new-chat-btn" onClick={onNewChat}>
            <PlusCircle size={16} />
            New chat
          </button>
        )}
      </div>
    </header>
  );
}
