/**
 * App.tsx — Root application component. Defines the overall layout structure.
 *
 * Layout: full-height flex column with a fixed header and a flex-row body.
 * The body contains the collapsible sidebar, the SVG canvas, and the inspector pane.
 *
 * This component is intentionally thin — it only handles layout and renders
 * the major region components. All logic lives in hooks and the store.
 */

import React, { useEffect } from 'react';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Panels/Sidebar';
import { Canvas } from './components/Canvas/Canvas';
import { Inspector } from './components/Panels/Inspector';
import { NodeEditModal } from './components/DesignMode/NodeEditModal';
import { GroupEditModal } from './components/DesignMode/GroupEditModal';
import { PhaseEditModal } from './components/DesignMode/PhaseEditModal';
import { UserGuideModal } from './components/Modals/UserGuideModal';
import styles from './App.module.css';

export default function App() {
  // ── Global keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Shift+? opens the user guide
      if (event.shiftKey && event.key === '?') {
        document.dispatchEvent(new CustomEvent('flowgraph:open-guide'));
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={styles.appRoot}>
      <Header />
      <div className={styles.appBody}>
        <Sidebar />
        <Canvas />
        <Inspector />
      </div>

      {/* Modals — rendered outside the layout flow so they overlay everything */}
      <NodeEditModal />
      <GroupEditModal />
      <PhaseEditModal />
      <UserGuideModal />
    </div>
  );
}
