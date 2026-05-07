/**
 * components/DesignMode/NodeEditModal.tsx — Modal for adding or editing a node.
 *
 * Triggered by:
 *   - Clicking "Add Node" tool then clicking canvas (add mode)
 *   - Double-clicking a node in design mode (edit mode)
 *   - Clicking "Edit Node" in DesignToolbar or Inspector
 *
 * Listens for two custom DOM events:
 *   - 'flowgraph:add-node'  → opens in add mode with canvas click position
 *   - 'flowgraph:edit-node' → opens in edit mode with the node's current data
 */

import React, { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { generateNodeId } from '../../utils/exportJson';
import type { Position, NodeTag } from '../../types/graph';
import styles from './NodeEditModal.module.css';

const TAG_PALETTE: { color: string; label: string }[] = [
  { color: '#ef4444', label: 'Red' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#22c55e', label: 'Green' },
  { color: '#8b5cf6', label: 'Violet' },
  { color: '#3b82f6', label: 'Blue' },
];

type ModalMode = 'add' | 'edit';

export function NodeEditModal() {
  const { allNodes, addNode, updateNode, deleteNode, ownerColors, recolorTag, renameTag, tagRegistry, ownerRegistry } = useGraphStore();

  // ── Local modal state ─────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('add');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<Position>({ x: 0, y: 0 });

  // Form fields
  const [fieldId, setFieldId] = useState('');
  const [fieldName, setFieldName] = useState('');
  const [fieldOwner, setFieldOwner] = useState('');
  const [fieldDesc, setFieldDesc] = useState('');
  const [fieldTags, setFieldTags] = useState<NodeTag[]>([]);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerShowAll, setOwnerShowAll] = useState(false);

  // Tag dropdown state
  const [tagDropOpen, setTagDropOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0].color);

  // Inline tag edit state (edit existing tag in dropdown)
  const [editingTagLabel, setEditingTagLabel] = useState<string | null>(null);
  const [editTagText, setEditTagText] = useState('');
  const [editTagColor, setEditTagColor] = useState(TAG_PALETTE[0].color);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Unique owners: from nodes + pre-registered owners, deduped
  const existingOwners = [...new Set([...allNodes.map((n) => n.owner), ...ownerRegistry])];

  // Global tag pool — unique by label (case-insensitive), first-seen color wins.
  // Sources: node tags → session tagRegistry → current fieldTags (for newly created ones).
  const existingTags: NodeTag[] = (() => {
    const seen = new Map<string, NodeTag>();
    for (const n of allNodes) {
      for (const t of n.tags ?? []) {
        const key = t.label.toLowerCase();
        if (!seen.has(key)) seen.set(key, t);
      }
    }
    for (const t of tagRegistry) {
      const key = t.label.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    }
    for (const t of fieldTags) {
      const key = t.label.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    }
    return [...seen.values()];
  })();

  // ── Listen for open events dispatched by Canvas and DesignToolbar ─────
  useEffect(() => {
    function handleAddNode(e: Event) {
      const position = (e as CustomEvent<Position>).detail;
      setMode('add');
      setEditingNodeId(null);
      setInsertPosition(position);
      setFieldId(generateNodeId(allNodes));
      setFieldName('');
      setFieldOwner(existingOwners[0] ?? '');
      setFieldDesc('');
      setFieldTags([]);
      setTagSearch('');
      setTagDropOpen(false);
      setNewTagColor(TAG_PALETTE[0].color);
      setEditingTagLabel(null);
      setIsOpen(true);
    }

    document.addEventListener('flowgraph:add-node', handleAddNode);
    return () => {
      document.removeEventListener('flowgraph:add-node', handleAddNode);
    };
  }, [allNodes, existingOwners]);

  // ── Auto-focus name field when modal opens ────────────────────────────
  useEffect(() => {
    if (isOpen) setTimeout(() => nameInputRef.current?.focus(), 80);
  }, [isOpen]);

  // ── Close on Escape ───────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  function handleSave() {
    if (!fieldId.trim() || !fieldName.trim()) {
      alert('Node ID and Name are required.');
      return;
    }

    if (mode === 'add') {
      // Check for duplicate ID before adding
      if (allNodes.find((n) => n.id === fieldId.trim())) {
        alert(`A node with ID "${fieldId.trim()}" already exists. Please use a unique ID.`);
        return;
      }
      addNode(
        {
          id: fieldId.trim(),
          name: fieldName.trim(),
          owner: fieldOwner.trim() || 'Unknown',
          description: fieldDesc.trim(),
          dependencies: [],
          tags: fieldTags.length > 0 ? fieldTags : undefined,
        },
        insertPosition
      );
    } else if (editingNodeId) {
      updateNode(editingNodeId, {
        name: fieldName.trim(),
        owner: fieldOwner.trim() || 'Unknown',
        description: fieldDesc.trim(),
        tags: fieldTags.length > 0 ? fieldTags : undefined,
      });
    }

    setIsOpen(false);
  }

  function handleDelete() {
    if (!editingNodeId) return;
    const node = allNodes.find((n) => n.id === editingNodeId);
    if (!node) return;
    deleteNode(editingNodeId);
    setIsOpen(false);
  }

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.icon}>{mode === 'add' ? '➕' : '✏️'}</span>
          <div className={styles.title}>{mode === 'add' ? 'Add Node' : 'Edit Node'}</div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>✕</button>
        </div>

        <div className={styles.body}>
          {/* Node ID — editable only when adding, locked when editing */}
          <div className={styles.field}>
            <label className={styles.label}>Node ID</label>
            <input
              className={styles.input}
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
              disabled={mode === 'edit'}
              style={{ opacity: mode === 'edit' ? 0.5 : 1 }}
              placeholder="e.g. STEP-01"
              maxLength={40}
            />
            {mode === 'edit' && (
              <div className={styles.fieldHint}>ID cannot be changed (it's referenced by other nodes' dependencies)</div>
            )}
          </div>

          {/* Name */}
          <div className={styles.field}>
            <label className={styles.label}>Name *</label>
            <input
              ref={nameInputRef}
              className={styles.input}
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Short descriptive name"
              maxLength={60}
            />
          </div>

          {/* Owner — with custom dropdown from existing owners */}
          <div className={styles.field}>
            <label className={styles.label}>Owner / Lane</label>
            <div style={{ position: 'relative' }}>
              <input
                className={styles.input}
                value={fieldOwner}
                onChange={(e) => { setFieldOwner(e.target.value); setOwnerShowAll(false); setOwnerOpen(true); }}
                onFocus={() => setOwnerOpen(true)}
                onBlur={() => setTimeout(() => setOwnerOpen(false), 160)}
                placeholder="e.g. Engineering"
                maxLength={60}
                autoComplete="off"
                style={{ paddingRight: fieldOwner ? 52 : 28 }}
              />
              {fieldOwner && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setFieldOwner(''); setOwnerOpen(true); }}
                  tabIndex={-1}
                  title="Clear owner"
                  style={{
                    position: 'absolute', right: 28, top: 0, bottom: 0,
                    width: 24, background: 'transparent', border: 'none',
                    color: 'var(--text3)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="11" height="12" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,3 11,3"/>
                    <path d="M4,3V1.5h4V3"/>
                    <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                    <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                    <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => { setOwnerShowAll(true); setOwnerOpen((o) => !o); }}
                tabIndex={-1}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0,
                  width: 28, background: 'transparent', border: 'none',
                  color: 'var(--text3)', cursor: 'pointer', fontSize: 10,
                }}
              >▾</button>
              {ownerOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
                  background: 'var(--surface)', border: '1px solid var(--border2)',
                  borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
                  maxHeight: 180, overflowY: 'auto', marginTop: 2,
                }}>
                  {existingOwners
                    .filter((o) => ownerShowAll || o.toLowerCase().includes(fieldOwner.toLowerCase()))
                    .map((owner) => (
                      <div
                        key={owner}
                        onMouseDown={() => { setFieldOwner(owner); setOwnerOpen(false); }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                          display: 'flex', alignItems: 'center', gap: 8,
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                      >
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: ownerColors[owner] ?? '#4f9eff',
                        }} />
                        {owner}
                      </div>
                    ))}
                  {fieldOwner.trim() && !existingOwners.some((o) => o.toLowerCase() === fieldOwner.trim().toLowerCase()) && (
                    <div
                      onMouseDown={() => { setOwnerOpen(false); }}
                      style={{
                        padding: '8px 12px', fontSize: 11,
                        color: 'var(--accent)', fontStyle: 'italic',
                        borderTop: existingOwners.length > 0 ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      + Create new owner: "{fieldOwner.trim()}"
                    </div>
                  )}
                  {existingOwners.filter((o) => ownerShowAll || o.toLowerCase().includes(fieldOwner.toLowerCase())).length === 0 &&
                    !ownerShowAll && (
                    <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)' }}>
                      No owners yet — type a name
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea
              className={styles.textarea}
              value={fieldDesc}
              onChange={(e) => setFieldDesc(e.target.value)}
              placeholder="1–3 sentences explaining what this step involves"
              rows={3}
            />
          </div>

          {/* Tags */}
          <div className={styles.field}>
            <label className={styles.label}>Tags</label>

            {/* Assigned tag chips */}
            {fieldTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {fieldTags.map((tag, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: tag.color, color: '#fff',
                    padding: '3px 8px', borderRadius: 6,
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    {tag.label}
                    <button
                      type="button"
                      onClick={() => setFieldTags((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove tag"
                      style={{
                        background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)',
                        cursor: 'pointer', padding: 0, lineHeight: 1,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <svg width="10" height="11" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,3 11,3"/>
                        <path d="M4,3V1.5h4V3"/>
                        <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                        <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                        <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Tag dropdown — pick existing or create new */}
            <div style={{ position: 'relative' }}>
              <input
                className={styles.input}
                value={tagSearch}
                onChange={(e) => { setTagSearch(e.target.value); setTagDropOpen(true); }}
                onFocus={() => setTagDropOpen(true)}
                onBlur={() => setTimeout(() => setTagDropOpen(false), 160)}
                placeholder={existingTags.length > 0 ? 'Search or type a name to create a new tag…' : 'Type a name to create a new tag…'}
                maxLength={60}
                autoComplete="off"
                style={{ paddingRight: 28 }}
              />
              <button
                type="button"
                onClick={() => setTagDropOpen((o) => !o)}
                tabIndex={-1}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0,
                  width: 28, background: 'transparent', border: 'none',
                  color: 'var(--text3)', cursor: 'pointer', fontSize: 10,
                }}
              >▾</button>

              {tagDropOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
                  background: 'var(--surface)', border: '1px solid var(--border2)',
                  borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
                  maxHeight: 220, overflowY: 'auto', marginTop: 2,
                }}>
                  {/* All tags — assigned ones show a checkmark and toggle off on click */}
                  {existingTags
                    .filter((t) => !tagSearch || t.label.toLowerCase().includes(tagSearch.toLowerCase()))
                    .map((tag) => {
                      const isAssigned = fieldTags.some((f) => f.label.toLowerCase() === tag.label.toLowerCase());
                      const isEditingThis = editingTagLabel === tag.label;

                      if (isEditingThis) {
                        return (
                          <div key={tag.label} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                            {/* Color swatches */}
                            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
                              {TAG_PALETTE.map((p) => (
                                <button key={p.color} type="button" title={p.label}
                                  onMouseDown={(e) => { e.preventDefault(); setEditTagColor(p.color); }}
                                  style={{
                                    width: 16, height: 16, borderRadius: '50%', border: 'none',
                                    background: p.color, cursor: 'pointer', flexShrink: 0,
                                    outline: editTagColor === p.color ? '2px solid #fff' : 'none',
                                    outlineOffset: 1,
                                    boxShadow: editTagColor === p.color ? `0 0 0 3px ${p.color}55` : 'none',
                                  }}
                                />
                              ))}
                            </div>
                            {/* Text input + Apply/Cancel */}
                            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                              <input
                                value={editTagText}
                                onChange={(e) => setEditTagText(e.target.value)}
                                maxLength={60}
                                autoFocus
                                style={{
                                  flex: 1, minWidth: 0,
                                  background: 'var(--bg3)', border: '1px solid var(--accent)',
                                  borderRadius: 4, color: 'var(--text)',
                                  fontFamily: 'var(--font-mono)', fontSize: 11, padding: '3px 7px', outline: 'none',
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const newText = editTagText.trim();
                                    if (newText && newText !== tag.label) renameTag(tag.label, newText);
                                    if (editTagColor !== tag.color) recolorTag(newText || tag.label, editTagColor);
                                    // Update in fieldTags if already assigned
                                    setFieldTags((prev) => prev.map((t) =>
                                      t.label.toLowerCase() === tag.label.toLowerCase()
                                        ? { label: newText || tag.label, color: editTagColor }
                                        : t
                                    ));
                                    setEditingTagLabel(null);
                                  }
                                  if (e.key === 'Escape') setEditingTagLabel(null);
                                  e.stopPropagation();
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const newText = editTagText.trim();
                                  if (newText && newText !== tag.label) renameTag(tag.label, newText);
                                  if (editTagColor !== tag.color) recolorTag(newText || tag.label, editTagColor);
                                  setFieldTags((prev) => prev.map((t) =>
                                    t.label.toLowerCase() === tag.label.toLowerCase()
                                      ? { label: newText || tag.label, color: editTagColor }
                                      : t
                                  ));
                                  setEditingTagLabel(null);
                                }}
                                style={{
                                  background: 'rgba(167,139,250,.2)', border: '1px solid var(--design)',
                                  borderRadius: 4, color: 'var(--design)', fontSize: 10,
                                  fontFamily: 'var(--font-mono)', fontWeight: 700,
                                  padding: '3px 8px', cursor: 'pointer', flexShrink: 0,
                                }}
                              >Apply</button>
                              <button
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setEditingTagLabel(null); }}
                                title="Cancel edit"
                                style={{
                                  background: 'transparent', border: '1px solid var(--border2)',
                                  borderRadius: 4, color: 'var(--text3)',
                                  padding: '3px 7px', cursor: 'pointer', flexShrink: 0,
                                  display: 'flex', alignItems: 'center',
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                                  <polyline points="2,3.5 2,6.5 5,6.5"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                      <div
                        key={tag.label}
                        onMouseDown={() => {
                          if (isAssigned) {
                            setFieldTags((prev) => prev.filter((f) => f.label.toLowerCase() !== tag.label.toLowerCase()));
                          } else {
                            setFieldTags((prev) => [...prev, tag]);
                            setTagSearch('');
                            setTagDropOpen(false);
                          }
                        }}
                        className={styles.tagRow}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                          display: 'flex', alignItems: 'center', gap: 8,
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text)', position: 'relative',
                          background: isAssigned ? 'var(--surface2)' : undefined,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = isAssigned ? 'var(--surface2)' : '')}
                      >
                        {/* Checkmark for assigned tags */}
                        <span style={{
                          width: 14, flexShrink: 0, textAlign: 'center',
                          color: 'var(--accent)', fontSize: 11, fontWeight: 700,
                          visibility: isAssigned ? 'visible' : 'hidden',
                        }}>✓</span>
                        <span style={{
                          display: 'inline-block', background: tag.color,
                          color: '#fff', borderRadius: 4,
                          padding: '1px 6px', fontSize: 9, fontWeight: 700,
                          fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                          letterSpacing: '0.04em', flexShrink: 0,
                        }}>{tag.label}</span>
                        {/* Pencil edit button — appears on row hover */}
                        <button
                          type="button"
                          className={styles.tagEditBtn}
                          title="Edit tag name and color globally"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setEditingTagLabel(tag.label);
                            setEditTagText(tag.label);
                            setEditTagColor(tag.color);
                          }}
                        >✎</button>
                      </div>
                    );
                  })}

                  {/* "Create new tag" row — shown when typed text is new */}
                  {tagSearch.trim() &&
                    !existingTags.some((t) => t.label.toLowerCase() === tagSearch.trim().toLowerCase()) && (
                    <div style={{ padding: '8px 12px', borderTop: existingTags.filter((t) => !fieldTags.some((f) => f.label.toLowerCase() === t.label.toLowerCase()) && t.label.toLowerCase().includes(tagSearch.toLowerCase())).length > 0 ? '1px solid var(--border)' : 'none' }}>
                      {/* Color picker */}
                      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
                        {TAG_PALETTE.map((p) => (
                          <button
                            key={p.color}
                            type="button"
                            title={p.label}
                            onMouseDown={(e) => { e.preventDefault(); setNewTagColor(p.color); }}
                            style={{
                              width: 16, height: 16, borderRadius: '50%', border: 'none',
                              background: p.color, cursor: 'pointer', flexShrink: 0,
                              outline: newTagColor === p.color ? `2px solid #fff` : 'none',
                              outlineOffset: 1,
                              boxShadow: newTagColor === p.color ? `0 0 0 3px ${p.color}55` : 'none',
                            }}
                          />
                        ))}
                      </div>
                      <div
                        onMouseDown={() => {
                          const trimmed = tagSearch.trim();
                          if (!trimmed) return;
                          const newTag = { label: trimmed, color: newTagColor };
                          setFieldTags((prev) => {
                            const alreadyOn = prev.some((t) => t.label.toLowerCase() === trimmed.toLowerCase());
                            return alreadyOn ? prev : [...prev, newTag];
                          });
                          setTagSearch('');
                          setTagDropOpen(false);
                        }}
                        style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontStyle: 'italic' }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                      >
                        + Create new tag: "
                        <span style={{
                          display: 'inline-block', background: newTagColor,
                          color: '#fff', borderRadius: 4,
                          padding: '0px 5px', fontSize: 9, fontWeight: 700,
                          fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                          letterSpacing: '0.04em', verticalAlign: 'middle',
                        }}>{tagSearch.trim()}</span>
                        "
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {existingTags.length === 0 && !tagSearch.trim() && (
                    <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)' }}>
                      No tags yet — type a name above to create one
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          {/* Delete button — only in edit mode */}
          {mode === 'edit' && (
            <button className={styles.deleteBtn} onClick={handleDelete}>
              Delete Node
            </button>
          )}
          <button className={styles.cancelBtn} onClick={() => setIsOpen(false)}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
