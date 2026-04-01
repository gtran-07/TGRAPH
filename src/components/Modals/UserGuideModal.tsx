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
  - "id": string (unique)
  - "name": string (≤60 chars)
  - "owner": string (lane/group name)
  - "description": string (1–3 sentences)
  - "dependencies": array of string ids (prerequisites — nodes that must complete BEFORE this one)

DEPENDENCY DIRECTION (IMPORTANT):
- "dependencies" are PREREQUISITES.
- If step B requires step A to be done first, then B.dependencies includes "A".
- Do NOT list downstream steps as dependencies.

RULES:
1) IDs must be unique and stable. Use a consistent scheme like "REQ-01", "DES-02", "TEST-03".
2) Every dependency id must exist in the output — no dangling references.
3) If the diagram contains a loop/cycle, break it by inserting a review/approval/checkpoint node.
4) Use owner names as lane headers (or infer lanes if not explicitly labeled).
5) Keep "name" short and "description" 1–3 sentences.

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
        <p>Click the <strong>↺</strong> button in the header to recalculate the automatic layout from scratch. Useful if you've dragged nodes around and want to start fresh. Note: this clears your manual arrangement.</p>

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
    title: 'Filtering by Owner',
    content: (
      <div>
        <p>The sidebar on the left lists all owners in the loaded graph. You can show or hide nodes by owner to reduce visual clutter.</p>

        <h4 className={styles.subheading}>Opening the sidebar</h4>
        <p>The sidebar opens automatically when you load a file. If it's been collapsed, click the small <strong>floating tab</strong> on the left edge of the canvas to expand it again.</p>

        <h4 className={styles.subheading}>Filtering</h4>
        <ul className={styles.ul}>
          <li>Each owner row shows a colored dot, the owner name, and a count of their nodes</li>
          <li>Click any owner row to toggle their nodes on or off</li>
          <li>Edges are filtered too — if either endpoint is hidden, the edge is hidden</li>
          <li>The <strong>ALL</strong> button at the top toggles all owners at once</li>
        </ul>

        <h4 className={styles.subheading}>Collapsing the sidebar</h4>
        <p>Click the <strong>«</strong> button inside the sidebar panel to collapse it to a floating tab so it doesn't block the canvas.</p>

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
        <p>Focus Mode shows only a single node and its immediate connections — hiding everything else temporarily. Useful for understanding one step without the noise of the full graph.</p>

        <h4 className={styles.subheading}>Entering Focus Mode</h4>
        <p><strong>Double-click any node</strong> while Design Mode is <em>off</em>. The canvas animates to show only the focused node, its direct prerequisites (upstream), and its direct dependents (downstream). A yellow banner appears at the top of the canvas.</p>

        <h4 className={styles.subheading}>Exiting Focus Mode</h4>
        <ul className={styles.ul}>
          <li>Press <code>Escape</code></li>
          <li>Click the <strong>✕</strong> on the yellow banner</li>
          <li>Double-click the canvas background</li>
        </ul>
        <p>The graph restores exactly the positions and zoom level you had before entering Focus Mode.</p>

        <Warning>Double-clicking a node while Design Mode is active opens the Edit Node dialog instead of entering Focus Mode.</Warning>
      </div>
    ),
  },
  {
    id: 'inspector',
    icon: '🔎',
    title: 'Inspecting a Node',
    content: (
      <div>
        <p>The Inspector panel (right side) shows the full details of any selected node.</p>

        <Step number={1}><strong>Single-click</strong> any node to select it. The Inspector panel slides open.</Step>
        <Step number={2}>The Inspector shows: full name, ID, owner (as a colored tag), description, and all dependencies listed by name.</Step>
        <Step number={3}>Click the <strong>«</strong> button inside the Inspector, or the <strong>▣</strong> button in the header, to close it.</Step>

        <p>When Design Mode is active, an <strong>Edit Node</strong> button appears at the bottom of the Inspector for quick editing access.</p>

        <Tip>The Inspector closes automatically if the selected node's owner is filtered out.</Tip>
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
          <li><strong>Select</strong> — default; drag nodes, click to inspect</li>
          <li><strong>Add Node</strong> — click empty canvas to place a new node</li>
          <li><strong>Connect</strong> — draw a directed connection between two nodes</li>
          <li><strong>Edit Node</strong> — open the edit dialog for the selected node</li>
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
          <Shortcut keys="Escape" action="Close search results / exit Focus Mode / cancel connect / close modal" />
          <Shortcut keys="Ctrl+Z" action="Undo last change (Design Mode)" />
          <Shortcut keys="Ctrl+Y / Ctrl+Shift+Z" action="Redo (Design Mode)" />
          <Shortcut keys="Double-click node" action="Enter Focus Mode (view) or open Edit dialog (Design Mode)" />
          <Shortcut keys="Double-click background" action="Exit Focus Mode" />
        </div>
        <Tip>Most header buttons have tooltips — hover over them to see what they do.</Tip>
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

        <Tip>Add "output JSON only, no markdown, no explanation" to your message. This prevents the AI from wrapping the output in code fences, which would cause a parse error.</Tip>
        <Warning>If the graph loads with no arrows, the dependency IDs don't match the node IDs exactly. Open the JSON in a text editor and verify that values in "dependencies" arrays exactly match "id" fields — they are case-sensitive.</Warning>
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
        <div style={{ marginTop:10, fontSize:11, color:'var(--text3)' }}>Tip: ask the AI to output <strong>JSON only</strong> (no markdown) to avoid parse errors.</div>
      </div>
    ),
  },
  {
    id: 'ai-example',
    icon: '📄',
    title: 'Example JSON',
    content: (
      <div>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:10 }}>
          <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.6 }}>A minimal example of the JSON format accepted by FlowGraph.</div>
          <button onClick={() => copyText(EXAMPLE_JSON)} style={{ padding:'6px 10px', border:'1px solid var(--border2)', background:'transparent', color:'var(--text2)', fontFamily:'var(--font-mono)', fontSize:10, borderRadius:5, cursor:'pointer', whiteSpace:'nowrap' }}>Copy Example</button>
        </div>
        <pre style={{ whiteSpace:'pre', overflow:'auto', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>{EXAMPLE_JSON}</pre>
      </div>
    ),
  },
  {
    id: 'ai-spec',
    icon: '📐',
    title: 'JSON Spec',
    content: (
      <div>
        <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800, margin:'14px 0 8px' }}>Required node fields</div>
        <pre style={{ whiteSpace:'pre', overflow:'auto', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>{`{\n  "id": "string (unique, case-sensitive)",\n  "name": "string (≤60 chars, shown on node card)",\n  "owner": "string (determines swim lane and color)",\n  "description": "string (1–3 sentences, shown in Inspector)",\n  "dependencies": ["id-of-prereq-1", "id-of-prereq-2"]\n}`}</pre>
        <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800, margin:'14px 0 8px' }}>Optional layout block (auto-generated by FlowGraph)</div>
        <pre style={{ whiteSpace:'pre', overflow:'auto', padding:12, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>{`{\n  "nodes": [ ... ],\n  "_layout": {\n    "currentView": "dag",\n    "dag":   { "positions": { "id": {"x":0,"y":0} }, "transform": {"x":0,"y":0,"k":1} },\n    "lanes": { "positions": { ... }, "transform": { ... } }\n  }\n}`}</pre>
        <div style={{ fontSize:10, letterSpacing:1, textTransform:'uppercase', color:'var(--text3)', fontWeight:800, margin:'14px 0 8px' }}>Rules</div>
        <ul style={{ paddingLeft:20, margin:'8px 0', color:'var(--text2)', fontSize:13, lineHeight:1.9 }}>
          <li>Output must be a <strong>JSON array</strong> or a <strong>{"{"}"nodes"[]{" }"}</strong> object</li>
          <li><strong>Dependencies are prerequisites</strong>: if B requires A, B.dependencies includes "A"</li>
          <li>All dependency IDs must exist in the same file</li>
          <li>No duplicate IDs</li>
          <li>The <code>_layout</code> block is optional — FlowGraph adds it when you save</li>
        </ul>
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
          <li>Go to <strong>AI Prompt</strong> section and click <strong>Copy Prompt</strong></li>
          <li>Open Copilot, Claude, or ChatGPT and paste the prompt</li>
          <li>Follow with your process description (lanes, steps, sequence)</li>
          <li>The AI outputs a JSON array — save it as <code style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:3,padding:'1px 5px',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--accent)'}}>myprocess.json</code></li>
          <li>Load the file into FlowGraph using <strong>Open JSON File</strong></li>
          <li>Arrange nodes, switch views, add connections as needed using Design Mode</li>
          <li>Click <strong>Save</strong> to write back to the file (Chrome/Edge) or download a copy</li>
        </ol>
        <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:6, fontSize:12, color:'var(--text2)' }}>
          ⚠️ If edges are missing: dependency IDs don't match node IDs exactly — they are case-sensitive.
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
