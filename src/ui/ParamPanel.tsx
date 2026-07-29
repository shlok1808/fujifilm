import type { DynamicRange, GenCaps, Recipe, Strength } from '../model/recipe';
import { MONOCHROME_SIMS } from '../model/recipe';

interface Props {
  recipe: Recipe;
  caps: GenCaps | null;
  onChange: (r: Recipe) => void;
}

function Slider({
  label, value, min, max, step = 1, disabled, hint, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  disabled?: boolean; hint?: string; onChange: (v: number) => void;
}) {
  return (
    <label className={`field slider${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        <em>{value > 0 ? `+${value}` : value}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ParamPanel({ recipe, caps, onChange }: Props) {
  const set = <K extends keyof Recipe>(key: K, value: Recipe[K]) =>
    onChange({ ...recipe, [key]: value });

  const mono = MONOCHROME_SIMS.has(recipe.filmSim);
  const tone = caps?.toneRange ?? [-2, 4];
  const colorR = caps?.colorRange ?? [-4, 4];
  const sharpR = caps?.sharpnessRange ?? [-4, 4];
  const nrR = caps?.nrRange ?? [-4, 4];
  const missing = (has: boolean | undefined) =>
    has === false ? 'not available on this body' : undefined;

  return (
    <div className="params">
      <label className="field">
        <span>Dynamic range</span>
        <select
          value={recipe.dynamicRange}
          onChange={(e) => set('dynamicRange', Number(e.target.value) as DynamicRange)}
        >
          <option value={100}>DR100</option>
          <option value={200}>DR200</option>
          <option value={400}>DR400</option>
        </select>
      </label>

      <fieldset>
        <legend>White balance</legend>
        <Slider
          label="Shift Red" value={recipe.whiteBalance.shiftRed} min={-9} max={9}
          onChange={(v) => set('whiteBalance', { ...recipe.whiteBalance, shiftRed: v })}
        />
        <Slider
          label="Shift Blue" value={recipe.whiteBalance.shiftBlue} min={-9} max={9}
          onChange={(v) => set('whiteBalance', { ...recipe.whiteBalance, shiftBlue: v })}
        />
      </fieldset>

      <Slider label="Highlight" value={recipe.highlight} min={tone[0]} max={tone[1]}
        onChange={(v) => set('highlight', v)} />
      <Slider label="Shadow" value={recipe.shadow} min={tone[0]} max={tone[1]}
        onChange={(v) => set('shadow', v)} />
      <Slider label="Color" value={recipe.color} min={colorR[0]} max={colorR[1]}
        disabled={mono} hint={mono ? 'monochrome simulation' : undefined}
        onChange={(v) => set('color', v)} />
      <Slider label="Sharpness" value={recipe.sharpness} min={sharpR[0]} max={sharpR[1]}
        onChange={(v) => set('sharpness', v)} />
      <Slider label="Noise reduction" value={recipe.noiseReduction} min={nrR[0]} max={nrR[1]}
        onChange={(v) => set('noiseReduction', v)} />

      <Slider label="Clarity" value={recipe.clarity ?? 0} min={-5} max={5}
        disabled={caps?.clarity === false} hint={missing(caps?.clarity)}
        onChange={(v) => set('clarity', v)} />

      <label className={`field${caps?.grain === false ? ' disabled' : ''}`}>
        <span>Grain effect</span>
        <select
          value={recipe.grain?.strength ?? 'off'}
          disabled={caps?.grain === false}
          onChange={(e) => set('grain', { ...recipe.grain, strength: e.target.value as Strength })}
        >
          <option value="off">Off</option>
          <option value="weak">Weak</option>
          <option value="strong">Strong</option>
        </select>
        {caps?.grain === false && <small>not available on this body</small>}
      </label>

      <label className={`field${caps?.colorChrome === false ? ' disabled' : ''}`}>
        <span>Color Chrome Effect</span>
        <select
          value={recipe.colorChrome ?? 'off'}
          disabled={caps?.colorChrome === false || mono}
          onChange={(e) => set('colorChrome', e.target.value as Strength)}
        >
          <option value="off">Off</option>
          <option value="weak">Weak</option>
          <option value="strong">Strong</option>
        </select>
        {caps?.colorChrome === false && <small>not available on this body</small>}
      </label>

      <label className={`field${caps?.colorChromeFxBlue === false ? ' disabled' : ''}`}>
        <span>Color Chrome FX Blue</span>
        <select
          value={recipe.colorChromeFxBlue ?? 'off'}
          disabled={caps?.colorChromeFxBlue === false || mono}
          onChange={(e) => set('colorChromeFxBlue', e.target.value as Strength)}
        >
          <option value="off">Off</option>
          <option value="weak">Weak</option>
          <option value="strong">Strong</option>
        </select>
        {caps?.colorChromeFxBlue === false && <small>not available on this body</small>}
      </label>

      <Slider label="Exposure comp" value={recipe.exposureComp ?? 0} min={-3} max={3} step={1 / 3}
        onChange={(v) => set('exposureComp', v)} />
    </div>
  );
}
