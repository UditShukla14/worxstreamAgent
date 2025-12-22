import { useMemo } from 'react';

export interface Milestone {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  text: string;
}

interface MilestonesProps {
  milestones: Milestone[];
}

export function Milestones({ milestones }: MilestonesProps) {
  const statusCounts = useMemo(() => {
    const counts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };
    milestones.forEach(m => {
      counts[m.status] = (counts[m.status] || 0) + 1;
    });
    return counts;
  }, [milestones]);

  const total = milestones.length;
  const completed = statusCounts.completed;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '⟳';
      case 'failed':
        return '✗';
      case 'pending':
      default:
        return '○';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'milestone-completed';
      case 'in_progress':
        return 'milestone-in-progress';
      case 'failed':
        return 'milestone-failed';
      case 'pending':
      default:
        return 'milestone-pending';
    }
  };

  if (milestones.length === 0) {
    return null;
  }

  return (
    <div className="milestones-container">
      <div className="milestones-header">
        <div className="milestones-title">
          <span className="milestones-icon">📋</span>
          <span>Task Progress</span>
        </div>
        <div className="milestones-progress">
          <div className="milestones-progress-bar">
            <div 
              className="milestones-progress-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="milestones-progress-text">
            {completed}/{total} completed
          </span>
        </div>
      </div>
      <div className="milestones-list">
        {milestones.map((milestone) => (
          <div 
            key={milestone.id} 
            className={`milestone-item ${getStatusClass(milestone.status)}`}
          >
            <span className="milestone-icon">{getStatusIcon(milestone.status)}</span>
            <span className="milestone-text">{milestone.text}</span>
            <span className="milestone-status-badge">{milestone.status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

