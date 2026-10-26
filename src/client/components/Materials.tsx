import { createMemo, createSignal, For } from 'solid-js';
import type { BlockAssets } from '../../shared/types.ts';
import { blockName, iconStyle, stacks } from '../format.ts';

/** Material list with item counts and stack / shulker box breakdown. */
export function Materials(props: { materials: [string, number][]; assets: BlockAssets | null }) {
  const [filter, setFilter] = createSignal('');
  const [copied, setCopied] = createSignal(false);

  const total = createMemo(() => props.materials.reduce((s, [, n]) => s + n, 0));
  const rows = createMemo(() => {
    const q = filter().trim().toLowerCase();
    return props.materials.filter(([n]) => !q || n.includes(q) || blockName(props.assets, n).toLowerCase().includes(q));
  });

  const copyCsv = async () => {
    const csv = 'Block,Count\n' + props.materials.map(([n, c]) => `"${blockName(props.assets, n)}",${c}`).join('\n');
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      prompt('Copy the material list:', csv);
    }
  };

  return (
    <div class="materials panel">
      <div class="row">
        <strong>Materials</strong>
        <span class="muted small">{props.materials.length} types · {total().toLocaleString()}</span>
        <div class="spacer" />
        <button class="small" title="Copy as CSV" onClick={copyCsv}>{copied() ? 'Copied!' : 'Copy CSV'}</button>
      </div>
      <input type="search" placeholder="Filter…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      <div class="list">
        <For each={rows()}>
          {([name, n]) => (
            <div class="item">
              <div class="icon" style={iconStyle(props.assets, name)} />
              <div class="name" title={name}>{blockName(props.assets, name)}</div>
              <div class="n">{n.toLocaleString()}</div>
              <div class="st">{stacks(n)}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
