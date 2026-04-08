/**
 * components/Panels/Inspector.tsx — Right pane showing selected node details.
 *
 * Opens automatically when a node is clicked (selectedNodeId changes to non-null).
 * Can also be toggled open/closed by the Header's ▣ button via the custom event
 * 'flowgraph:toggle-inspector'.
 *
 * Shows: name, ID, description, owner (coloured tag), dependency tags.
 * In Design Mode an "Edit Node" button appears that opens the node-edit modal.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import styles from './Inspector.module.css';

export function Inspector() {
  const {
    selectedNodeId, allNodes, ownerColors, setSelectedNode, designMode,
    selectedGroupId, groups, setSelectedGroup,
    selectedPhaseId, phases, setSelectedPhaseId, deletePhase,
  } = useGraphStore();

  const selectedNode = selectedNodeId
    ? allNodes.find((node) => node.id === selectedNodeId)
    : null;

  const selectedGroup = selectedGroupId
    ? groups.find((g) => g.id === selectedGroupId)
    : null;

  const selectedPhase = selectedPhaseId
    ? phases.find((p) => p.id === selectedPhaseId)
    : null;

  const hasSelection = !!selectedNode || !!selectedGroup || !!selectedPhase;

  // ── userOpen: the user-controlled open state ──────────────────────────
  const [userOpen, setUserOpen] = useState(false);
  const prevSelectedIdRef = useRef<string | null>(null);
  const prevGroupIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== prevSelectedIdRef.current) {
      setUserOpen(true);
    }
    prevSelectedIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    if (selectedGroupId && selectedGroupId !== prevGroupIdRef.current) {
      setUserOpen(true);
    }
    prevGroupIdRef.current = selectedGroupId;
  }, [selectedGroupId]);

  useEffect(() => {
    if (selectedPhaseId) setUserOpen(true);
  }, [selectedPhaseId]);

  // ── Listen for the header ▣ toggle button ─────────────────────────────
  useEffect(() => {
    function handleToggle() {
      setUserOpen((open) => !open);
    }
    document.addEventListener('flowgraph:toggle-inspector', handleToggle);
    return () => document.removeEventListener('flowgraph:toggle-inspector', handleToggle);
  }, []);

  const isOpen = hasSelection && userOpen;

  function handleClose() {
    setUserOpen(false);
    setSelectedNode(null);
    setSelectedGroup(null);
    setSelectedPhaseId(null);
  }

  function handleEditClick() {
    if (selectedNode) {
      document.dispatchEvent(
        new CustomEvent('flowgraph:edit-node', { detail: { nodeId: selectedNode.id } })
      );
    }
  }

  function handleEditGroupClick() {
    if (selectedGroup) {
      document.dispatchEvent(
        new CustomEvent('flowgraph:edit-group', { detail: { groupId: selectedGroup.id } })
      );
    }
  }

  return (
    <div className={`${styles.rightPane} ${!isOpen ? styles.collapsed : ''}`}>
      <div className={styles.header}>
        <span>Inspector</span>
        <button
          className={styles.collapseBtn}
          onClick={handleClose}
          title="Close inspector"
        >«</button>
      </div>

      <div className={styles.body}>
        {!hasSelection ? (
          <div className={styles.empty}>Select a node, group, or phase to view its details.</div>
        ) : selectedPhase ? (
          /* ── Phase details ──────────────────────────────────────────── */
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 12, height: 12, borderRadius: '50%',
                background: selectedPhase.color, flexShrink: 0, display: 'inline-block',
              }} />
              <div className={styles.name}>{selectedPhase.name}</div>
            </div>
            <div className={styles.sub}>Phase ID: {selectedPhase.id} · Seq: {selectedPhase.sequence + 1}</div>

            <div className={styles.section}>Description</div>
            <div className={styles.desc}>
              {selectedPhase.description || 'No description provided.'}
            </div>

            <div className={styles.section}>
              Nodes ({selectedPhase.nodeIds.length})
            </div>
            <div className={styles.tags}>
              {selectedPhase.nodeIds.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>No nodes assigned.</span>
              ) : (
                selectedPhase.nodeIds.slice(0, 8).map((nid) => {
                  const n = allNodes.find((node) => node.id === nid);
                  return (
                    <span key={nid} className={`${styles.tag} ${styles.tagDep}`}>
                      {n ? n.name : nid}
                    </span>
                  );
                })
              )}
              {selectedPhase.nodeIds.length > 8 && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  +{selectedPhase.nodeIds.length - 8} more…
                </span>
              )}
            </div>

            {designMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent('flowgraph:edit-phase', { detail: { phaseId: selectedPhase.id } }))}
                  style={{
                    width: '100%', padding: '8px 0', borderRadius: 5,
                    border: '1px solid #4A90D9',
                    background: 'rgba(74,144,217,0.1)',
                    color: '#4A90D9',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11, fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ✏️ Edit Phase
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete phase "${selectedPhase.name}"?`)) {
                      deletePhase(selectedPhase.id);
                      setSelectedPhaseId(null);
                    }
                  }}
                  style={{
                    width: '100%', padding: '8px 0', borderRadius: 5,
                    border: '1px solid var(--danger, #e74c3c)',
                    background: 'rgba(231,76,60,0.08)',
                    color: 'var(--danger, #e74c3c)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11, fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  🗑 Delete Phase
                </button>
              </div>
            )}
          </>
        ) : selectedGroup ? (
          /* ── Group details ──────────────────────────────────────────── */
          <>
            <div className={styles.name}>{selectedGroup.name}</div>
            <div className={styles.sub}>Group ID: {selectedGroup.id}</div>

            <div className={styles.section}>Description</div>
            <div className={styles.desc}>
              {selectedGroup.description || 'No description provided.'}
            </div>

            <div className={styles.section}>Owner(s)</div>
            <div className={styles.tags}>
              {selectedGroup.owners.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>None</span>
              ) : (
                selectedGroup.owners.map((o) => (
                  <span
                    key={o}
                    className={styles.tag}
                    style={{
                      borderColor: ownerColors[o] ?? 'var(--accent)',
                      color: ownerColors[o] ?? 'var(--accent)',
                    }}
                  >
                    {o}
                  </span>
                ))
              )}
            </div>

            <div className={styles.section}>
              Children ({selectedGroup.childNodeIds.length} nodes
              {selectedGroup.childGroupIds.length > 0
                ? `, ${selectedGroup.childGroupIds.length} groups`
                : ''})
            </div>
            <div className={styles.tags}>
              {selectedGroup.childNodeIds.slice(0, 8).map((nid) => {
                const n = allNodes.find((node) => node.id === nid);
                return (
                  <span key={nid} className={`${styles.tag} ${styles.tagDep}`}>
                    {n ? n.name : nid}
                  </span>
                );
              })}
              {selectedGroup.childNodeIds.length > 8 && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  +{selectedGroup.childNodeIds.length - 8} more…
                </span>
              )}
            </div>

            <div className={styles.section}>Status</div>
            <div className={styles.tags}>
              <span className={styles.tag} style={{ borderColor: 'var(--accent3)', color: 'var(--accent3)' }}>
                {selectedGroup.collapsed ? 'Collapsed' : 'Expanded'}
              </span>
            </div>

            {designMode && (
              <button
                onClick={handleEditGroupClick}
                style={{
                  marginTop: 16, width: '100%',
                  padding: '8px 0', borderRadius: 5,
                  border: '1px solid var(--design)',
                  background: 'rgba(167,139,250,.1)',
                  color: 'var(--design)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✏️ Edit Group
              </button>
            )}
          </>
        ) : selectedNode ? (
          /* ── Node details ───────────────────────────────────────────── */
          <>
            <div className={styles.name}>{selectedNode.name}</div>
            <div className={styles.sub}>ID: {selectedNode.id}</div>

            <div className={styles.section}>Description</div>
            <div className={styles.desc}>
              {selectedNode.description || 'No description provided.'}
            </div>

            <div className={styles.section}>Owner</div>
            <div className={styles.tags}>
              <span
                className={styles.tag}
                style={{
                  borderColor: ownerColors[selectedNode.owner] ?? 'var(--accent)',
                  color: ownerColors[selectedNode.owner] ?? 'var(--accent)',
                }}
              >
                {selectedNode.owner}
              </span>
            </div>

            <div className={styles.section}>Dependencies</div>
            <div className={styles.tags}>
              {selectedNode.dependencies.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>No dependencies</span>
              ) : (
                selectedNode.dependencies.map((depId) => {
                  const depNode = allNodes.find((n) => n.id === depId);
                  return (
                    <span key={depId} className={`${styles.tag} ${styles.tagDep}`}>
                      {depNode ? depNode.name : depId}
                    </span>
                  );
                })
              )}
            </div>

            {/* Edit button — only shown in design mode */}
            {designMode && (
              <button
                onClick={handleEditClick}
                style={{
                  marginTop: 16, width: '100%',
                  padding: '8px 0', borderRadius: 5,
                  border: '1px solid var(--design)',
                  background: 'rgba(167,139,250,.1)',
                  color: 'var(--design)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✏️ Edit Node
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
