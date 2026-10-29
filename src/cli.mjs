#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runAgent } from './agent.mjs';
import { LiveModel, MockModel } from './model.mjs';
import { AgentError, readJSON } from './common.mjs';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, provider: { type: 'string', default: 'live' },
    root: { type: 'string', default: '.runs' }, output: { type: 'string' },
    'max-steps': { type: 'string', default: '16' }, 'max-tool-calls': { type: 'string', default: '16' },
    faults: { type: 'string' }, now: { type: 'string' }, preference: { type: 'string', default: '' }, help: { type: 'boolean' }
  } });
  if (values.help || !values.input) {
    console.log('node [--env-file=.env] src/cli.mjs --input examples/inputs/normal.json --provider live|mock [--root .runs] [--output result.json] [--max-steps 16] [--max-tool-calls 16] [--faults examples/faults/script-once.json] [--now ISO_TIME] [--preference TEXT]\n默认 live；--now 仅用于可复现模拟时钟。退出码：0完成，2未完成/待补充，1配置或输入错误。');
    process.exitCode = values.help ? 0 : 1;
  } else {
    if (!['live', 'mock'].includes(values.provider)) throw new AgentError('INVALID_PROVIDER', 'provider 只允许 live 或 mock');
    const timestamp = values.now ? Date.parse(values.now) : null;
    if (values.now && !Number.isFinite(timestamp)) throw new AgentError('INVALID_CLOCK', '--now 必须为合法时间');
    const input = await readJSON(resolve(values.input));
    const faults = values.faults ? await readJSON(resolve(values.faults)) : {};
    const result = await runAgent(input, {
      model: values.provider === 'live' ? new LiveModel() : new MockModel(), root: resolve(values.root),
      maxSteps: Number(values['max-steps']), maxToolCalls: Number(values['max-tool-calls']), faults,
      now: values.now ? () => timestamp : () => Date.now(), preference: values.preference
    });
    const text = JSON.stringify(result, null, 2) + '\n';
    if (values.output) await writeFile(resolve(values.output), text);
    console.log(text);
    process.exitCode = result.status === 'completed' ? 0 : 2;
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'error', code: error instanceof AgentError ? error.code : 'IO_ERROR', message: error instanceof AgentError ? error.message : '文件读取、JSON格式或命令行参数错误；请检查命令与输入文件' }));
  process.exitCode = 1;
}
