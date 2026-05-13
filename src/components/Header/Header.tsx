/**
 * components/Header/Header.tsx — Top navigation bar for FlowGraph.
 *
 * Contains: logo, file loader, search bar, status chip, view toggle,
 * saved layouts dropdown, design mode button, save JSON button, and action buttons.
 *
 * Button mapping (matches original HTML exactly):
 *   ☰  — toggle owner-filter sidebar
 *   ▣  — toggle inspector pane
 *   ?  — open AI Prompt / JSON spec modal  (original btn-help behaviour)
 *   ↺  — reload from file (restore last saved state)
 *   🌳 — reset layout (recalculate positions from scratch, DAG tree SVG)
 *   ⊞  — fit to screen
 *   📖 — user guide (far right)
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import { exportGraphToJson, buildExportPayload } from '../../utils/exportJson';
import { exportToPdf } from '../../utils/exportPdf';
import { buildTourSequence } from '../../utils/cinema';
import type { SavedLayout } from '../../types/graph';
import styles from './Header.module.css';

export function Header() {
  const {
    allNodes, allEdges, visibleNodes, viewMode, designMode, designDirty,
    setViewMode, setDesignMode, loadData, rebuildGraph, clearGraph,
    saveNamedLayout, loadNamedLayout, fitToScreen,
    setSelectedNode, setLastJumpedNode, positions, setTransform, flyTo,
    activeOwners, toggleOwner, currentFileName, ownerColors,
    fileHandle, setFileHandle, setCurrentFileName, groups, phases, tagRegistry, ownerRegistry, meta,
    discoveryActive, discoverySequence, startDiscovery, exitDiscovery, discoveryEngagement,
    focusMode, exitFocusMode, focusedOwner, exitOwnerFocus, setPathHighlight,
    edgePathTypes, marqueeMode, toggleMarqueeMode,
    criticalPathActive, toggleCriticalPath,
    criticalFocusActive, runAutoLayout,
  } = useGraphStore();

  // True when File System Access API is available (Chrome/Edge 86+)
  const fsApiSupported = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

  // ── Local UI state ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<typeof allNodes>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [layoutName, setLayoutName] = useState('');
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  // Modal open flag — numeric counter so every button click triggers the effect.
  const [guidePulse, setGuidePulse] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const layoutsRef = useRef<HTMLDivElement>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const [modeMenuPos, setModeMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // ── Load saved layouts from localStorage on mount / dropdown open ─────
  useEffect(() => {
    const raw = localStorage.getItem('flowgraph-layouts');
    if (raw) {
      try { setSavedLayouts(JSON.parse(raw)); } catch { /* ignore corrupt data */ }
    }
  }, [layoutsOpen]);

  // ── Modal event dispatch — increment-counter pattern ──────────────────
  useEffect(() => {
    if (guidePulse === 0) return;
    document.dispatchEvent(new CustomEvent('flowgraph:open-guide'));
  }, [guidePulse]);

  // ── Shared JSON parse + load logic ───────────────────────────────────
  const parseAndLoad = useCallback((text: string, fileName: string, handle: FileSystemFileHandle | null) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      alert('Invalid JSON file. Make sure the file is valid JSON.');
      return;
    }

    let rawNodes: unknown[];
    let savedLayout: { positions: Record<string, { x: number; y: number }>; transform: { x: number; y: number; k: number }; viewMode?: string; currentView?: string; dag?: unknown; lanes?: unknown } | null = null;

    if (Array.isArray(parsed)) {
      rawNodes = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).nodes)) {
      const obj = parsed as Record<string, unknown>;
      rawNodes = obj.nodes as unknown[];
      savedLayout = (obj._layout as typeof savedLayout) ?? null;
      // Attach groups and phases to savedLayout so loadData can pick them up
      if (savedLayout && Array.isArray(obj.groups)) {
        (savedLayout as Record<string, unknown>).groups = obj.groups;
      } else if (!savedLayout && Array.isArray(obj.groups)) {
        savedLayout = { positions: {}, transform: { x: 0, y: 0, k: 1 }, groups: obj.groups } as unknown as typeof savedLayout;
      }
      if (savedLayout && Array.isArray(obj.phases)) {
        (savedLayout as Record<string, unknown>).phases = obj.phases;
      } else if (!savedLayout && Array.isArray(obj.phases)) {
        savedLayout = { positions: {}, transform: { x: 0, y: 0, k: 1 }, phases: obj.phases } as unknown as typeof savedLayout;
      }
      if (savedLayout && Array.isArray(obj.tagRegistry)) {
        (savedLayout as Record<string, unknown>).tagRegistry = obj.tagRegistry;
      } else if (!savedLayout && Array.isArray(obj.tagRegistry)) {
        savedLayout = { positions: {}, transform: { x: 0, y: 0, k: 1 }, tagRegistry: obj.tagRegistry } as unknown as typeof savedLayout;
      }
      if (savedLayout && Array.isArray(obj.ownerRegistry)) {
        (savedLayout as Record<string, unknown>).ownerRegistry = obj.ownerRegistry;
      } else if (!savedLayout && Array.isArray(obj.ownerRegistry)) {
        savedLayout = { positions: {}, transform: { x: 0, y: 0, k: 1 }, ownerRegistry: obj.ownerRegistry } as unknown as typeof savedLayout;
      }
      if (obj._meta && typeof obj._meta === 'object') {
        if (savedLayout) {
          (savedLayout as Record<string, unknown>).meta = obj._meta;
        } else {
          savedLayout = { positions: {}, transform: { x: 0, y: 0, k: 1 }, meta: obj._meta } as unknown as typeof savedLayout;
        }
      }
      if (obj.edgePathTypes && typeof obj.edgePathTypes === 'object') {
        if (savedLayout) {
          (savedLayout as Record<string, unknown>).edgePathTypes = obj.edgePathTypes;
        } else {
          savedLayout = { positions: {}, transform: { x: 0, y: 0, k: 1 }, edgePathTypes: obj.edgePathTypes } as unknown as typeof savedLayout;
        }
      }
    } else {
      alert('JSON must be an array of nodes or an object with a "nodes" array.');
      return;
    }

    const nodes = (rawNodes as Record<string, unknown>[]).map((raw) => ({
      id: String(raw.id ?? ''),
      name: String(raw.name ?? raw.id ?? 'Unnamed'),
      owner: String(raw.owner ?? 'Unknown'),
      description: String(raw.description ?? ''),
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map(String) : [],
      ...(Array.isArray(raw.tags) && raw.tags.length > 0 ? { tags: raw.tags as import('../../types/graph').NodeTag[] } : {}),
    }));

    loadData(nodes, savedLayout, fileName);
    setFileHandle(handle); // null for legacy input, FileSystemFileHandle for API
    setLastSavedAt(null); // new file — reset save timestamp

    // Fit to screen when no saved positions exist for the loaded view.
    // Covers: (a) no _layout at all, (b) _layout exists but the active view's positions
    // are empty (e.g. file always saved in Lanes mode leaves dag.positions = {}).
    const needsFit = !savedLayout || (() => {
      const sl = savedLayout as Record<string, unknown>;
      const view = String(sl.currentView ?? 'dag');
      const viewLayout = view === 'lanes' ? sl.lanes : sl.dag;
      const positions = viewLayout ? (viewLayout as Record<string, unknown>).positions : null;
      return !positions || Object.keys(positions as Record<string, unknown>).length === 0;
    })();
    if (needsFit) setTimeout(() => fitToScreen(false), 100);
  }, [loadData, setFileHandle, fitToScreen]);

  // ── Primary file open — File System Access API (Chrome/Edge) ─────────
  const handleOpenFile = useCallback(async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'FlowGraph JSON', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        const text = await file.text();
        parseAndLoad(text, file.name, handle);
      } catch (err) {
        // AbortError = user cancelled the picker — not a real error
        if ((err as Error).name !== 'AbortError') {
          alert(`Failed to open file: ${(err as Error).message}`);
        }
      }
    } else {
      // Fallback for Firefox/Safari: use hidden <input type="file">
      fileInputRef.current?.click();
    }
  }, [parseAndLoad]);

  // ── Fallback file load via <input type="file"> ────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      parseAndLoad(text, file.name, null); // null = no handle, saves will download
    } catch (err) {
      alert(`Failed to load file: ${(err as Error).message}`);
    }
    e.target.value = '';
  }

  // ── Allow Canvas empty state to trigger the file picker ──────────────
  useEffect(() => {
    document.addEventListener('flowgraph:open-file-picker', handleOpenFile);
    return () => document.removeEventListener('flowgraph:open-file-picker', handleOpenFile);
  }, [handleOpenFile]);

  // ── Load sample flowchart — detail.file selects which sample to load ────
  useEffect(() => {
    const handleLoadSample = (e: Event) => {
      try {
        const detail = (e as CustomEvent<{ file?: string; data?: unknown }>).detail;
        const file = detail?.file ?? 'sample.json';
        const fileName = file.split('/').pop() ?? file;
        if (detail?.data !== undefined) {
          // Bundled data — no fetch needed; works offline and via file://
          parseAndLoad(JSON.stringify(detail.data), fileName, null);
        } else {
          // Fallback: fetch from server (hosted deployment)
          const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
          fetch(`${base}${file}`)
            .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
            .then((text) => parseAndLoad(text, fileName, null))
            .catch((err) => alert(`Failed to load sample: ${(err as Error).message}`));
        }
      } catch (err) {
        alert(`Failed to load sample: ${(err as Error).message}`);
      }
    };
    document.addEventListener('flowgraph:load-sample', handleLoadSample);
    return () => document.removeEventListener('flowgraph:load-sample', handleLoadSample);
  }, [parseAndLoad]);

  // ── Save — writes in-place if handle available; prompts for location when
  //          unlinked on browsers that support the File System Access API;
  //          falls back to download only as a last resort. ─────────────────
  const handleSaveJson = useCallback(async () => {
    if (fileHandle) {
      try {
        const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') throw new Error('Write permission denied');
        const payload = buildExportPayload(allNodes, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
        setLastSavedAt(new Date());
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          // Permission denied or write error — fall back to download so no data is lost
          exportGraphToJson(allNodes, currentFileName ?? undefined, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
          setLastSavedAt(new Date());
        }
      }
    } else if (window.showSaveFilePicker) {
      // No linked file yet but browser supports the API — prompt the user to
      // choose a save location so the chart becomes linked immediately.
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentFileName ?? 'flowgraph.json',
          types: [{ description: 'FlowGraph JSON', accept: { 'application/json': ['.json'] } }],
        });
        const payload = buildExportPayload(allNodes, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
        setFileHandle(handle);
        setCurrentFileName(handle.name);
        setLastSavedAt(new Date());
      } catch (err) {
        // User cancelled the picker — do nothing (no download fallback).
        if ((err as Error).name !== 'AbortError') {
          // Unexpected error — fall back to download so no data is lost.
          exportGraphToJson(allNodes, currentFileName ?? undefined, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
          setLastSavedAt(new Date());
        }
      }
    } else {
      // Last resort: browser doesn't support File System Access API.
      exportGraphToJson(allNodes, currentFileName ?? undefined, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
      setLastSavedAt(new Date());
    }
  }, [fileHandle, allNodes, currentFileName, setFileHandle, setCurrentFileName, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes]);

  // ── Save As — pick a new file path, write, and update the handle ────────
  const handleSaveAs = useCallback(async () => {
    setSaveMenuOpen(false);
    const payload = buildExportPayload(allNodes, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
    const json = JSON.stringify(payload, null, 2);

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentFileName ?? 'flowgraph.json',
          types: [{ description: 'FlowGraph JSON', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setFileHandle(handle);
        setCurrentFileName(handle.name);
        setLastSavedAt(new Date());
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          alert(`Save As failed: ${(err as Error).message}`);
        }
      }
    } else {
      // Fallback: download with a user-chosen name via prompt
      const name = window.prompt('Enter a filename for the saved file:', currentFileName ?? 'flowgraph.json');
      if (!name) return;
      const safeName = name.endsWith('.json') ? name : `${name}.json`;
      exportGraphToJson(allNodes, safeName, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes);
      setCurrentFileName(safeName);
      setLastSavedAt(new Date());
    }
  }, [allNodes, currentFileName, setFileHandle, setCurrentFileName, groups, phases, tagRegistry, ownerRegistry, meta, edgePathTypes]);

  // ── Reload from file — re-read via fileHandle and restore saved state ───
  const handleReloadFromFile = useCallback(async () => {
    if (!fileHandle) return;
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      parseAndLoad(text, currentFileName ?? file.name, fileHandle);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') alert('Failed to reload from file.');
    }
  }, [fileHandle, currentFileName, parseAndLoad]);

  // ── Export PDF ───────────────────────────────────────────────────────────
  const handleExportPdf = useCallback((mode: 'current' | 'full') => {
    setSaveMenuOpen(false);
    const nodeOwnerMap: Record<string, string> = {};
    allNodes.forEach((n) => { nodeOwnerMap[n.id] = n.owner; });
    exportToPdf(mode, positions, ownerColors, nodeOwnerMap, undefined, viewMode);
  }, [positions, ownerColors, allNodes, viewMode]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setShowSearchResults(false);
        setLayoutsOpen(false);
      }
      // Shift+? opens the user guide (matches original HTML behaviour)
      if (e.shiftKey && e.key === '?') {
        setGuidePulse((n) => n + 1);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  // ── Close dropdowns when clicking outside ──────────────────────
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (layoutsRef.current && !layoutsRef.current.contains(e.target as Node)) {
        setLayoutsOpen(false);
      }
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
      if (
        modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node) &&
        modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)
      ) {
        setModeMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // ── Search handler ────────────────────────────────────────────────────
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const lower = query.toLowerCase();
    const results = visibleNodes.filter(
      (node) =>
        node.name.toLowerCase().includes(lower) ||
        node.id.toLowerCase().includes(lower) ||
        node.owner.toLowerCase().includes(lower) ||
        node.description.toLowerCase().includes(lower)
    ).slice(0, 8);
    setSearchResults(results);
    setShowSearchResults(results.length > 0);
  }, [visibleNodes]);

  // ── Jump to node when a search result is clicked ──────────────────────
  /**
   * handleJumpToNode — centers the viewport on the target node and triggers
   * the pulsing amber glow.
   *
   * If the node's owner is currently filtered out, we activate that owner
   * first (matching the original HTML behaviour) so the node is visible.
   */
  function handleJumpToNode(nodeId: string) {
    setShowSearchResults(false);
    setSearchQuery('');

    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Make the owner visible if it was filtered out
    if (!activeOwners.has(node.owner)) {
      toggleOwner(node.owner);
    }

    setSelectedNode(nodeId);

    // Read the latest positions from the store (may have changed after toggleOwner)
    const latestPositions = useGraphStore.getState().positions;
    const pos = latestPositions[nodeId];
    if (!pos) return;

    const canvasEl = document.getElementById('canvas-wrap');
    if (!canvasEl) return;
    const { width: canvasW, height: canvasH } = canvasEl.getBoundingClientRect();
    const NODE_W = 180, NODE_H = 72;
    // Fly to the node at a comfortable 75% zoom regardless of current zoom level
    const targetScale = 0.75;
    const newX = canvasW / 2 - (pos.x + NODE_W / 2) * targetScale;
    const newY = canvasH / 2 - (pos.y + NODE_H / 2) * targetScale;
    flyTo({ x: newX, y: newY, k: targetScale });

    // Trigger the pulsing glow — stays until a different node is selected
    setLastJumpedNode(nodeId);
  }

  // ── Saved layout handlers ─────────────────────────────────────────────
  function handleSaveLayout() {
    if (!layoutName.trim()) return;
    saveNamedLayout(layoutName.trim());
    setLayoutName('');
    const raw = localStorage.getItem('flowgraph-layouts');
    if (raw) setSavedLayouts(JSON.parse(raw));
  }

  function handleDeleteLayout(index: number) {
    const updated = savedLayouts.filter((_, i) => i !== index);
    setSavedLayouts(updated);
    localStorage.setItem('flowgraph-layouts', JSON.stringify(updated));
  }

  // ── Discover / Cinema ─────────────────────────────────────────────────
  function handleDiscover() {
    if (discoveryActive) {
      exitDiscovery();
      return;
    }
    if (designMode) setDesignMode(false);
    if (criticalPathActive) toggleCriticalPath();
    if (focusMode) exitFocusMode();
    if (focusedOwner) exitOwnerFocus();
    if (viewMode !== 'dag') setViewMode('dag');
    setPathHighlight(null);
    setSearchQuery('');
    setShowSearchResults(false);
    const edges = allNodes.flatMap((n) =>
      n.dependencies.map((dep) => ({ from: dep, to: n.id }))
    );
    const sequence = buildTourSequence(allNodes, edges, phases, groups);
    startDiscovery(sequence);
  }

  const hasData = allNodes.length > 0;
  // True when a map is "active" — either nodes are loaded, or a new empty graph was started (designMode).
  const hasMap = hasData || designMode;
  const hasCriticalEdges = Object.values(edgePathTypes).some(t => t === 'critical');

  // Derive current mode label and active CSS class for the dropdown trigger
  const currentModeName = discoveryActive ? 'Discover'
    : criticalPathActive ? 'Paths'
    : designMode ? 'Design'
    : 'Explore';
  const currentModeClass = discoveryActive ? styles.btnModeMenuDiscover
    : criticalPathActive ? styles.btnModeMenuPaths
    : designMode ? styles.btnModeMenuDesign
    : '';

  return (
    <header className={styles.header}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>⬡</div>
        FlowGraph
      </div>
      <div className={styles.sep} />

      {/* Hidden fallback file input for browsers without File System Access API */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className={styles.fileInput}
      />

      {/* File menu dropdown — Open JSON, New, Samples, Reload */}
      {!discoveryActive && (
        <div className={styles.fileMenuWrap} ref={fileMenuRef}>
          <button
            className={`${styles.btnFileMenu} ${fileMenuOpen ? styles.btnFileMenuOpen : ''}`}
            title="File operations — open, new, samples, reload"
            onClick={() => setFileMenuOpen((v) => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span className={styles.btnLabel}>Open JSON</span>
            <svg className={styles.chevron} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {fileMenuOpen && (
            <div className={styles.fileMenuDropdown}>
              <button className={styles.fileMenuItem} onClick={() => { setFileMenuOpen(false); handleOpenFile(); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Open
              </button>
              <button className={styles.fileMenuItem} onClick={() => {
                setFileMenuOpen(false);
                if (allNodes.length > 0 && !window.confirm('Start a new flowchart? Unsaved changes will be lost.')) return;
                clearGraph(); setLastSavedAt(null);
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New
              </button>
              <button className={styles.fileMenuItem} onClick={() => { setFileMenuOpen(false); document.dispatchEvent(new CustomEvent('flowgraph:pick-sample')); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="1" y="1.5" width="8" height="5" rx="1.5"/>
                  <rect x="15" y="17.5" width="8" height="5" rx="1.5"/>
                  <path d="M9 4 C16 4 8 20 15 20" strokeWidth="1.6"/>
                  <polyline points="13,17.5 15,20 12.5,22" strokeWidth="1.6"/>
                </svg>
                Samples…
              </button>
              {fileHandle && <>
                <div className={styles.fileMenuDivider} />
                <button className={styles.fileMenuItem} onClick={() => { setFileMenuOpen(false); handleReloadFromFile(); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="1 4 1 10 7 10"/>
                    <path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
                  </svg>
                  Reload from File
                </button>
              </>}
            </div>
          )}
        </div>
      )}

      {/* Save — split button: primary action + chevron opens save/export menu */}
      {hasData && !discoveryActive && (
        <div className={styles.saveSplit} ref={saveMenuRef}>
          <button
            className={`${styles.btnSaveJson} ${fileHandle ? styles.btnSaveJsonLinked : ''} ${!designDirty && !fileHandle ? styles.btnSaveJsonQuiet : ''}`}
            title={fileHandle
              ? `Save — writes directly to "${currentFileName}" on your disk (no download)`
              : `Download JSON — saves a copy to your Downloads folder${currentFileName ? ` as "${currentFileName}"` : ''}\nTo save in-place, re-open the file using the Open button (Chrome/Edge only)`}
            onClick={handleSaveJson}
          >
            {fileHandle ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            <span className={styles.btnLabel}>{fileHandle ? 'Save' : 'Save JSON'}</span>
          </button>
          <button
            className={`${styles.btnSaveChevron} ${fileHandle ? styles.btnSaveChevronLinked : ''} ${!designDirty && !fileHandle ? styles.btnSaveChevronQuiet : ''} ${saveMenuOpen ? styles.btnSaveChevronOpen : ''}`}
            title="More save options"
            onClick={() => setSaveMenuOpen((v) => !v)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {saveMenuOpen && (
            <div className={styles.saveMenu}>
              <button className={styles.saveMenuItem} onClick={handleSaveAs}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                Save As…
              </button>
              <div className={styles.saveMenuDivider} />
              <button className={styles.saveMenuItem} onClick={() => handleExportPdf('current')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Export PDF — Current View
              </button>
              <button className={styles.saveMenuItem} onClick={() => handleExportPdf('full')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h18"/>
                </svg>
                Export PDF — Full Chart
              </button>
            </div>
          )}
        </div>
      )}

      {/* Current file name chip — shows linked (green) vs unlinked (gray) status */}
      {currentFileName && (
        <div
          className={`${styles.fileChip} ${fileHandle ? styles.fileChipLinked : styles.fileChipUnlinked}`}
          title={fileHandle
            ? `Linked to "${currentFileName}" — Save writes directly to this file on your disk`
            : `"${currentFileName}" loaded as a copy — Save will download a new file. Re-open with the button above to enable direct saving (Chrome/Edge only)`}
        >
          {fileHandle ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              <line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
          )}
          <span className={styles.fileChipName}>{currentFileName}</span>
        </div>
      )}

      {/* Search */}
      {hasMap && !discoveryActive && <div className={styles.searchWrap}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Search nodes… (⌘K)"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => searchQuery && setShowSearchResults(true)}
          onKeyDown={(e) => e.key === 'Escape' && setShowSearchResults(false)}
        />
        {showSearchResults && (
          <div className={styles.searchResults}>
            {searchResults.map((node) => (
              <div
                key={node.id}
                className={styles.searchItem}
                onMouseDown={() => handleJumpToNode(node.id)}
              >
                <span className={styles.searchItemName}>{node.name}</span>
                <span className={styles.searchItemId}>#{node.id} · {node.owner}</span>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Right-side toolbar */}
      <div className={styles.toolbarRight}>

        {/* Status chip */}
        <div className={styles.statusChip}>
          {hasData
            ? <><span>{allNodes.length}</span> nodes · <span>{allEdges.length}</span> edges</>
            : 'No data loaded'
          }
          {lastSavedAt && (
            <span
              className={`${styles.savedStamp} ${designDirty ? styles.savedStampStale : ''}`}
              title={designDirty
                ? `Last saved at ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — you have unsaved changes`
                : `Saved at ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            >
              · {designDirty ? '⚠' : '✓'} {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {designDirty && <span className={styles.unsavedDot} title="Unsaved changes">●</span>}
        </div>

        {/* Recalculate layout */}
        {hasMap && (
          <button
            className={styles.btnIcon}
            title="Reset layout — recalculate positions from scratch"
            onClick={() => { if (criticalFocusActive) { runAutoLayout(); } else { rebuildGraph(); setTimeout(() => fitToScreen(), 50); } }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="5" y="0.5" width="4" height="3.5" rx="0.7"/>
              <rect x="0.5" y="10" width="4" height="3.5" rx="0.7"/>
              <rect x="9.5" y="10" width="4" height="3.5" rx="0.7"/>
              <line x1="7" y1="4" x2="7" y2="7"/>
              <line x1="7" y1="7" x2="2.5" y2="10"/>
              <line x1="7" y1="7" x2="11.5" y2="10"/>
            </svg>
          </button>
        )}

        {/* Fit to screen */}
        {hasMap && (
          <button
            className={styles.btnIcon}
            title="Fit graph to screen"
            onClick={() => fitToScreen()}
          >⊞</button>
        )}

        {/* Default tool (pan + zoom + select) — active whenever marquee is off */}
        {hasData && !discoveryActive && (
          <button
            className={styles.btnIcon}
            title={!marqueeMode ? 'Pan · Zoom · Select (default) — drag to pan, scroll to zoom, click to select' : 'Click to return to default pan/zoom/select mode'}
            onClick={() => { if (marqueeMode) toggleMarqueeMode(); }}
            style={!marqueeMode ? { color: '#3b82f6', borderColor: '#3b82f6', background: 'rgba(59,130,246,0.12)' } : {}}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 11V6a2 2 0 0 0-4 0v5"/>
              <path d="M14 10V4a2 2 0 0 0-4 0v6"/>
              <path d="M10 10.5V6a2 2 0 0 0-4 0v8"/>
              <path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
            </svg>
          </button>
        )}

        {/* Marquee selection — mutually exclusive with default tool */}
        {hasData && !discoveryActive && (
          <button
            className={styles.btnIcon}
            title={marqueeMode ? 'Marquee select: ON — drag to rubber-band select nodes (click to exit)' : 'Marquee select — drag to select a region of nodes'}
            onClick={() => toggleMarqueeMode()}
            style={marqueeMode ? { color: '#3b82f6', borderColor: '#3b82f6', background: 'rgba(59,130,246,0.12)' } : {}}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2">
              <rect x="1" y="1" width="12" height="12" rx="1"/>
            </svg>
          </button>
        )}

        {/* User guide */}
        <button
          className={styles.btnIcon}
          title="How to use FlowGraph (Shift+?)"
          onClick={() => setGuidePulse((n) => n + 1)}
        >📖</button>

        {/* DAG / Lanes toggle */}
        {hasData && !discoveryActive && (
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === 'dag' ? styles.viewBtnActive : ''}`}
              title="DAG layout — hierarchical tree"
              onClick={() => setViewMode('dag')}
            >DAG</button>
            <button
              className={`${styles.viewBtn} ${viewMode === 'lanes' ? styles.viewBtnActive : ''}`}
              title="Lanes layout — swimlane by owner"
              onClick={() => setViewMode('lanes')}
            >LANES</button>
          </div>
        )}

        {/* Saved Layouts dropdown */}
        {hasMap && !discoveryActive && <div className={styles.layoutsWrap} ref={layoutsRef}>
          <button
            className={`${styles.btnLayouts} ${layoutsOpen ? styles.btnLayoutsOpen : ''}`}
            onClick={() => setLayoutsOpen(!layoutsOpen)}
            title="Save and restore named layouts"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span className={styles.btnLabel}>Layouts</span>
          </button>
          {layoutsOpen && (
            <div className={styles.layoutsDropdown}>
              <div className={styles.layoutsSaveRow}>
                <input
                  className={styles.layoutsInput}
                  placeholder="Name this layout…"
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveLayout()}
                  maxLength={40}
                  autoFocus
                />
                <button className={styles.layoutsSaveBtn} onClick={handleSaveLayout}>SAVE</button>
              </div>
              <div className={styles.layoutsList}>
                {savedLayouts.length === 0
                  ? <div className={styles.layoutsEmpty}>No saved layouts yet</div>
                  : savedLayouts.map((layout, index) => (
                    <div key={index} className={styles.layoutItem} onClick={() => {
                      loadNamedLayout(layout.snapshot, layout.viewMode);
                      setLayoutsOpen(false);
                    }}>
                      <span className={styles.layoutItemIcon}>
                        {layout.viewMode === 'lanes' ? '▤' : '◫'}
                      </span>
                      <div className={styles.layoutItemInfo}>
                        <div className={styles.layoutItemName}>{layout.name}</div>
                        <div className={styles.layoutItemMeta}>
                          {layout.viewMode.toUpperCase()} · {new Date(layout.savedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        className={styles.layoutItemDelete}
                        onClick={(e) => { e.stopPropagation(); handleDeleteLayout(index); }}
                        title="Delete this layout"
                      >✕</button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>}

        {/* Mode dropdown — Explore / Design / Discover / Paths */}
        {hasMap && <div className={styles.modeMenuWrap} ref={modeMenuRef}>
          <button
            ref={modeBtnRef}
            className={`${styles.btnModeMenu} ${modeMenuOpen ? styles.btnModeMenuOpen : ''} ${currentModeClass}`}
            title="Switch interaction mode"
            onClick={() => {
              if (!modeMenuOpen && modeBtnRef.current) {
                const r = modeBtnRef.current.getBoundingClientRect();
                setModeMenuPos({ top: r.bottom + 5, right: window.innerWidth - r.right });
              }
              setModeMenuOpen((v) => !v);
            }}
          >
            {discoveryActive ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
              </svg>
            ) : criticalPathActive ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="3" cy="19" r="2" fill="currentColor" stroke="none"/>
                <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
                <circle cx="21" cy="5" r="2" fill="currentColor" stroke="none"/>
                <path d="M3 19 C 18 19 18 12 12 12 C 6 12 6 5 21 5"/>
              </svg>
            ) : designMode ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
            <span className={styles.btnLabel}>{currentModeName}</span>
            <svg className={styles.chevron} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {modeMenuOpen && ReactDOM.createPortal(
            <div
              ref={modeDropdownRef}
              className={styles.modeMenuDropdown}
              style={{ position: 'fixed', top: modeMenuPos.top, right: modeMenuPos.right, left: 'auto' }}
            >
              <div className={styles.modeMenuSection}>MODE</div>
              <button
                className={`${styles.modeMenuItem} ${!designMode && !discoveryActive && !criticalPathActive ? styles.modeMenuItemActive : ''}`}
                onClick={() => {
                  if (designMode) setDesignMode(false);
                  if (discoveryActive) exitDiscovery();
                  if (criticalPathActive) toggleCriticalPath();
                  setModeMenuOpen(false);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Explore
                {!designMode && !discoveryActive && !criticalPathActive && <span className={styles.modeMenuCheck}>✓</span>}
              </button>
              <button
                className={`${styles.modeMenuItem} ${designMode ? styles.modeMenuItemDesign : ''}`}
                onClick={() => {
                  if (discoveryActive) exitDiscovery();
                  if (criticalPathActive) toggleCriticalPath();
                  setDesignMode(!designMode);
                  setModeMenuOpen(false);
                }}
                disabled={!hasData}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Design
                {designMode && <span className={styles.modeMenuCheck}>✓</span>}
              </button>
              <button
                className={`${styles.modeMenuItem} ${discoveryActive ? styles.modeMenuItemDiscover : ''}`}
                onClick={() => { handleDiscover(); setModeMenuOpen(false); }}
                disabled={!hasData}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
                </svg>
                Discover
                {discoveryActive && <span className={styles.modeMenuCheck}>✓</span>}
              </button>
              <button
                className={`${styles.modeMenuItem} ${criticalPathActive ? styles.modeMenuItemPaths : ''}`}
                onClick={() => {
                  if (designMode) setDesignMode(false);
                  if (discoveryActive) exitDiscovery();
                  toggleCriticalPath();
                  setModeMenuOpen(false);
                }}
                disabled={!hasData || (!hasCriticalEdges && !criticalPathActive)}
                title="Explore critical path chains in the graph"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="3" cy="19" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="21" cy="5" r="2" fill="currentColor" stroke="none"/>
                  <path d="M3 19 C 18 19 18 12 12 12 C 6 12 6 5 21 5"/>
                </svg>
                Paths
                {criticalPathActive && <span className={styles.modeMenuCheck}>✓</span>}
              </button>
            </div>,
            document.body
          )}
        </div>}

      </div>
    </header>
  );
}
