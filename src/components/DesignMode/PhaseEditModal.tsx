/**
 * components/DesignMode/PhaseEditModal.tsx — Modal for creating or editing a phase.
 *
 * Triggered by:
 *   - 'flowgraph:create-phase' event (from DesignToolbar "Manage Phases" or Navigator "+")
 *   - 'flowgraph:edit-phase' event with { phaseId } (from Inspector or PhaseLayer double-click)
 *
 * Form fields: Name, Description, Color (8-swatch palette + custom hex).
 * In edit mode: shows the list of assigned node names (read-only).
 */

import React, { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { PHASE_PALETTE } from '../../types/graph';
import styles from './NodeEditModal.module.css';

type ModalMode = 'create' | 'edit';

export function PhaseEditModal() {
  const {
    allNodes, phases, createPhase, updatePhase, deletePhase,
  } = useGraphStore();

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('create');
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [preselectedNodeIds, setPreselectedNodeIds] = useState<string[]>([]);

  // Form fields
  const [fieldName, setFieldName] = useState('');
  const [fieldDesc, setFieldDesc] = useState('');
  const [fieldColor, setFieldColor] = useState<string>(PHASE_PALETTE[0]);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // ── Listen for open events ──────────────────────────────────────────────
  useEffect(() => {
    function handleCreate(e: Event) {
      const detail = (e as CustomEvent<{ nodeIds?: string[] }>).detail ?? {};
      const nodeIds = detail.nodeIds ?? [];
      // Pick the next color in the palette
      const nextColor = PHASE_PALETTE[phases.length % PHASE_PALETTE.length];

      setMode('create');
      setEditingPhaseId(null);
      setPreselectedNodeIds(nodeIds);
      setFieldName('');
      setFieldDesc('');
      setFieldColor(nextColor);
      setIsOpen(true);
    }

    function handleEdit(e: Event) {
      const { phaseId } = (e as CustomEvent<{ phaseId: string }>).detail;
      const phase = phases.find((p) => p.id === phaseId);
      if (!phase) return;

      setMode('edit');
      setEditingPhaseId(phaseId);
      setPreselectedNodeIds(phase.nodeIds);
      setFieldName(phase.name);
      setFieldDesc(phase.description);
      setFieldColor(phase.color);
      setIsOpen(true);
    }

    document.addEventListener('flowgraph:create-phase', handleCreate);
    document.addEventListener('flowgraph:edit-phase', handleEdit);
    return () => {
      document.removeEventListener('flowgraph:create-phase', handleCreate);
      document.removeEventListener('flowgraph:edit-phase', handleEdit);
    };
  }, [phases]);

  // Auto-focus name input
  useEffect(() => {
    if (isOpen) setTimeout(() => nameInputRef.current?.focus(), 80);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  function handleSave() {
    if (!fieldName.trim()) {
      alert('Phase name is required.');
      return;
    }

    if (mode === 'create') {
      createPhase(preselectedNodeIds, {
        name: fieldName.trim(),
        description: fieldDesc.trim(),
        color: fieldColor,
      });
    } else if (editingPhaseId) {
      updatePhase(editingPhaseId, {
        name: fieldName.trim(),
        description: fieldDesc.trim(),
        color: fieldColor,
      });
    }

    setIsOpen(false);
  }

  function handleDelete() {
    if (!editingPhaseId) return;
    const phase = phases.find((p) => p.id === editingPhaseId);
    if (!phase) return;

    const confirmed = window.confirm(
      `Delete phase "${phase.name}"?\n\nNodes assigned to this phase will remain unaffected.`
    );
    if (!confirmed) return;

    deletePhase(editingPhaseId);
    setIsOpen(false);
  }

  if (!isOpen) return null;

  const assignedNodeNames = preselectedNodeIds
    .map((nid) => allNodes.find((n) => n.id === nid)?.name ?? nid)
    .slice(0, 8);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.icon}>{mode === 'create' ? '◈' : '✏️'}</span>
          <div className={styles.title}>{mode === 'create' ? 'Create Phase' : 'Edit Phase'}</div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>✕</button>
        </div>

        <div className={styles.body}>
          {/* Phase Name */}
          <div className={styles.field}>
            <label className={styles.label}>Phase Name *</label>
            <input
              ref={nameInputRef}
              className={styles.input}
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Discovery, Build, Deploy"
              maxLength={60}
            />
          </div>

          {/* Description */}
          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea
              className={styles.textarea}
              value={fieldDesc}
              onChange={(e) => setFieldDesc(e.target.value)}
              placeholder="What does this phase represent?"
              rows={2}
            />
          </div>

          {/* Color picker */}
          <div className={styles.field}>
            <label className={styles.label}>Color</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {PHASE_PALETTE.map((color) => (
                <button
                  key={color}
                  onClick={() => setFieldColor(color)}
                  title={color}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: color,
                    border: fieldColor === color ? '2.5px solid var(--text1)' : '2px solid transparent',
                    cursor: 'pointer',
                    outline: fieldColor === color ? `2px solid ${color}` : 'none',
                    outlineOffset: 2,
                    flexShrink: 0,
                  }}
                />
              ))}
              {/* Custom hex input */}
              <input
                type="color"
                value={fieldColor}
                onChange={(e) => setFieldColor(e.target.value)}
                title="Custom color"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: 'none',
                  padding: 1,
                }}
              />
              <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                {fieldColor}
              </span>
            </div>
          </div>

          {/* Assigned nodes (edit mode) */}
          {mode === 'edit' && (
            <div className={styles.field}>
              <label className={styles.label}>
                Assigned Nodes ({preselectedNodeIds.length})
              </label>
              {preselectedNodeIds.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>No nodes assigned.</div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>
                  {assignedNodeNames.map((name, i) => (
                    <span
                      key={i}
                      style={{ marginRight: 6, padding: '1px 5px', background: 'var(--surface2)', borderRadius: 3 }}
                    >
                      {name}
                    </span>
                  ))}
                  {preselectedNodeIds.length > 8 && (
                    <span style={{ color: 'var(--text3)' }}>+{preselectedNodeIds.length - 8} more…</span>
                  )}
                </div>
              )}
              <div className={styles.fieldHint}>
                Assign nodes via "Assign to Phase" in Design Mode with nodes selected.
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {mode === 'edit' && (
            <button className={styles.deleteBtn} onClick={handleDelete}>
              Delete Phase
            </button>
          )}
          <button className={styles.cancelBtn} onClick={() => setIsOpen(false)}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave}>
            {mode === 'create' ? 'Create Phase' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
