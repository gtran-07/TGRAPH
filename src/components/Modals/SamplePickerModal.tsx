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

const SAMPLE_ICONS: Record<string, React.ReactNode> = {
  small: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="6" r="3.5"/>
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/>
      <polyline points="9,18 12,21 15,18" strokeWidth="1.6"/>
    </svg>
  ),
  medium: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="9" y="1.5" width="6" height="4" rx="1.2"/>
      <rect x="1.5" y="10" width="6" height="4" rx="1.2"/>
      <rect x="16.5" y="10" width="6" height="4" rx="1.2"/>
      <rect x="9" y="18.5" width="6" height="4" rx="1.2"/>
      <path d="M12 5.5 C8 5.5 4.5 8 4.5 10" strokeWidth="1.6"/>
      <path d="M12 5.5 C16 5.5 19.5 8 19.5 10" strokeWidth="1.6"/>
      <path d="M4.5 14 C4.5 16 8 18.5 12 18.5" strokeWidth="1.6"/>
      <path d="M19.5 14 C19.5 16 16 18.5 12 18.5" strokeWidth="1.6"/>
    </svg>
  ),
  large: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6.5 19a4.5 4.5 0 0 1-.1-9 5.5 5.5 0 0 1 10.8-1.5A4.5 4.5 0 1 1 17.5 19Z"/>
      <line x1="12" y1="19" x2="12" y2="11" strokeWidth="1.6"/>
      <polyline points="9,14 12,11 15,14" strokeWidth="1.6"/>
    </svg>
  ),
  xlarge: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9.5"/>
      <ellipse cx="12" cy="12" rx="3.8" ry="9.5"/>
      <line x1="2.5" y1="12" x2="21.5" y2="12"/>
      <path d="M3.5 7.5 Q12 5.5 20.5 7.5" fill="none"/>
      <path d="M3.5 16.5 Q12 18.5 20.5 16.5" fill="none"/>
    </svg>
  ),
};

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
                {SAMPLE_ICONS[s.id]}
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
