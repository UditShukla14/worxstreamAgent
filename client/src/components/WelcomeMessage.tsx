import { Bot } from './icons/AnimatedIcons';

export function WelcomeMessage() {
  return (
    <div className="message assistant">
      <div className="message-avatar">
        <Bot size={16} />
      </div>
      <div className="message-content">
        <div className="message-text">
          <p>Hi! I'm your Worxstream assistant. How can I help you today?</p>
        </div>
      </div>
    </div>
  );
}
