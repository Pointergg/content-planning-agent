import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function atomicJSON(path, value) {
  if (path instanceof URL) path = fileURLToPath(path);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path);
}
export async function ensureDir(path) { await mkdir(path, { recursive: true }); }
export class AgentError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export function safeId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id))
    throw new AgentError('INVALID_ID', 'id 只允许 1-64 位字母、数字、下划线或短横线');
  return id;
}
export function validateRequest(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AgentError('INVALID_INPUT', '输入必须是 JSON 对象');
  const missing = ['theme', 'budget', 'deadline'].filter(k => input[k] == null || input[k] === '');
  if (missing.length) return { missing };
  if (typeof input.theme !== 'string' || !input.theme.trim() || input.theme.length > 200)
    throw new AgentError('INVALID_THEME', '主题须为 1-200 字符');
  if (typeof input.budget !== 'number' || !Number.isFinite(input.budget) || input.budget < 0 || input.budget > 1000000 || Math.abs(input.budget * 100 - Math.round(input.budget * 100)) > 1e-8)
    throw new AgentError('INVALID_BUDGET', '预算须为非负有限数字，最多两位小数，上限1000000');
  if (typeof input.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(input.deadline) || !Number.isFinite(Date.parse(input.deadline)))
    throw new AgentError('INVALID_DEADLINE', '截止时间须为带时区的 ISO 8601 时间');
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(input.deadline);
  const zone = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(input.deadline);
  const offset = zone[1] === 'Z' ? 0 : (zone[2] === '+' ? 1 : -1) * (Number(zone[3]) * 60 + Number(zone[4]));
  const local = new Date(Date.parse(input.deadline) + offset * 60000).toISOString();
  if (!local.startsWith(`${parts[1]}T${parts[2]}`)) throw new AgentError('INVALID_DEADLINE', '截止日期不存在或时间非法');
  return { request: { theme: input.theme.trim(), budget: input.budget, deadline: new Date(input.deadline).toISOString() }, expired: Date.parse(input.deadline) <= now };
}
