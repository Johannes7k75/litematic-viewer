// Talks to the local server (ViewerService over ConnectRPC) and to the mesher worker.

import { ConnectError, createClient, type Transport } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ViewerService, type ListSchematicsResponse, type Schematic } from '../gen/litematic/v1/viewer_pb.ts';
import { fromProto } from '../shared/schematic-proto.ts';
import type { BlockAssets, BlockGrid, MeshData, ParsedSchematic, WorkerRequest, WorkerResponse } from '../shared/types.ts';

/** The server's RPC API; binary protobuf over HTTP, resolved against the page's origin. */
export function createViewerClient(transport: Transport = createConnectTransport({ baseUrl: new URL('rpc', location.href).href, useBinaryFormat: true })) {
  return createClient(ViewerService, transport);
}

let defaultClient: ReturnType<typeof createViewerClient> | null = null;
/** Created on first use, so importing this module needs no browser `location`. */
const viewer = () => (defaultClient ??= createViewerClient());

/** Plain message for the UI ("not found" rather than "[not_found] not found"). */
function describe(e: unknown): Error {
  return e instanceof ConnectError ? new Error(e.rawMessage) : (e as Error);
}

function schematicOf(m: Schematic | undefined): ParsedSchematic {
  if (!m) throw new Error('Server sent no schematic');
  return fromProto(m);
}

export async function fetchList(): Promise<ListSchematicsResponse> {
  try {
    return await viewer().listSchematics({});
  } catch (e) {
    throw describe(e);
  }
}

/** Parse a schematic from the served folder. */
export async function fetchSchematic(path: string): Promise<ParsedSchematic> {
  try {
    return schematicOf((await viewer().getSchematic({ path })).schematic);
  } catch (e) {
    throw describe(e);
  }
}

/** Parse a dropped file (not in the served folder). */
export async function uploadSchematic(file: Blob): Promise<ParsedSchematic> {
  try {
    return schematicOf((await viewer().parseSchematic({ data: new Uint8Array(await file.arrayBuffer()) })).schematic);
  } catch (e) {
    throw describe(e);
  }
}

export const previewUrl = (path: string) => `api/preview?p=${encodeURIComponent(path)}`;

export async function fetchAssets(): Promise<BlockAssets> {
  const res = await fetch('assets/blocks.json');
  if (!res.ok) throw new Error('Block assets missing (run `bun run build:assets`)');
  return res.json();
}

type Pending = { resolve: (m: MeshData) => void; reject: (e: Error) => void };
/** Requests that expect a reply, without the id (assigned by `call`). */
type Call = Extract<WorkerRequest, { id: number }> extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

/** Request/response wrapper around the mesher worker. */
export class MesherClient {
  private readonly worker = new Worker('worker.js', { type: 'module' });
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** Set once the worker has crashed; every later call fails with it instead of hanging. */
  private fatal: Error | null = null;

  constructor(assets: BlockAssets) {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.type === 'error') p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.mesh);
    };
    this.worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      this.fail(new Error(`Mesh worker crashed: ${ev.message || 'unknown error'}`));
    };
    this.worker.onmessageerror = () => this.fail(new Error('Mesh worker sent an unreadable message'));
    this.worker.postMessage({ type: 'assets', assets } satisfies WorkerRequest);
  }

  private fail(err: Error): void {
    this.fatal = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private call(msg: Call, transfer: Transferable[] = []): Promise<MeshData> {
    if (this.fatal) return Promise.reject(this.fatal);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id } as WorkerRequest, transfer);
    });
  }

  /** Hand a schematic to the worker (it gets its own copy) and mesh all layers. */
  load({ dims, grid, palette, spawners }: BlockGrid): Promise<MeshData> {
    const copy = grid.slice();
    return this.call({ type: 'load', schematic: { dims, grid: copy, palette, spawners } }, [copy.buffer]);
  }

  mesh(yMin: number, yMax: number): Promise<MeshData> {
    return this.call({ type: 'mesh', yMin, yMax });
  }
}
