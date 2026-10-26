// Finds .litematic files and reads their metadata and preview thumbnails.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { asCompound, asNumber, asNumbers, asString, parseNbt } from './nbt.ts';
import { create } from '@bufbuild/protobuf';
import { DimsSchema, SchematicInfoSchema, type SchematicInfo } from '../gen/litematic/v1/viewer_pb.ts';
import { encodePng } from './png.ts';

interface CacheEntry {
  info: SchematicInfo;
  preview: Int32Array | null;
}

export class SchematicIndex {
  private readonly cache = new Map<string, CacheEntry>();
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(root);
  }

  /** Relative paths of all .litematic files below the root (follows symlinks, survives loops). */
  private findFiles(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (dir: string) => {
      let real: string;
      try {
        real = realpathSync(dir);
      } catch {
        return;
      }
      if (seen.has(real)) return;
      seen.add(real);
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        let isDir = ent.isDirectory(), isFile = ent.isFile();
        if (ent.isSymbolicLink()) {
          try {
            const st = statSync(p);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue;
          }
        }
        if (isDir) walk(p);
        else if (isFile && ent.name.toLowerCase().endsWith('.litematic')) out.push(relative(this.root, p));
      }
    };
    walk(this.root);
    return out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  list(): SchematicInfo[] {
    return this.findFiles().map((rel) => this.entry(rel).info);
  }

  /** Resolve a client-supplied relative path; null unless it is a file inside the root. */
  resolve(rel: string | undefined | null): string | null {
    if (!rel) return null;
    let full: string;
    try {
      full = realpathSync(join(this.root, rel));
    } catch {
      return null;
    }
    if (!full.startsWith(this.root + '/') || !statSync(full).isFile()) return null;
    return relative(this.root, full);
  }

  read(rel: string): Uint8Array {
    return readFileSync(join(this.root, rel));
  }

  previewPng(rel: string): Uint8Array | null {
    const pix = this.entry(rel).preview;
    if (!pix) return null;
    const side = Math.floor(Math.sqrt(pix.length));
    const data = new Uint8Array(side * side * 4);
    for (let i = 0; i < side * side; i++) {
      const v = pix[i]; // ARGB
      data[i * 4] = (v >> 16) & 255;
      data[i * 4 + 1] = (v >> 8) & 255;
      data[i * 4 + 2] = v & 255;
      data[i * 4 + 3] = (v >>> 24) & 255;
    }
    return encodePng({ width: side, height: side, data });
  }

  private entry(rel: string): CacheEntry {
    const full = join(this.root, rel);
    const st = statSync(full);
    const key = `${full}\0${st.mtimeMs}\0${st.size}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const raw = readFileSync(full);
    const info = create(SchematicInfoSchema, {
      path: rel,
      size: BigInt(st.size),
      mtime: st.mtimeMs / 1000,
      md5: createHash('md5').update(raw).digest('hex'),
    });
    let preview: Int32Array | null = null;
    try {
      const nbt = parseNbt(raw);
      const meta = asCompound(nbt.Metadata);
      const es = asCompound(meta.EnclosingSize);
      info.name = asString(meta.Name);
      info.author = asString(meta.Author);
      info.description = asString(meta.Description);
      info.dims = create(DimsSchema, { x: Math.abs(asNumber(es.x)), y: Math.abs(asNumber(es.y)), z: Math.abs(asNumber(es.z)) });
      info.blocks = asNumber(meta.TotalBlocks);
      info.regions = asNumber(meta.RegionCount, Object.keys(asCompound(nbt.Regions)).length);
      info.created = BigInt(asNumber(meta.TimeCreated));
      info.mcVersion = asNumber(nbt.MinecraftDataVersion);
      const pix = asNumbers(meta.PreviewImageData);
      if (pix?.length) {
        preview = Int32Array.from(pix);
        info.preview = true;
      }
    } catch (e) {
      info.error = e instanceof Error ? e.message : String(e);
    }
    const entry = { info, preview };
    this.cache.set(key, entry);
    return entry;
  }
}
