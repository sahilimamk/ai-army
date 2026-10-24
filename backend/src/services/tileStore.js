import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'custom-tiles.json');

async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(tiles) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(tiles, null, 2) + '\n');
}

function validateTile({ name, url, param }) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (!url || !String(url).trim()) throw new Error('url is required');
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new Error('url is not valid');
  }
  if (u.protocol !== 'https:') throw new Error('only https:// URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are rejected');
  const allowedParams = ['q', 'prompt', 'text', 'none'];
  if (param && !allowedParams.includes(param)) throw new Error(`param must be one of ${allowedParams.join(', ')}`);
  return { name: String(name).trim(), url: u.toString(), param: param || 'none' };
}

export const tileStore = {
  list: readAll,
  async add(input) {
    const clean = validateTile(input);
    const tiles = await readAll();
    const tile = { id: crypto.randomUUID(), ...clean };
    tiles.push(tile);
    await writeAll(tiles);
    return tile;
  },
  async remove(id) {
    const tiles = await readAll();
    const next = tiles.filter((t) => t.id !== id);
    if (next.length === tiles.length) {
      const err = new Error('tile not found');
      err.status = 404;
      throw err;
    }
    await writeAll(next);
  },
};
