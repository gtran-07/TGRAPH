/**
 * components/Modals/UserGuideModal.tsx — Full interactive user guide modal.
 *
 * Navigation: fixed left panel with section links, scrollable right content area.
 * Keyboard shortcut: Shift+? opens this modal.
 * Also listens for 'flowgraph:open-guide' custom events from Header.
 *
 * ── MAINTAINER NOTE ──────────────────────────────────────────────────────────
 * Keep this file in sync with app features. Update the relevant SECTIONS entry
 * whenever a user-facing feature is added, changed, or removed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import styles from './UserGuideModal.module.css';

// ─── AI PROMPT & EXAMPLE ─────────────────────────────────────────────────────

const AI_PROMPT = `You are converting a graphical process flow (PDF/Visio/description) into a JSON file for a dependency flowchart viewer.

OUTPUT REQUIREMENT:
- Output ONLY valid JSON. No markdown. No explanation. No code fences.

JSON FORMAT:
- Output must be a JSON array of node objects: [ { ... }, { ... } ].
- Each node object MUST contain:
  - "id": string (unique, case-sensitive — e.g. "REQ-01", "DES-01")
  - "name": string (≤60 chars — shown on the node card)
  - "owner": string (team or group name — determines swim lane and color)
  - "description": string (1–3 sentences — shown in the Inspector panel)
  - "dependencies": array of prerequisite node IDs — nodes that must complete BEFORE this one

DEPENDENCY DIRECTION (IMPORTANT):
- "dependencies" are PREREQUISITES (upstream steps), not outputs.
- If step B requires step A to be done first, then B.dependencies includes "A".
- Do NOT list downstream steps as dependencies.

RULES:
1) IDs must be unique and case-sensitive. Use a consistent scheme like "REQ-01", "DES-02", "TEST-03".
2) All dependency IDs must reference existing node IDs in the output — no dangling references.
3) If the diagram contains a loop/cycle, break it by inserting a review/approval/checkpoint node.
4) Use owner names as swim lane headers (or infer from the diagram if not explicitly labeled).
5) Keep "name" ≤60 chars and "description" 1–3 sentences.

FINAL VALIDATION BEFORE OUTPUT:
- Ensure no duplicate ids.
- Ensure all dependencies reference existing ids.
- Ensure dependencies represent prerequisites (not outputs).

Now output the JSON array only.`;

const EXAMPLE_JSON = `[
  {
    "id": "REQ-01",
    "name": "Gather Requirements",
    "owner": "Project",
    "description": "Collect requirements and constraints from stakeholders.",
    "dependencies": []
  },
  {
    "id": "DES-01",
    "name": "Create Functional Design",
    "owner": "Engineering",
    "description": "Draft the functional design and review with stakeholders.",
    "dependencies": ["REQ-01"]
  },
  {
    "id": "TEST-01",
    "name": "Execute Validation Test",
    "owner": "QA",
    "description": "Run validation tests and record results.",
    "dependencies": ["DES-01"]
  }
]`;

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

// ─── SECTION DATA ────────────────────────────────────────────────────────────

interface GuideSection {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

function Tip({ children }: { children: React.ReactNode }) {
  return <div className={styles.tip}><span className={styles.tipIcon}>💡</span><div>{children}</div></div>;
}
function Warning({ children }: { children: React.ReactNode }) {
  return <div className={styles.warning}><span className={styles.tipIcon}>⚠️</span><div>{children}</div></div>;
}
function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <div className={styles.shortcutRow}>
      <code className={styles.kbd}>{keys}</code>
      <span className={styles.shortcutAction}>{action}</span>
    </div>
  );
}
function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className={styles.step}>
      <div className={styles.stepNum}>{number}</div>
      <div>{children}</div>
    </div>
  );
}

const SECTIONS: GuideSection[] = [
  // ── USER GUIDE ────────────────────────────────────────────────────────────
  {
    id: 'getting-started',
    icon: '🚀',
    title: 'Getting Started',
    content: (
      <div>
        <p>FlowGraph is a visual tool for exploring <strong>dependency maps</strong> — diagrams that show which tasks, steps, or systems must be completed before others can begin.</p>
        <p style={{marginTop:12}}>Every box on the canvas is a <strong>node</strong> (a step or task). Every arrow is a <strong>connection</strong> showing that one step depends on another. An arrow from A → B means "B cannot start until A is done."</p>

        <h4 className={styles.subheading}>When you first open FlowGraph</h4>
        <p>You'll see a landing screen with two options:</p>
        <ul className={styles.ul}>
          <li><strong>Open JSON File</strong> — load an existing flowchart from a <code>.json</code> file</li>
          <li><strong>New Flowchart</strong> — start from a blank canvas in Design Mode and build from scratch</li>
        </ul>

        <h4 className={styles.subheading}>Loading an existing file</h4>
        <Step number={1}>Click <strong>Open JSON File</strong> on the landing screen, or the <strong>Open JSON File</strong> button in the header at any time.</Step>
        <Step number={2}>Select a <code>.json</code> file from your computer.</Step>
        <Step number={3}>The graph appears on the canvas. The owner sidebar opens automatically on the left.</Step>

        <h4 className={styles.subheading}>Starting fresh</h4>
        <p>Click <strong>New Flowchart</strong> on the landing screen or the <strong>+ New</strong> button in the header. The canvas clears and Design Mode activates so you can start adding nodes immediately. No file is required.</p>

        <Tip>Don't have a JSON file yet? Use the AI Tools section in this guide to generate one automatically from a process description.</Tip>
      </div>
    ),
  },
  {
    id: 'opening-saving',
    icon: '📂',
    title: 'Opening & Saving Files',
    content: (
      <div>
        <p>FlowGraph has two distinct file modes depending on your browser. The filename chip in the header shows which mode is active.</p>

        <h4 className={styles.subheading}>Linked mode — Chrome & Edge (recommended)</h4>
        <p>When you open a file in Chrome or Edge, FlowGraph uses the <strong>File System Access API</strong> to maintain a live connection to the file on your disk:</p>
        <ul className={styles.ul}>
          <li>The filename chip turns <strong>teal</strong> with a chain-link icon</li>
          <li>The Save button shows a <strong>floppy-disk icon</strong> labelled "Save"</li>
          <li>Clicking Save <strong>writes directly back to your original file</strong> — no download dialog, no duplicate files</li>
        </ul>
        <Tip>This is the best way to work. Open the file once, edit freely, click Save, and the same file on your disk is updated in place.</Tip>

        <h4 className={styles.subheading}>Unlinked mode — Firefox, Safari, and other browsers</h4>
        <p>Browsers that don't support the File System Access API use a standard file picker instead:</p>
        <ul className={styles.ul}>
          <li>The filename chip shows in <strong>gray</strong> with a broken-chain icon</li>
          <li>The Save button shows a <strong>download icon</strong> labelled "Save JSON"</li>
          <li>Clicking Save <strong>downloads a new copy</strong> to your Downloads folder</li>
          <li>Your original file is untouched — you must manually replace it if needed</li>
        </ul>

        <h4 className={styles.subheading}>Switching between modes</h4>
        <p>If you loaded a file in unlinked mode and want linked mode, close the file and re-open it using the <strong>Open JSON File</strong> button in Chrome or Edge. The app will re-link to the file.</p>

        <h4 className={styles.subheading}>Save As</h4>
        <p>Click the <strong>∨ chevron</strong> next to the Save button to open the save menu. Choose <strong>Save As…</strong> to write the graph to a different file location or with a new filename. In Chrome/Edge this shows the system Save dialog; in other browsers it prompts for a filename and downloads a copy.</p>

        <h4 className={styles.subheading}>Export to PDF</h4>
        <p>The save menu also offers two PDF export options, both using your browser's built-in print dialog — no third-party tools needed:</p>
        <ul className={styles.ul}>
          <li><strong>Export PDF — Current View</strong> — captures exactly what is visible on screen at the current pan and zoom level.</li>
          <li><strong>Export PDF — Full Chart</strong> — automatically expands the canvas to include every node, regardless of current zoom or pan position.</li>
        </ul>
        <p>PDFs are rendered from SVG so they are <strong>infinitely sharp</strong> — you can zoom into any detail in your PDF viewer without pixelation. The PDF uses a clean white background with a light engineering-paper "+" grid, and all connectors are drawn in black for crisp print output.</p>
        <Tip>In the system print dialog, choose "Save as PDF" as the destination to get a PDF file. Select <strong>landscape orientation</strong> for best results on wide charts.</Tip>

        <h4 className={styles.subheading}>Reload from File</h4>
        <p>The <strong>↺</strong> button in the header re-reads the linked file from disk and restores the last saved state, discarding any unsaved changes. Only available in linked mode (Chrome/Edge). Useful when you want to undo a batch of edits back to the last known-good save.</p>

        <h4 className={styles.subheading}>New Flowchart (no file)</h4>
        <p>When you create a new flowchart via <strong>+ New</strong>, there is no linked file. The Save button downloads a file called <code>flowgraph.json</code>. After saving, you can re-open that file to get linked mode for future saves.</p>

        <Warning>Changes are never saved automatically regardless of mode. Always click Save before closing the browser tab.</Warning>
      </div>
    ),
  },
  {
    id: 'navigating',
    icon: '🧭',
    title: 'Navigating the Canvas',
    content: (
      <div>
        <p>The canvas is an infinite scrollable space. You can pan in any direction and zoom freely.</p>

        <h4 className={styles.subheading}>Pan (move around)</h4>
        <p>Click and drag on any <strong>empty area</strong> of the canvas (not on a node or edge). The cursor changes to a grabbing hand while panning.</p>

        <h4 className={styles.subheading}>Zoom</h4>
        <p>Scroll your mouse wheel to zoom in and out. The zoom is <strong>centered on your cursor position</strong> — whatever is under your cursor stays fixed as you zoom. You can also use the <strong>+</strong> and <strong>−</strong> buttons at the bottom-center of the canvas.</p>

        <h4 className={styles.subheading}>Fit to Screen</h4>
        <p>Click the <strong>⊞</strong> button in the header to automatically zoom and center the entire graph so all nodes are visible.</p>

        <h4 className={styles.subheading}>Reset Layout</h4>
        <p>Click the <strong>tree-diagram icon</strong> in the header to recalculate the automatic layout from scratch. Useful if you've dragged nodes around and want to start fresh. Note: this clears your manual arrangement.</p>

        <h4 className={styles.subheading}>Reload from File</h4>
        <p>Click the <strong>↺</strong> button to reload the graph from the last saved version of the file, discarding any unsaved changes. Only available when a file is linked (Chrome/Edge).</p>

        <h4 className={styles.subheading}>Auto-Space</h4>
        <p>Click the <strong>four-squares icon</strong> in the header to detect and spread apart any overlapping nodes or groups. Useful after collapsing groups or rearranging many nodes at once.</p>

        <h4 className={styles.subheading}>Minimap</h4>
        <p>The small overview map in the <strong>bottom-right corner</strong> shows the entire graph at reduced scale. The blue rectangle represents your current viewport. Click anywhere on the minimap to jump to that area.</p>

        <Tip>If you've zoomed in very close and lost your place, click ⊞ (Fit to Screen) to get back to the full view.</Tip>
      </div>
    ),
  },
  {
    id: 'understanding',
    icon: '📊',
    title: 'Understanding the Graph',
    content: (
      <div>
        <p>Each element in the graph has a specific meaning:</p>

        <h4 className={styles.subheading}>Nodes (boxes)</h4>
        <p>Each box represents a step, task, or process. Inside each box you'll see:</p>
        <ul className={styles.ul}>
          <li><strong>#ID</strong> (small text, top) — the unique identifier for this node</li>
          <li><strong>Name</strong> (bold text, center) — the display label for this step</li>
          <li><strong>Owner</strong> (colored text, bottom) — which team or person owns this step</li>
          <li><strong>Colored left bar</strong> — the color represents the owner. Same color = same owner.</li>
        </ul>

        <h4 className={styles.subheading}>Edges (arrows)</h4>
        <p>An arrow from node A to node B means <strong>"B depends on A"</strong> — A must be completed before B can start. Follow arrows left-to-right to understand the work sequence.</p>

        <h4 className={styles.subheading}>Node visual states</h4>
        <ul className={styles.ul}>
          <li><strong>Normal</strong> — plain dark box with subtle border</li>
          <li><strong>Hovered</strong> — blue border; connected nodes are highlighted, others fade out</li>
          <li><strong>Selected</strong> — persistent blue border; details shown in the Inspector panel</li>
          <li><strong>Jumped-to</strong> — pulsing amber border glow after clicking a search result</li>
          <li><strong>Neighbor</strong> — teal border on nodes directly connected to the hovered node</li>
          <li><strong>Dimmed</strong> — 30% opacity on nodes not connected to the hovered node</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'searching',
    icon: '🔍',
    title: 'Searching for Nodes',
    content: (
      <div>
        <p>The search bar at the top of the screen lets you quickly find any node by name, ID, owner, or description.</p>

        <Step number={1}>Click the search bar or press <code>⌘K</code> (Mac) / <code>Ctrl+K</code> (Windows) to focus it.</Step>
        <Step number={2}>Start typing any part of the node's name, ID, owner, or description.</Step>
        <Step number={3}>A dropdown appears with up to 8 matching results. Each shows the name, ID, and owner.</Step>
        <Step number={4}>Click any result to jump to that node. The canvas pans and zooms to center it at 75% zoom, and the node's border pulses amber.</Step>

        <p>Press <code>Escape</code> to close the results without navigating.</p>

        <Tip>Search is case-insensitive and matches partial text anywhere in the name, ID, owner, or description.</Tip>
        <Tip>If the node's owner was filtered out, it becomes visible automatically when you jump to it.</Tip>
      </div>
    ),
  },
  {
    id: 'filtering',
    icon: '🏷️',
    title: 'Left Panel (Owners / Inspector / Tags)',
    content: (
      <div>
        <p>The left panel has three tabs: <strong>Owners</strong>, <strong>Inspector</strong>, and <strong>Tags</strong>. It opens automatically when a file is loaded.</p>

        <h4 className={styles.subheading}>Opening and closing</h4>
        <ul className={styles.ul}>
          <li>If the panel is collapsed, click the <strong>☰</strong> button on the left edge of the canvas to expand it.</li>
          <li>Click the <strong>«</strong> button inside the panel to collapse it back.</li>
          <li>Drag the <strong>right edge</strong> of the panel to resize it (220–560 px).</li>
        </ul>

        <h4 className={styles.subheading}>Owners tab — filter by team</h4>
        <ul className={styles.ul}>
          <li>Each row shows a colored dot, the owner name, and a node count.</li>
          <li>Click any row to toggle those nodes on or off. Edges are filtered too — if either endpoint is hidden, the edge hides.</li>
          <li>The <strong>ALL</strong> button at the top toggles all owners at once.</li>
          <li>In Design Mode a <strong>+ owner name</strong> input appears at the bottom to pre-register new owner names before adding nodes.</li>
        </ul>

        <h4 className={styles.subheading}>Inspector tab — selected item details</h4>
        <p>When you select a node, group, or phase, the panel automatically switches to the Inspector tab and shows full details. See the <em>Inspecting a Node</em> section for what's shown.</p>
        <p>If the panel is collapsed when you make a selection, a <strong>floating hint</strong> appears on the left edge — click it to open the panel directly to the Inspector tab.</p>

        <h4 className={styles.subheading}>Tags tab — manage labels</h4>
        <p>Create and manage colored label tags that can be attached to nodes. See the <em>Tags</em> section for details.</p>

        <Warning>Filtering hides nodes from view but does not delete them. All filtered nodes remain in the data and reappear when you re-enable their owner.</Warning>
        <Tip>In LANES view, hiding an owner removes their entire swim lane, giving more space to the visible ones.</Tip>
      </div>
    ),
  },
  {
    id: 'views',
    icon: '👁️',
    title: 'View Modes (DAG vs Lanes)',
    content: (
      <div>
        <p>FlowGraph has two ways to arrange nodes, switchable via the <strong>DAG / LANES</strong> toggle in the header.</p>

        <h4 className={styles.subheading}>DAG View (default)</h4>
        <p>Nodes are arranged <strong>left-to-right by dependency depth</strong>. Nodes with no dependencies (starting points) appear on the left. Each subsequent column contains nodes that depend on the previous column. Best for: understanding the full sequence, seeing the critical path.</p>

        <h4 className={styles.subheading}>LANES View</h4>
        <p>Nodes are grouped into <strong>horizontal swim lanes by owner</strong>. Each team's nodes appear in their own labeled band. Left-to-right position still reflects dependency depth, so you can see both who does what AND when. Best for: team responsibilities, cross-team handoffs, parallel workstreams.</p>

        <Tip>Your arrangement in each view is saved separately. Switching from DAG to LANES and back restores exactly where you left off in each view.</Tip>
        <Tip>Both DAG and LANES layouts are saved when you click Save — reloading the file restores the current view and keeps the other view's arrangement too.</Tip>
      </div>
    ),
  },
  {
    id: 'focus-mode',
    icon: '🎯',
    title: 'Focus Mode',
    content: (
      <div>
        <p>Focus Mode isolates a single node and its connections — hiding everything else temporarily. Useful for understanding one step without the noise of the full graph.</p>

        <h4 className={styles.subheading}>Entering Focus Mode</h4>
        <p><strong>Double-click any node</strong> while Design Mode is <em>off</em>. The canvas animates to show only the focused node and its connections. A banner appears at the top of the canvas.</p>

        <h4 className={styles.subheading}>Focus Depth</h4>
        <p>Use the <strong>Neighbors / Full Path</strong> toggle in the banner to control how much of the graph is shown:</p>
        <ul className={styles.ul}>
          <li><strong>Neighbors</strong> — direct parents and children only (1 hop). Good for understanding a single step.</li>
          <li><strong>Full Path</strong> — all ancestors back to the source and all descendants to the end. Good for tracing the complete chain.</li>
        </ul>
        <p>Switching between modes re-runs layout with an animation so you can see the graph expand or contract.</p>

        <h4 className={styles.subheading}>Exiting Focus Mode</h4>
        <ul className={styles.ul}>
          <li>Press <code>Escape</code></li>
          <li>Click the <strong>✕</strong> on the banner</li>
          <li>Double-click the canvas background</li>
        </ul>
        <p>The graph restores exactly the positions and zoom level you had before entering Focus Mode.</p>

        <Warning>Double-clicking a node while Design Mode is active opens the Edit Node dialog instead of entering Focus Mode.</Warning>
      </div>
    ),
  },
  {
    id: 'cinema',
    icon: '🎬',
    title: 'Process Cinema',
    content: (
      <div>
        <p><strong>Process Cinema</strong> turns a graph into a guided narrative — a structured story that walks you through the graph's key structural moments in order, explains what each one means, and tracks where your attention went. It is available on any graph complex enough to benefit from it.</p>

        <h4 className={styles.subheading}>Starting Cinema</h4>
        <p>Open the left panel and click the <strong>Cinema</strong> tab. If the graph is complex enough (has forks, bottlenecks, or well-populated phases), a <strong>Discover</strong> button appears. Click it to generate the tour and see a preview showing estimated time and scene count. Click <strong>Begin →</strong> to start.</p>
        <Tip>A banner may appear on the canvas the first time you open a complex graph — click it to be reminded Cinema is available, then go to the Cinema tab to start.</Tip>

        <h4 className={styles.subheading}>Phase 1 — Cinema (narration)</h4>
        <p>Each scene focuses on one structural moment in the graph. The canvas dims all unrelated nodes while the current node glows blue. The sidebar shows:</p>
        <ul className={styles.ul}>
          <li><strong>Act badge</strong> — which third of the process you are in (Act 1 / 2 / 3)</li>
          <li><strong>Type pill</strong> — the structural role of this scene: Origin, Fork, Bottleneck, Convergence, Phase Transition, Step, Parallel Group, or Output</li>
          <li><strong>Headline + body</strong> — what this node is and why it matters structurally</li>
          <li><strong>Insight</strong> — a short observation about critical path membership or fan-out risk</li>
        </ul>
        <p>Use <strong>Next →</strong> and <strong>← Back</strong> to move through scenes. The breadcrumb bar at the top shows your progress and lets you click back to any completed scene.</p>

        <h4 className={styles.subheading}>Prediction gates</h4>
        <p>After certain structural scenes (forks, bottlenecks), the cinema inserts a <strong>prediction question</strong> before revealing the next scene. Choose an answer — you must respond before Next becomes available. Right or wrong, the explanation appears immediately so you learn from each one.</p>

        <h4 className={styles.subheading}>Smart pan</h4>
        <p>Cinema automatically pans the canvas to keep the current scene's node visible. The <strong>"Skip pan if node is visible"</strong> toggle suppresses this when the node is already on screen — useful on small graphs where panning is unnecessary.</p>

        <h4 className={styles.subheading}>Finishing the cinema</h4>
        <p>Click <strong>Finish</strong> on the last scene. A transition screen appears with two choices:</p>
        <ul className={styles.ul}>
          <li><strong>Test memory</strong> — move to Phase 2 (Reconstruction)</li>
          <li><strong>Skip to summary</strong> — jump directly to Phase 3 (Heatmap)</li>
        </ul>

        <h4 className={styles.subheading}>Phase 2 — Reconstruction (memory quiz)</h4>
        <p>Every node you saw during cinema is blanked out on the canvas — its label disappears and its border becomes a dashed outline. A pool of shuffled name chips appears in the sidebar.</p>
        <Step number={1}>Click a chip to select it (it turns blue).</Step>
        <Step number={2}>Click the blank node on the canvas where you think that label belongs.</Step>
        <Step number={3}>A green pop means correct — that node is permanently revealed. A red shake means wrong — the chip stays in the pool for another try.</Step>
        <p>When all nodes are placed, the canvas holds for a moment then automatically moves to the Heatmap. Click <strong>Skip →</strong> at any point to jump ahead without finishing all placements.</p>
        <Tip>Node positions are preserved during reconstruction to serve as spatial memory anchors — dragging is blocked while this phase is active.</Tip>

        <h4 className={styles.subheading}>Phase 3 — Heatmap (your attention map)</h4>
        <p>The heatmap colors every node you saw during cinema by how much cognitive engagement it received — time dwelled, clicks, and revisits all count. This is a mirror, not a score.</p>
        <ul className={styles.ul}>
          <li><strong>Hot</strong> (orange-red glow) — you spent significantly more time here than average</li>
          <li><strong>Warm</strong> (amber) — solid attention, at or above average</li>
          <li><strong>Cold</strong> (blue) — you saw it but did not linger</li>
          <li><strong>Ice</strong> (pale blue, dim) — barely registered</li>
        </ul>
        <p>Cold and ice nodes that you also misplaced during Reconstruction get a subtle <strong>dashed amber ring</strong> — a "double miss" marker showing nodes that were both low-attention and hard to recall.</p>
        <p>Nodes that never appeared in the cinema remain in their normal visual state.</p>

        <h4 className={styles.subheading}>The heatmap panel</h4>
        <p>The Cinema tab shows:</p>
        <ul className={styles.ul}>
          <li><strong>Legend</strong> — plain-English description of each tier</li>
          <li><strong>Nodes you barely touched</strong> — each cold/ice node listed by name with its structural role (e.g. "bottleneck", "fork")</li>
          <li><strong>Explain my cold nodes</strong> — builds a natural-language prompt naming your hot and cold nodes and copies it to the clipboard. Paste it into Claude or any AI assistant to get an explanation of what you missed and why those nodes matter.</li>
          <li><strong>Explore freely</strong> — exits Cinema entirely and returns the canvas to normal</li>
        </ul>

        <h4 className={styles.subheading}>Stats strip</h4>
        <p>At the bottom of the heatmap panel: <em>Scenes absorbed</em>, <em>Bottlenecks found</em>, <em>Rebuilt correctly</em> (shows a fraction or "skipped"), and <em>Cold nodes</em>.</p>

        <h4 className={styles.subheading}>Exiting Cinema</h4>
        <p>Click <strong>✕ Exit Tour</strong> in the header at any time to leave Cinema. During the cinema and reconstruction phases this preserves your engagement data. From the heatmap, <strong>Explore freely</strong> cleans up all Cinema coloring and returns every node to its normal visual state.</p>

        <h4 className={styles.subheading}>Engagement persistence</h4>
        <p>Your raw engagement scores are saved inside the JSON file when you click Save. If you run Cinema again on the same file in a future session, the scores accumulate — repeat visits to the same nodes increase their weight over time.</p>

        <Warning>Cinema requires a graph with at least some structural complexity — linear chains with no forks or convergences produce very short tours. The BHS sample graph is a good test case for the full experience.</Warning>
        <Tip>The "Explain my cold nodes" clipboard prompt works best in Claude — paste it and describe the graph's domain for a richer explanation of the gaps in your mental model.</Tip>
      </div>
    ),
  },
  {
    id: 'inspector',
    icon: '🔎',
    title: 'Inspecting Nodes, Groups & Phases',
    content: (
      <div>
        <p>The <strong>Inspector tab</strong> in the left panel shows full details for any selected node, group, or phase. The panel auto-switches to this tab whenever you make a selection.</p>

        <h4 className={styles.subheading}>Selecting items</h4>
        <ul className={styles.ul}>
          <li><strong>Single-click a node</strong> to select it and open its details.</li>
          <li><strong>Single-click a group</strong> to see its members and collapse state.</li>
          <li><strong>Single-click a phase band</strong> to see its assigned nodes.</li>
        </ul>

        <h4 className={styles.subheading}>What the Inspector shows for a node</h4>
        <ul className={styles.ul}>
          <li><strong>Name</strong> — the display label</li>
          <li><strong>Description</strong> — the detail text</li>
          <li><strong>Owner</strong> — colored tag showing which team owns this node</li>
          <li><strong>Dependencies</strong> — names of all prerequisite nodes</li>
          <li><strong>Tags</strong> — any colored labels attached to the node (if any)</li>
          <li><strong>Phase</strong> — which phase the node belongs to, or "Unassigned"</li>
          <li><strong>Groups</strong> — any groups this node is a member of</li>
        </ul>

        <h4 className={styles.subheading}>What the Inspector shows for a group</h4>
        <ul className={styles.ul}>
          <li>Name, description, owner(s), child node and group counts, collapse status, and phase assignment</li>
        </ul>

        <h4 className={styles.subheading}>What the Inspector shows for a phase</h4>
        <ul className={styles.ul}>
          <li>Name, description, sequence number, and list of all assigned nodes</li>
        </ul>

        <h4 className={styles.subheading}>Design Mode buttons</h4>
        <p>When Design Mode is active, <strong>Edit Node / Edit Group / Edit Phase</strong> and <strong>Delete Phase</strong> buttons appear at the bottom of the Inspector for direct editing access.</p>

        <Tip>If the left panel is collapsed when you click a node, a floating hint appears on the left edge — click it to jump straight to the Inspector tab.</Tip>
      </div>
    ),
  },
  {
    id: 'layouts',
    icon: '💾',
    title: 'Saved Layouts',
    content: (
      <div>
        <p>After arranging nodes where you want them (by dragging), you can save the layout with a name and restore it later — independently of the JSON file.</p>

        <Step number={1}>Click the <strong>Layouts</strong> button in the header.</Step>
        <Step number={2}>Type a name for your layout in the input field.</Step>
        <Step number={3}>Press <code>Enter</code> or click <strong>SAVE</strong>.</Step>
        <Step number={4}>Your layout appears in the list. Click it to restore that arrangement.</Step>
        <Step number={5}>Click the <strong>✕</strong> icon on a layout row to delete it.</Step>

        <p>Each saved layout stores the node positions, viewport zoom/pan, and which view (DAG or LANES) was active.</p>

        <Warning>Layouts are stored in your browser's localStorage. They survive page refreshes but won't appear in a different browser or on a different computer.</Warning>
        <Warning>Layouts reference node IDs. If you load a different JSON file with different IDs, existing layouts may not restore correctly.</Warning>
      </div>
    ),
  },
  {
    id: 'design-overview',
    icon: '✏️',
    title: 'Design Mode Overview',
    content: (
      <div>
        <p>Design Mode lets you modify the graph directly in the browser — adding nodes, drawing connections, editing details, and deleting elements — without manually editing the JSON file.</p>

        <h4 className={styles.subheading}>Activating Design Mode</h4>
        <p>Click the <strong>Design</strong> button in the header. Design Mode works whether or not a file is loaded — you can start from a blank canvas using <strong>+ New</strong> and build a flowchart from scratch.</p>
        <p>A purple toolbar banner appears at the top of the canvas when Design Mode is active.</p>

        <h4 className={styles.subheading}>The Design Toolbar</h4>
        <ul className={styles.ul}>
          <li><strong>Select</strong> — default; drag nodes, click to inspect. Shift+click to multi-select.</li>
          <li><strong>Add Node</strong> — click empty canvas to place a new node</li>
          <li><strong>Connect</strong> — draw a directed connection between two nodes</li>
          <li><strong>Edit Node</strong> — open the edit dialog for the selected node (appears when a node is selected)</li>
          <li><strong>Edit Group</strong> — open the edit dialog for the selected group (appears when a group is selected)</li>
          <li><strong>⬡ Group (N)</strong> — create a group from N multi-selected items (appears when 2+ items are selected)</li>
          <li><strong>◈ Phase</strong> — assign selected nodes/groups to a phase, or create a new phase (appears when any item is selected)</li>
        </ul>

        <h4 className={styles.subheading}>Undo / Redo</h4>
        <p>Use <code>Ctrl+Z</code> to undo the last change and <code>Ctrl+Y</code> (or <code>Ctrl+Shift+Z</code>) to redo. Undo history is maintained for the current session.</p>

        <h4 className={styles.subheading}>Saving changes</h4>
        <p>The <strong>Save</strong> button in the header saves your changes. See the <em>Opening & Saving Files</em> section for details on linked (in-place) vs download save modes.</p>

        <Warning>Changes are NOT saved automatically. Close or refresh the browser without saving and your changes are lost.</Warning>
        <Tip>Double-clicking a node in Design Mode opens the Edit dialog. In normal view mode, double-clicking enters Focus Mode instead.</Tip>
      </div>
    ),
  },
  {
    id: 'design-select',
    icon: '🖱️',
    title: 'Design: Select Tool',
    content: (
      <div>
        <p>The Select tool is the default when Design Mode is active. It behaves the same as normal view mode.</p>
        <ul className={styles.ul}>
          <li><strong>Drag a node</strong> to reposition it on the canvas</li>
          <li><strong>Single-click a node</strong> to select it and open the Inspector</li>
          <li><strong>Double-click a node</strong> to open the Edit Node dialog</li>
          <li><strong>Click empty canvas</strong> to deselect</li>
        </ul>
        <p>Switch back to Select after using Add Node or Connect to avoid accidentally triggering those tools when clicking.</p>
        <Tip>Dragged positions are preserved when you save. The JSON file stores layout positions so they reload exactly as you left them.</Tip>
      </div>
    ),
  },
  {
    id: 'design-add',
    icon: '➕',
    title: 'Design: Add Node',
    content: (
      <div>
        <p>The Add Node tool creates new nodes by clicking directly on the canvas where you want them placed.</p>

        <Step number={1}>Click <strong>Add Node</strong> in the design toolbar. The cursor changes to a crosshair (+).</Step>
        <Step number={2}>Click anywhere on the empty canvas where you want the new node.</Step>
        <Step number={3}>The <strong>Add Node form</strong> opens with these fields:
          <ul className={styles.ul}>
            <li><strong>Node ID</strong> — auto-generated (e.g. NODE-07). You can change it, but it must be unique.</li>
            <li><strong>Name</strong> — required. The label shown on the node card (≤60 characters).</li>
            <li><strong>Owner / Lane</strong> — which team or group this belongs to. Start typing to see existing owners.</li>
            <li><strong>Description</strong> — optional. 1–3 sentences shown in the Inspector panel.</li>
          </ul>
        </Step>
        <Step number={4}>Click <strong>Save</strong> to add the node, or <strong>Cancel</strong> to abort.</Step>

        <p>The node appears at the position you clicked. A new owner name gets a color assigned automatically and appears in the sidebar.</p>

        <Warning>Node IDs cannot be changed after creation — they are referenced by other nodes' dependency lists. Choose a meaningful ID like "STEP-01".</Warning>
        <Tip>After adding a node, switch to the Connect tool to draw edges from it to other nodes.</Tip>
      </div>
    ),
  },
  {
    id: 'design-connect',
    icon: '🔗',
    title: 'Design: Connect Tool',
    content: (
      <div>
        <p>The Connect tool draws a directed edge (arrow) from one node to another, establishing a dependency relationship.</p>

        <Step number={1}>Click <strong>Connect</strong> in the design toolbar. The cursor changes to a crosshair.</Step>
        <Step number={2}><strong>Click the prerequisite node</strong> (the one that must happen first). It glows purple and a dashed ghost line follows your cursor.</Step>
        <Step number={3}><strong>Click the dependent node</strong> (the one that cannot start until the source is done). The connection is drawn.</Step>

        <p>The arrow direction: <em>prerequisite → dependent</em>.</p>

        <h4 className={styles.subheading}>Canceling</h4>
        <p>Click empty canvas, press <code>Escape</code>, or switch tools to cancel a connection in progress.</p>

        <Warning>Duplicate connections are silently ignored.</Warning>
        <Warning>Self-connections (a node pointing to itself) are blocked.</Warning>
        <Tip>The direction matters: click the PREREQUISITE first, then the DEPENDENT.</Tip>
      </div>
    ),
  },
  {
    id: 'design-edit',
    icon: '📝',
    title: 'Design: Edit Node',
    content: (
      <div>
        <p>The Edit Node dialog lets you update a node's name, owner, and description, or delete the node entirely.</p>

        <h4 className={styles.subheading}>Opening the Edit dialog</h4>
        <ul className={styles.ul}>
          <li><strong>Double-click any node</strong> while Design Mode is active</li>
          <li>Select a node, then click <strong>Edit Node</strong> in the design toolbar</li>
          <li>Select a node, then click <strong>Edit Node</strong> in the Inspector panel</li>
        </ul>

        <h4 className={styles.subheading}>What you can change</h4>
        <ul className={styles.ul}>
          <li><strong>Name</strong> — the display label on the node card</li>
          <li><strong>Owner / Lane</strong> — moves the node to a different team's lane. New owners get a color automatically.</li>
          <li><strong>Description</strong> — the detail text shown in the Inspector</li>
          <li><strong>Tags</strong> — attach colored label tags. Click the tag dropdown to pick from existing tags or type to create a new one. Tags are visible in the Inspector panel.</li>
        </ul>

        <h4 className={styles.subheading}>What you cannot change</h4>
        <p>The <strong>Node ID</strong> is locked after creation because other nodes reference it in their dependency lists.</p>

        <h4 className={styles.subheading}>Deleting a node</h4>
        <p>Click the red <strong>Delete Node</strong> button. Confirm when prompted. Deleting removes the node AND all edges connected to it, and removes it from any other node's dependency list.</p>
      </div>
    ),
  },
  {
    id: 'design-delete-edge',
    icon: '✂️',
    title: 'Design: Delete a Connection',
    content: (
      <div>
        <p>Connections (edges) can be deleted in Design Mode by clicking on them directly.</p>

        <Step number={1}>Make sure <strong>Design Mode is active</strong>. Edge deletion works in any design tool.</Step>
        <Step number={2}><strong>Hover over any arrow</strong>. It turns red and a tooltip appears: <em>"🗑 Click to delete connection"</em>.</Step>
        <Step number={3}><strong>Click the arrow</strong> to delete it immediately.</Step>

        <Tip>The clickable hit area is 12px wide — much wider than the visible line — so you don't need to be perfectly precise.</Tip>
        <Tip>Use <code>Ctrl+Z</code> to undo an accidentally deleted edge.</Tip>
      </div>
    ),
  },
  {
    id: 'tags',
    icon: '🔖',
    title: 'Tags',
    content: (
      <div>
        <p>Tags are short colored labels you can attach to nodes to categorize them — for example marking nodes as "Blocked", "In Progress", or "High Priority". Tags are purely visual metadata; they don't affect layout or connections.</p>

        <h4 className={styles.subheading}>Attaching tags to a node</h4>
        <p>Open the Edit Node dialog (double-click a node in Design Mode), then use the <strong>Tags</strong> field:</p>
        <ul className={styles.ul}>
          <li>Click the tag dropdown to see all existing tags in the project.</li>
          <li>Type to filter the list or enter a new tag name.</li>
          <li>Select a color from the palette for new tags, then press <strong>Enter</strong> or click to create.</li>
          <li>Click a tag chip's <strong>✕</strong> to remove it from the node.</li>
        </ul>

        <h4 className={styles.subheading}>Managing tags globally (Tags tab)</h4>
        <p>Open the left panel and click the <strong>Tags</strong> tab to see all tags defined in the project:</p>
        <ul className={styles.ul}>
          <li>Each row shows the tag color, label, and how many nodes use it.</li>
          <li>Click a tag row to edit its label or color inline.</li>
          <li>Click the <strong>✕</strong> next to a tag to remove it from the registry. Tags still in use on nodes cannot be deleted until they are removed from all nodes first.</li>
          <li>Use the input at the bottom to pre-register a new tag before attaching it to any node.</li>
        </ul>

        <h4 className={styles.subheading}>Where tags appear</h4>
        <ul className={styles.ul}>
          <li><strong>Inspector tab</strong> — shows all tags on a selected node as colored chips.</li>
          <li><strong>JSON file</strong> — tags are serialized as <code>{`"tags": [{"label": "Blocked", "color": "#ef4444"}]`}</code> inside each node object.</li>
        </ul>

        <Tip>Tags are great for status tracking — use them alongside phases (which capture time) to show both "when" and "how it's going" on the same chart.</Tip>
      </div>
    ),
  },
  {
    id: 'design-multiselect',
    icon: '🖱️',
    title: 'Design: Multi-Select',
    content: (
      <div>
        <p>Multi-select lets you pick several nodes and/or groups at once, then act on them together — move them, group them, or assign them to a phase.</p>

        <h4 className={styles.subheading}>Selecting multiple items</h4>
        <ul className={styles.ul}>
          <li>Make sure the <strong>Select</strong> tool is active in the design toolbar.</li>
          <li><strong>Shift+click</strong> any node or group to add it to the selection. Click again to remove it.</li>
          <li>The toolbar shows a count: e.g. <em>3 items selected</em>.</li>
          <li>Click empty canvas to clear the selection (or click <strong>✕ Clear</strong> in the toolbar).</li>
        </ul>

        <h4 className={styles.subheading}>Moving multiple items</h4>
        <p>Drag any one of the selected items — all selected items move together, preserving their relative positions.</p>

        <h4 className={styles.subheading}>Grouping selected items</h4>
        <p>When 2 or more items are selected, the <strong>⬡ Group (N)</strong> button appears. Click it to open the Create Group dialog and bundle all selected nodes and groups into a new named group.</p>

        <h4 className={styles.subheading}>Assigning to a phase</h4>
        <p>With items selected, click the <strong>◈ Phase</strong> button to assign all selected nodes/groups to an existing phase or create a new one.</p>

        <h4 className={styles.subheading}>Copying and pasting</h4>
        <p>With one or more items selected, press <code>Ctrl+C</code> to copy and <code>Ctrl+V</code> to paste a duplicate set of nodes at a slight offset. Pasted nodes get new IDs automatically.</p>

        <Tip>Shift+click works on both nodes and groups. You can mix them freely in a multi-selection.</Tip>
      </div>
    ),
  },
  {
    id: 'design-groups',
    icon: '⬡',
    title: 'Design: Groups',
    content: (
      <div>
        <p>Groups are named containers that bundle related nodes (and other groups) together. They appear as a polygon on the canvas and can be collapsed to hide their members or expanded to show them.</p>

        <h4 className={styles.subheading}>Creating a group</h4>
        <Step number={1}>In Design Mode, use the <strong>Select</strong> tool and <strong>Shift+click</strong> at least two nodes or groups.</Step>
        <Step number={2}>Click the <strong>⬡ Group (N)</strong> button that appears in the toolbar.</Step>
        <Step number={3}>Fill in the <strong>Group ID</strong>, <strong>Name</strong>, and optional <strong>Description</strong> in the Create Group dialog, then click <strong>Create Group</strong>.</Step>

        <h4 className={styles.subheading}>Group visual shape</h4>
        <p>Groups are drawn as <strong>polygons</strong>. The number of sides increases with nesting depth:</p>
        <ul className={styles.ul}>
          <li>Top-level group → <strong>pentagon</strong> (5 sides)</li>
          <li>Group inside a group → <strong>hexagon</strong> (6 sides)</li>
          <li>Each additional level adds one more side</li>
        </ul>

        <h4 className={styles.subheading}>Collapsed vs expanded</h4>
        <ul className={styles.ul}>
          <li><strong>Expanded</strong> (default) — a translucent bounding box sits behind the member nodes. Members are fully visible and interactive.</li>
          <li><strong>Collapsed</strong> — members are hidden; the group renders as a single labelled polygon. Any edges that connected to member nodes are rerouted to the polygon boundary.</li>
        </ul>
        <p>Click the <strong>collapse/expand toggle</strong> on the group card to switch between states. This also works outside Design Mode.</p>

        <h4 className={styles.subheading}>Editing a group</h4>
        <p>While Design Mode is active: select the group (single-click), then click <strong>Edit Group</strong> in the toolbar or double-click the group. You can update the name, description, and member list.</p>

        <h4 className={styles.subheading}>Deleting a group</h4>
        <p>Open the Edit Group dialog and click <strong>Delete Group</strong>. You can choose to delete only the group wrapper (members remain as standalone nodes) or delete the group and all its members.</p>

        <Tip>Groups are a great way to simplify a dense graph. Collapse a finished phase's group to reduce visual noise.</Tip>
        <Warning>Groups are serialized in the JSON file. When you save and reload, the groups, collapse state, and nesting are all preserved.</Warning>
      </div>
    ),
  },
  {
    id: 'design-phases',
    icon: '◈',
    title: 'Phases',
    content: (
      <div>
        <p>Phases represent time or progress stages — like Discovery, Build, and Deploy. They appear as <strong>vertical colored bands</strong> behind the nodes, giving each band a distinct color and label.</p>

        <h4 className={styles.subheading}>Creating a phase</h4>
        <ul className={styles.ul}>
          <li>Click the <strong>+</strong> pill in the <strong>Phase Navigator</strong> bar at the bottom of the canvas, or</li>
          <li>In Design Mode, select one or more nodes/groups and click <strong>◈ Phase → + New Phase…</strong> to pre-assign the selection to the new phase</li>
        </ul>
        <p>Fill in the phase <strong>Name</strong>, optional <strong>Description</strong>, pick a <strong>Color</strong>, and click <strong>Create Phase</strong>.</p>

        <h4 className={styles.subheading}>Assigning nodes to a phase</h4>
        <p>In Design Mode, select one or more nodes or groups, then click <strong>◈ Phase</strong> in the toolbar and pick a phase from the dropdown. Each node belongs to at most one phase — assigning it to a new phase removes it from the old one automatically.</p>

        <h4 className={styles.subheading}>Phase bands on the canvas</h4>
        <p>Each phase band wraps tightly around its assigned nodes in <strong>DAG view</strong>, or spans the full canvas height in <strong>Lanes view</strong>. The band has:</p>
        <ul className={styles.ul}>
          <li>A colored header strip with the phase name and a numbered badge</li>
          <li>A translucent fill area covering all assigned nodes</li>
        </ul>
        <p>Clicking a band <strong>selects</strong> the phase and shows its details in the Inspector. Double-clicking it (in Design Mode) opens the Edit Phase dialog.</p>

        <h4 className={styles.subheading}>Phase Navigator bar</h4>
        <p>The floating pill bar at the bottom of the canvas lists all phases. Click a pill to <strong>spotlight</strong> that phase — its band brightens while all other phases fade out. Click the active pill again (or click <strong>All</strong>) to clear the spotlight.</p>

        <h4 className={styles.subheading}>Collapsing a phase</h4>
        <p>Double-click a phase band, or click the collapse icon on the band header, to <strong>collapse</strong> the phase. Collapsed phases show as a narrow labeled strip; their nodes are hidden and edges are stubbed. Click again to expand.</p>
        <p>The Phase Navigator also has <strong>Collapse All</strong> and <strong>Expand All</strong> controls.</p>

        <h4 className={styles.subheading}>Editing or deleting a phase</h4>
        <p>Select a phase by clicking its band, then use the <strong>Edit Phase</strong> / <strong>Delete Phase</strong> buttons in the Inspector panel. In Design Mode you can also double-click the band to open the Edit Phase dialog directly.</p>

        <Tip>Phases are saved in the JSON file alongside node data. They reload exactly as left when you reopen the file.</Tip>
        <Warning>Undo/redo do not yet restore phase changes — phase edits are immediately final.</Warning>
      </div>
    ),
  },
  {
    id: 'saving',
    icon: '💾',
    title: 'Saving Your Work',
    content: (
      <div>
        <p>The <strong>Save</strong> button in the header is always visible whenever a graph is loaded. What it does depends on how the file was opened — see <em>Opening & Saving Files</em> for full details.</p>

        <h4 className={styles.subheading}>Quick reference</h4>
        <ul className={styles.ul}>
          <li><strong>Teal chain-link chip + "Save" button</strong> — file is linked (Chrome/Edge). Clicking Save writes directly to your file on disk. No download, no dialog.</li>
          <li><strong>Gray broken-chain chip + "Save JSON" button</strong> — file is not linked. Clicking Save downloads a new copy to your Downloads folder.</li>
          <li><strong>No chip (new flowchart)</strong> — no file yet. Clicking Save downloads a file called <code>flowgraph.json</code>.</li>
        </ul>

        <h4 className={styles.subheading}>Save status indicator</h4>
        <p>The status chip in the header (showing node and edge counts) also displays save state:</p>
        <ul className={styles.ul}>
          <li><strong>✓ HH:MM</strong> — saved successfully at that time, no pending changes.</li>
          <li><strong>⚠ HH:MM · ●</strong> — saved at that time, but you have unsaved changes since. The orange dot is a visual reminder to save again.</li>
        </ul>

        <h4 className={styles.subheading}>Save As</h4>
        <p>Click the <strong>∨ chevron</strong> on the right side of the Save button to open the save options menu. Choose <strong>Save As…</strong> to write to a new filename or location. After a Save As, future saves go to the new file automatically.</p>

        <h4 className={styles.subheading}>Export to PDF</h4>
        <p>The ∨ chevron menu also provides two PDF export options:</p>
        <ul className={styles.ul}>
          <li><strong>Export PDF — Current View</strong> — prints what is visible now.</li>
          <li><strong>Export PDF — Full Chart</strong> — prints every node at once.</li>
        </ul>
        <p>PDFs use a white background with an engineering-paper "+" grid and all connectors drawn in black. Because the source is SVG vector data, the output is fully sharp at any zoom level.</p>

        <h4 className={styles.subheading}>What gets saved</h4>
        <p>The JSON file captures everything: node data AND the current layout positions and viewport transform for both DAG and LANES views. When you reload the file, the graph reopens exactly as you left it.</p>

        <Warning>Changes are never saved automatically. Close or refresh the browser without saving and your changes are lost.</Warning>
        <Tip>In linked mode (Chrome/Edge), treat Save like Ctrl+S — click it frequently as you work.</Tip>
      </div>
    ),
  },
  {
    id: 'shortcuts',
    icon: '⌨️',
    title: 'Keyboard Shortcuts',
    content: (
      <div>
        <p>FlowGraph supports the following keyboard shortcuts:</p>
        <div className={styles.shortcutTable}>
          <Shortcut keys="⌘K / Ctrl+K" action="Focus the search bar" />
          <Shortcut keys="Shift+?" action="Open this User Guide" />
          <Shortcut keys="Escape" action="Close search results / exit Focus Mode / cancel connect / close modal / clear multi-select" />
          <Shortcut keys="Ctrl+Z" action="Undo last change (Design Mode)" />
          <Shortcut keys="Ctrl+Y / Ctrl+Shift+Z" action="Redo (Design Mode)" />
          <Shortcut keys="Ctrl+C" action="Copy selected nodes (Design Mode)" />
          <Shortcut keys="Ctrl+V" action="Paste copied nodes with new IDs (Design Mode)" />
          <Shortcut keys="Delete" action="Delete selected node, group, or multi-selection (Design Mode)" />
          <Shortcut keys="Shift+Click" action="Add/remove item from multi-selection (Design Mode, Select tool)" />
          <Shortcut keys="Double-click node" action="Enter Focus Mode (view) or open Edit Node dialog (Design Mode)" />
          <Shortcut keys="Double-click group" action="Open Edit Group dialog (Design Mode)" />
          <Shortcut keys="Double-click phase band" action="Collapse / expand phase (Design Mode)" />
          <Shortcut keys="Double-click background" action="Exit Focus Mode" />
          <Shortcut keys="S" action="Summon Mode — connect nodes without panning ✨ (Design Mode)" />
        </div>
        <Tip>Most header buttons have tooltips — hover over them to see what they do.</Tip>
      </div>
    ),
  },

  {
    id: 'json-format',
    icon: '📐',
    title: 'JSON Format',
    content: (
      <div>
        <p>FlowGraph reads and writes a simple JSON format. You can hand-author it, generate it with AI, or let Design Mode build it for you.</p>

        <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800, margin:'14px 0 8px' }}>Required node fields</div>
        <pre style={{ whiteSpace:'pre', overflow:'auto', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>{`{
  "id": "string (unique, case-sensitive)",
  "name": "string (≤60 chars, shown on node card)",
  "owner": "string (determines swim lane and color)",
  "description": "string (1–3 sentences, shown in Inspector)",
  "dependencies": ["id-of-prereq-1", "id-of-prereq-2"]
}`}</pre>

        <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800, margin:'14px 0 8px' }}>Optional layout block (auto-generated by FlowGraph)</div>
        <pre style={{ whiteSpace:'pre', overflow:'auto', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>{`{
  "nodes": [ ... ],
  "_layout": {
    "currentView": "dag",
    "dag":   { "positions": { "id": {"x":0,"y":0} }, "transform": {"x":0,"y":0,"k":1} },
    "lanes": { "positions": { ... }, "transform": { ... } }
  }
}`}</pre>

        <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800, margin:'14px 0 8px' }}>Rules</div>
        <ul style={{ paddingLeft:20, margin:'8px 0 14px', color:'var(--text2)', fontSize:13, lineHeight:1.9 }}>
          <li>Output must be a <strong>JSON array</strong> or a <strong>{"{"}"nodes"[]{" }"}</strong> object</li>
          <li><strong>Dependencies are prerequisites</strong>: if B requires A, B.dependencies includes "A"</li>
          <li>All dependency IDs must exist in the same file</li>
          <li>No duplicate IDs</li>
          <li>The <code>_layout</code> block is optional — FlowGraph adds it when you save</li>
        </ul>

        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:8 }}>
          <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800 }}>Minimal example</div>
          <button onClick={() => copyText(EXAMPLE_JSON)} style={{ padding:'6px 10px', border:'1px solid var(--border2)', background:'transparent', color:'var(--text2)', fontFamily:'var(--font-mono)', fontSize:10, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap' }}>Copy Example</button>
        </div>
        <pre style={{ whiteSpace:'pre', overflow:'auto', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>{EXAMPLE_JSON}</pre>
      </div>
    ),
  },

  // ── AI TOOLS ─────────────────────────────────────────────────────────────
  {
    id: 'ai-json',
    icon: '🤖',
    title: 'Getting a JSON File with AI',
    content: (
      <div>
        <p>You don't need to write JSON manually. Any AI assistant can generate it from a process description in seconds.</p>

        <Step number={1}>Open the <strong>AI Prompt</strong> section in this guide and click <strong>Copy Prompt</strong>.</Step>
        <Step number={2}>Open any AI assistant: Claude, Microsoft Copilot, ChatGPT, or similar.</Step>
        <Step number={3}>Paste the prompt, then describe your process — who does what, in what order, and who each step depends on.</Step>
        <Step number={4}>The AI outputs a JSON array. Copy it.</Step>
        <Step number={5}>Open a plain text editor (Notepad, VS Code, TextEdit), paste the JSON, and save the file with a <code>.json</code> extension (e.g. <code>myprocess.json</code>).</Step>
        <Step number={6}>Load the file into FlowGraph using <strong>Open JSON File</strong>.</Step>

        <Tip>The prompt already instructs the AI to output JSON only with no markdown. If the AI still wraps the output in code fences, remove the fences manually before saving the file.</Tip>
        <Warning>If the graph loads with no arrows, dependency IDs don't match node IDs exactly. IDs are case-sensitive — open the JSON in a text editor and verify that every value in "dependencies" exactly matches an "id" field. See the <strong>JSON Format</strong> section for the full field reference.</Warning>
      </div>
    ),
  },
  {
    id: 'troubleshooting',
    icon: '🔧',
    title: 'Troubleshooting',
    content: (
      <div>
        <p>Solutions to the most common problems:</p>

        <div className={styles.troubleTable}>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>JSON file won't load</div>
            <div className={styles.troubleSolution}>The file must contain a JSON array starting with <code>[</code> or an object with a <code>"nodes"</code> array. Open it in a text editor. If the AI output included markdown code fences (<code>```json</code>), remove them before saving.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>Nodes appear but no arrows</div>
            <div className={styles.troubleSolution}>Values in <code>dependencies</code> arrays don't exactly match <code>id</code> fields. IDs are case-sensitive. Open the JSON and verify spelling matches exactly.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>A node is missing from the graph</div>
            <div className={styles.troubleSolution}>Its owner is filtered out in the sidebar. Expand the sidebar (click the floating left tab) and make sure all owners are checked.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>Save button downloads a copy instead of saving in place</div>
            <div className={styles.troubleSolution}>You're in unlinked mode (the filename chip is gray). Re-open the file using the Open JSON File button in Chrome or Edge to get direct-save support. Firefox and Safari do not support in-place file saving.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>Saved layout is gone after reload</div>
            <div className={styles.troubleSolution}>Named layouts (via the Layouts button) are stored in browser localStorage and are browser-specific. Layout positions saved inside the JSON file are always preserved when you reopen the file.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>Graph looks cluttered or tangled</div>
            <div className={styles.troubleSolution}>Try LANES view for separation by team. Use Focus Mode (double-click a node) to explore one node's context. Drag nodes to custom positions, then save the layout in the JSON file to preserve it.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>I accidentally deleted an edge or node</div>
            <div className={styles.troubleSolution}>Press <code>Ctrl+Z</code> to undo in Design Mode. Undo history is maintained for the current session only — it resets if you reload the page.</div>
          </div>
          <div className={styles.troubleRow}>
            <div className={styles.troubleProblem}>New Flowchart cleared my work</div>
            <div className={styles.troubleSolution}>The + New button shows a confirmation dialog if data is present. If you confirmed and lost work, use your browser's back history or check your Downloads folder for a previously saved JSON.</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'ai-prompt-text',
    icon: '📋',
    title: 'AI Prompt',
    content: (
      <div>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:10 }}>
          <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.6 }}>Copy this prompt into any AI assistant, then describe your process flow as the input.</div>
          <button onClick={() => copyText(AI_PROMPT)} style={{ padding:'6px 10px', border:'1px solid var(--border2)', background:'transparent', color:'var(--text2)', fontFamily:'var(--font-mono)', fontSize:10, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap' }}>Copy Prompt</button>
        </div>
        <textarea readOnly value={AI_PROMPT} style={{ width:'100%', minHeight:260, resize:'vertical', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6, outline:'none' }} />
        <div style={{ marginTop:10, fontSize:11, color:'var(--text3)' }}>The prompt specifies all required fields. See <strong>JSON Format</strong> in this guide for the full field reference and a working example.</div>
      </div>
    ),
  },
  {
    id: 'ai-workflow',
    icon: '🔄',
    title: 'AI Workflow',
    content: (
      <div>
        <ol style={{ paddingLeft:20, margin:'8px 0', color:'var(--text2)', fontSize:13, lineHeight:2 }}>
          <li>Start from your process description, PDF, or Visio diagram</li>
          <li>Go to the <strong>AI Prompt</strong> section and click <strong>Copy Prompt</strong></li>
          <li>Open Copilot, Claude, or ChatGPT and paste the prompt</li>
          <li>Describe your process: who does what, in what order, and which steps are prerequisites</li>
          <li>The AI outputs a JSON array matching the <strong>JSON Format</strong> spec — save it as <code style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:3,padding:'1px 5px',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--accent)'}}>myprocess.json</code></li>
          <li>Load the file into FlowGraph using <strong>Open JSON File</strong></li>
          <li>Arrange nodes, switch views, and add connections as needed using Design Mode</li>
          <li>Click <strong>Save</strong> to write back to the file (Chrome/Edge) or download a copy</li>
        </ol>
        <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, fontSize:12, color:'var(--text2)' }}>
          ⚠️ If edges are missing: <code>"dependencies"</code> values don't exactly match <code>"id"</code> fields — IDs are case-sensitive. See <strong>JSON Format</strong> for the full field reference.
        </div>
      </div>
    ),
  },
];

// ─── SEARCH UTILITIES ────────────────────────────────────────────────────────

/**
 * extractText — recursively extracts all plain-text strings from a React node tree.
 * Used to build a searchable index over section content without maintaining
 * separate keyword lists.
 */
function extractText(node: React.ReactNode): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

// Pre-compute once at module load — lowercased title + full content text per section.
const SECTION_INDEX = SECTIONS.map((s) => ({
  id: s.id,
  text: `${s.title} ${extractText(s.content)}`.toLowerCase(),
}));

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export function UserGuideModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Listen for open events (Shift+? via App.tsx, or 📖 button in Header)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.open || e.type === 'flowgraph:open-guide') {
        handleOpen();
      }
    };
    document.addEventListener('flowgraph:open-guide', handler);
    document.addEventListener('flowgraph:guide-state', handler);
    document.addEventListener('flowgraph:help-state', handler);
    return () => {
      document.removeEventListener('flowgraph:open-guide', handler);
      document.removeEventListener('flowgraph:guide-state', handler);
      document.removeEventListener('flowgraph:help-state', handler);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── Filter sections by search query ──────────────────────────────────
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return SECTIONS;
    const q = searchQuery.toLowerCase();
    return SECTIONS.filter((_, i) => SECTION_INDEX[i].text.includes(q));
  }, [searchQuery]);

  // Auto-navigate when the active section is no longer in filtered results
  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (filteredSections.length === 0) return;
    if (!filteredSections.find((s) => s.id === activeSection)) {
      setActiveSection(filteredSections[0].id);
      if (contentRef.current) contentRef.current.scrollTop = 0;
    }
  }, [filteredSections, activeSection, searchQuery]);

  function handleNavClick(sectionId: string) {
    setActiveSection(sectionId);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }

  // Clear search and reset to first section when the modal opens
  function handleOpen() {
    setIsOpen(true);
    setActiveSection(SECTIONS[0].id);
    setSearchQuery('');
  }

  if (!isOpen) return null;

  const currentSection = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo}>⬡</div>
            <div>
              <div className={styles.title}>FlowGraph User Guide</div>
              <div className={styles.subtitle}>Everything you need to know about using FlowGraph</div>
            </div>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.shortcutHint}><code>Shift+?</code> to open anytime</div>
            <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>✕</button>
          </div>
        </div>

        <div className={styles.body}>
          {/* Left navigation */}
          <nav className={styles.nav}>
            {/* Search box */}
            <div className={styles.navSearch}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.navSearchIcon}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={searchInputRef}
                className={styles.navSearchInput}
                type="text"
                placeholder="Search guide…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
              />
              {searchQuery && (
                <button className={styles.navSearchClear} onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} title="Clear search">✕</button>
              )}
            </div>

            {filteredSections.length === 0 ? (
              <div className={styles.navNoResults}>No sections match "{searchQuery}"</div>
            ) : searchQuery.trim() ? (
              /* Flat list when searching — no group headers */
              <>
                <div className={styles.navGroup}>{filteredSections.length} result{filteredSections.length !== 1 ? 's' : ''}</div>
                {filteredSections.map((section) => (
                  <button
                    key={section.id}
                    className={`${styles.navItem} ${activeSection === section.id ? styles.navItemActive : ''}`}
                    onClick={() => handleNavClick(section.id)}
                  >
                    <span className={styles.navIcon}>{section.icon}</span>
                    <span className={styles.navLabel}>{section.title}</span>
                  </button>
                ))}
              </>
            ) : (
              /* Grouped list when not searching */
              <>
                <div className={styles.navGroup}>User Guide</div>
                {SECTIONS.filter(s => !s.id.startsWith('ai-')).map((section) => (
                  <button
                    key={section.id}
                    className={`${styles.navItem} ${activeSection === section.id ? styles.navItemActive : ''}`}
                    onClick={() => handleNavClick(section.id)}
                  >
                    <span className={styles.navIcon}>{section.icon}</span>
                    <span className={styles.navLabel}>{section.title}</span>
                  </button>
                ))}
                <div className={styles.navGroup}>AI Tools</div>
                {SECTIONS.filter(s => s.id.startsWith('ai-')).map((section) => (
                  <button
                    key={section.id}
                    className={`${styles.navItem} ${activeSection === section.id ? styles.navItemActive : ''}`}
                    onClick={() => handleNavClick(section.id)}
                  >
                    <span className={styles.navIcon}>{section.icon}</span>
                    <span className={styles.navLabel}>{section.title}</span>
                  </button>
                ))}
              </>
            )}
          </nav>

          {/* Content area */}
          <div className={styles.content} ref={contentRef}>
            <div key={currentSection.id} className={styles.sectionContent}>
              <div className={styles.contentHeader}>
                <span className={styles.contentIcon}>{currentSection.icon}</span>
                <h2 className={styles.contentTitle}>{currentSection.title}</h2>
              </div>
              <div className={styles.contentBody}>
                {currentSection.content}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
