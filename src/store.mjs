import { resolve, join } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { AgentError, atomicJSON, ensureDir, readJSON, safeId } from './common.mjs';
export class Store {
  constructor(root, id) { this.dir = resolve(root, safeId(id)); this.statePath = join(this.dir, 'state.json'); }
  async lock() {
    await ensureDir(this.dir);
    try { this.handle = await open(join(this.dir, '.lock'), 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw new AgentError('RUN_LOCKED', '任务正在运行；若进程崩溃，请确认无存活进程后手动移除该任务 .lock'); throw e; }
  }
  async unlock() { if (this.handle) { await this.handle.close(); await unlink(join(this.dir, '.lock')); this.handle = null; } }
  async load() { try { return await readJSON(this.statePath); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async save(state) { await atomicJSON(this.statePath, state); }
  get artifactPath() { return join(this.dir, 'plan.json'); }
  async saveArtifact(plan) { await atomicJSON(this.artifactPath, plan); }
}
