/**
 * components/Panels/Inspector.tsx — Pure content component for node/group/phase details.
 *
 * This component renders the inspector body only — no outer pane wrapper.
 * It is consumed as a tab inside the LeftPane (Sidebar.tsx).
 *
 * Shows: name, ID, description, owner (coloured tag), dependency tags.
 * In Design Mode an "Edit Node" / "Edit Group" / "Edit Phase" button appears.
 */

import React, { useState, useEffect } from 'react';
import { useGraphStore } from '../../store/graphStore';
import type { PathType } from '../../types/graph';
import { PHASE_PALETTE } from '../../types/graph';
import { ColorSwatchPicker } from '../DesignMode/ColorSwatchPicker';
import styles from './Inspector.module.css';

export function InspectorContent() {
  const {
    selectedNodeId, allNodes, ownerColors, setSelectedNode, designMode,
    selectedGroupId, groups, setSelectedGroup,
    selectedPhaseId, phases, setSelectedPhaseId, deletePhase, updatePhase,
    assignNodesToPhase, removeNodesFromPhase,
    assignGroupsToPhase, removeGroupsFromPhase,
    createPhase,
    tagRegistry, addTagToRegistry,
    ownerRegistry, setOwnerColor,
    multiSelectIds, updateNodeCinemaFields, updateGroupCinemaFields,
    pathHighlightNodeId, pathHighlightMode, setPathHighlight, allEdges,
    positions, flyTo, setLastJumpedNode,
    edgePathTypes, setEdgePathType,
    updateNode, updateGroup, deleteNode, deleteGroup, deleteEdge,
  } = useGraphStore();

  const [scriptDraft, setScriptDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [phaseNameDraft, setPhaseNameDraft] = useState('');
  const [phaseDescDraft, setPhaseDescDraft] = useState('');
  const [phaseColorDraft, setPhaseColorDraft] = useState<string>(PHASE_PALETTE[0]);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState<string>(PHASE_PALETTE[0]);
  const [showNewPhaseForm, setShowNewPhaseForm] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseColor, setNewPhaseColor] = useState<string>(PHASE_PALETTE[0]);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [newOwnerColor, setNewOwnerColor] = useState<string>(PHASE_PALETTE[0]);
  const [dependenciesOpen, setDependenciesOpen] = useState(true);
  const [dependentsOpen, setDependentsOpen] = useState(true);
  const [incomingEdgesOpen, setIncomingEdgesOpen] = useState(true);
  const [outgoingEdgesOpen, setOutgoingEdgesOpen] = useState(true);
  const [cinemaOpen, setCinemaOpen] = useState(true);

  const selectedNode = selectedNodeId
    ? allNodes.find((node) => node.id === selectedNodeId)
    : null;

  const selectedGroup = selectedGroupId
    ? groups.find((g) => g.id === selectedGroupId)
    : null;

  // Sync drafts when selection changes
  useEffect(() => {
    setShowNewTagForm(false);
    setShowNewPhaseForm(false);
    setOwnerDraft('');
    if (selectedNode) {
      setScriptDraft(selectedNode.cinemaScript ?? '');
      setNameDraft(selectedNode.name);
      setDescDraft(selectedNode.description);
    } else if (selectedGroup) {
      setScriptDraft(selectedGroup.cinemaScript ?? '');
      setNameDraft(selectedGroup.name);
      setDescDraft(selectedGroup.description);
    } else {
      setScriptDraft('');
      setNameDraft('');
      setDescDraft('');
    }
  }, [selectedNodeId, selectedGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPhase = selectedPhaseId
    ? phases.find((p) => p.id === selectedPhaseId)
    : null;

  useEffect(() => {
    if (selectedPhase) {
      setPhaseNameDraft(selectedPhase.name);
      setPhaseDescDraft(selectedPhase.description);
      setPhaseColorDraft(selectedPhase.color);
    }
  }, [selectedPhaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSelection = !!selectedNode || !!selectedGroup || !!selectedPhase;

  function commitNodeName() {
    if (!selectedNode) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== selectedNode.name) updateNode(selectedNode.id, { name: trimmed });
    else setNameDraft(selectedNode.name);
  }

  function commitNodeDesc() {
    if (!selectedNode) return;
    if (descDraft !== selectedNode.description) updateNode(selectedNode.id, { description: descDraft });
  }

  function commitGroupName() {
    if (!selectedGroup) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== selectedGroup.name) updateGroup(selectedGroup.id, { name: trimmed });
    else setNameDraft(selectedGroup.name);
  }

  function commitGroupDesc() {
    if (!selectedGroup) return;
    if (descDraft !== selectedGroup.description) updateGroup(selectedGroup.id, { description: descDraft });
  }

  function navigateTo(id: string, childNodeIds?: string[]) {
    const canvasEl = document.getElementById('canvas-wrap');
    if (!canvasEl) return;
    const { width: W, height: H } = canvasEl.getBoundingClientRect();
    const NODE_W = 180, NODE_H = 72;

    let pos = positions[id];

    // Expanded group: derive center from child node positions
    if (!pos && childNodeIds && childNodeIds.length > 0) {
      const pts = childNodeIds.map((nid) => positions[nid]).filter(Boolean) as { x: number; y: number }[];
      if (pts.length > 0) {
        pos = {
          x: pts.reduce((s, p) => s + p.x + NODE_W / 2, 0) / pts.length - NODE_W / 2,
          y: pts.reduce((s, p) => s + p.y + NODE_H / 2, 0) / pts.length - NODE_H / 2,
        };
      }
    }

    if (!pos) return;
    const targetScale = 0.75;
    flyTo({ x: W / 2 - (pos.x + NODE_W / 2) * targetScale, y: H / 2 - (pos.y + NODE_H / 2) * targetScale, k: targetScale });
    setLastJumpedNode(id);
  }

  if (multiSelectIds.length > 1) {
    return (
      <div className={styles.empty}>
        {multiSelectIds.length} items selected.
      </div>
    );
  }

  if (!hasSelection) {
    return (
      <div className={styles.empty}>
        Select a node, group, or phase to view its details.
      </div>
    );
  }

  if (selectedPhase) {
    function navigateToPhase() {
      const canvasEl = document.getElementById('canvas-wrap');
      if (!canvasEl) return;
      const { width: W, height: H } = canvasEl.getBoundingClientRect();
      const NODE_W = 180, NODE_H = 72;
      const pts = selectedPhase!.nodeIds
        .map((nid) => positions[nid])
        .filter(Boolean) as { x: number; y: number }[];
      if (pts.length === 0) return;
      const cx = pts.reduce((s, p) => s + p.x + NODE_W / 2, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y + NODE_H / 2, 0) / pts.length;
      const targetScale = 0.75;
      flyTo({ x: W / 2 - cx * targetScale, y: H / 2 - cy * targetScale, k: targetScale });
    }

    function commitPhaseName() {
      const trimmed = phaseNameDraft.trim();
      if (trimmed && trimmed !== selectedPhase!.name) updatePhase(selectedPhase!.id, { name: trimmed });
      else setPhaseNameDraft(selectedPhase!.name);
    }

    function commitPhaseDesc() {
      if (phaseDescDraft !== selectedPhase!.description)
        updatePhase(selectedPhase!.id, { description: phaseDescDraft });
    }

    function resetPhaseDrafts() {
      setPhaseNameDraft(selectedPhase!.name);
      setPhaseDescDraft(selectedPhase!.description);
      setPhaseColorDraft(selectedPhase!.color);
    }

    return (
      <>
        {/* Header row: color dot · name · action buttons */}
        <div className={styles.nameRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 }}>
            <span style={{
              width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
              background: phaseColorDraft, display: 'inline-block',
            }} />
            {designMode
              ? <textarea
                  rows={2}
                  className={styles.nameInput}
                  value={phaseNameDraft}
                  onChange={(e) => setPhaseNameDraft(e.target.value)}
                  onBlur={commitPhaseName}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLTextAreaElement).blur(); }}
                />
              : <div className={styles.name}>{selectedPhase.name}</div>
            }
          </div>
          <div className={styles.btnRow}>
            <button className={styles.actionBtn} title="Fly to phase" onClick={navigateToPhase}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="3"/>
                <line x1="7" y1="0" x2="7" y2="3.5"/>
                <line x1="7" y1="10.5" x2="7" y2="14"/>
                <line x1="0" y1="7" x2="3.5" y2="7"/>
                <line x1="10.5" y1="7" x2="14" y2="7"/>
              </svg>
            </button>
            {designMode && (
              <>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnCancel}`}
                  title="Reset edits to last saved"
                  onClick={resetPhaseDrafts}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                    <polyline points="2,3.5 2,6.5 5,6.5"/>
                  </svg>
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                  title="Delete phase"
                  onClick={() => {
                    deletePhase(selectedPhase.id);
                    setSelectedPhaseId(null);
                  }}
                >
                  <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,3 11,3"/>
                    <path d="M4,3V1.5h4V3"/>
                    <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                    <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                    <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        {designMode && (
          <div style={{ padding: '6px 0 2px 0' }}>
            <ColorSwatchPicker
              value={phaseColorDraft}
              onChange={(color) => {
                setPhaseColorDraft(color);
                updatePhase(selectedPhase.id, { color });
              }}
            />
          </div>
        )}

        <div className={styles.sub}>Seq: {selectedPhase.sequence + 1}</div>

        <div className={styles.section}>Description</div>
        {designMode
          ? <textarea
              className={styles.descTextarea}
              value={phaseDescDraft}
              onChange={(e) => setPhaseDescDraft(e.target.value)}
              onBlur={commitPhaseDesc}
              placeholder="No description provided."
            />
          : <div className={styles.desc}>
              {selectedPhase.description || 'No description provided.'}
            </div>
        }

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
      </>
    );
  }

  if (selectedGroup) {
    return (
      <>
        <div className={styles.nameRow}>
          {designMode
            ? <textarea
                rows={2}
                className={styles.nameInput}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitGroupName}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLTextAreaElement).blur(); }}
              />
            : <div className={styles.name}>{selectedGroup.name}</div>
          }
          <div className={styles.btnRow}>
            <button className={styles.actionBtn} title="Locate on canvas" onClick={() => navigateTo(selectedGroup.id, selectedGroup.childNodeIds)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="3"/>
                <line x1="7" y1="0" x2="7" y2="3.5"/>
                <line x1="7" y1="10.5" x2="7" y2="14"/>
                <line x1="0" y1="7" x2="3.5" y2="7"/>
                <line x1="10.5" y1="7" x2="14" y2="7"/>
              </svg>
            </button>
            {designMode && (
              <>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnCancel}`}
                  title="Reset edits to last saved"
                  onClick={() => { setNameDraft(selectedGroup.name); setDescDraft(selectedGroup.description); }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                    <polyline points="2,3.5 2,6.5 5,6.5"/>
                  </svg>
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                  title="Delete group"
                  onClick={() => {
                    deleteGroup(selectedGroup.id);
                    setSelectedGroup(null);
                  }}
                >
                  <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,3 11,3"/>
                    <path d="M4,3V1.5h4V3"/>
                    <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                    <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                    <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        <div className={styles.section}>Description</div>
        {designMode
          ? <textarea
              className={styles.descTextarea}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={commitGroupDesc}
              placeholder="No description provided."
            />
          : <div className={styles.desc}>
              {selectedGroup.description || 'No description provided.'}
            </div>
        }

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

        {designMode && selectedGroup.collapsed && (() => {
          const allDescendantIds = new Set<string>();
          const queue = [selectedGroup.id];
          while (queue.length > 0) {
            const gid = queue.shift()!;
            const g = groups.find((gr) => gr.id === gid);
            if (!g) continue;
            g.childNodeIds.forEach((id) => allDescendantIds.add(id));
            g.childGroupIds.forEach((id) => queue.push(id));
          }
          const outgoing = allEdges.filter((e) => allDescendantIds.has(e.from) && !allDescendantIds.has(e.to));
          const incoming = allEdges.filter((e) => !allDescendantIds.has(e.from) && allDescendantIds.has(e.to));
          if (outgoing.length === 0 && incoming.length === 0) return null;
          return (
            <>
              {incoming.length > 0 && (
                <CollapsibleSection title={`Incoming (${incoming.length})`} open={incomingEdgesOpen} onToggle={() => setIncomingEdgesOpen((o) => !o)}>
                  {incoming.map((edge) => {
                    const source = allNodes.find((n) => n.id === edge.from);
                    const edgeKey = `${edge.from}:${edge.to}`;
                    const currentType: PathType = edgePathTypes[edgeKey] ?? 'required';
                    return (
                      <EdgeTypeRow
                        key={edgeKey}
                        label={source?.name ?? edge.from}
                        currentType={currentType}
                        onTypeChange={(t) => setEdgePathType(edgeKey, t)}
                        onLabelClick={() => setSelectedNode(edge.from)}
                        onDelete={() => deleteEdge(edge.from, edge.to)}
                      />
                    );
                  })}
                </CollapsibleSection>
              )}
              {outgoing.length > 0 && (
                <CollapsibleSection title={`Outgoing (${outgoing.length})`} open={outgoingEdgesOpen} onToggle={() => setOutgoingEdgesOpen((o) => !o)}>
                  {outgoing.map((edge) => {
                    const target = allNodes.find((n) => n.id === edge.to);
                    const edgeKey = `${edge.from}:${edge.to}`;
                    const currentType: PathType = edgePathTypes[edgeKey] ?? 'required';
                    return (
                      <EdgeTypeRow
                        key={edgeKey}
                        label={target?.name ?? edge.to}
                        currentType={currentType}
                        onTypeChange={(t) => setEdgePathType(edgeKey, t)}
                        onLabelClick={() => setSelectedNode(edge.to)}
                        onDelete={() => deleteEdge(edge.from, edge.to)}
                      />
                    );
                  })}
                </CollapsibleSection>
              )}
            </>
          );
        })()}

        {(() => {
          const groupPhase = phases.find((p) => (p.groupIds ?? []).includes(selectedGroup.id));
          return (
            <>
              <div className={styles.section}>Phase</div>
              {designMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {phases.length > 0 && (
                    <select
                      value={groupPhase?.id ?? ''}
                      onChange={(e) => {
                        if (e.target.value === '') removeGroupsFromPhase([selectedGroup.id]);
                        else assignGroupsToPhase([selectedGroup.id], e.target.value);
                      }}
                      style={{
                        background: 'var(--bg3)', border: '1px solid var(--border2)',
                        borderRadius: 4, color: groupPhase ? groupPhase.color : 'var(--text3)',
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        padding: '4px 6px', cursor: 'pointer', width: '100%',
                      }}
                    >
                      <option value="" style={{ color: 'var(--text3)' }}>Unassigned</option>
                      {phases.map((p) => (
                        <option key={p.id} value={p.id} style={{ color: p.color }}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  {!showNewPhaseForm ? (
                    <button
                      onClick={() => { setShowNewPhaseForm(true); setNewPhaseName(''); setNewPhaseColor(PHASE_PALETTE[0]); }}
                      style={{
                        background: 'none', border: '1px dashed var(--border2)',
                        borderRadius: 4, color: 'var(--text3)', fontFamily: 'var(--font-mono)',
                        fontSize: 11, padding: '4px 8px', cursor: 'pointer', textAlign: 'left',
                      }}
                    >+ New phase</button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 4, border: '1px solid var(--border2)' }}>
                      <input
                        autoFocus
                        placeholder="Phase name"
                        value={newPhaseName}
                        onChange={(e) => setNewPhaseName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setShowNewPhaseForm(false); }}
                        style={{
                          background: 'var(--bg2)', border: '1px solid var(--border2)',
                          borderRadius: 3, color: 'var(--text1)', fontFamily: 'var(--font-mono)',
                          fontSize: 11, padding: '3px 6px', outline: 'none',
                        }}
                      />
                      <ColorSwatchPicker value={newPhaseColor} onChange={setNewPhaseColor} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => {
                            const trimmed = newPhaseName.trim();
                            if (!trimmed) return;
                            createPhase([], { name: trimmed, description: '', color: newPhaseColor }, [selectedGroup.id]);
                            setShowNewPhaseForm(false);
                          }}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: 4,
                            border: '1px solid var(--accent)', background: 'rgba(99,102,241,0.12)',
                            color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
                            fontWeight: 700, cursor: 'pointer',
                          }}
                        >Add</button>
                        <button
                          onClick={() => setShowNewPhaseForm(false)}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: 4,
                            border: '1px solid var(--border2)', background: 'none',
                            color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.tags}>
                  {groupPhase ? (
                    <span className={styles.tag} style={{ borderColor: groupPhase.color, color: groupPhase.color }}>
                      {groupPhase.name}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>Unassigned</span>
                  )}
                </div>
              )}
            </>
          );
        })()}

        {/* Cinema author fields — design mode only */}
        {designMode && (
          <CinemaAuthorFields
            scriptDraft={scriptDraft}
            onScriptChange={setScriptDraft}
            onScriptBlur={() => updateGroupCinemaFields(selectedGroup.id, { cinemaScript: scriptDraft || undefined })}
            bottleneck={!!selectedGroup.cinemaBottleneck}
            onBottleneckChange={(v) => updateGroupCinemaFields(selectedGroup.id, { cinemaBottleneck: v || undefined })}
            skip={!!selectedGroup.cinemaSkip}
            onSkipChange={(v) => updateGroupCinemaFields(selectedGroup.id, { cinemaSkip: v || undefined })}
            open={cinemaOpen}
            onToggle={() => setCinemaOpen((o) => !o)}
          />
        )}
      </>
    );
  }

  if (selectedNode) {
    const activePathMode = !designMode && pathHighlightNodeId === selectedNode.id ? pathHighlightMode : null;
    let ancestorCount = 0;
    let descendantCount = 0;
    if (!designMode) {
      const av = new Set<string>();
      const aq = [selectedNode.id];
      while (aq.length > 0) {
        const cur = aq.shift()!;
        for (const edge of allEdges) {
          if (edge.to === cur && !av.has(edge.from)) { av.add(edge.from); aq.push(edge.from); }
        }
      }
      ancestorCount = av.size;
      const dv = new Set<string>();
      const dq = [selectedNode.id];
      while (dq.length > 0) {
        const cur = dq.shift()!;
        for (const edge of allEdges) {
          if (edge.from === cur && !dv.has(edge.to)) { dv.add(edge.to); dq.push(edge.to); }
        }
      }
      descendantCount = dv.size;
    }
    const handlePathClick = (mode: 'ancestors' | 'descendants' | 'both') => {
      if (activePathMode === mode) setPathHighlight(null);
      else setPathHighlight(selectedNode.id, mode);
    };
    let pathCountLine: string | null = null;
    if (activePathMode === 'ancestors') {
      pathCountLine = ancestorCount === 0 ? 'No ancestors — this is a root node' : `${ancestorCount} ancestor node${ancestorCount !== 1 ? 's' : ''}`;
    } else if (activePathMode === 'descendants') {
      pathCountLine = descendantCount === 0 ? 'No descendants — this is a terminal node' : `${descendantCount} descendant node${descendantCount !== 1 ? 's' : ''}`;
    } else if (activePathMode === 'both') {
      const parts: string[] = [];
      if (ancestorCount > 0) parts.push(`${ancestorCount} ancestor${ancestorCount !== 1 ? 's' : ''}`);
      if (descendantCount > 0) parts.push(`${descendantCount} descendant${descendantCount !== 1 ? 's' : ''}`);
      pathCountLine = parts.length > 0 ? parts.join(', ') : 'Root and terminal node';
    }

    return (
      <>
        <div className={styles.nameRow}>
          {designMode
            ? <textarea
                rows={2}
                className={styles.nameInput}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitNodeName}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLTextAreaElement).blur(); }}
              />
            : <div className={styles.name}>{selectedNode.name}</div>
          }
          <div className={styles.btnRow}>
            <button className={styles.actionBtn} title="Locate on canvas" onClick={() => navigateTo(selectedNode.id)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="3"/>
                <line x1="7" y1="0" x2="7" y2="3.5"/>
                <line x1="7" y1="10.5" x2="7" y2="14"/>
                <line x1="0" y1="7" x2="3.5" y2="7"/>
                <line x1="10.5" y1="7" x2="14" y2="7"/>
              </svg>
            </button>
            {!designMode && (
              <>
                <button
                  className={styles.actionBtn}
                  style={activePathMode === 'ancestors' ? { color: '#22d3ee', borderColor: '#22d3ee', background: '#22d3ee26' } : {}}
                  title="Highlight ancestors"
                  onClick={() => handlePathClick('ancestors')}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="11" y1="6.5" x2="3" y2="6.5"/>
                    <polyline points="6,3.5 3,6.5 6,9.5"/>
                  </svg>
                </button>
                <button
                  className={styles.actionBtn}
                  style={activePathMode === 'descendants' ? { color: '#f59e0b', borderColor: '#f59e0b', background: '#f59e0b26' } : {}}
                  title="Highlight descendants"
                  onClick={() => handlePathClick('descendants')}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="2" y1="6.5" x2="10" y2="6.5"/>
                    <polyline points="7,3.5 10,6.5 7,9.5"/>
                  </svg>
                </button>
                <button
                  className={styles.actionBtn}
                  style={activePathMode === 'both' ? { color: '#a78bfa', borderColor: '#a78bfa', background: '#a78bfa26' } : {}}
                  title="Highlight lineage"
                  onClick={() => handlePathClick('both')}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="2" y1="6.5" x2="11" y2="6.5"/>
                    <polyline points="5,3.5 2,6.5 5,9.5"/>
                    <polyline points="8,3.5 11,6.5 8,9.5"/>
                  </svg>
                </button>
              </>
            )}
            {designMode && (
              <>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnCancel}`}
                  title="Reset edits to last saved"
                  onClick={() => { setNameDraft(selectedNode.name); setDescDraft(selectedNode.description); }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                    <polyline points="2,3.5 2,6.5 5,6.5"/>
                  </svg>
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                  title="Delete node"
                  onClick={() => {
                    deleteNode(selectedNode.id);
                    setSelectedNode(null);
                  }}
                >
                  <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,3 11,3"/>
                    <path d="M4,3V1.5h4V3"/>
                    <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                    <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                    <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        {pathCountLine && <div className={styles.countHint}>{pathCountLine}</div>}

        <div className={styles.section}>Description</div>
        {designMode
          ? <textarea
              className={styles.descTextarea}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={commitNodeDesc}
              placeholder="No description provided."
            />
          : <div className={styles.desc}>
              {selectedNode.description || 'No description provided.'}
            </div>
        }

        <div className={styles.section}>Owner</div>
        {designMode ? (() => {
          const allOwners = [...new Set([
            ...allNodes.map((n) => n.owner),
            ...ownerRegistry,
          ])].filter(Boolean).sort();
          const currentColor = ownerColors[selectedNode.owner] ?? 'var(--accent)';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allOwners.length > 0 && (
                <select
                  value={selectedNode.owner}
                  onChange={(e) => { if (e.target.value) updateNode(selectedNode.id, { owner: e.target.value }); }}
                  style={{
                    background: 'var(--bg3)', border: '1px solid var(--border2)',
                    borderRadius: 4, color: currentColor,
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    padding: '4px 6px', cursor: 'pointer', width: '100%',
                  }}
                >
                  {allOwners.map((o) => (
                    <option key={o} value={o} style={{ color: ownerColors[o] ?? 'var(--accent)' }}>{o}</option>
                  ))}
                </select>
              )}
              {!ownerDraft ? (
                <button
                  onClick={() => { setOwnerDraft(' '); setNewOwnerColor(PHASE_PALETTE[0]); }}
                  style={{
                    background: 'none', border: '1px dashed var(--border2)',
                    borderRadius: 4, color: 'var(--text3)', fontFamily: 'var(--font-mono)',
                    fontSize: 11, padding: '4px 8px', cursor: 'pointer', textAlign: 'left',
                  }}
                >+ New owner</button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 4, border: '1px solid var(--border2)' }}>
                  <input
                    autoFocus
                    placeholder="Owner name"
                    value={ownerDraft.trim()}
                    onChange={(e) => setOwnerDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setOwnerDraft(''); }}
                    style={{
                      background: 'var(--bg2)', border: '1px solid var(--border2)',
                      borderRadius: 3, color: 'var(--text1)', fontFamily: 'var(--font-mono)',
                      fontSize: 11, padding: '3px 6px', outline: 'none',
                    }}
                  />
                  <ColorSwatchPicker value={newOwnerColor} onChange={setNewOwnerColor} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => {
                        const trimmed = ownerDraft.trim();
                        if (!trimmed) return;
                        updateNode(selectedNode.id, { owner: trimmed });
                        setOwnerColor(trimmed, newOwnerColor);
                        setOwnerDraft('');
                      }}
                      style={{
                        flex: 1, padding: '4px 0', borderRadius: 4,
                        border: '1px solid var(--accent)', background: 'rgba(99,102,241,0.12)',
                        color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
                        fontWeight: 700, cursor: 'pointer',
                      }}
                    >Add</button>
                    <button
                      onClick={() => setOwnerDraft('')}
                      title="Cancel"
                      style={{
                        padding: '4px 8px', borderRadius: 4,
                        border: '1px solid var(--border2)', background: 'none',
                        color: 'var(--text3)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                        <polyline points="2,3.5 2,6.5 5,6.5"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })() : (
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
        )}

        {!designMode && (
          <>
            <CollapsibleSection
              title={`Dependencies (${selectedNode.dependencies.length})`}
              open={dependenciesOpen}
              onToggle={() => setDependenciesOpen((o) => !o)}
            >
              {selectedNode.dependencies.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>No dependencies</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '0 -6px' }}>
                  {selectedNode.dependencies.map((depId) => {
                    const depNode = allNodes.find((n) => n.id === depId);
                    const edgeKey = `${depId}:${selectedNode.id}`;
                    const pathType: PathType = edgePathTypes[edgeKey] ?? 'standard';
                    return (
                      <DepConnectionRow
                        key={depId}
                        label={depNode ? depNode.name : depId}
                        type={pathType}
                        ownerColor={depNode ? ownerColors[depNode.owner] : undefined}
                        onClick={() => navigateTo(depId)}
                      />
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>

            {(() => {
              const dependentIds = allEdges
                .filter((e) => e.from === selectedNode.id)
                .map((e) => e.to);
              return (
                <CollapsibleSection
                  title={`Dependents (${dependentIds.length})`}
                  open={dependentsOpen}
                  onToggle={() => setDependentsOpen((o) => !o)}
                >
                  {dependentIds.length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>No dependents</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '0 -6px' }}>
                      {dependentIds.map((depId) => {
                        const depNode = allNodes.find((n) => n.id === depId);
                        const edgeKey = `${selectedNode.id}:${depId}`;
                        const pathType: PathType = edgePathTypes[edgeKey] ?? 'standard';
                        return (
                          <DepConnectionRow
                            key={depId}
                            label={depNode ? depNode.name : depId}
                            type={pathType}
                            ownerColor={depNode ? ownerColors[depNode.owner] : undefined}
                            onClick={() => navigateTo(depId)}
                          />
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSection>
              );
            })()}
          </>
        )}

        {designMode && (() => {
          const outgoing = allEdges.filter((e) => e.from === selectedNode.id);
          const incoming = allEdges.filter((e) => e.to === selectedNode.id);
          if (outgoing.length === 0 && incoming.length === 0) return (
            <div className={styles.emptyConnections}>
              No connections yet.{' '}
              <button
                className={styles.summonHint}
                onClick={() => useGraphStore.getState().activateSummon(selectedNode.id)}
              >
                ✨ Summon nodes to connect
              </button>
            </div>
          );
          return (
            <>
              {incoming.length > 0 && (
                <CollapsibleSection title={`Incoming (${incoming.length})`} open={incomingEdgesOpen} onToggle={() => setIncomingEdgesOpen((o) => !o)}>
                  {incoming.map((edge) => {
                    const source = allNodes.find((n) => n.id === edge.from);
                    const edgeKey = `${edge.from}:${edge.to}`;
                    const currentType: PathType = edgePathTypes[edgeKey] ?? 'required';
                    return (
                      <EdgeTypeRow
                        key={edgeKey}
                        label={source?.name ?? edge.from}
                        currentType={currentType}
                        onTypeChange={(t) => setEdgePathType(edgeKey, t)}
                        onLabelClick={() => setSelectedNode(edge.from)}
                        onDelete={() => deleteEdge(edge.from, edge.to)}
                      />
                    );
                  })}
                </CollapsibleSection>
              )}
              {outgoing.length > 0 && (
                <CollapsibleSection title={`Outgoing (${outgoing.length})`} open={outgoingEdgesOpen} onToggle={() => setOutgoingEdgesOpen((o) => !o)}>
                  {outgoing.map((edge) => {
                    const target = allNodes.find((n) => n.id === edge.to);
                    const edgeKey = `${edge.from}:${edge.to}`;
                    const currentType: PathType = edgePathTypes[edgeKey] ?? 'required';
                    return (
                      <EdgeTypeRow
                        key={edgeKey}
                        label={target?.name ?? edge.to}
                        currentType={currentType}
                        onTypeChange={(t) => setEdgePathType(edgeKey, t)}
                        onLabelClick={() => setSelectedNode(edge.to)}
                        onDelete={() => deleteEdge(edge.from, edge.to)}
                      />
                    );
                  })}
                </CollapsibleSection>
              )}
            </>
          );
        })()}

        {(designMode || (selectedNode.tags && selectedNode.tags.length > 0)) && (
          <>
            <div className={styles.section}>Tags</div>
            <div className={styles.tags}>
              {(selectedNode.tags ?? []).map((tag, i) => (
                <span
                  key={i}
                  className={styles.tag}
                  style={{
                    borderColor: tag.color,
                    color: tag.color,
                    background: `${tag.color}18`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {tag.label}
                  {designMode && (
                    <button
                      onClick={() => updateNode(selectedNode.id, { tags: (selectedNode.tags ?? []).filter((_, j) => j !== i) })}
                      style={{
                        background: 'none', border: 'none', padding: '0 1px',
                        color: tag.color, cursor: 'pointer', lineHeight: 1,
                        display: 'flex', alignItems: 'center',
                      }}
                      title="Remove tag"
                    >
                      <svg width="10" height="11" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,3 11,3"/>
                        <path d="M4,3V1.5h4V3"/>
                        <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                        <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                        <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                      </svg>
                    </button>
                  )}
                </span>
              ))}
              {(selectedNode.tags ?? []).length === 0 && !designMode && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>None</span>
              )}
            </div>
            {designMode && (() => {
              const existingLabels = new Set((selectedNode.tags ?? []).map((t) => t.label.toLowerCase()));
              const available = tagRegistry.filter((t) => !existingLabels.has(t.label.toLowerCase()));
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {available.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const t = tagRegistry.find((r) => r.label === e.target.value);
                        if (t) updateNode(selectedNode.id, { tags: [...(selectedNode.tags ?? []), t] });
                      }}
                      style={{
                        background: 'var(--bg3)', border: '1px solid var(--border2)',
                        borderRadius: 4, color: 'var(--text2)', fontFamily: 'var(--font-mono)',
                        fontSize: 11, padding: '4px 6px', cursor: 'pointer',
                      }}
                    >
                      <option value="">Add from registry…</option>
                      {available.map((t) => (
                        <option key={t.label} value={t.label}>{t.label}</option>
                      ))}
                    </select>
                  )}
                  {!showNewTagForm ? (
                    <button
                      onClick={() => { setShowNewTagForm(true); setNewTagLabel(''); setNewTagColor(PHASE_PALETTE[0]); }}
                      style={{
                        background: 'none', border: '1px dashed var(--border2)',
                        borderRadius: 4, color: 'var(--text3)', fontFamily: 'var(--font-mono)',
                        fontSize: 11, padding: '4px 8px', cursor: 'pointer', textAlign: 'left',
                      }}
                    >+ New tag</button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 4, border: '1px solid var(--border2)' }}>
                      <input
                        autoFocus
                        placeholder="Tag label"
                        value={newTagLabel}
                        onChange={(e) => setNewTagLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setShowNewTagForm(false); }}
                        style={{
                          background: 'var(--bg2)', border: '1px solid var(--border2)',
                          borderRadius: 3, color: 'var(--text1)', fontFamily: 'var(--font-mono)',
                          fontSize: 11, padding: '3px 6px', outline: 'none',
                        }}
                      />
                      <ColorSwatchPicker value={newTagColor} onChange={setNewTagColor} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => {
                            const trimmed = newTagLabel.trim();
                            if (!trimmed) return;
                            const newTag = { label: trimmed, color: newTagColor };
                            addTagToRegistry(newTag);
                            updateNode(selectedNode.id, { tags: [...(selectedNode.tags ?? []), newTag] });
                            setShowNewTagForm(false);
                          }}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: 4,
                            border: '1px solid var(--accent)', background: 'rgba(99,102,241,0.12)',
                            color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
                            fontWeight: 700, cursor: 'pointer',
                          }}
                        >Add</button>
                        <button
                          onClick={() => setShowNewTagForm(false)}
                          title="Cancel"
                          style={{
                            padding: '4px 8px', borderRadius: 4,
                            border: '1px solid var(--border2)', background: 'none',
                            color: 'var(--text3)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                            <polyline points="2,3.5 2,6.5 5,6.5"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {(() => {
          const nodePhase = phases.find((p) => p.nodeIds.includes(selectedNode.id));
          return (
            <>
              <div className={styles.section}>Phase</div>
              {designMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {phases.length > 0 && (
                    <select
                      value={nodePhase?.id ?? ''}
                      onChange={(e) => {
                        if (e.target.value === '') removeNodesFromPhase([selectedNode.id]);
                        else assignNodesToPhase([selectedNode.id], e.target.value);
                      }}
                      style={{
                        background: 'var(--bg3)', border: '1px solid var(--border2)',
                        borderRadius: 4, color: nodePhase ? nodePhase.color : 'var(--text3)',
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        padding: '4px 6px', cursor: 'pointer', width: '100%',
                      }}
                    >
                      <option value="" style={{ color: 'var(--text3)' }}>Unassigned</option>
                      {phases.map((p) => (
                        <option key={p.id} value={p.id} style={{ color: p.color }}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  {!showNewPhaseForm ? (
                    <button
                      onClick={() => { setShowNewPhaseForm(true); setNewPhaseName(''); setNewPhaseColor(PHASE_PALETTE[0]); }}
                      style={{
                        background: 'none', border: '1px dashed var(--border2)',
                        borderRadius: 4, color: 'var(--text3)', fontFamily: 'var(--font-mono)',
                        fontSize: 11, padding: '4px 8px', cursor: 'pointer', textAlign: 'left',
                      }}
                    >+ New phase</button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 4, border: '1px solid var(--border2)' }}>
                      <input
                        autoFocus
                        placeholder="Phase name"
                        value={newPhaseName}
                        onChange={(e) => setNewPhaseName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setShowNewPhaseForm(false); }}
                        style={{
                          background: 'var(--bg2)', border: '1px solid var(--border2)',
                          borderRadius: 3, color: 'var(--text1)', fontFamily: 'var(--font-mono)',
                          fontSize: 11, padding: '3px 6px', outline: 'none',
                        }}
                      />
                      <ColorSwatchPicker value={newPhaseColor} onChange={setNewPhaseColor} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => {
                            const trimmed = newPhaseName.trim();
                            if (!trimmed) return;
                            createPhase([selectedNode.id], { name: trimmed, description: '', color: newPhaseColor });
                            setShowNewPhaseForm(false);
                          }}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: 4,
                            border: '1px solid var(--accent)', background: 'rgba(99,102,241,0.12)',
                            color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11,
                            fontWeight: 700, cursor: 'pointer',
                          }}
                        >Add</button>
                        <button
                          onClick={() => setShowNewPhaseForm(false)}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: 4,
                            border: '1px solid var(--border2)', background: 'none',
                            color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.tags}>
                  {nodePhase ? (
                    <span className={styles.tag} style={{ borderColor: nodePhase.color, color: nodePhase.color }}>
                      {nodePhase.name}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>Unassigned</span>
                  )}
                </div>
              )}
            </>
          );
        })()}

        {(() => {
          const nodeGroups = groups.filter((g) => g.childNodeIds.includes(selectedNode.id));
          return (
            <>
              <div className={styles.section}>Groups</div>
              <div className={styles.tags}>
                {nodeGroups.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>None</span>
                ) : (
                  nodeGroups.map((g) => (
                    <span key={g.id} className={`${styles.tag} ${styles.tagDep}`}>
                      {g.name}
                    </span>
                  ))
                )}
              </div>
            </>
          );
        })()}

        {/* Cinema author fields — design mode only */}
        {designMode && (
          <CinemaAuthorFields
            scriptDraft={scriptDraft}
            onScriptChange={setScriptDraft}
            onScriptBlur={() => updateNodeCinemaFields(selectedNode.id, { cinemaScript: scriptDraft || undefined })}
            bottleneck={!!selectedNode.cinemaBottleneck}
            onBottleneckChange={(v) => updateNodeCinemaFields(selectedNode.id, { cinemaBottleneck: v || undefined })}
            skip={!!selectedNode.cinemaSkip}
            onSkipChange={(v) => updateNodeCinemaFields(selectedNode.id, { cinemaSkip: v || undefined })}
            open={cinemaOpen}
            onToggle={() => setCinemaOpen((o) => !o)}
          />
        )}
      </>
    );
  }

  return null;
}

/** @deprecated Use InspectorContent inside the LeftPane tabs instead */
export { InspectorContent as Inspector };

// ─── Read-only dependency / dependent connection row ─────────────────────────

const DEP_STROKE_W: Record<PathType, number>  = { critical: 7, priority: 4.5, standard: 3.5, optional: 2.5 };
const DEP_HL_W: Record<PathType, number>      = { critical: 3, priority: 2,   standard: 1.5, optional: 1   };
const DEP_HL_OP: Record<PathType, number>     = { critical: 0.25, priority: 0.22, standard: 0.18, optional: 0.15 };
const DEP_TYPE_COLOR: Record<PathType, string> = {
  critical: '#ef4444', priority: '#f59e0b', standard: 'var(--text3)', optional: 'var(--text3)',
};

function DepConnectionRow({ label, type, ownerColor, onClick }: { label: string; type: PathType; ownerColor?: string; onClick: () => void }) {
  const lineColor = ownerColor ?? 'var(--accent)';
  return (
    <button className={styles.depRow} onClick={onClick} title={`Go to: ${label}`}>
      <svg width={24} height={14} style={{ flexShrink: 0 }}>
        <line x1={2} y1={8} x2={22} y2={8}
          stroke={lineColor} strokeWidth={Math.min(DEP_STROKE_W[type], 7)} strokeLinecap="round" />
        <line x1={3.5} y1={9.5} x2={23.5} y2={9.5}
          stroke={`rgba(255,255,255,${DEP_HL_OP[type]})`} strokeWidth={DEP_HL_W[type]} strokeLinecap="round" />
      </svg>
      <span className={styles.depRowName} style={{
        flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
        letterSpacing: '0.5px', textTransform: 'uppercase', flexShrink: 0,
        color: DEP_TYPE_COLOR[type],
        opacity: type === 'standard' || type === 'optional' ? 0.55 : 1,
      }}>
        {type}
      </span>
    </button>
  );
}

// ─── Edge type row sub-component ─────────────────────────────────────────────

interface EdgeTypeRowProps {
  label: string;
  currentType: PathType;
  onTypeChange: (t: PathType) => void;
  onLabelClick: () => void;
  onDelete?: () => void;
}

function EdgeTypeRow({ label, currentType, onTypeChange, onLabelClick, onDelete }: EdgeTypeRowProps) {
  const CHIP_WIDTHS: Record<PathType, number>    = { critical: 7, priority: 4.5, standard: 3.5, optional: 2.5 };
  const CHIP_HL_W: Record<PathType, number>       = { critical: 3, priority: 2,   standard: 1.5, optional: 1   };
  const CHIP_HL_OP: Record<PathType, number>      = { critical: 0.25, priority: 0.22, standard: 0.18, optional: 0.15 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, paddingLeft: 4 }}>
      <svg width={24} height={14} style={{ flexShrink: 0 }}>
        <line x1={2} y1={8} x2={22} y2={8} stroke="var(--accent)" strokeWidth={Math.min(CHIP_WIDTHS[currentType], 7)} strokeLinecap="round" />
        <line x1={3.5} y1={9.5} x2={23.5} y2={9.5} stroke={`rgba(255,255,255,${CHIP_HL_OP[currentType]})`} strokeWidth={CHIP_HL_W[currentType]} strokeLinecap="round" />
      </svg>
      <button
        onClick={onLabelClick}
        style={{
          flex: 1, textAlign: 'left', background: 'none', border: 'none',
          color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: 11,
          cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          padding: 0,
        }}
        title={label}
      >
        {label}
      </button>
      <select
        value={currentType}
        onChange={(e) => onTypeChange(e.target.value as PathType)}
        style={{
          background: 'var(--bg3)', border: '1px solid var(--border2)',
          borderRadius: 4, color: 'var(--text2)', fontFamily: 'var(--font-mono)',
          fontSize: 10, padding: '2px 4px', cursor: 'pointer',
        }}
      >
        <option value="critical">Critical</option>
        <option value="required">Required</option>
        <option value="optional">Optional</option>
        <option value="alternative">Alternative</option>
      </select>
      {onDelete && (
        <button
          onClick={onDelete}
          title="Remove edge"
          style={{
            background: 'none', border: 'none', padding: '0 2px',
            color: 'var(--text3)', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center',
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
    </div>
  );
}

// ─── Collapsible section header ──────────────────────────────────────────────

function CollapsibleSection({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <>
      <button className={styles.sectionToggle} onClick={onToggle}>
        <span>{title}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="2,3 5,7 8,3"/>
        </svg>
      </button>
      {open && children}
    </>
  );
}

// ─── Cinema author fields sub-component ──────────────────────────────────────

interface CinemaAuthorFieldsProps {
  scriptDraft: string;
  onScriptChange: (v: string) => void;
  onScriptBlur: () => void;
  bottleneck: boolean;
  onBottleneckChange: (v: boolean) => void;
  skip: boolean;
  onSkipChange: (v: boolean) => void;
  open: boolean;
  onToggle: () => void;
}

function CinemaAuthorFields({
  scriptDraft, onScriptChange, onScriptBlur,
  bottleneck, onBottleneckChange,
  skip, onSkipChange,
  open, onToggle,
}: CinemaAuthorFieldsProps) {
  const dividerStyle: React.CSSProperties = {
    marginTop: 18,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  };
  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 68,
    resize: 'vertical',
    background: 'var(--bg3)',
    border: '1px solid var(--border2)',
    borderRadius: 4,
    color: 'var(--text2)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    lineHeight: 1.55,
    padding: '6px 8px',
    outline: 'none',
  };
  const checkRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    cursor: 'pointer',
  };
  const checkLabelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text2)',
    userSelect: 'none',
  };

  return (
    <div style={dividerStyle}>
      <button className={styles.sectionToggle} onClick={onToggle} style={{ marginTop: 0 }}>
        <span>Cinema</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="2,3 5,7 8,3"/>
        </svg>
      </button>

      {open && (
        <>
          <div style={{ marginBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
            Narration override
          </div>
          <textarea
            style={textareaStyle}
            value={scriptDraft}
            placeholder="Auto-generated from node data. Write here to override."
            onChange={(e) => onScriptChange(e.target.value)}
            onBlur={onScriptBlur}
          />

          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={bottleneck}
              onChange={(e) => onBottleneckChange(e.target.checked)}
            />
            <span style={checkLabelStyle}>Force bottleneck in cinema</span>
          </label>

          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={skip}
              onChange={(e) => onSkipChange(e.target.checked)}
            />
            <span style={checkLabelStyle}>Skip in cinema tour</span>
          </label>
        </>
      )}
    </div>
  );
}
