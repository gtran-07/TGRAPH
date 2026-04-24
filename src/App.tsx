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
import { NodeEditModal } from './components/DesignMode/NodeEditModal';
import { GroupEditModal } from './components/DesignMode/GroupEditModal';
import { PhaseEditModal } from './components/DesignMode/PhaseEditModal';
import { UserGuideModal } from './components/Modals/UserGuideModal';
import { SamplePickerModal } from './components/Modals/SamplePickerModal';
import { CinemaOverlay } from './components/Cinema/CinemaOverlay';
import { SummonDock } from './components/SummonMode/SummonDock';
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
      </div>

      {/* Modals — rendered outside the layout flow so they overlay everything */}
      <NodeEditModal />
      <GroupEditModal />
      <PhaseEditModal />
      <UserGuideModal />
      <SamplePickerModal />

      {/* Cinema overlay — portal into #canvas-wrap; renders nothing when inactive */}
      <CinemaOverlay />

      {/* Summon dock — portal into document.body; renders nothing when inactive */}
      <SummonDock />
    </div>
  );
}
