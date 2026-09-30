import { useState } from 'react';

/**
 * Zahl mit − / + und Eingabefeld (Enter oder Verlassen übernimmt, Esc verwirft). Jeder Schritt ist eine Aktion
 * (ein Undo-Schritt) – kein Dauerfeuer beim Ziehen wie bei einem Regler.
 */
export function Stepper(props: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  unit?: string;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const commit = (raw: string) => {
    setDraft(undefined);
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(v) || v === props.value) return;
    props.onChange(Math.max(props.min, Math.min(props.max, v)));
  };
  const disabled = props.disabled === true;
  return (
    <span className="stepper" role="group" aria-label={props.label}>
      <button type="button" onClick={() => props.onChange(props.value - 1)} disabled={disabled || props.value <= props.min} aria-label={`${props.label} verringern`}>
        −
      </button>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={1}
        value={draft ?? String(props.value)}
        disabled={disabled}
        aria-label={props.label}
        title={`${props.label} (${props.min}–${props.max}${props.unit !== undefined ? ` ${props.unit}` : ''}) – Enter übernimmt`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(undefined);
            e.currentTarget.blur();
          }
        }}
      />
      <button type="button" onClick={() => props.onChange(props.value + 1)} disabled={disabled || props.value >= props.max} aria-label={`${props.label} erhöhen`}>
        +
      </button>
    </span>
  );
}
