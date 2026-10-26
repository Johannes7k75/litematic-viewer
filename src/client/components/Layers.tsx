import { Show } from 'solid-js';

export interface LayerRange {
  lo: number;
  hi: number;
  single: boolean;
}

/** Y-layer range / single-layer slider. */
export function Layers(props: { maxY: number; range: LayerRange; onChange: (r: LayerRange) => void }) {
  const onSlider = (which: 'lo' | 'hi', v: number) => {
    const { lo, hi, single } = props.range;
    if (single) return props.onChange({ lo: v, hi: v, single: true });
    const next = which === 'lo' ? { lo: v, hi } : { lo, hi: v };
    // Dragging one handle past the other pushes it along.
    props.onChange(next.lo > next.hi ? { lo: v, hi: v, single: false } : { ...next, single: false });
  };

  const onSingle = (single: boolean) => props.onChange({ lo: single ? props.range.hi : 0, hi: props.range.hi, single });

  return (
    <div class="layers panel">
      <div class="row">
        <strong>Layers</strong>
        <span class="muted">Y {props.range.single ? props.range.hi : `${props.range.lo} – ${props.range.hi}`}</span>
        <div class="spacer" />
        <label class="small">
          <input type="checkbox" checked={props.range.single} onChange={(e) => onSingle(e.currentTarget.checked)} /> Single layer
        </label>
      </div>
      <label class="slider">
        <span>{props.range.single ? 'Layer' : 'Top'}</span>
        <input type="range" min="0" max={props.maxY} value={props.range.hi} onInput={(e) => onSlider('hi', +e.currentTarget.value)} />
      </label>
      <Show when={!props.range.single}>
        <label class="slider">
          <span>Bottom</span>
          <input type="range" min="0" max={props.maxY} value={props.range.lo} onInput={(e) => onSlider('lo', +e.currentTarget.value)} />
        </label>
      </Show>
      <div class="small muted">PageUp / PageDown moves the layer</div>
    </div>
  );
}
