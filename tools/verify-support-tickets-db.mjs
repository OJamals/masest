#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const phases = [
  ['delivery-effects', new URL('./verify-support-delivery-effects.mjs', import.meta.url)],
  ['ticket-queue', new URL('./verify-support-ticket-queue.mjs', import.meta.url)],
];

async function main() {
  const startedAt = performance.now();
  const results = [];
  for (const [name, scriptUrl] of phases) {
    const phaseStartedAt = performance.now();
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [scriptUrl.pathname], {
        env: process.env,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 180_000,
        killSignal: 'SIGTERM',
      });
      if (stdout.trim()) process.stdout.write(`${stdout.trim()}\n`);
      if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
      results.push({ name, status: 'passed', duration_ms: Math.round(performance.now() - phaseStartedAt) });
    } catch (error) {
      if (error.stdout?.trim()) process.stdout.write(`${error.stdout.trim()}\n`);
      if (error.stderr?.trim()) process.stderr.write(`${error.stderr.trim()}\n`);
      const durationMs = Math.round(performance.now() - phaseStartedAt);
      throw new Error(`${name} support database proof failed after ${durationMs}ms: ${error.message}`);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    phases: results,
    total_duration_ms: Math.round(performance.now() - startedAt),
  }));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
