import { useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import {
  MOCK_POLICIES,
  formatTs,
  type Policy,
  type PolicyType,
  type PolicyStatus,
} from '../mock/controlTowerMockData'

// ── Policy Modal ──────────────────────────────────────────────

interface PolicyModalProps {
  initial?: Policy | null
  onSave: (p: Policy) => void
  onClose: () => void
}

function PolicyModal({ initial, onSave, onClose }: PolicyModalProps) {
  const isEdit = !!initial
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<PolicyType>(initial?.type ?? 'policy')
  const [status, setStatus] = useState<PolicyStatus>(initial?.status ?? 'active')
  const [content, setContent] = useState(initial?.content ?? '')
  const [error, setError] = useState('')

  function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!content.trim()) { setError('Content is required.'); return }

    onSave({
      id: initial?.id ?? `pol_${Date.now()}`,
      name: name.trim(),
      type,
      status,
      content: content.trim(),
      updatedAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <div className="ct-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ct-modal">
        <div className="ct-modal-header">
          <h3>{isEdit ? 'Edit Policy' : 'New Policy'}</h3>
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
            <label className="ct-label">Policy Name</label>
            <input
              className="ct-input"
              placeholder="e.g. Minimum Margin Policy"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="ct-form-group">
              <label className="ct-label">Type</label>
              <select
                className="ct-form-select"
                value={type}
                onChange={e => setType(e.target.value as PolicyType)}
              >
                <option value="policy">Policy</option>
                <option value="rule">Rule</option>
              </select>
            </div>
            <div className="ct-form-group">
              <label className="ct-label">Status</label>
              <select
                className="ct-form-select"
                value={status}
                onChange={e => setStatus(e.target.value as PolicyStatus)}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>

          <div className="ct-form-group">
            <label className="ct-label">Content (Markdown supported)</label>
            <textarea
              className="ct-textarea"
              placeholder="Describe the policy in detail..."
              value={content}
              onChange={e => { setContent(e.target.value); setError('') }}
              style={{ minHeight: 180 }}
            />
          </div>
        </div>

        <div className="ct-modal-footer">
          <button className="ct-btn ct-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="ct-btn ct-btn-primary" onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Create Policy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────

function DeleteConfirm({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="ct-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="ct-modal" style={{ width: 400 }}>
        <div className="ct-modal-header">
          <h3>Delete Policy</h3>
          <button className="ct-drawer-close" onClick={onCancel}><X size={15} /></button>
        </div>
        <div className="ct-modal-body">
          <p style={{ color: 'var(--ct-text-secondary)', fontSize: 13 }}>
            Are you sure you want to delete <strong style={{ color: 'var(--ct-text-primary)' }}>"{name}"</strong>?
            This action cannot be undone.
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

// ── Policies View ─────────────────────────────────────────────

export function PoliciesView() {
  const [policies, setPolicies] = useState<Policy[]>(MOCK_POLICIES)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [deleting, setDeleting] = useState<Policy | null>(null)

  function openCreate() { setEditing(null); setShowModal(true) }
  function openEdit(p: Policy) { setEditing(p); setShowModal(true) }

  function handleSave(p: Policy) {
    setPolicies(prev => {
      const idx = prev.findIndex(x => x.id === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = p
        return next
      }
      return [p, ...prev]
    })
  }

  function handleDelete(id: string) {
    setPolicies(prev => prev.filter(p => p.id !== id))
    setDeleting(null)
  }

  return (
    <>
      <div className="ct-page-header">
        <h2>Policies</h2>
        <p>Manage the governance policy documents used by master agents to evaluate events.</p>
      </div>

      <div className="ct-page-body">
        {/* Header bar */}
        <div className="ct-filters" style={{ marginBottom: 16 }}>
          <div className="ct-filters-spacer" />
          <button className="ct-btn ct-btn-primary" onClick={openCreate}>
            <Plus size={14} />
            New Policy
          </button>
        </div>

        {/* Table */}
        <div className="ct-section">
          <div className="ct-table-wrap">
            <table className="ct-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="ct-empty">
                      No policies yet. Create your first policy.
                    </td>
                  </tr>
                ) : (
                  policies.map(p => (
                    <tr key={p.id} style={{ cursor: 'default' }}>
                      <td className="primary">{p.name}</td>
                      <td>
                        <span className={`ct-badge ${p.type}`}>
                          {p.type.charAt(0).toUpperCase() + p.type.slice(1)}
                        </span>
                      </td>
                      <td>
                        <span className={`ct-badge ${p.status}`}>
                          {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                        </span>
                      </td>
                      <td>{formatTs(p.updatedAt)}</td>
                      <td>
                        <div className="ct-row-actions">
                          <button
                            className="ct-icon-btn"
                            title="Edit"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="ct-icon-btn danger"
                            title="Delete"
                            onClick={() => setDeleting(p)}
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
        <PolicyModal
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
