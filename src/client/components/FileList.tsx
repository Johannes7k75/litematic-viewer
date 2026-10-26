import { createMemo, createSignal, For, Show } from 'solid-js';
import type { SchematicInfo } from '../../gen/litematic/v1/viewer_pb.ts';
import { previewUrl } from '../api.ts';
import { storage } from '../format.ts';

/** Sidebar list of schematics. */
export function FileList(props: {
  files: SchematicInfo[];
  root: string;
  selected: string | null;
  onOpen: (f: SchematicInfo) => void;
}) {
  const [query, setQuery] = createSignal('');
  const [dedupe, setDedupe] = createSignal(storage.get('dedupe', true));

  /** Files with identical content, keyed by hash. */
  const copies = createMemo(() => {
    const m = new Map<string, SchematicInfo[]>();
    for (const f of props.files) m.set(f.md5, [...(m.get(f.md5) ?? []), f]);
    return m;
  });

  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    return props.files
      .filter((f) => !dedupe() || copies().get(f.md5)![0] === f)
      .filter((f) => !q || `${f.name} ${f.path} ${f.author}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.path).localeCompare(b.name || b.path, undefined, { sensitivity: 'base' }));
  });

  const toggleDedupe = (on: boolean) => {
    setDedupe(on);
    storage.set('dedupe', on);
  };

  return (
    <aside class="files">
      <header>
        <h1>Litematic Viewer</h1>
        <input type="search" placeholder="Search schematics…" autocomplete="off"
          value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="row small">
          <label>
            <input type="checkbox" checked={dedupe()} onChange={(e) => toggleDedupe(e.currentTarget.checked)} /> Hide duplicates
          </label>
          <span class="count muted">{visible().length} shown</span>
        </div>
      </header>
      <ul>
        <For each={visible()}>
          {(f) => {
            const same = () => copies().get(f.md5)!;
            const selected = () => f.path === props.selected || (dedupe() && same().some((d) => d.path === props.selected));
            const meta = [f.dims && `${f.dims.x}×${f.dims.y}×${f.dims.z}`, f.blocks ? `${f.blocks.toLocaleString()} blocks` : '', f.author, f.error ? '⚠ unreadable' : '']
              .filter(Boolean)
              .join(' · ');
            return (
              <li classList={{ selected: selected() }} title={same().map((d) => d.path).join('\n')} onClick={() => props.onOpen(f)}>
                <div class="thumb" style={f.preview ? { 'background-image': `url("${previewUrl(f.path)}")` } : {}}>
                  {f.preview ? '' : '▦'}
                </div>
                <div class="info">
                  <div class="name">{f.name || f.path.split('/').pop()!.replace(/\.litematic$/i, '')}</div>
                  <div class="meta">{meta}</div>
                  <div class="path">{f.path}</div>
                  <Show when={dedupe() && same().length > 1}>
                    <div class="dup">{same().length} identical copies</div>
                  </Show>
                </div>
              </li>
            );
          }}
        </For>
      </ul>
      <footer class="small muted">{props.root}</footer>
    </aside>
  );
}
