import { useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import {
  MOCK_RULES,
  ALL_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  formatTs,
  type Rule,
  type EventType,
} from '../mock/controlTowerMockData'

// ── Rule Modal ────────────────────────────────────────────────

interface RuleModalProps {
  initial?: Rule | null
  onSave: (r: Rule) => void
  onClose: () => void
}

function RuleModal({ initial, onSave, onClose }: RuleModalProps) {
  const isEdit = !!initial
  const [name, setName] = useState(initial?.name ?? '')
  const [eventType, setEventType] = useState<EventType>(initial?.eventType ?? 'estimate.created')
  const [condition, setCondition] = useState(initial?.condition ?? '')
  const [action, setAction] = useState(initial?.action ?? '')
  const [priority, setPriority] = useState(initial?.priority ?? 2)
  const [active, setActive] = useState(initial?.active ?? true)
  const [error, setError] = useState('')

  function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!condition.trim()) { setError('Condition is required.'); return }
    if (!action.trim()) { setError('Action is required.'); return }

    onSave({
      id: initial?.id ?? `rule_${Date.now()}`,
      name: name.trim(),
      eventType,
      condition: condition.trim(),
      action: action.trim(),
      priority,
      active,
      updatedAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <div
      className="ct-modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="ct-modal">
        <div className="ct-modal-header">
          <h3>{isEdit ? 'Edit Rule' : 'New Rule'}</h3>
          <button className="ct-drawer-close" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="ct-modal-body">
          {error && (
            <div style={{
              background: 'var(--ct-red-muted)',
              color: 'var(--ct-red)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 'var(--ct-radius-sm)',
              padding: '8px 12px',
              fontSize: 12,
            }}>
              {error}
            </div>
          )}

          <div className="ct-form-group">
            <label className="ct-label">Rule Name</label>
            <input
              className="ct-input"
              placeholder="e.g. Flag Low Margin Estimates"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
            />
          </div>

          <div className="ct-form-group">
            <label className="ct-label">Trigger Event Type</label>
            <select
              className="ct-form-select"
              value={eventType}
              onChange={e => setEventType(e.target.value as EventType)}
            >
              {ALL_EVENT_TYPES.map(et => (
                <option key={et} value={et}>{EVENT_TYPE_LABELS[et]}</option>
              ))}
            </select>
          </div>

          <div className="ct-form-group">
            <label className="ct-label">Condition</label>
            <textarea
              className="ct-textarea"
              placeholder="Describe when this rule should trigger, e.g. Gross margin < 20%"
              value={condition}
              onChange={e => { setCondition(e.target.value); setError('') }}
              style={{ minHeight: 80 }}
            />
          </div>

          <div className="ct-form-group">
            <label className="ct-label">Action on Violation</label>
            <textarea
              className="ct-textarea"
              placeholder="Describe what should happen, e.g. Flag for manager review and create a critical alert"
              value={action}
              onChange={e => { setAction(e.target.value); setError('') }}
              style={{ minHeight: 80 }}
            />
          </div>

          <div className="ct-form-group">
            <label className="ct-label">
              Priority: <strong style={{ color: 'var(--ct-text-primary)' }}>{priority}</strong>
              <span style={{ color: 'var(--ct-text-muted)', fontWeight: 400 }}>
                {' '}(1 = highest, 5 = lowest)
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={5}
              value={priority}
              onChange={e => setPriority(Number(e.target.value))}
              className="ct-slider"
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ct-text-muted)' }}>
              <span>1 — Critical</span>
              <span>5 — Low</span>
            </div>
          </div>

          <div className="ct-form-group">
            <label className="ct-toggle">
              <input
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
              />
              <div className="ct-toggle-track" />
              <span className="ct-toggle-label">{active ? 'Active — rule will run on matching events' : 'Inactive — rule is disabled'}</span>
            </label>
          </div>
        </div>

        <div className="ct-modal-footer">
          <button className="ct-btn ct-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="ct-btn ct-btn-primary" onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="ct-modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="ct-modal" style={{ width: 400 }}>
        <div className="ct-modal-header">
          <h3>Delete Rule</h3>
          <button className="ct-drawer-close" onClick={onCancel}><X size={15} /></button>
        </div>
        <div className="ct-modal-body">
          <p style={{ color: 'var(--ct-text-secondary)', fontSize: 13 }}>
            Are you sure you want to delete{' '}
            <strong style={{ color: 'var(--ct-text-primary)' }}>"{name}"</strong>? This action
            cannot be undone.
          </p>
        </div>
        <div className="ct-modal-footer">
          <button className="ct-btn ct-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="ct-btn ct-btn-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ── Priority dot ──────────────────────────────────────────────

function PriorityDot({ priority }: { priority: number }) {
  const colors = ['', 'var(--ct-red)', 'var(--ct-amber)', 'var(--ct-blue)', 'var(--ct-text-muted)', 'var(--ct-text-muted)']
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: colors[priority] ?? 'var(--ct-text-muted)',
          display: 'inline-block',
        }}
      />
      P{priority}
    </span>
  )
}

// ── Rules View ────────────────────────────────────────────────

export function RulesView() {
  const [rules, setRules] = useState<Rule[]>(MOCK_RULES)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [deleting, setDeleting] = useState<Rule | null>(null)

  function openCreate() { setEditing(null); setShowModal(true) }
  function openEdit(r: Rule) { setEditing(r); setShowModal(true) }

  function handleSave(r: Rule) {
    setRules(prev => {
      const idx = prev.findIndex(x => x.id === r.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = r
        return next
      }
      return [r, ...prev]
    })
  }

  function handleDelete(id: string) {
    setRules(prev => prev.filter(r => r.id !== id))
    setDeleting(null)
  }

  function handleToggleActive(id: string) {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, active: !r.active } : r)))
  }

  return (
    <>
      <div className="ct-page-header">
        <h2>Rules</h2>
        <p>Structured rules that master agents evaluate against every incoming event.</p>
      </div>

      <div className="ct-page-body">
        {/* Header bar */}
        <div className="ct-filters" style={{ marginBottom: 16 }}>
          <div className="ct-filters-spacer" />
          <button className="ct-btn ct-btn-primary" onClick={openCreate}>
            <Plus size={14} />
            New Rule
          </button>
        </div>

        {/* Table */}
        <div className="ct-section">
          <div className="ct-table-wrap">
            <table className="ct-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Event Trigger</th>
                  <th>Condition</th>
                  <th>Action</th>
                  <th>Priority</th>
                  <th>Active</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="ct-empty">
                      No rules yet. Create your first rule.
                    </td>
                  </tr>
                ) : (
                  rules.map(r => (
                    <tr key={r.id} style={{ cursor: 'default' }}>
                      <td className="primary">{r.name}</td>
                      <td>
                        <span className="ct-badge event">{r.eventType}</span>
                      </td>
                      <td
                        style={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                        }}
                        title={r.condition}
                      >
                        {r.condition}
                      </td>
                      <td
                        style={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                        }}
                        title={r.action}
                      >
                        {r.action}
                      </td>
                      <td><PriorityDot priority={r.priority} /></td>
                      <td>
                        <label className="ct-toggle" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={r.active}
                            onChange={() => handleToggleActive(r.id)}
                          />
                          <div className="ct-toggle-track" />
                        </label>
                      </td>
                      <td>{formatTs(r.updatedAt)}</td>
                      <td>
                        <div className="ct-row-actions">
                          <button className="ct-icon-btn" title="Edit" onClick={() => openEdit(r)}>
                            <Pencil size={13} />
                          </button>
                          <button
                            className="ct-icon-btn danger"
                            title="Delete"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <RuleModal
          initial={editing}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}

      {deleting && (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => handleDelete(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
