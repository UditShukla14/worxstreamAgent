import { Package, Users, Building2, Landmark, ShoppingBag, CreditCard } from './icons/AnimatedIcons';
import { ReactNode } from 'react';

interface QuickActionsProps {
  onSelect: (text: string) => void;
  disabled?: boolean;
}

interface QuickAction {
  text: string;
  icon: ReactNode;
}

const quickActions: QuickAction[] = [
  { text: 'Show all product categories', icon: <Package size={14} /> },
  { text: 'List all customers', icon: <Users size={14} /> },
  { text: 'Show vendors', icon: <Building2 size={14} /> },
  { text: 'List departments', icon: <Landmark size={14} /> },
  { text: 'Show products', icon: <ShoppingBag size={14} /> },
  { text: 'List subscription plans', icon: <CreditCard size={14} /> },
];

export function QuickActions({ onSelect, disabled }: QuickActionsProps) {
  return (
    <div className="quick-actions">
      <div className="quick-actions-title">Quick actions</div>
      <div className="quick-actions-grid">
        {quickActions.map((action) => (
          <button
            key={action.text}
            className="quick-action-btn"
            onClick={() => onSelect(action.text)}
            disabled={disabled}
          >
            {action.icon}
            {action.text}
          </button>
        ))}
      </div>
    </div>
  );
}
