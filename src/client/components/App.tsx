import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { SchematicInfo } from '../../gen/litematic/v1/viewer_pb.ts';
import type { BlockAssets, BlockState, ParsedSchematic } from '../../shared/types.ts';
import { fetchAssets, fetchList, fetchSchematic, MesherClient, uploadSchematic } from '../api.ts';
import { blockName, storage } from '../format.ts';
import { Viewer, type BlockHit, type Lighting } from '../viewer.ts';
import { FileList } from './FileList.tsx';
import { Layers, type LayerRange } from './Layers.tsx';
import { Materials } from './Materials.tsx';

interface Current extends ParsedSchematic {
  label: string;
  entry: SchematicInfo | null;
}

interface Hover {
  x: number;
  y: number;
  z: number;
  state: BlockState;
  left: number;
  top: number;
}

/** Root component: file list, 3D stage and overlays. */
export function App() {
  const [files, setFiles] = createSignal<SchematicInfo[]>([]);
  const [root, setRoot] = createSignal('');
  const [selected, setSelected] = createSignal<string | null>(null);
  const [current, setCurrent] = createSignal<Current | null>(null);
  const [loading, setLoading] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [assets, setAssets] = createSignal<BlockAssets | null>(null);
  const [showMaterials, setShowMaterials] = createSignal(storage.get('showMats', true));
  const [lighting, setLighting] = createSignal<Lighting>(storage.get('lighting', 'classic'));
  const [sunAngle, setSunAngle] = createSignal(storage.get('sunAngle', 45));
  const [layers, setLayerRange] = createSignal<LayerRange>({ lo: 0, hi: 0, single: false });
  const [hover, setHover] = createSignal<Hover | null>(null);
  const [dragover, setDragover] = createSignal(false);

  let canvas!: HTMLCanvasElement;
  let stage!: HTMLElement;
  let viewer: Viewer;
  let mesher: MesherClient | null = null;
  let ready: Promise<void>;
  let openToken = 0;

  onMount(() => {
    viewer = new Viewer(canvas);
    viewer.onHover = showHover;
    ready = (async () => {
      const a = await fetchAssets();
      mesher = new MesherClient(a);
      await viewer.loadAtlas('assets/atlas.png');
      viewer.setLighting(lighting());
      viewer.setSunAngle(sunAngle());
      setAssets(a);
    })();
    ready.catch((e: Error) => setError(e.message));
    loadList();
    window.addEventListener('keydown', onKey);
  });
  onCleanup(() => window.removeEventListener('keydown', onKey));

  async function loadList() {
    try {
      const { root, files } = await fetchList();
      setRoot(root);
      setFiles(files);
      const fromHash = decodeURIComponent(location.hash.replace(/^#p=/, ''));
      const initial = files.find((f) => f.path === fromHash);
      if (initial) openEntry(initial);
    } catch (e) {
      setRoot(`Could not reach the local server: ${(e as Error).message}`);
    }
  }

  function openEntry(f: SchematicInfo) {
    setSelected(f.path);
    history.replaceState(null, '', `#p=${encodeURIComponent(f.path)}`);
    return open(f.name || f.path.split('/').pop()!, f, () => fetchSchematic(f.path));
  }

  /** Load a schematic and show it; any failure ends the spinner with an error message. */
  async function open(label: string, entry: SchematicInfo | null, load: () => Promise<ParsedSchematic>) {
    const token = ++openToken;
    setLoading(`Loading ${label}…`);
    setError(null);
    try {
      const [s] = await Promise.all([load(), ready]);
      const mesh = await mesher!.load(s);
      if (token !== openToken) return; // a newer schematic was opened meanwhile
      setCurrent({ ...s, label, entry });
      setLayerRange({ lo: 0, hi: s.dims[1] - 1, single: false });
      viewer.setSchematic(s.dims, s.grid, mesh);
      document.title = `${s.meta.name || label} – Litematic Viewer`;
    } catch (e) {
      if (token === openToken) setError(`Could not open ${label}: ${(e as Error).message}`);
    } finally {
      if (token === openToken) setLoading(null);
    }
  }

  // ---------------------------------------------------------------- layers

  let remeshTimer = 0, remeshBusy = false, remeshQueued = false;

  function setLayers(range: LayerRange) {
    setLayerRange(range);
    viewer.setLayerRange(range.lo, range.hi);
    clearTimeout(remeshTimer);
    remeshTimer = window.setTimeout(remesh, 30);
  }

  /** Rebuild the mesh for the current layers; coalesces requests while the worker is busy. */
  async function remesh() {
    if (!mesher || !current()) return;
    if (remeshBusy) {
      remeshQueued = true;
      return;
    }
    remeshBusy = true;
    try {
      viewer.setMesh(await mesher.mesh(layers().lo, layers().hi));
    } catch (e) {
      setError(`Could not update layers: ${(e as Error).message}`);
    } finally {
      remeshBusy = false;
      if (remeshQueued) {
        remeshQueued = false;
        remesh();
      }
    }
  }

  // ---------------------------------------------------------------- interaction

  function showHover(hit: BlockHit | null, ev: PointerEvent | null) {
    const c = current();
    if (!hit || !ev || !c) return setHover(null);
    const r = stage.getBoundingClientRect();
    setHover({
      x: hit.x, y: hit.y, z: hit.z,
      state: c.palette[hit.id],
      left: Math.min(ev.clientX - r.left + 16, r.width - 290),
      top: Math.min(ev.clientY - r.top + 16, r.height - 80),
    });
  }

  function toggleMaterials() {
    setShowMaterials(!showMaterials());
    storage.set('showMats', showMaterials());
  }

  function toggleLighting() {
    const next: Lighting = lighting() === 'classic' ? 'complementary' : 'classic';
    setLighting(next);
    storage.set('lighting', next);
    viewer.setLighting(next);
  }

  function changeSun(deg: number) {
    setSunAngle(deg);
    storage.set('sunAngle', deg);
    viewer.setSunAngle(deg);
  }

  function onKey(ev: KeyboardEvent) {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') return;
    const c = current();
    if (!c) return;
    if (ev.key === 'r' || ev.key === 'R') viewer.resetCamera();
    else if (ev.key === 'm' || ev.key === 'M') toggleMaterials();
    else if (ev.key === 'l' || ev.key === 'L') toggleLighting();
    else if (ev.key === 'PageUp' || ev.key === 'PageDown') {
      ev.preventDefault();
      const y = Math.max(0, Math.min(c.dims[1] - 1, layers().hi + (ev.key === 'PageUp' ? 1 : -1)));
      setLayers({ lo: y, hi: y, single: true });
    }
  }

  async function onDrop(ev: DragEvent) {
    ev.preventDefault();
    setDragover(false);
    const file = ev.dataTransfer?.files[0];
    if (!file) return;
    setSelected(null);
    history.replaceState(null, '', location.pathname);
    await open(file.name.replace(/\.litematic$/i, ''), null, () => uploadSchematic(file));
  }

  const subtitle = (c: Current) => {
    const total = c.materials.reduce((s, [, n]) => s + n, 0);
    const parts = [c.dims.join(' × '), `${total.toLocaleString()} blocks`];
    if (c.meta.author) parts.push(`by ${c.meta.author}`);
    if (c.regions.length > 1) parts.push(`${c.regions.length} regions`);
    if (c.entry) parts.push(c.entry.path);
    return parts.join(' · ');
  };

  return (
    <>
      <FileList files={files()} root={root()} selected={selected()} onOpen={openEntry} />
      <main ref={stage} class="stage" classList={{ dragover: dragover() }}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}>
        <canvas ref={canvas} />

        <Show when={!current() && !loading() && !error()}>
          <div class="overlay"><p>Pick a schematic on the left, or drop a <code>.litematic</code> file here.</p></div>
        </Show>
        <Show when={loading()}>
          {(text) => <div class="overlay"><div class="spinner" /><p>{text()}</p></div>}
        </Show>
        <Show when={!loading() && error()}>
          {(msg) => <div class="overlay error"><p>{msg()}</p></div>}
        </Show>

        <Show when={current()}>
          {(c) => (
            <>
              <div class="topbar panel">
                <div>
                  <div class="title">{c().meta.name || c().label}</div>
                  <div class="small muted">{subtitle(c())}</div>
                </div>
                <div class="spacer" />
                <Show when={lighting() === 'complementary'}>
                  <label class="sun small muted" title="Time of day: sun position">
                    Sun
                    <input type="range" min="0" max="360" value={sunAngle()}
                      onInput={(e) => changeSun(+e.currentTarget.value)} />
                  </label>
                </Show>
                <button classList={{ active: lighting() === 'complementary' }} title="Shaders: sun, shadows and AO (L)" onClick={toggleLighting}>Shaders</button>
                <button title="Reset camera (R)" onClick={() => viewer.resetCamera()}>Reset view</button>
                <button classList={{ active: showMaterials() }} title="Material list (M)" onClick={toggleMaterials}>Materials</button>
              </div>
              <Layers maxY={c().dims[1] - 1} range={layers()} onChange={setLayers} />
              <Show when={showMaterials()}>
                <Materials materials={c().materials} assets={assets()} />
              </Show>
            </>
          )}
        </Show>

        <Show when={hover()}>
          {(h) => {
            const props = () => Object.entries(h().state.props).map(([k, v]) => `${k}=${v}`).join(', ');
            return (
              <div class="tooltip" style={{ left: `${h().left}px`, top: `${h().top}px` }}>
                <strong>{blockName(assets(), h().state.name)}</strong>{' '}
                <span class="muted small">{h().x}, {h().y}, {h().z}</span>
                <Show when={props()}><div class="props">{props()}</div></Show>
              </div>
            );
          }}
        </Show>

        <div class="help small muted">Left drag: rotate · Right drag: pan · Wheel: zoom · Hover a block for details</div>
      </main>
    </>
  );
}
