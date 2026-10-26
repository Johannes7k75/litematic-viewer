// Web Worker: builds block meshes off the main thread. Parsing happens on the server.

import type { WorkerRequest, WorkerResponse } from '../shared/types.ts';
import { Atlas } from './mesher/blocks.ts';
import { Mesher, meshTransferables } from './mesher/mesh.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let atlas: Atlas | null = null;
let mesher: Mesher | null = null;

function reply(msg: WorkerResponse, transfer: ArrayBuffer[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'assets') {
    atlas = new Atlas(msg.assets);
    return;
  }
  try {
    if (!atlas) throw new Error('Block assets not loaded');
    if (msg.type === 'load') {
      mesher = new Mesher(atlas, msg.schematic);
      const mesh = mesher.build(0, msg.schematic.dims[1] - 1);
      reply({ type: 'mesh', id: msg.id, mesh }, meshTransferables(mesh));
    } else {
      if (!mesher) throw new Error('No schematic loaded');
      const mesh = mesher.build(msg.yMin, msg.yMax);
      reply({ type: 'mesh', id: msg.id, mesh }, meshTransferables(mesh));
    }
  } catch (e) {
    reply({ type: 'error', id: msg.id, error: e instanceof Error ? e.message : String(e) });
  }
};
