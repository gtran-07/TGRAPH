/**
 * components/Canvas/Canvas.tsx — The main SVG canvas where the graph is rendered.
 *
 * Responsibilities:
 *   - Renders the SVG element with pan/zoom transform applied to a root <g> element
 *   - Hosts EdgeLayer, NodeLayer, LaneLayer, MiniMap, zoom controls, banners
 *   - Handles canvas-level mouse events: pan, scroll-to-zoom, click-on-background
 *   - Shows the empty state when no data is loaded
 *   - Shows the Design Mode banner when design mode is active
 *   - Shows the Focus Mode banner when focus mode is active
 *
 * What does NOT belong here: individual node rendering (NodeCard), edge path calculation (layout.ts).
 */

import React, {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
} from "react";
import { useGraphStore } from "../../store/graphStore";
import type { Transform } from "../../types/graph";
import { NodeCard } from "./NodeCard";
import { GroupCard } from "./GroupCard";
import { EdgeLayer } from "./EdgeLayer";
import { LaneLayer } from "./LaneLayer";
import { MiniMap } from "./MiniMap";
import { GhostEdge } from "./GhostEdge";
import { PhaseLayer } from "./PhaseLayer";
import { PhaseNavigator } from "./PhaseNavigator";
import { PhaseCrowns } from "./PhaseCrowns";
import { LaneCrowns } from "./LaneCrowns";
import { OwnerFocusBar } from "./OwnerFocusBar";
import { PhaseHoverCard } from "./PhaseHoverCard";
import { PathTypePopover } from "../DesignMode/PathTypePopover";
import type { CrownBand } from "./PhaseCrowns";
import {
  NODE_W,
  NODE_H,
  GAP_X,
  LANE_LABEL_W,
  computePhaseAdjustedPositions,
} from "../../utils/layout";
import { DesignToolbar } from "../DesignMode/DesignToolbar";
import { CanvasPing } from "../SummonMode/CanvasPing";
import { GhostRing } from "../SummonMode/GhostRing";
import { SummonOverlay } from "../SummonMode/SummonOverlay";
import {
  computeGroupNestLevel,
  getAllDescendantNodeIds,
  getHiddenGroupIds,
  getCollapsedGroupForNode,
  computeBoundingBox,
  GROUP_R,
} from "../../utils/grouping";
import styles from "./Canvas.module.css";

export function Canvas() {
  const {
    visibleNodes,
    visibleEdges,
    positions,
    transform,
    setTransform,
    saveLayoutToCache,
    flyTarget,
    clearFlyTarget,
    focusMode,
    focusNodeId,
    focusDepth,
    exitFocusMode,
    setFocusDepth,
    flyTo,
    setLastJumpedNode,
    designMode,
    designTool,
    connectSourceId,
    setConnectSource,
    addEdge,
    addNode,
    setSelectedNode,
    allNodes,
    allEdges,
    ownerColors,
    laneMetrics,
    viewMode,
    enterFocusMode,
    hoveredNodeId,
    fitToScreen,
    clearGraph,
    pathHighlightNodeId,
    pathHighlightMode,
    selectedNodeId,
    selectedGroupId,
    deleteNode,
    deleteGroup,
    multiSelectIds,
    marqueeMode,
    toggleMarqueeMode,
    setMultiSelectIds,
    copySelection,
    pasteClipboard,
    pasteCount,
    groups,
    toggleGroupCollapse,
    clearMultiSelect,
    phases,
    focusedPhaseId,
    selectedPhaseId,
    setFocusedPhaseId,
    setSelectedPhaseId,
    collapsedPhaseIds,
    togglePhaseCollapse,
    collapseAllPhases,
    expandAllPhases,
    focusedOwner,
    enterOwnerFocus,
    exitOwnerFocus,
    discoveryActive,
    fadingOutNodeIds,
    fadingOutPositions,
    setEdgePathType,
    edgePathTypes,
    summonActive,
    summonSourceId,
    summonShowRing,
  } = useGraphStore();

  // ── Entrance animation suppression ────────────────────────────────────
  // Direction-aware: compare previous render's values with current to decide
  // whether the incoming graph-content mount should animate or appear instantly.
  //
  //  Animate    : new file load, enter node focus, enter owner focus
  //  Suppress   : DAG↔LANE switch, exit node/owner focus, owner filter toggle
  //
  // Two-part design to survive multiple renders per transition:
  //   suppressThisRender — IIFE that catches the *triggering* render
  //   suppressActiveRef  — boolean ref that stays true for 700 ms, catching any
  //                        secondary renders (ResizeObserver, fitToScreen timeout…)
  const prevViewModeRef = useRef(viewMode);
  const prevFocusModeRef = useRef(focusMode);
  const prevFocusedOwnerRef = useRef(focusedOwner);
  const prevAllNodesLenRef = useRef(allNodes.length);
  const prevVisibleNodesLenRef = useRef(visibleNodes.length);
  const prevPasteCountRef = useRef(pasteCount);

  // Persistent 700 ms suppression window
  const suppressActiveRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Explicit "must animate" events — take absolute priority, can clear the window early
  const animateThisRender = (() => {
    const isPasteRender = prevPasteCountRef.current !== pasteCount;
    if (!isPasteRender && prevAllNodesLenRef.current !== allNodes.length) return true; // file load
    if (!prevFocusModeRef.current && focusMode) return true; // focus enter
    if (prevFocusedOwnerRef.current === null && focusedOwner !== null)
      return true; // owner enter
    return false;
  })();

  // Transitions that should suppress entrance animations
  const suppressThisRender = (() => {
    if (animateThisRender) return false; // animate wins
    if (prevPasteCountRef.current !== pasteCount) return true; // paste
    if (prevViewModeRef.current !== viewMode) return true; // DAG↔LANE
    if (prevFocusModeRef.current && !focusMode) return true; // focus exit
    if (prevFocusedOwnerRef.current !== null && focusedOwner === null)
      return true; // owner exit
    if (prevVisibleNodesLenRef.current !== visibleNodes.length) return true; // filter toggle
    return false;
  })();

  // Combined: suppress if triggered this render OR still inside the 700 ms window.
  // Never suppress on explicit animate events.
  const suppressEntrance =
    !animateThisRender && (suppressThisRender || suppressActiveRef.current);

  useLayoutEffect(() => {
    if (animateThisRender) {
      // Clear the window immediately so animation plays without delay
      suppressActiveRef.current = false;
      if (suppressTimerRef.current) {
        clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
    } else if (suppressThisRender) {
      // Open / extend the 700 ms suppression window
      suppressActiveRef.current = true;
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = setTimeout(() => {
        suppressActiveRef.current = false;
      }, 700);
    }
    // Update prev refs — always last, after logic above has read them
    prevViewModeRef.current = viewMode;
    prevFocusModeRef.current = focusMode;
    prevFocusedOwnerRef.current = focusedOwner;
    prevAllNodesLenRef.current = allNodes.length;
    prevVisibleNodesLenRef.current = visibleNodes.length;
    prevPasteCountRef.current = pasteCount;
  });

  // ── Refs ──────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  // Tracks current adjustedPositions without adding it to effect dep arrays.
  // Updated every render so effects always read fresh visual coordinates.
  const adjustedPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // ── Canvas height (SVG user-space) for PhaseLayer band height ─────────
  // We track the canvas pixel height and divide by the current zoom scale
  // so bands always span the full visible canvas regardless of zoom level.
  const [canvasPixelHeight, setCanvasPixelHeight] = useState(600);
  const [canvasPixelWidth, setCanvasPixelWidth] = useState(1200);
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setCanvasPixelHeight(rect.height);
        setCanvasPixelWidth(rect.width);
      }
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    setCanvasPixelHeight(rect.height);
    setCanvasPixelWidth(rect.width);
    return () => obs.disconnect();
  }, []);
  // Convert pixel height to SVG-space height accounting for pan offset
  const svgBandHeight =
    canvasPixelHeight / Math.max(transform.k, 0.01) +
    Math.abs(transform.y / Math.max(transform.k, 0.01)) +
    200;

  // ── Nodes hidden by collapsed phases (works in all view modes) ──────────
  // Computed separately from position adjustment so it's always reliable.
  const hiddenNodeIds = useMemo(() => {
    if (collapsedPhaseIds.length === 0) return new Set<string>();
    const collapsedSet = new Set(collapsedPhaseIds);
    const hidden = new Set<string>();
    phases.forEach((ph) => {
      if (collapsedSet.has(ph.id)) ph.nodeIds.forEach((nid) => hidden.add(nid));
    });
    return hidden;
  }, [phases, collapsedPhaseIds]);

  // ── Owner focus role sets ────────────────────────────────────────────────
  // Computed when focusedOwner is set. Used to assign per-node display roles
  // (owned / upstream / downstream / partial) for opacity and badge rendering.
  const ownerFocusSets = useMemo(() => {
    if (!focusedOwner) return null;
    const ownedIds = new Set(
      allNodes.filter((n) => n.owner === focusedOwner).map((n) => n.id),
    );
    const upstreamIds = new Set<string>();
    allNodes.forEach((n) => {
      if (n.owner === focusedOwner) {
        n.dependencies.forEach((dep) => {
          const d = allNodes.find((x) => x.id === dep);
          if (d && d.owner !== focusedOwner) upstreamIds.add(dep);
        });
      }
    });
    const downstreamIds = new Set<string>();
    allNodes.forEach((n) => {
      if (
        n.owner !== focusedOwner &&
        n.dependencies.some((dep) => ownedIds.has(dep))
      ) {
        downstreamIds.add(n.id);
      }
    });
    const allOwners = new Set(allNodes.map((n) => n.owner).filter(Boolean));
    const connectedOwners = new Set([focusedOwner]);
    [...upstreamIds, ...downstreamIds].forEach((id) => {
      const n = allNodes.find((x) => x.id === id);
      if (n) connectedOwners.add(n.owner);
    });
    const hiddenLaneCount = [...allOwners].filter(
      (o) => !connectedOwners.has(o),
    ).length;
    return { ownedIds, upstreamIds, downstreamIds, hiddenLaneCount };
  }, [focusedOwner, allNodes]);

  // Helper: derive the owner focus role for a given node
  function getOwnerFocusRole(
    nodeId: string,
    nodeOwner: string,
  ): "owned" | "upstream" | "downstream" | "partial" | null {
    if (!ownerFocusSets) return null;
    if (nodeOwner === focusedOwner) return "owned";
    if (ownerFocusSets.upstreamIds.has(nodeId)) return "upstream";
    if (ownerFocusSets.downstreamIds.has(nodeId)) return "downstream";
    return "partial";
  }

  // ── Phase-adjusted positions (visual x-shift for collapsed bands, dag only) ─
  // Nodes to the right of a collapsed band shift left to fill freed space.
  // Stored positions are never mutated.
  const adjustedPositions = useMemo(() => {
    if (collapsedPhaseIds.length === 0) return positions;
    return computePhaseAdjustedPositions(
      phases,
      positions,
      collapsedPhaseIds,
      NODE_W,
      viewMode === "lanes" ? LANE_LABEL_W : undefined,
    ).adjustedPositions;
  }, [phases, positions, collapsedPhaseIds, viewMode]);
  adjustedPositionsRef.current = adjustedPositions;

  // ── Per-node entrance delay: column stagger + y-rank within column ─────
  // Computed here (not in NodeCard) because it needs all visible nodes and their
  // positions to determine each node's rank within its column.
  // Column stagger: 120ms — keep in sync with EdgeLayer's COLUMN_STAGGER constant.
  // Y stagger: 30ms per rank so nodes in the same column ripple top-to-bottom.
  const nodeEntranceDelay = useMemo(() => {
    const COLUMN_STAGGER = 120;
    const Y_STAGGER = 30;
    const STEP = NODE_W + GAP_X;

    const columnMap = new Map<number, Array<{ id: string; y: number }>>();
    visibleNodes.forEach((node) => {
      const pos = adjustedPositions[node.id];
      if (!pos) return;
      const col = Math.max(0, Math.round(pos.x / STEP));
      if (!columnMap.has(col)) columnMap.set(col, []);
      columnMap.get(col)!.push({ id: node.id, y: pos.y });
    });

    const delays: Record<string, number> = {};
    columnMap.forEach((nodes, col) => {
      const sorted = [...nodes].sort((a, b) => a.y - b.y);
      sorted.forEach(({ id }, rank) => {
        delays[id] = Math.min(col * COLUMN_STAGGER + rank * Y_STAGGER, 600);
      });
    });

    return delays;
  }, [visibleNodes, adjustedPositions]);

  // ── Phase crown bands + viewport-presence set ─────────────────────────
  // Derived from phases + positions + transform. No store state needed.
  const PHASE_PAD_X_C = 30; // matches PhaseLayer constant
  const PHASE_HEADER_H = 48; // matches PhaseLayer HEADER_H
  const PHASE_PAD_Y_C = 20; // matches PhaseLayer PHASE_PAD_Y
  const { crownBands, inViewportPhaseIds, globalBandTop } = useMemo(() => {
    const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
    const bands: CrownBand[] = [];
    const inViewport = new Set<string>();
    const { x: tx, y: _ty, k } = transform;
    const allBandMinYs: number[] = [];

    // Viewport rectangle in SVG space
    const vpLeft = -tx / k;
    const vpRight = (canvasPixelWidth - tx) / k;
    const vpTop = -transform.y / k;
    const vpBottom = (canvasPixelHeight - transform.y) / k;

    sorted.forEach((phase, idx) => {
      const nodePositions = phase.nodeIds
        .map((nid) => adjustedPositions[nid])
        .filter((p): p is { x: number; y: number } => !!p);
      const groupPositions = (phase.groupIds ?? [])
        .map((gid) => adjustedPositions[gid])
        .filter((p): p is { x: number; y: number } => !!p);
      const assignedPositions = [...nodePositions, ...groupPositions];
      if (assignedPositions.length === 0) return;

      const minX =
        Math.min(...assignedPositions.map((p) => p.x)) - PHASE_PAD_X_C;
      const maxX =
        Math.max(...assignedPositions.map((p) => p.x + NODE_W)) + PHASE_PAD_X_C;
      bands.push({ phase, idx: idx + 1, minX, maxX });

      const minY = Math.min(...assignedPositions.map((p) => p.y));
      allBandMinYs.push(minY);

      // Check if any member of this phase is inside the viewport
      const hasNodeInView = assignedPositions.some((p) => {
        return (
          p.x + NODE_W > vpLeft &&
          p.x < vpRight &&
          p.y > vpTop - 200 &&
          p.y < vpBottom + 200
        );
      });
      if (hasNodeInView) inViewport.add(phase.id);
    });

    // globalBandTop mirrors PhaseLayer's calculation: the shared header top for all bands.
    const gbt =
      allBandMinYs.length > 0
        ? Math.min(...allBandMinYs) - PHASE_HEADER_H - PHASE_PAD_Y_C
        : 0;

    return {
      crownBands: bands,
      inViewportPhaseIds: inViewport,
      globalBandTop: gbt,
    };
  }, [
    phases,
    adjustedPositions,
    transform,
    canvasPixelWidth,
    canvasPixelHeight,
  ]);

  // ── Pan state (local — doesn't need to be in global store) ────────────
  const panState = useRef<{
    startX: number;
    startY: number;
    startTX: number;
    startTY: number;
  } | null>(null);
  const hasPannedRef = useRef(false);

  // ── Mouse-button state — suppresses node/group tooltip while dragging ──
  const [isMouseDown, setIsMouseDown] = useState(false);

  // ── Space-key pan mode ────────────────────────────────────────────────
  // Holding Space activates a temporary pan mode: cursor changes to grab/grabbing
  // and mousedown anywhere on the canvas (even over nodes) starts panning.
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault(); // prevent page scroll
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
    }
    function onMouseDown() {
      setIsMouseDown(true);
    }
    function onMouseUp() {
      setIsMouseDown(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousedown", onMouseDown, true); // capture: fires before stopPropagation
    document.addEventListener("mouseup", onMouseUp, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
    };
  }, []);

  // ── Ghost edge mouse position (for drawing connections) ───────────────
  const [ghostTarget, setGhostTarget] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // ── Marquee (rubber-band) selection rect ─────────────────────────────
  const [marquee, setMarquee] = useState<{
    startSvg: { x: number; y: number };
    curSvg: { x: number; y: number };
  } | null>(null);

  // ── Node hover tooltip position (screen coords) ───────────────────────
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [tooltipHidden, setTooltipHidden] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    setTooltipHidden(false);
    if (hoveredNodeId) {
      tooltipTimerRef.current = setTimeout(() => setTooltipHidden(true), 1500);
    }
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, [hoveredNodeId]);

  // ── Collapsed phase hover card ─────────────────────────────────────────
  const [collapsedPhaseHover, setCollapsedPhaseHover] = useState<{
    phaseId: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [collapsedPhaseHiding, setCollapsedPhaseHiding] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PathTypePopover state: which edge was clicked and where to show the popover
  const [pathTypePopover, setPathTypePopover] = useState<{
    edge: import('../../types/graph').GraphEdge;
    position: { x: number; y: number };
  } | null>(null);

  const hasData = visibleNodes.length > 0 || allNodes.length > 0;

  // ── Cross-group boundary edges ────────────────────────────────────────
  // visibleEdges only contains edges where BOTH endpoints are visible nodes.
  // When a node is inside a collapsed group its edges to/from outside nodes
  // are dropped. We restore them here so they can be routed to the group proxy.
  const displayEdges = useMemo(() => {
    const hasCollapsed = groups.some((g) => g.collapsed);
    if (!hasCollapsed) return visibleEdges;

    // Build a node→outermost-collapsed-group map using the fixed getCollapsedGroupForNode
    // so nested groups are handled correctly (outermost wins).
    const nodeToGroup = new Map<string, string>();
    const allNodeIds = new Set(allEdges.flatMap((e) => [e.from, e.to]));
    allNodeIds.forEach((nid) => {
      const outermost = getCollapsedGroupForNode(nid, groups);
      if (outermost) nodeToGroup.set(nid, outermost.id);
    });

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const included = new Set(visibleEdges.map((e) => `${e.from}|${e.to}`));
    const extra: typeof visibleEdges = [];
    const extraKeys = new Set<string>();

    for (const edge of allEdges) {
      if (included.has(`${edge.from}|${edge.to}`)) continue;
      const fromGroup = nodeToGroup.get(edge.from);
      const toGroup = nodeToGroup.get(edge.to);
      const fromVis = visibleNodeIds.has(edge.from);
      const toVis = visibleNodeIds.has(edge.to);
      const key = `${edge.from}|${edge.to}`;
      if (extraKeys.has(key)) continue;
      // Cross-boundary: one side visible node, other inside a collapsed group
      if ((fromVis && toGroup) || (toVis && fromGroup)) {
        extra.push(edge);
        extraKeys.add(key);
        // Both endpoints inside DIFFERENT collapsed groups
      } else if (fromGroup && toGroup && fromGroup !== toGroup) {
        extra.push(edge);
        extraKeys.add(key);
      }
    }

    return extra.length > 0 ? [...visibleEdges, ...extra] : visibleEdges;
  }, [visibleEdges, visibleNodes, allEdges, groups]);

  // ── Filter edges and groups hidden by collapsed phases ────────────────
  // Nodes inside collapsed phases are already skipped at render time via hiddenNodeIds.
  // Edges touching those nodes must also be removed (no proxy polygon to route them to).
  // Groups whose every descendant node is phase-hidden are suppressed entirely.
  const phaseFilteredEdges = useMemo(() => {
    if (hiddenNodeIds.size === 0) return displayEdges;
    return displayEdges.filter(
      (e) => !hiddenNodeIds.has(e.from) && !hiddenNodeIds.has(e.to),
    );
  }, [displayEdges, hiddenNodeIds]);

  const phaseHiddenGroupIds = useMemo(() => {
    if (hiddenNodeIds.size === 0) return new Set<string>();
    const hidden = new Set<string>();
    for (const group of groups) {
      const descendants = getAllDescendantNodeIds(group.id, groups);
      if (
        descendants.length > 0 &&
        descendants.every((id) => hiddenNodeIds.has(id))
      ) {
        hidden.add(group.id);
      }
    }
    return hidden;
  }, [groups, hiddenNodeIds]);

  // In focus mode, only show groups that have at least one descendant node visible
  const focusVisibleGroupIds = useMemo(() => {
    if (!focusMode) return null;
    const visibleIdSet = new Set(visibleNodes.map((n) => n.id));
    const result = new Set<string>();
    for (const g of groups) {
      const descendants = getAllDescendantNodeIds(g.id, groups);
      if (descendants.some((id) => visibleIdSet.has(id))) result.add(g.id);
    }
    return result;
  }, [focusMode, visibleNodes, groups]);

  const focusedNode = focusNodeId
    ? allNodes.find((n) => n.id === focusNodeId)
    : null;

  // ── Convert screen coordinates to SVG canvas coordinates ─────────────
  // Reads transformRef (not transform state) so this callback is stable and
  // never changes reference. A changing reference would re-render every NodeCard
  // and GroupCard on every zoom tick, causing the CSS transform transition to
  // fire on all nodes simultaneously — visible as flashing boxes during zoom.
  const screenToSvg = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  }, []); // stable — reads transformRef at call-time, no deps needed

  // ── Pan: start on mousedown on SVG background ─────────────────────────
  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    hasPannedRef.current = false;
    // Space held: pan from anywhere (even over nodes); skip other tool logic
    if (spaceHeld) {
      cancelFlyAnimation();
      panState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTX: transform.x,
        startTY: transform.y,
      };
      return;
    }
    // Only start panning if clicking directly on the SVG or graph root (not a node)
    const target = e.target as Element;
    if (
      target.closest(".node-group") ||
      (designMode && target.closest(".edge-hit")) ||
      target.closest(".group-overlay")
    )
      return;
    if (designMode && designTool === "add") return; // Add tool uses click, not drag

    // Marquee mode: start a rubber-band selection rect instead of panning
    if (marqueeMode && (!designMode || designTool === "select")) {
      const pt = screenToSvg(e.clientX, e.clientY);
      setMarquee({ startSvg: pt, curSvg: pt });
      return;
    }

    cancelFlyAnimation(); // Cancel any in-progress fly animation so the user takes over immediately
    panState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTX: transform.x,
      startTY: transform.y,
    };
  }

  // ── Pan: update on mousemove ──────────────────────────────────────────
  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    // Space pan mode: only run pan logic, skip all other pointer actions
    if (!spaceHeld) {
      // Update ghost edge target if connecting
      if (designMode && designTool === "connect" && connectSourceId) {
        const pt = screenToSvg(e.clientX, e.clientY);
        setGhostTarget(pt);
      }

      // Track mouse position for node hover tooltip
      const wrap = canvasWrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    }

    // Marquee: update current corner
    if (marquee) {
      const pt = screenToSvg(e.clientX, e.clientY);
      const dx = pt.x - marquee.startSvg.x;
      const dy = pt.y - marquee.startSvg.y;
      if (Math.abs(dx) > 4 / transform.k || Math.abs(dy) > 4 / transform.k) {
        hasPannedRef.current = true; // suppress click-to-deselect on mouseup
      }
      setMarquee({ startSvg: marquee.startSvg, curSvg: pt });
      return;
    }

    if (!panState.current) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasPannedRef.current = true;
    setTransform({
      ...transform,
      x: panState.current.startTX + dx,
      y: panState.current.startTY + dy,
    });
  }

  // ── Pan: end on mouseup ───────────────────────────────────────────────
  function handleSvgMouseUp() {
    if (marquee) {
      commitMarqueeSelection(marquee.startSvg, marquee.curSvg);
      setMarquee(null);
      return;
    }
    if (panState.current) {
      panState.current = null;
      saveLayoutToCache(); // Persist the new pan position
    }
  }

  function commitMarqueeSelection(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const rx = Math.min(start.x, end.x);
    const ry = Math.min(start.y, end.y);
    const rw = Math.abs(end.x - start.x);
    const rh = Math.abs(end.y - start.y);
    if (rw < 4 / transform.k && rh < 4 / transform.k) return; // tiny drag → ignore

    function overlaps(bx: number, by: number, bw: number, bh: number) {
      return bx < rx + rw && bx + bw > rx && by < ry + rh && by + bh > ry;
    }

    const hitIds: string[] = [];

    // Hit-test visible nodes
    for (const node of visibleNodes) {
      const pos = adjustedPositions[node.id];
      if (pos && overlaps(pos.x, pos.y, NODE_W, NODE_H)) hitIds.push(node.id);
    }

    // Hit-test visible groups
    const hiddenGroupIds = getHiddenGroupIds(groups);
    for (const group of groups) {
      if (hiddenGroupIds.has(group.id)) continue;
      if (group.collapsed) {
        // Collapsed group: polygon centered at its position
        const pos = adjustedPositions[group.id];
        if (pos && overlaps(pos.x - GROUP_R, pos.y - GROUP_R, GROUP_R * 2, GROUP_R * 2)) {
          hitIds.push(group.id);
        }
      } else {
        // Expanded group: bounding box of child node positions
        const childNodePositions = getAllDescendantNodeIds(group.id, groups)
          .map((nid) => adjustedPositions[nid])
          .filter(Boolean) as { x: number; y: number }[];
        if (childNodePositions.length > 0) {
          const bb = computeBoundingBox(childNodePositions, NODE_W, NODE_H, 32);
          if (overlaps(bb.x, bb.y, bb.w, bb.h)) hitIds.push(group.id);
        }
      }
    }

    if (hitIds.length > 0) {
      setMultiSelectIds(hitIds);
    } else {
      clearMultiSelect();
    }
  }

  const handleGroupToggle = useCallback(
    (groupId: string) => {
      toggleGroupCollapse(groupId);
    },
    [toggleGroupCollapse],
  );

  // ── Scroll to zoom (centered on cursor position) ──────────────────────
  // React 18 attaches onWheel as a PASSIVE listener, which means
  // e.preventDefault() is silently ignored and the browser may scroll the
  // page instead of zooming the canvas. The fix is to attach a native
  // (non-passive) wheel listener via useEffect.
  //
  // We store the current transform in a ref so the event handler always
  // reads the latest value without needing to re-register itself on every
  // zoom step (which would cause jank from rapid add/remove cycles).
  const transformRef = useRef<Transform>(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // ── Fly-to animation ──────────────────────────────────────────────────────
  // When flyTarget is set (by search, view-switch, fit-to-screen, etc.), smoothly
  // animate the viewport from its current position to the target using easeOutCubic.
  // User pan or scroll cancels the animation immediately.
  const flyAnimRef = useRef<number | null>(null);

  function cancelFlyAnimation() {
    if (flyAnimRef.current !== null) {
      cancelAnimationFrame(flyAnimRef.current);
      flyAnimRef.current = null;
      clearFlyTarget();
    }
  }

  useEffect(() => {
    if (!flyTarget) return;

    // Cancel any in-progress animation
    if (flyAnimRef.current !== null) cancelAnimationFrame(flyAnimRef.current);

    const from = { ...transformRef.current };
    const to = flyTarget;
    const startTime = performance.now();
    const DURATION = 580; // ms

    function easeInOutSine(t: number) {
      return -(Math.cos(Math.PI * t) - 1) / 2;
    }

    function step() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / DURATION, 1);
      const e = easeInOutSine(t);
      setTransform({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        k: from.k + (to.k - from.k) * e,
      });
      if (t < 1) {
        flyAnimRef.current = requestAnimationFrame(step);
      } else {
        setTransform(to);
        clearFlyTarget();
        flyAnimRef.current = null;
      }
    }

    flyAnimRef.current = requestAnimationFrame(step);

    return () => {
      if (flyAnimRef.current !== null) {
        cancelAnimationFrame(flyAnimRef.current);
        flyAnimRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget]); // flyTarget identity change is the only trigger; setTransform/clearFlyTarget are stable

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      cancelFlyAnimation(); // Let the user take over immediately
      const rect = svgEl!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const newScale = Math.max(0.1, Math.min(3, t.k * delta));
      const newX = cursorX - (cursorX - t.x) * (newScale / t.k);
      const newY = cursorY - (cursorY - t.y) * (newScale / t.k);
      setTransform({ x: newX, y: newY, k: newScale });
    }

    svgEl.addEventListener("wheel", onWheel, { passive: false });
    return () => svgEl.removeEventListener("wheel", onWheel);
    // setTransform is stable (Zustand action), so this effect runs once only.
  }, [setTransform]);

  // ── Click on SVG background ───────────────────────────────────────────
  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (spaceHeld) return; // space pan mode — no selections or tool actions
    const target = e.target as Element;
    const clickedNode = target.closest(".node-group");
    const clickedEdge = target.closest(".edge-hit");
    const clickedGroup = target.closest(".group-overlay");

    if (designMode && designTool === "add" && !clickedNode && !clickedGroup) {
      // Add mode: open the add-node modal at the click position
      const pt = screenToSvg(e.clientX, e.clientY);
      document.dispatchEvent(
        new CustomEvent("flowgraph:add-node", { detail: pt }),
      );
      return;
    }

    if (designMode && designTool === "connect") {
      if (!clickedNode && !clickedEdge && !clickedGroup) {
        // Clicked empty space in connect mode — cancel the connection
        setConnectSource(null);
        setGhostTarget(null);
      }
      return;
    }

    // Click on background or phase — deselect nodes/groups and clear multi-select.
    // Clicking a phase should still deselect nodes/groups; the phase click handler
    // selects the phase separately via onPhaseClick.
    // Skip deselect if the user dragged (panned) — only a clean stationary click should deselect.
    if (hasPannedRef.current) return;
    const clickedPhase = target.closest("[data-phase-id]");
    if (!clickedNode && !clickedGroup) {
      // In focus mode: always revert selection to the anchor node instead of clearing it.
      setSelectedNode(focusMode && focusNodeId ? focusNodeId : null);
      clearMultiSelect();
      if (!clickedPhase) {
        setSelectedPhaseId(null);
      }
    }
  }

  // ── Double-click on SVG background — exit focus mode ─────────────────
  function handleSvgDblClick(e: React.MouseEvent<SVGSVGElement>) {
    if (spaceHeld) return; // space pan mode — no actions
    const target = e.target as Element;
    if (target.closest(".node-group")) return; // Node dblclick handled in NodeCard
    if (target.closest(".group-overlay")) return; // Group dblclick handled in GroupCard
    if (focusMode) exitFocusMode();
  }

  // ── Keyboard: Escape cancels connect mode or exits focus; Delete removes selection ──
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Summon mode takes priority — dismiss before other Escape actions
        const { summonActive: sa, deactivateSummon: deact } = useGraphStore.getState();
        if (sa) {
          e.preventDefault();
          e.stopPropagation();
          deact();
          return;
        }
        if (connectSourceId) {
          setConnectSource(null);
          setGhostTarget(null);
        } else if (focusedOwner) {
          exitOwnerFocus();
        } else if (focusMode) {
          exitFocusMode();
        }
        return;
      }

      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const state = useGraphStore.getState();
        if (state.selectedNodeId && !state.summonActive && !state.discoveryActive) {
          e.preventDefault();
          state.activateSummon(state.selectedNodeId);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "c" && designMode) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        copySelection();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "v" && designMode) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        pasteClipboard();
        return;
      }

      if (e.key === "Delete" && designMode) {
        // Don't fire when the user is typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        if (multiSelectIds.length > 0) {
          // Multi-select: each id may be a node or a group
          const nodeIds = multiSelectIds.filter((id) =>
            allNodes.some((n) => n.id === id),
          );
          const groupIds = multiSelectIds.filter((id) =>
            groups.some((g) => g.id === id),
          );
          const total = multiSelectIds.length;
          if (
            !confirm(
              `Delete ${total} selected item${total > 1 ? "s" : ""}? This cannot be undone.`,
            )
          )
            return;
          groupIds.forEach((id) => deleteGroup(id, false));
          nodeIds.forEach((id) => deleteNode(id));
        } else if (selectedNodeId) {
          const node = allNodes.find((n) => n.id === selectedNodeId);
          if (!node) return;
          if (
            !confirm(
              `Delete "${node.name}"? All connections to/from this node will also be removed.`,
            )
          )
            return;
          deleteNode(selectedNodeId);
        } else if (selectedGroupId) {
          const group = groups.find((g) => g.id === selectedGroupId);
          if (!group) return;
          if (!confirm(`Delete group "${group.name}" and all its contents?`))
            return;
          deleteGroup(selectedGroupId, false);
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [
    connectSourceId,
    focusMode,
    exitFocusMode,
    focusedOwner,
    exitOwnerFocus,
    setConnectSource,
    designMode,
    selectedNodeId,
    selectedGroupId,
    multiSelectIds,
    deleteNode,
    deleteGroup,
    allNodes,
    groups,
    copySelection,
    pasteClipboard,
  ]);

  // ── Summon source aura ────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = () => {
      document.querySelectorAll(".summon-source-aura").forEach((el) =>
        el.classList.remove("summon-source-aura")
      );
    };
    if (!summonActive || !summonSourceId) { cleanup(); return cleanup; }
    const state = useGraphStore.getState();
    const sourceNode = state.allNodes.find((n) => n.id === summonSourceId);
    const color = sourceNode
      ? (state.ownerColors[sourceNode.owner] ?? "rgba(79,158,255,0.4)")
      : "rgba(79,158,255,0.4)";
    const el = document.querySelector(`.node-group[data-id="${summonSourceId}"]`);
    if (el) {
      (el as SVGElement).style.setProperty("--aura-color", color);
      el.classList.add("summon-source-aura");
    }
    return cleanup;
  }, [summonActive, summonSourceId]);

  // ── Hover highlight via direct DOM class manipulation ────────────────
  // Positive-only: only the hovered node and its direct neighbors get visual
  // treatment (.hovered / .neighbor classes). Non-hovered nodes are untouched.
  //
  // We deliberately do NOT dim non-hovered nodes. Any CSS change (opacity, fill,
  // stroke) applied to ~140 leaf elements simultaneously invalidates paint tiles
  // across the whole canvas. At high zoom those tiles are large and Chrome can't
  // repaint them all in one frame — visible as grey/white box flicker everywhere.
  useEffect(() => {
    const graphRoot = document.getElementById("graph-root");
    if (!graphRoot) return;

    // Clear all highlight classes whenever hovered target changes
    graphRoot.querySelectorAll(".hovered, .neighbor").forEach((el) => {
      el.classList.remove("hovered", "neighbor");
    });

    if (!hoveredNodeId) return;

    // Determine neighbors — works for both node IDs and group IDs.
    // Use allEdges (not visibleEdges) so edges into/out of collapsed groups are included.
    // When a neighbor is inside a collapsed group, resolve to that group's ID instead.
    const hovGroup = groups.find((g) => g.id === hoveredNodeId);
    const directParents = new Set<string>();
    const directChildren = new Set<string>();

    function resolveToVisible(nodeId: string): string {
      const collapsed = getCollapsedGroupForNode(nodeId, groups);
      return collapsed ? collapsed.id : nodeId;
    }

    if (hovGroup) {
      const descendantIds = new Set(
        getAllDescendantNodeIds(hovGroup.id, groups),
      );
      for (const edge of allEdges) {
        const fromIn = descendantIds.has(edge.from);
        const toIn = descendantIds.has(edge.to);
        if (fromIn && !toIn) directChildren.add(resolveToVisible(edge.to));
        if (toIn && !fromIn) directParents.add(resolveToVisible(edge.from));
      }
    } else {
      const hovNode = allNodes.find((n) => n.id === hoveredNodeId);
      (hovNode?.dependencies ?? []).forEach((id) =>
        directParents.add(resolveToVisible(id)),
      );
      allEdges
        .filter((e) => e.from === hoveredNodeId)
        .forEach((e) => directChildren.add(resolveToVisible(e.to)));
    }

    // Apply .hovered / .neighbor — only to the handful of relevant elements
    graphRoot.querySelectorAll(".node-group, .group-overlay").forEach((el) => {
      const id = el.getAttribute("data-id") ?? el.getAttribute("data-group-id");
      if (id === hoveredNodeId) {
        el.classList.add("hovered");
      } else if (id && (directParents.has(id) || directChildren.has(id))) {
        el.classList.add("neighbor");
      }
    });
  }, [hoveredNodeId, allNodes, visibleEdges, groups]);

  // ── Path highlight — ancestor/descendant paths to/from selected node ────
  // BFS direction(s) determined by pathHighlightMode. Nodes get path classes;
  // edges on the path are brightened with mode-specific colors.
  useEffect(() => {
    const graphRoot = document.getElementById("graph-root");
    if (!graphRoot) return;

    // Clear all path classes and edge overrides
    graphRoot
      .querySelectorAll(".path-focus, .path-ancestor, .path-descendant, .path-ghost")
      .forEach((el) => {
        el.classList.remove("path-focus", "path-ancestor", "path-descendant", "path-ghost");
      });
    graphRoot.querySelectorAll("g[data-edge-from] .edge-groove").forEach((el) => {
      const e = el as SVGPathElement;
      e.style.opacity = "";
      e.style.strokeWidth = "";
      e.style.stroke = "";
    });

    if (!pathHighlightNodeId || !pathHighlightMode) return;

    // Backward BFS: collect every ancestor that can reach pathHighlightNodeId
    const ancestors = new Set<string>();
    if (pathHighlightMode === 'ancestors' || pathHighlightMode === 'both') {
      const queue = [pathHighlightNodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of allEdges) {
          if (edge.to === current && !ancestors.has(edge.from)) {
            ancestors.add(edge.from);
            queue.push(edge.from);
          }
        }
      }
    }

    // Forward BFS: collect every descendant reachable from pathHighlightNodeId
    const descendants = new Set<string>();
    if (pathHighlightMode === 'descendants' || pathHighlightMode === 'both') {
      const queue = [pathHighlightNodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of allEdges) {
          if (edge.from === current && !descendants.has(edge.to)) {
            descendants.add(edge.to);
            queue.push(edge.to);
          }
        }
      }
    }

    // Apply node classes
    graphRoot.querySelectorAll(".node-group, .group-overlay").forEach((el) => {
      const id = el.getAttribute("data-id") ?? el.getAttribute("data-group-id");
      if (!id) return;
      if (id === pathHighlightNodeId) {
        el.classList.add("path-focus");
      } else if (ancestors.has(id)) {
        el.classList.add("path-ancestor");
      } else if (descendants.has(id)) {
        el.classList.add("path-descendant");
      } else {
        el.classList.add("path-ghost");
      }
    });

    // Apply edge styles — color by direction; off-path edges are dimmed
    graphRoot.querySelectorAll("g[data-edge-from]").forEach((el) => {
      const from = el.getAttribute("data-edge-from");
      const to = el.getAttribute("data-edge-to");
      if (!from || !to) return;
      const visEl = el.querySelector(".edge-groove") as SVGPathElement | null;
      if (!visEl) return;

      const isAncestorEdge =
        ancestors.has(from) && (to === pathHighlightNodeId || ancestors.has(to));
      const isDescendantEdge =
        descendants.has(to) && (from === pathHighlightNodeId || descendants.has(from));

      if (isAncestorEdge) {
        visEl.style.stroke = "#22d3ee";
        visEl.style.strokeWidth = "2.5";
        visEl.style.opacity = "1";
      } else if (isDescendantEdge) {
        visEl.style.stroke = "#f59e0b";
        visEl.style.strokeWidth = "2.5";
        visEl.style.opacity = "1";
      } else {
        visEl.style.opacity = "0.06";
      }
    });

    // Fit viewport to the highlighted node set for the active mode.
    // Use adjustedPositionsRef (matches visual layout including phase-accordion offsets).
    const canvasEl = document.getElementById('canvas-wrap');
    if (canvasEl) {
      const { width: W, height: H } = canvasEl.getBoundingClientRect();
      const livePositions = adjustedPositionsRef.current;
      const relevantIds = new Set([pathHighlightNodeId, ...ancestors, ...descendants]);
      const pts = [...relevantIds]
        .map((id) => livePositions[id])
        .filter(Boolean) as { x: number; y: number }[];
      if (pts.length) {
        const minX = Math.min(...pts.map((p) => p.x));
        const minY = Math.min(...pts.map((p) => p.y));
        const maxX = Math.max(...pts.map((p) => p.x + NODE_W));
        const maxY = Math.max(...pts.map((p) => p.y + NODE_H));
        const PAD = 80;
        const k = Math.min(
          (W - PAD * 2) / (maxX - minX || 1),
          (H - PAD * 2) / (maxY - minY || 1),
          1.0,
        );
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        flyTo({ x: W / 2 - cx * k, y: H / 2 - cy * k, k: Math.max(k, 0.1) });
      }
    }
  }, [pathHighlightNodeId, pathHighlightMode, allEdges, flyTo]);

  // ── Stable focus-request handler (prevents NodeCard memo invalidation) ─
  const handleFocusRequest = useCallback(
    (id: string) => {
      enterFocusMode(id);
      setTimeout(() => fitToScreen(), 50);
    },
    [enterFocusMode, fitToScreen],
  );

  // ── Collapsed phase hover card handlers ───────────────────────────────
  const handleCollapsedHover = useCallback(
    (phaseId: string, cx: number, cy: number) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setCollapsedPhaseHiding(false);
      setCollapsedPhaseHover({ phaseId, clientX: cx, clientY: cy });
    },
    [],
  );

  const handleCollapsedHoverEnd = useCallback(() => {
    setCollapsedPhaseHiding(true);
    hideTimerRef.current = setTimeout(() => {
      setCollapsedPhaseHover(null);
      setCollapsedPhaseHiding(false);
    }, 150);
  }, []);

  // ── Cursor style based on active tool ─────────────────────────────────
  const canvasCursor = spaceHeld
    ? panState.current
      ? "grabbing"
      : "grab"
    : designMode && designTool === "add"
      ? "cell"
      : designMode && designTool === "connect"
        ? "crosshair"
        : marqueeMode
          ? marquee
            ? "crosshair"
            : "crosshair"
          : panState.current
            ? "grabbing"
            : "grab";

  return (
    <div
      id="canvas-wrap"
      ref={canvasWrapRef}
      className={`${styles.canvasWrap} ${designMode ? styles.designModeActive : ""} ${discoveryActive ? styles.cinemaModeActive : ""} ${focusedOwner ? styles.ownerFocusModeActive : ""}`}
      style={
        focusedOwner
          ? ({
              "--owner-focus-color": ownerColors[focusedOwner] ?? "#4f9eff",
            } as React.CSSProperties)
          : undefined
      }
    >
      {/* Cinema mode badge */}
      {discoveryActive && <div className={styles.cinemaBadge}>🎬 Cinema</div>}

      {/* Owner Focus badge — top-left, visible in all modes including cinema */}
      {focusedOwner && (
        <div className={styles.ownerFocusBadge}>◎ {focusedOwner}</div>
      )}

      {/* Empty state — shown when no JSON has been loaded yet (hidden in design mode) */}
      {!hasData && !designMode && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>⬡</div>
          <div className={styles.emptyTitle}>FlowGraph</div>
          <div className={styles.emptySub}>
            Visualize and edit dependency graphs
          </div>
          <div className={styles.emptyActions}>
            <button
              className={styles.emptyActionBtn}
              onClick={() =>
                document.dispatchEvent(
                  new CustomEvent("flowgraph:open-file-picker"),
                )
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className={styles.emptyActionLabel}>Open JSON File</span>
              <span className={styles.emptyActionHint}>
                Open an existing flowchart
              </span>
            </button>
            <div className={styles.emptyOr}>or</div>
            <button
              className={`${styles.emptyActionBtn} ${styles.emptyActionBtnSample}`}
              onClick={() =>
                document.dispatchEvent(new CustomEvent("flowgraph:pick-sample"))
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span className={styles.emptyActionLabel}>Try Sample</span>
              <span className={styles.emptyActionHint}>
                Choose a demo flowchart
              </span>
            </button>
            <div className={styles.emptyOr}>or</div>
            <button
              className={`${styles.emptyActionBtn} ${styles.emptyActionBtnDesign}`}
              onClick={() => clearGraph()}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className={styles.emptyActionLabel}>New Flowchart</span>
              <span className={styles.emptyActionHint}>
                Start from scratch in design mode
              </span>
            </button>
          </div>
          <div className={styles.emptyFootnote}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Chrome / Edge: opening a file links it — Save writes back to your
            file directly, no download needed. Other browsers: Save downloads a
            copy.
          </div>
          <div className={styles.emptyCredit}>
            Built with Claude Code · Authored by Giang Tran
          </div>
        </div>
      )}

      {/* Main SVG canvas */}
      <svg
        ref={svgRef}
        className={styles.svgCanvas}
        style={{ cursor: canvasCursor }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
        onClick={handleSvgClick}
        onDoubleClick={handleSvgDblClick}
      >
        <defs>
          {/* Default arrowhead marker for edges */}
          <marker
            id="arrow"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#070a10" />
          </marker>
          {/* Highlighted arrowhead — blue, for hovered connected edges */}
          <marker
            id="arrow-highlight"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#4f9eff" />
          </marker>
          {/*
            Dynamic color arrowhead — inherits currentColor from the edge stroke.
            Used when hovering so the arrowhead matches the owner color of the source node.
          */}
          <marker
            id="arrow-dyn"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
          </marker>
          {/* Design mode ghost edge arrowhead — purple dashed */}
          <marker
            id="arrow-ghost"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#a78bfa" />
          </marker>
        </defs>

        {/* Graph root — all pan/zoom transform is applied here */}
        <g
          id="graph-root"
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
        >
          {/* Layer order: lanes background → edges → nodes (nodes always on top) */}
          {/* key causes React to remount when view/focus changes, replaying the CSS fade-in */}
          <g
            key={`${viewMode}-${focusMode ? focusNodeId : "normal"}-${visibleNodes.length}-${visibleEdges[0]?.from ?? "x"}`}
            id="graph-content"
            className={suppressEntrance ? "suppress-entrance" : undefined}
            style={spaceHeld ? { pointerEvents: "none" } : undefined}
          >
            {/* Phase bands — fills + borders only, rendered first behind everything */}
            <g id="phase-layer">
              <PhaseLayer
                phases={phases}
                nodes={visibleNodes}
                groups={groups}
                positions={adjustedPositions}
                focusedPhaseId={focusedPhaseId}
                selectedPhaseId={selectedPhaseId}
                canvasHeight={svgBandHeight}
                collapsedPhaseIds={collapsedPhaseIds}
                viewMode={viewMode}
                screenToSvg={screenToSvg}
                onPhaseClick={(id) => setSelectedPhaseId(id)}
                onPhaseDoubleClick={(id) => togglePhaseCollapse(id)}
                onToggleCollapse={togglePhaseCollapse}
                onCollapsedHover={handleCollapsedHover}
                onCollapsedHoverEnd={handleCollapsedHoverEnd}
                renderPart="background"
                transform={transform}
                canvasPixelHeight={canvasPixelHeight}
              />
            </g>
            <g id="lanes-layer">
              <LaneLayer
                nodes={visibleNodes}
                positions={adjustedPositions}
                laneMetrics={laneMetrics}
                ownerColors={ownerColors}
                viewMode={viewMode}
                onFocusOwner={enterOwnerFocus}
                focusedOwner={focusedOwner}
              />
            </g>

            {/* Expanded group overlays — drawn below edges so they appear as background.
              Sorted outer-first (highest nestLevel) so inner groups render last = on top,
              ensuring inner groups capture clicks before outer group overlays do. */}
            <g id="groups-expanded-layer">
              {(() => {
                const hiddenGroupIds = getHiddenGroupIds(groups);
                return groups
                  .filter(
                    (g) =>
                      !g.collapsed &&
                      !hiddenGroupIds.has(g.id) &&
                      !phaseHiddenGroupIds.has(g.id) &&
                      (!focusVisibleGroupIds || focusVisibleGroupIds.has(g.id)),
                  )
                  .sort(
                    (a, b) =>
                      computeGroupNestLevel(b.id, groups) -
                      computeGroupNestLevel(a.id, groups),
                  );
              })().map((group) => {
                const childNodePositions = getAllDescendantNodeIds(
                  group.id,
                  groups,
                )
                  .map((nid) => adjustedPositions[nid])
                  .filter(Boolean) as { x: number; y: number }[];
                const groupColor = ownerColors[group.owners[0]] ?? "#4f9eff";
                const nestLevel = computeGroupNestLevel(group.id, groups);
                const pos = adjustedPositions[group.id] ?? { x: 0, y: 0 };
                return (
                  <GroupCard
                    key={group.id}
                    group={group}
                    position={pos}
                    color={groupColor}
                    childPositions={childNodePositions}
                    screenToSvg={screenToSvg}
                    nestLevel={nestLevel}
                    onToggleCollapse={handleGroupToggle}
                    laneMetrics={laneMetrics}
                    viewMode={viewMode}
                    laneFocusRole={getOwnerFocusRole(
                      group.id,
                      group.owners[0] ?? "",
                    )}
                    entranceDelay={
                      Math.max(0, Math.round(pos.x / (NODE_W + GAP_X))) * 120
                    }
                    animate={!suppressEntrance}
                  />
                );
              })}
            </g>

            <g id="edges-layer">
              <EdgeLayer
                edges={phaseFilteredEdges}
                positions={adjustedPositions}
                designMode={designMode}
                ownerColors={ownerColors}
                nodes={visibleNodes}
                groups={groups}
                ownerFocusSets={ownerFocusSets}
                focusedOwner={focusedOwner}
                suppressEntranceAnimation={suppressEntrance}
                onEdgeSelectPathType={(edge, clientX, clientY) =>
                  setPathTypePopover({ edge, position: { x: clientX, y: clientY } })
                }
              />
              {/* Ghost edge shown while drawing a connection in design mode */}
              {designMode && connectSourceId && ghostTarget && (
                <GhostEdge
                  sourcePosition={adjustedPositions[connectSourceId]}
                  targetPoint={ghostTarget}
                />
              )}
            </g>
            <g id="nodes-layer">
              {visibleNodes
                .filter((node) => !hiddenNodeIds.has(node.id))
                .map((node) => {
                  const nodePos = adjustedPositions[node.id] ?? { x: 0, y: 0 };
                  return (
                    <NodeCard
                      key={node.id}
                      node={node}
                      position={nodePos}
                      color={ownerColors[node.owner] ?? "#4f9eff"}
                      screenToSvg={screenToSvg}
                      onFocusRequest={handleFocusRequest}
                      laneFocusRole={getOwnerFocusRole(node.id, node.owner)}
                      isFocusNode={focusMode && node.id === focusNodeId}
                      entranceDelay={nodeEntranceDelay[node.id] ?? 0}
                      animate={!suppressEntrance}
                    />
                  );
                })}
              {fadingOutNodeIds.map((id) => {
                const node = allNodes.find((n) => n.id === id);
                const pos = fadingOutPositions[id];
                if (!node || !pos) return null;
                return (
                  <NodeCard
                    key={`fading-${id}`}
                    node={node}
                    position={pos}
                    color={ownerColors[node.owner] ?? "#4f9eff"}
                    screenToSvg={screenToSvg}
                    onFocusRequest={handleFocusRequest}
                    fadingOut
                    animate={false}
                  />
                );
              })}
            </g>

            {/* Collapsed group polygons — drawn above nodes */}
            <g id="groups-collapsed-layer">
              {(() => {
                const hiddenGroupIds = getHiddenGroupIds(groups);
                return groups.filter(
                  (g) =>
                    g.collapsed &&
                    !hiddenGroupIds.has(g.id) &&
                    !phaseHiddenGroupIds.has(g.id) &&
                    (!focusVisibleGroupIds || focusVisibleGroupIds.has(g.id)),
                );
              })().map((group) => {
                const groupColor = ownerColors[group.owners[0]] ?? "#4f9eff";
                const nestLevel = computeGroupNestLevel(group.id, groups);
                const pos = adjustedPositions[group.id] ?? { x: 0, y: 0 };
                return (
                  <GroupCard
                    key={group.id}
                    group={group}
                    position={pos}
                    color={groupColor}
                    childPositions={[]}
                    screenToSvg={screenToSvg}
                    nestLevel={nestLevel}
                    onToggleCollapse={handleGroupToggle}
                    laneMetrics={laneMetrics}
                    viewMode={viewMode}
                    laneFocusRole={getOwnerFocusRole(
                      group.id,
                      group.owners[0] ?? "",
                    )}
                    entranceDelay={
                      Math.max(0, Math.round(pos.x / (NODE_W + GAP_X))) * 120
                    }
                    animate={!suppressEntrance}
                  />
                );
              })}
            </g>

            {/* Summon ring + ping — above all nodes */}
            {summonActive && <CanvasPing />}
            {summonActive && summonShowRing && <GhostRing />}
          </g>
          {/* end graph-content */}

          {/* Marquee selection rect — inside #graph-root so it shares the pan/zoom transform */}
          {marquee && (() => {
            const x = Math.min(marquee.startSvg.x, marquee.curSvg.x);
            const y = Math.min(marquee.startSvg.y, marquee.curSvg.y);
            const w = Math.abs(marquee.curSvg.x - marquee.startSvg.x);
            const h = Math.abs(marquee.curSvg.y - marquee.startSvg.y);
            return (
              <rect
                x={x} y={y} width={w} height={h}
                fill="rgba(59,130,246,0.08)"
                stroke="#3b82f6"
                strokeWidth={1.5 / transform.k}
                strokeDasharray={`${5 / transform.k} ${3 / transform.k}`}
                pointerEvents="none"
              />
            );
          })()}
        </g>

        {/* Phase header strips — rendered as a sibling to #graph-root so they always
            paint above node compositing layers (will-change:opacity promotes NodeCards
            to GPU layers; anything inside #graph-root that isn't also promoted gets
            drawn into the background layer and covered). Applying the same transform
            keeps coordinates identical. */}
        <g
          id="phase-headers-overlay"
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
          style={{ willChange: "transform" }}
        >
          <PhaseLayer
            phases={phases}
            nodes={visibleNodes}
            groups={groups}
            positions={adjustedPositions}
            focusedPhaseId={focusedPhaseId}
            selectedPhaseId={selectedPhaseId}
            canvasHeight={svgBandHeight}
            collapsedPhaseIds={collapsedPhaseIds}
            viewMode={viewMode}
            screenToSvg={screenToSvg}
            onPhaseClick={(id) => setSelectedPhaseId(id)}
            onPhaseDoubleClick={(id) => togglePhaseCollapse(id)}
            onToggleCollapse={togglePhaseCollapse}
            onCollapsedHover={(phaseId, cx, cy) =>
              setCollapsedPhaseHover({ phaseId, clientX: cx, clientY: cy })
            }
            onCollapsedHoverEnd={() => setCollapsedPhaseHover(null)}
            renderPart="headers"
            transform={transform}
            canvasPixelHeight={canvasPixelHeight}
          />
        </g>
      </svg>

      {/* Design mode toolbar banner */}
      {designMode && <DesignToolbar />}

      {/* Focus mode banner */}
      {focusMode && focusedNode && (
        <div className={styles.focusBanner}>
          <span className={styles.focusBannerIcon}>🎯</span>
          <button
            className={styles.focusBannerLocate}
            title="Click to fly to this node"
            onClick={() => {
              if (!focusNodeId) return;
              setSelectedNode(focusNodeId);
              setLastJumpedNode(focusNodeId);
              const pos = positions[focusNodeId];
              if (pos) {
                const canvasEl = document.getElementById('canvas-wrap');
                if (canvasEl) {
                  const { width: W, height: H } = canvasEl.getBoundingClientRect();
                  flyTo({ x: W / 2 - (pos.x + 90) * 0.75, y: H / 2 - (pos.y + 36) * 0.75, k: 0.75 });
                }
              }
            }}
          >
            Focus: <strong>{focusedNode.name}</strong>
          </button>
          <div className={styles.focusDepthToggle}>
            <button
              className={`${styles.focusDepthBtn} ${focusDepth === 'neighbors' ? styles.focusDepthBtnActive : ''}`}
              onClick={() => setFocusDepth('neighbors')}
              title="Show only direct parents and children"
            >
              Neighbors
            </button>
            <button
              className={`${styles.focusDepthBtn} ${focusDepth === 'full' ? styles.focusDepthBtnActive : ''}`}
              onClick={() => setFocusDepth('full')}
              title="Show all ancestors and descendants"
            >
              Full Path
            </button>
          </div>
          <span className={styles.focusBannerHint}>
            Esc or double-click background to exit
          </span>
          <button className={styles.focusBannerClose} onClick={exitFocusMode}>
            ✕
          </button>
        </div>
      )}

      {/* Phase Crowns — sticky context bars at top edge when headers scroll out of view. */}
      {hasData && phases.length > 0 && (
        <PhaseCrowns
          bands={crownBands}
          transform={transform}
          canvasWidth={canvasPixelWidth}
          globalBandTop={globalBandTop}
        />
      )}

      {/* Lane Crowns — sticky owner labels on the left edge when lane labels scroll off-screen.
          Shown in lanes mode whenever the user pans right or zooms in past x=0. */}
      {hasData && viewMode === "lanes" && (
        <LaneCrowns
          nodes={visibleNodes}
          laneMetrics={laneMetrics}
          ownerColors={ownerColors}
          transform={transform}
          canvasHeight={canvasPixelHeight}
          onFocusOwner={enterOwnerFocus}
          focusedOwner={focusedOwner}
        />
      )}

      {/* Phase Navigator — floating pill bar */}
      {hasData && (
        <PhaseNavigator
          phases={phases}
          focusedPhaseId={focusedPhaseId}
          designMode={designMode}
          inViewportPhaseIds={inViewportPhaseIds}
          collapsedPhaseIds={collapsedPhaseIds}
          onFocusPhase={setFocusedPhaseId}
          onCreatePhase={() =>
            document.dispatchEvent(
              new CustomEvent("flowgraph:create-phase", { detail: {} }),
            )
          }
          onToggleCollapse={togglePhaseCollapse}
          onCollapseAll={collapseAllPhases}
          onExpandAll={expandAllPhases}
        />
      )}

      {/* Owner Focus Bar — floating status bar when an owner lane is focused */}
      {hasData && focusedOwner && ownerFocusSets && (
        <OwnerFocusBar
          focusedOwner={focusedOwner}
          ownerColor={ownerColors[focusedOwner] ?? "#4f9eff"}
          upstreamCount={ownerFocusSets.upstreamIds.size}
          downstreamCount={ownerFocusSets.downstreamIds.size}
          hiddenLaneCount={ownerFocusSets.hiddenLaneCount}
          onExit={exitOwnerFocus}
        />
      )}

      {/* Collapsed phase hover card — shown while hovered or animating out */}
      {collapsedPhaseHover &&
        canvasWrapRef.current &&
        (collapsedPhaseIds.includes(collapsedPhaseHover.phaseId) ||
          collapsedPhaseHiding) &&
        (() => {
          const ph = phases.find((p) => p.id === collapsedPhaseHover.phaseId);
          if (!ph) return null;
          return (
            <PhaseHoverCard
              phase={ph}
              allNodes={allNodes}
              groups={groups}
              clientX={collapsedPhaseHover.clientX}
              clientY={collapsedPhaseHover.clientY}
              canvasRect={canvasWrapRef.current.getBoundingClientRect()}
              isHiding={
                collapsedPhaseHiding ||
                !collapsedPhaseIds.includes(collapsedPhaseHover.phaseId)
              }
              onExpand={() => togglePhaseCollapse(collapsedPhaseHover.phaseId)}
            />
          );
        })()}

      {/* Minimap — bottom right corner overview */}
      <MiniMap
        nodes={visibleNodes.filter((n) => !hiddenNodeIds.has(n.id))}
        positions={adjustedPositions}
        transform={transform}
        ownerColors={ownerColors}
        canvasRef={canvasWrapRef}
      />

      {/* Zoom controls — bottom center */}
      <div className={styles.zoomControls}>
        <button
          className={styles.zoomBtn}
          onClick={() => {
            const newK = Math.min(3, transform.k * 1.2);
            const canvas = document.getElementById("canvas-wrap");
            if (!canvas) return;
            const { width: w, height: h } = canvas.getBoundingClientRect();
            setTransform({
              x: w / 2 - (w / 2 - transform.x) * (newK / transform.k),
              y: h / 2 - (h / 2 - transform.y) * (newK / transform.k),
              k: newK,
            });
          }}
          title="Zoom in"
        >
          +
        </button>
        <div className={styles.zoomLabel}>{Math.round(transform.k * 100)}%</div>
        <button
          className={styles.zoomBtn}
          onClick={() => {
            const newK = Math.max(0.1, transform.k * 0.83);
            const canvas = document.getElementById("canvas-wrap");
            if (!canvas) return;
            const { width: w, height: h } = canvas.getBoundingClientRect();
            setTransform({
              x: w / 2 - (w / 2 - transform.x) * (newK / transform.k),
              y: h / 2 - (h / 2 - transform.y) * (newK / transform.k),
              k: newK,
            });
          }}
          title="Zoom out"
        >
          −
        </button>
      </div>

      {/* Edge delete tooltip — shown when hovering an edge in design mode */}
      <div
        id="edge-delete-tip"
        className={styles.edgeDeleteTip}
        style={{ display: "none" }}
      >
        🗑 Click to delete connection
      </div>

      {/* PathTypePopover — appears when clicking an edge with 'select' tool */}
      {pathTypePopover && (
        <PathTypePopover
          edge={pathTypePopover.edge}
          position={pathTypePopover.position}
          currentType={pathTypePopover.edge.pathType ?? 'standard'}
          onSelect={(type) => {
            setEdgePathType(`${pathTypePopover.edge.from}:${pathTypePopover.edge.to}`, type);
          }}
          onClose={() => setPathTypePopover(null)}
        />
      )}

      {/* Node hover tooltip — shows full name + tags when hovering a node */}
      {(() => {
        if (
          !hoveredNodeId ||
          !tooltipPos ||
          isMouseDown ||
          focusMode ||
          tooltipHidden
        )
          return null;
        const hovNode = allNodes.find((n) => n.id === hoveredNodeId);
        if (!hovNode) return null;
        const wrap = canvasWrapRef.current;
        const wrapW = wrap?.offsetWidth ?? 9999;
        const wrapH = wrap?.offsetHeight ?? 9999;
        const TOOLTIP_W = 220;
        const OFFSET_X = 14;
        const OFFSET_Y = -12;
        let left = tooltipPos.x + OFFSET_X;
        let top = tooltipPos.y + OFFSET_Y;
        // Clamp so tooltip never overflows the canvas container
        if (left + TOOLTIP_W > wrapW - 8)
          left = tooltipPos.x - TOOLTIP_W - OFFSET_X;
        if (top < 8) top = tooltipPos.y + 24;
        if (top + 80 > wrapH - 8) top = tooltipPos.y - 80;
        return (
          <div
            className={styles.nodeTooltip}
            style={{ left, top, maxWidth: TOOLTIP_W }}
            // pointer-events:none so it never captures mouse events
          >
            <div className={styles.nodeTooltipName}>{hovNode.name}</div>
          </div>
        );
      })()}

      {/* Summon overlay — dims canvas behind the dock */}
      {summonActive && <SummonOverlay />}

      {/* Persistent attribution — bottom-left corner */}
      <div className={styles.credit}>
        Built with Claude Code · Authored by Giang Tran
      </div>
    </div>
  );
}
