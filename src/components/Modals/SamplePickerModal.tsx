/**
 * components/Modals/SamplePickerModal.tsx — Sample flowchart selection modal.
 *
 * Opens when the 'flowgraph:pick-sample' event is dispatched (e.g. from the
 * Canvas empty-state "Try Sample" button). Displays each entry in SAMPLE_FILES
 * as a clickable row. Selecting one dispatches 'flowgraph:load-sample' with
 * detail: { file } and closes the modal.
 */

import React, { useState, useEffect } from 'react';
import { SAMPLE_FILES } from '../../utils/samples';
import styles from './SamplePickerModal.module.css';

export function SamplePickerModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const open = () => setIsOpen(true);
    document.addEventListener('flowgraph:pick-sample', open);
    return () => document.removeEventListener('flowgraph:pick-sample', open);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  function load(s: (typeof SAMPLE_FILES)[number]) {
    setIsOpen(false);
    document.dispatchEvent(new CustomEvent('flowgraph:load-sample', { detail: { file: s.file, data: s.data } }));
  }

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Sample Flowcharts</div>
            <div className={styles.subtitle}>Select a demo to load into the canvas</div>
          </div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>✕</button>
        </div>

        <div className={styles.list}>
          {SAMPLE_FILES.map((s) => (
            <button key={s.id} className={styles.item} onClick={() => load(s)}>
              <div className={styles.itemIcon}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              </div>
              <div className={styles.itemBody}>
                <span className={styles.itemLabel}>{s.label}</span>
                <span className={styles.itemDesc}>{s.description}</span>
              </div>
              {s.nodeCount && <span className={styles.itemBadge}>{s.nodeCount}</span>}
              <svg className={styles.arrow} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
