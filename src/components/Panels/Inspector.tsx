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
import styles from './Inspector.module.css';

export function InspectorContent() {
  const {
    selectedNodeId, allNodes, ownerColors, setSelectedNode, designMode,
    selectedGroupId, groups, setSelectedGroup,
    selectedPhaseId, phases, setSelectedPhaseId, deletePhase,
    multiSelectIds, updateNodeCinemaFields, updateGroupCinemaFields,
    pathHighlightNodeId, setPathHighlight, allEdges,
  } = useGraphStore();

  // Local draft for cinemaScript textarea — committed onBlur to avoid store thrash
  const [scriptDraft, setScriptDraft] = useState('');

  const selectedNode = selectedNodeId
    ? allNodes.find((node) => node.id === selectedNodeId)
    : null;

  const selectedGroup = selectedGroupId
    ? groups.find((g) => g.id === selectedGroupId)
    : null;

  // Sync the script draft when selection changes
  useEffect(() => {
    if (selectedNode) setScriptDraft(selectedNode.cinemaScript ?? '');
    else if (selectedGroup) setScriptDraft(selectedGroup.cinemaScript ?? '');
    else setScriptDraft('');
  }, [selectedNodeId, selectedGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPhase = selectedPhaseId
    ? phases.find((p) => p.id === selectedPhaseId)
    : null;

  const hasSelection = !!selectedNode || !!selectedGroup || !!selectedPhase;

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
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 12, height: 12, borderRadius: '50%',
            background: selectedPhase.color, flexShrink: 0, display: 'inline-block',
          }} />
          <div className={styles.name}>{selectedPhase.name}</div>
        </div>
        <div className={styles.sub}>Seq: {selectedPhase.sequence + 1}</div>

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
    );
  }

  if (selectedGroup) {
    return (
      <>
        <div className={styles.name}>{selectedGroup.name}</div>

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

        {(() => {
          const groupPhase = phases.find((p) => (p.groupIds ?? []).includes(selectedGroup.id));
          return (
            <>
              <div className={styles.section}>Phase</div>
              <div className={styles.tags}>
                {groupPhase ? (
                  <span className={styles.tag} style={{ borderColor: groupPhase.color, color: groupPhase.color }}>
                    {groupPhase.name}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Unassigned</span>
                )}
              </div>
            </>
          );
        })()}

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
          />
        )}
      </>
    );
  }

  if (selectedNode) {
    return (
      <>
        <div className={styles.name}>{selectedNode.name}</div>

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

        {selectedNode.tags && selectedNode.tags.length > 0 && (
          <>
            <div className={styles.section}>Tags</div>
            <div className={styles.tags}>
              {selectedNode.tags.map((tag, i) => (
                <span
                  key={i}
                  className={styles.tag}
                  style={{
                    borderColor: tag.color,
                    color: tag.color,
                    background: `${tag.color}18`,
                  }}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          </>
        )}

        {(() => {
          const nodePhase = phases.find((p) => p.nodeIds.includes(selectedNode.id));
          return (
            <>
              <div className={styles.section}>Phase</div>
              <div className={styles.tags}>
                {nodePhase ? (
                  <span
                    className={styles.tag}
                    style={{ borderColor: nodePhase.color, color: nodePhase.color }}
                  >
                    {nodePhase.name}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Unassigned</span>
                )}
              </div>
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

        {/* Path highlight — view mode only */}
        {!designMode && (() => {
          const isActive = pathHighlightNodeId === selectedNode.id;

          // Count ancestor nodes via backward BFS
          let ancestorCount = 0;
          if (isActive) {
            const visited = new Set<string>();
            const queue = [selectedNode.id];
            while (queue.length > 0) {
              const cur = queue.shift()!;
              for (const edge of allEdges) {
                if (edge.to === cur && !visited.has(edge.from)) {
                  visited.add(edge.from);
                  queue.push(edge.from);
                }
              }
            }
            ancestorCount = visited.size;
          }

          return (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => setPathHighlight(isActive ? null : selectedNode.id)}
                style={{
                  width: '100%', padding: '8px 0', borderRadius: 5,
                  border: `1px solid ${isActive ? '#22d3ee' : 'var(--accent3)'}`,
                  background: isActive ? 'rgba(34,211,238,.15)' : 'rgba(34,211,238,.05)',
                  color: isActive ? '#22d3ee' : 'var(--accent3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isActive ? '✕ Clear Path View' : '⇤ Show Ancestor Paths'}
              </button>
              {isActive && (
                <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
                  {ancestorCount === 0
                    ? 'No ancestors — this is a root node'
                    : `${ancestorCount} ancestor node${ancestorCount !== 1 ? 's' : ''} on path`}
                </div>
              )}
            </div>
          );
        })()}

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
          />
        )}
      </>
    );
  }

  return null;
}

/** @deprecated Use InspectorContent inside the LeftPane tabs instead */
export { InspectorContent as Inspector };

// ─── Cinema author fields sub-component ──────────────────────────────────────

interface CinemaAuthorFieldsProps {
  scriptDraft: string;
  onScriptChange: (v: string) => void;
  onScriptBlur: () => void;
  bottleneck: boolean;
  onBottleneckChange: (v: boolean) => void;
  skip: boolean;
  onSkipChange: (v: boolean) => void;
}

function CinemaAuthorFields({
  scriptDraft, onScriptChange, onScriptBlur,
  bottleneck, onBottleneckChange,
  skip, onSkipChange,
}: CinemaAuthorFieldsProps) {
  const dividerStyle: React.CSSProperties = {
    marginTop: 18,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  };
  const sectionStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    marginBottom: 6,
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
      <div style={sectionStyle}>Cinema</div>

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
    </div>
  );
}
