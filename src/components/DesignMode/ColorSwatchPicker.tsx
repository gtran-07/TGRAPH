import React from 'react';
import { PHASE_PALETTE } from '../../types/graph';

interface ColorSwatchPickerProps {
  value: string;
  onChange: (color: string) => void;
  palette?: readonly string[];
}

export function ColorSwatchPicker({ value, onChange, palette = PHASE_PALETTE }: ColorSwatchPickerProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {palette.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          title={color}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: color,
            border: value === color ? '2.5px solid var(--text1)' : '2px solid transparent',
            outline: value === color ? `2px solid ${color}` : 'none',
            outlineOffset: 2,
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}
