/**
 * utils/exportPdf.ts — PDF / print export for FlowGraph.
 *
 * Key design decisions:
 *  - Grid uses explicit <line> elements (never SVG patterns). Patterns require
 *    <defs> as a direct child of <svg>; when nested inside a <g> they are
 *    silently ignored by browsers and PDF renderers → white page.
 *  - DOM isolation is JS-driven (not @media print CSS) for reliable results.
 *  - viewBox is set precisely for each mode so content fills the page.
 *
 * Two modes:
 *   'current' — viewBox = "0 0 svgW svgH". The SVG coordinate system maps
 *               pixel-for-pixel to the screen; graphRoot transform is untouched.
 *   'full'    — viewBox computed from all node positions. graphRoot transform
 *               reset to identity. Lane labels included by extending minX.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const NODE_W       = 180;
const NODE_H       = 72;
const PADDING      = 80;
const LANE_LABEL_W = 130;  // keep in sync with layout.ts

// ─────────────────────────────────────────────────────────────────────────────
// DOM isolation
// ─────────────────────────────────────────────────────────────────────────────

function isolateCanvas(canvasWrap: HTMLElement): () => void {
  const restored: Array<() => void> = [];

  // Hide every sibling at each ancestor level up to <body>
  let node: Element | null = canvasWrap;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    Array.from(parent.children).forEach((sib) => {
      if (sib === node || !(sib instanceof HTMLElement)) return;
      const prev = sib.style.visibility;
      sib.style.visibility = 'hidden';
      restored.push(() => { sib.style.visibility = prev; });
    });
    node = parent;
  }

  // Override canvas-wrap inline styles
  const savedStyle = canvasWrap.getAttribute('style') ?? '';
  Object.assign(canvasWrap.style, {
    position:   'fixed',
    top:        '0',
    left:       '0',
    right:      '0',
    bottom:     '0',
    width:      '100vw',
    height:     '100vh',
    background: '#ffffff',
    zIndex:     '99999',
    overflow:   'hidden',
  });

  return () => {
    canvasWrap.setAttribute('style', savedStyle);
    restored.forEach((fn) => fn());
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BBox for full mode
// ─────────────────────────────────────────────────────────────────────────────

interface BBox { x: number; y: number; w: number; h: number; }

function computeFullBBox(
  positions: Record<string, { x: number; y: number }>,
  viewMode?: string
): BBox | null {
  const pts = Object.values(positions);
  if (!pts.length) return null;
  let minX = Math.min(...pts.map((p) => p.x)) - PADDING;
  let minY = Math.min(...pts.map((p) => p.y)) - PADDING;
  const maxX = Math.max(...pts.map((p) => p.x + NODE_W)) + PADDING;
  const maxY = Math.max(...pts.map((p) => p.y + NODE_H)) + PADDING;
  // Lanes view: labels are drawn at x=0..LANE_LABEL_W — include them
  if (viewMode === 'lanes') minX = Math.min(minX, -PADDING / 2);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid and background injection — explicit <line> elements, NO patterns
// ─────────────────────────────────────────────────────────────────────────────

function injectBackgroundAndGrid(
  svgEl: SVGSVGElement,
  before: Element | null,
  vbX: number, vbY: number, vbW: number, vbH: number
): SVGGElement {
  const wrap = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  wrap.id = 'pdf-bg-grid';

  // ── White background ──────────────────────────────────────────────────────
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x',      String(vbX));
  bg.setAttribute('y',      String(vbY));
  bg.setAttribute('width',  String(vbW));
  bg.setAttribute('height', String(vbH));
  bg.setAttribute('fill',   '#ffffff');
  wrap.appendChild(bg);

  // ── Grid spacing — ~35 minor cells across, bounded 20–100 units ──────────
  const minor = Math.max(20, Math.min(100, Math.round(vbW / 35)));
  const major = minor * 5;

  // Snap start to a round grid multiple
  const startX = Math.floor(vbX / minor) * minor;
  const startY = Math.floor(vbY / minor) * minor;

  function line(
    x1: number, y1: number, x2: number, y2: number,
    stroke: string, strokeWidth: number
  ): SVGLineElement {
    const el = document.createElementNS(SVG_NS, 'line') as SVGLineElement;
    el.setAttribute('x1', String(x1));
    el.setAttribute('y1', String(y1));
    el.setAttribute('x2', String(x2));
    el.setAttribute('y2', String(y2));
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', String(strokeWidth));
    return el;
  }

  // ── Vertical lines ────────────────────────────────────────────────────────
  for (let x = startX; x <= vbX + vbW; x += minor) {
    const isMajor = Math.round(x) % major < 1;
    wrap.appendChild(line(x, vbY, x, vbY + vbH,
      isMajor ? '#b8cdd8' : '#d8e6ed',
      isMajor ? 0.6 : 0.3
    ));
  }

  // ── Horizontal lines ──────────────────────────────────────────────────────
  for (let y = startY; y <= vbY + vbH; y += minor) {
    const isMajor = Math.round(y) % major < 1;
    wrap.appendChild(line(vbX, y, vbX + vbW, y,
      isMajor ? '#b8cdd8' : '#d8e6ed',
      isMajor ? 0.6 : 0.3
    ));
  }

  svgEl.insertBefore(wrap, before ?? svgEl.firstChild);
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-color arrowhead markers + edge colorization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inject one dedicated arrowhead marker per unique owner color into a <defs>
 * element that is a DIRECT child of <svg>.
 *
 * Why not use #arrow-dyn (fill="currentColor")?
 * currentColor is a CSS inheritance concept. SVG markers are rendered in their
 * own viewport and do not inherit CSS color from the referencing element during
 * print / PDF export — it resolves to the initial value (black on screen but
 * often grey/transparent in PDF renderers).
 *
 * By hard-coding the fill hex directly into each marker's <polygon>, the color
 * is baked into the SVG and always renders correctly.
 *
 * Marker IDs: "arrow-pdf-" + hex digits (# stripped), e.g. "arrow-pdf-4f9eff".
 */
function injectColorMarkers(
  svgEl: SVGSVGElement,
  colors: Set<string>
): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
  defs.id = 'pdf-color-markers';

  colors.forEach((color) => {
    const mk = document.createElementNS(SVG_NS, 'marker') as SVGMarkerElement;
    mk.setAttribute('id',           `arrow-pdf-${color.replace('#', '')}`);
    mk.setAttribute('markerWidth',  '8');
    mk.setAttribute('markerHeight', '6');
    mk.setAttribute('refX',         '7');
    mk.setAttribute('refY',         '3');
    mk.setAttribute('orient',       'auto');
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', '0 0, 8 3, 0 6');
    poly.setAttribute('fill', color);   // hard-coded hex — no CSS inheritance
    mk.appendChild(poly);
    defs.appendChild(mk);
  });

  // Must be a direct child of <svg>, never inside a <g>
  svgEl.insertBefore(defs, svgEl.firstChild);
  return defs;
}

type EdgeSnap = {
  el: SVGPathElement;
  stroke: string | null; strokeWidth: string | null;
  opacity: string | null; markerEnd: string | null;
  styleColor: string; styleTransition: string;
};

function colorizeEdges(
  svgEl: SVGSVGElement,
  ownerColors: Record<string, string>,
  nodeOwnerMap: Record<string, string>
): { snaps: EdgeSnap[]; usedColors: Set<string> } {
  const snaps: EdgeSnap[] = [];
  const usedColors = new Set<string>();

  svgEl.querySelectorAll<SVGPathElement>('.edge-vis').forEach((path) => {
    const fromId = path.parentElement?.getAttribute('data-edge-from') ?? '';
    const owner  = nodeOwnerMap[fromId] ?? '';
    const color  = ownerColors[owner]   ?? '#4f9eff';
    usedColors.add(color);

    snaps.push({
      el: path,
      stroke:          path.getAttribute('stroke'),
      strokeWidth:     path.getAttribute('stroke-width'),
      opacity:         path.getAttribute('opacity'),
      markerEnd:       path.getAttribute('marker-end'),
      styleColor:      path.style.color,
      styleTransition: path.style.transition,
    });

    path.setAttribute('stroke',       color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('opacity',      '1');
    path.style.transition = 'none';
    // marker-end set after markers are injected (see caller)
  });

  return { snaps, usedColors };
}

function restoreEdges(snaps: EdgeSnap[]): void {
  snaps.forEach(({ el, stroke, strokeWidth, opacity, markerEnd, styleColor, styleTransition }) => {
    if (stroke      != null) el.setAttribute('stroke',       stroke);      else el.removeAttribute('stroke');
    if (strokeWidth != null) el.setAttribute('stroke-width', strokeWidth); else el.removeAttribute('stroke-width');
    if (opacity     != null) el.setAttribute('opacity',      opacity);     else el.removeAttribute('opacity');
    if (markerEnd   != null) el.setAttribute('marker-end',   markerEnd);   else el.removeAttribute('marker-end');
    el.style.color      = styleColor;
    el.style.transition = styleTransition;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function exportToPdf(
  mode: 'current' | 'full',
  positions?: Record<string, { x: number; y: number }>,
  ownerColors?: Record<string, string>,
  nodeOwnerMap?: Record<string, string>,
  _currentTransform?: { x: number; y: number; k: number },
  viewMode?: string,
  onExpandAllPhases?: () => void,
  onRestoreCollapsed?: () => void
): void {
  const svgEl      = document.querySelector('#canvas-wrap > svg') as SVGSVGElement | null;
  const graphRoot  = document.getElementById('graph-root') as SVGGElement | null;
  const canvasWrap = document.getElementById('canvas-wrap') as HTMLElement | null;

  if (!svgEl || !canvasWrap) {
    alert('Canvas not found. Make sure a chart is loaded before exporting.');
    return;
  }

  // Read dimensions BEFORE any DOM mutation
  const svgW = canvasWrap.clientWidth  || svgEl.clientWidth  || 1400;
  const svgH = canvasWrap.clientHeight || svgEl.clientHeight || 900;

  // Expand all collapsed phases so bands print in full
  onExpandAllPhases?.();

  // Isolate canvas — hides sidebar, header, inspector, modals
  const restoreIsolation = isolateCanvas(canvasWrap);

  // Persist original viewBox/transform for restore
  const savedViewBox   = svgEl.getAttribute('viewBox');
  const savedTransform = graphRoot?.getAttribute('transform') ?? null;

  // Compute the viewBox for this export
  let vbX: number, vbY: number, vbW: number, vbH: number;

  if (mode === 'full' && positions) {
    const bbox = computeFullBBox(positions, viewMode);
    if (!bbox) {
      restoreIsolation();
      alert('No nodes found.');
      return;
    }
    vbX = bbox.x; vbY = bbox.y; vbW = bbox.w; vbH = bbox.h;
    graphRoot?.setAttribute('transform', '');
  } else {
    // 'current': SVG pixel space = exactly what is on screen
    vbX = 0; vbY = 0; vbW = svgW; vbH = svgH;
  }

  svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

  // Inject white background + explicit grid lines before #graph-root
  const bgGrid = injectBackgroundAndGrid(svgEl, graphRoot, vbX, vbY, vbW, vbH);

  // Phase 1 — collect edge colors and save originals
  const { snaps: edgeSnaps, usedColors } = colorizeEdges(
    svgEl,
    ownerColors  ?? {},
    nodeOwnerMap ?? {}
  );

  // Phase 2 — inject one marker per unique color as direct <svg> children
  const markerDefs = injectColorMarkers(svgEl, usedColors);

  // Phase 3 — apply the correct marker-end to every edge path
  edgeSnaps.forEach(({ el }) => {
    const color = el.getAttribute('stroke') ?? '#4f9eff';
    el.setAttribute('marker-end', `url(#arrow-pdf-${color.replace('#', '')})`);
  });

  function restore() {
    restoreIsolation();
    bgGrid.remove();
    markerDefs.remove();
    restoreEdges(edgeSnaps);
    onRestoreCollapsed?.();

    if (savedViewBox !== null) svgEl!.setAttribute('viewBox', savedViewBox);
    else svgEl!.removeAttribute('viewBox');

    if (mode === 'full' && graphRoot) {
      if (savedTransform !== null) graphRoot.setAttribute('transform', savedTransform);
      else graphRoot.removeAttribute('transform');
    }

    window.removeEventListener('afterprint', restore);
  }

  window.addEventListener('afterprint', restore);
  window.print();
}
