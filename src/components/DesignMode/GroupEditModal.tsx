/**
 * components/DesignMode/GroupEditModal.tsx — Modal for creating or editing a group.
 *
 * Triggered by:
 *   - Clicking "Create Group" in DesignToolbar (create mode, with pre-selected nodes)
 *   - Double-clicking a group polygon or clicking "Edit Group" (edit mode)
 *
 * Listens for two custom DOM events:
 *   - 'flowgraph:create-group' → opens in create mode with selected node/group IDs
 *   - 'flowgraph:edit-group'   → opens in edit mode with the group's current data
 */

import React, { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { deriveGroupOwners, validateGroupConnectivity, validateGroupPhase, getAllDescendantNodeIds } from '../../utils/grouping';
import styles from './NodeEditModal.module.css';

type ModalMode = 'create' | 'edit';

export function GroupEditModal() {
  const {
    allNodes, allEdges, groups, phases,
    createGroup, updateGroup, deleteGroup,
    ownerColors, clearMultiSelect,
  } = useGraphStore();

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('create');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Pre-selected child IDs (from multi-select)
  const [childNodeIds, setChildNodeIds] = useState<string[]>([]);
  const [childGroupIds, setChildGroupIds] = useState<string[]>([]);

  // Form fields
  const [fieldName, setFieldName] = useState('');
  const [fieldDesc, setFieldDesc] = useState('');
  const [derivedOwners, setDerivedOwners] = useState<string[]>([]);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // ── Listen for open events ──────────────────────────────────────────────
  useEffect(() => {
    function handleCreate(e: Event) {
      const { nodeIds, groupIds } = (e as CustomEvent<{ nodeIds: string[]; groupIds: string[] }>).detail;

      // Validate connectivity — expand selected groups to their descendant nodes
      // so reachability is checked across the full combined set.
      const expandedIds = [
        ...nodeIds,
        ...groupIds.flatMap((gid) => getAllDescendantNodeIds(gid, groups)),
      ];
      const { valid, disconnectedIds } = validateGroupConnectivity(expandedIds, allEdges);
      if (!valid) {
        // Map disconnected node IDs back to readable names; if a node lives
        // inside one of the selected child groups, attribute it to that group.
        const shown = new Set<string>();
        disconnectedIds.forEach((id) => {
          const parentGroup = groupIds
            .map((gid) => groups.find((g) => g.id === gid))
            .find((g) => g && getAllDescendantNodeIds(g.id, groups).includes(id));
          if (parentGroup) {
            shown.add(`group "${parentGroup.name}"`);
          } else {
            const n = allNodes.find((nn) => nn.id === id);
            shown.add(n ? `"${n.name}" (${id})` : id);
          }
        });
        alert(
          `Cannot create group: the following items are not connected to the rest:\n\n${[...shown].join(', ')}\n\nAll selected items must be directly or indirectly connected.`
        );
        return;
      }

      // Validate same owner — all expanded nodes must share a single owner.
      const ownerSet = new Set<string>();
      for (const id of expandedIds) {
        const node = allNodes.find((n) => n.id === id);
        if (node) ownerSet.add(node.owner);
      }
      if (ownerSet.size > 1) {
        alert(
          `Cannot create group: selected nodes belong to multiple owners (${[...ownerSet].join(', ')}).\n\nAll nodes in a group must have the same owner.`
        );
        return;
      }

      // Validate same phase — all expanded nodes must belong to the same phase (or none).
      const { valid: phaseValid, conflictingPhaseNames } = validateGroupPhase(expandedIds, phases);
      if (!phaseValid) {
        alert(
          `Cannot create group: selected nodes span multiple phases (${conflictingPhaseNames.join(', ')}).\n\nAll nodes in a group must belong to the same phase.`
        );
        return;
      }

      setMode('create');
      setEditingGroupId(null);
      setChildNodeIds(nodeIds);
      setChildGroupIds(groupIds);
      setFieldName('');
      setFieldDesc('');
      setDerivedOwners(deriveGroupOwners(nodeIds, groupIds, allNodes, groups));
      setIsOpen(true);
    }

    function handleEdit(e: Event) {
      const { groupId } = (e as CustomEvent<{ groupId: string }>).detail;
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      setMode('edit');
      setEditingGroupId(groupId);
      setChildNodeIds(group.childNodeIds);
      setChildGroupIds(group.childGroupIds);
      setFieldName(group.name);
      setFieldDesc(group.description);
      setDerivedOwners(group.owners);
      setIsOpen(true);
    }

    document.addEventListener('flowgraph:create-group', handleCreate);
    document.addEventListener('flowgraph:edit-group', handleEdit);
    return () => {
      document.removeEventListener('flowgraph:create-group', handleCreate);
      document.removeEventListener('flowgraph:edit-group', handleEdit);
    };
  }, [allNodes, allEdges, groups, phases]);

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
      alert('Group name is required.');
      return;
    }

    if (mode === 'create') {
      createGroup(childNodeIds, childGroupIds, {
        name: fieldName.trim(),
        description: fieldDesc.trim(),
      });
      clearMultiSelect();
    } else if (editingGroupId) {
      updateGroup(editingGroupId, {
        name: fieldName.trim(),
        description: fieldDesc.trim(),
        // Re-derive owners in case children changed (read-only in edit mode for now)
        owners: deriveGroupOwners(childNodeIds, childGroupIds, allNodes, groups),
      });
    }

    setIsOpen(false);
  }

  function handleDelete() {
    if (!editingGroupId) return;
    const group = groups.find((g) => g.id === editingGroupId);
    if (!group) return;

    deleteGroup(editingGroupId, true); // dissolve = keep children
    setIsOpen(false);
  }

  if (!isOpen) return null;

  const ownerDisplay =
    derivedOwners.length === 0
      ? 'None'
      : derivedOwners.length === 1
        ? derivedOwners[0]
        : `Multiple (${derivedOwners.join(', ')})`;

  const childNodeNames = childNodeIds
    .map((id) => allNodes.find((n) => n.id === id)?.name ?? id)
    .slice(0, 5);
  const childGroupNames = childGroupIds
    .map((id) => groups.find((g) => g.id === id)?.name ?? id)
    .slice(0, 3);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.icon}>{mode === 'create' ? '⬡' : '✏️'}</span>
          <div className={styles.title}>{mode === 'create' ? 'Create Group' : 'Edit Group'}</div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>✕</button>
        </div>

        <div className={styles.body}>
          {/* Group Name */}
          <div className={styles.field}>
            <label className={styles.label}>Group Name *</label>
            <input
              ref={nameInputRef}
              className={styles.input}
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Data Processing Pipeline"
              maxLength={60}
            />
          </div>

          {/* Auto-derived Owner */}
          <div className={styles.field}>
            <label className={styles.label}>Owner(s)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {derivedOwners.map((o) => (
                <span key={o} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)' }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: ownerColors[o] ?? '#4f9eff',
                    display: 'inline-block',
                  }} />
                  {o}
                </span>
              ))}
              {derivedOwners.length === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>None</span>
              )}
            </div>
            <div className={styles.fieldHint}>Auto-derived from child nodes — updated when the group is saved.</div>
          </div>

          {/* Description */}
          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea
              className={styles.textarea}
              value={fieldDesc}
              onChange={(e) => setFieldDesc(e.target.value)}
              placeholder="What does this group represent?"
              rows={2}
            />
          </div>

          {/* Children summary */}
          <div className={styles.field}>
            <label className={styles.label}>
              Children ({childNodeIds.length} node{childNodeIds.length !== 1 ? 's' : ''}
              {childGroupIds.length > 0 ? `, ${childGroupIds.length} group${childGroupIds.length !== 1 ? 's' : ''}` : ''})
            </label>
            <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>
              {childNodeNames.map((n, i) => (
                <span key={i} style={{ marginRight: 6, padding: '1px 5px', background: 'var(--surface2)', borderRadius: 3 }}>{n}</span>
              ))}
              {childNodeIds.length > 5 && <span style={{ color: 'var(--text3)' }}>+{childNodeIds.length - 5} more…</span>}
              {childGroupNames.map((n, i) => (
                <span key={`g${i}`} style={{ marginRight: 6, padding: '1px 5px', background: 'var(--surface2)', borderRadius: 3, fontStyle: 'italic' }}>⬡ {n}</span>
              ))}
              {childGroupIds.length > 3 && <span style={{ color: 'var(--text3)' }}>+{childGroupIds.length - 3} more groups…</span>}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          {mode === 'edit' && (
            <button className={styles.deleteBtn} onClick={handleDelete}>
              Dissolve Group
            </button>
          )}
          <button className={styles.cancelBtn} onClick={() => setIsOpen(false)}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave}>
            {mode === 'create' ? 'Create Group' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
