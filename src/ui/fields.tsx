/** A color input that also allows "none" (transparent). */
export function ColorField({
  label,
  value,
  onChange,
  allowNone = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
}) {
  const none = value === 'none';
  return (
    <div className="field">
      <span>{label}</span>
      <div className="color-row">
        <input type="color" value={none ? '#ffffff' : value} disabled={none} onChange={(e) => onChange(e.target.value)} />
        {allowNone && (
          <label className="toggle">
            <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? 'none' : '#ffffff')} /> None
          </label>
        )}
      </div>
    </div>
  );
}

export function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)));
        }}
      />
    </label>
  );
}

export function SelectField<T extends string>(props: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A 0–1 value (e.g. opacity) as a 0–100 % slider. */
export function SliderField(props: { label: string; value: number; disabled?: boolean; onChange: (v: number) => void }) {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <label className="field">
      <span>{props.label}</span>
      <div className="slider-row">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          disabled={props.disabled}
          onChange={(e) => props.onChange(Number(e.target.value) / 100)}
        />
        <span className="mono small">{pct}%</span>
      </div>
    </label>
  );
}
