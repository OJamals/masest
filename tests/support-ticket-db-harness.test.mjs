import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

import {
  cleanupOwnedPostgres,
  checkOwnedPostgresStatus,
  discoverPostgresBinaries,
  runPostgresCommand,
  withOwnedPostgres,
} from '../tools/support-db-harness.mjs';

const { Client } = pg;
const LOCAL_PG_BIN = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@18/bin';

test('explicit PG_BIN fails closed with one actionable missing-binary error', async () => {
  const fakeBin = await mkdtemp(join(tmpdir(), 'masest-pg-missing-'));
  try {
    await assert.rejects(
      discoverPostgresBinaries({ env: { PG_BIN: fakeBin } }),
      new RegExp(`PostgreSQL harness prerequisite failed:.*${fakeBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*initdb`, 's'),
    );
  } finally {
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test('explicit PG_BIN rejects unsupported PostgreSQL without falling back', async () => {
  const fakeBin = await mkdtemp(join(tmpdir(), 'masest-pg-version-'));
  try {
    for (const name of ['initdb', 'pg_ctl', 'postgres']) {
      const path = join(fakeBin, name);
      await import('node:fs/promises').then(({ writeFile, chmod }) =>
        writeFile(path, '#!/bin/sh\necho "postgres (PostgreSQL) 15.9"\n').then(() => chmod(path, 0o700)));
    }
    await assert.rejects(
      discoverPostgresBinaries({ env: { PG_BIN: fakeBin } }),
      /unsupported PostgreSQL major 15.*supported majors: 16, 17, 18/i,
    );
  } finally {
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test('PostgreSQL subprocess errors retain the command and bounded failure detail', () => {
  assert.throws(
    () => runPostgresCommand(process.execPath, ['-e', 'process.stderr.write("proof failure"); process.exit(7)'], { timeoutMs: 2_000 }),
    /node.*proof failure/i,
  );
});

test('only pg_ctl status 3 confirms that an owned cluster is stopped', () => {
  const statusError = Object.assign(new Error('not running'), { status: 3 });
  assert.equal(checkOwnedPostgresStatus('/proof/pg_ctl', '/proof/data', {
    runCommand() { throw statusError; },
  }), 'stopped');
  assert.equal(checkOwnedPostgresStatus('/proof/pg_ctl', '/proof/data', {
    runCommand() { throw Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }); },
  }), 'unknown');
  assert.equal(checkOwnedPostgresStatus('/proof/pg_ctl', '/proof/data', {
    runCommand() { throw new Error('missing executable'); },
  }), 'unknown');
});

test('stop failure preserves the exact owned directory and reports it', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'masest-support-stop-proof-'));
  let removed = false;
  await assert.rejects(
    cleanupOwnedPostgres({
      tempDir: owned,
      dataDir: join(owned, 'data'),
      pgCtl: '/proof/pg_ctl',
      started: true,
    }, {
      runCommand() { throw new Error('forced stop failure'); },
      async remove() { removed = true; },
    }),
    new RegExp(`cleanup failed; preserved ${owned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.equal(removed, false);
  await access(owned, fsConstants.F_OK);
  await rm(owned, { recursive: true, force: true });
});

test('a real failed assertion still removes its owned PostgreSQL cluster', async () => {
  let owned;
  await assert.rejects(
    withOwnedPostgres({
      prefix: 'masest-support-assertion-proof-',
      env: { ...process.env, PG_BIN: LOCAL_PG_BIN },
      onStarted(cluster) { owned = cluster.tempDir; },
    }, async () => {
      assert.equal('actual', 'expected', 'intentional cleanup assertion');
    }),
    /intentional cleanup assertion/,
  );
  assert.ok(owned);
  await assert.rejects(access(owned, fsConstants.F_OK), /ENOENT/);
});

test('a failing onStarted hook still removes its owned PostgreSQL cluster', async () => {
  let owned;
  await assert.rejects(withOwnedPostgres({
    prefix: 'masest-support-hook-proof-',
    env: { ...process.env, PG_BIN: LOCAL_PG_BIN },
    onStarted(cluster) {
      owned = cluster.tempDir;
      throw new Error('intentional hook failure');
    },
  }, async () => {}), /intentional hook failure/);
  await assert.rejects(access(owned, fsConstants.F_OK), /ENOENT/);
});

test('an outer SIGTERM stops and removes the child-owned cluster', async () => {
  const harnessUrl = new URL('../tools/support-db-harness.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { startOwnedPostgres } from ${JSON.stringify(harnessUrl)};
    const cluster = await startOwnedPostgres({
      prefix: 'masest-support-signal-proof-',
      env: { ...process.env, PG_BIN: ${JSON.stringify(LOCAL_PG_BIN)} },
    });
    process.stdout.write(JSON.stringify({ tempDir: cluster.tempDir }) + '\\n');
    setInterval(() => {}, 60_000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  await Promise.race([
    (async () => { while (!output.includes('\n')) await once(child.stdout, 'data'); })(),
    once(child, 'exit').then(([code, signal]) => { throw new Error(`child exited before ready: ${code ?? signal}`); }),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('child readiness timed out')), 10_000);
      timer.unref();
    }),
  ]);
  const { tempDir } = JSON.parse(output.trim());
  assert.equal(child.kill('SIGTERM'), true);
  const [code, signal] = await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('child cleanup timed out')), 20_000);
      timer.unref();
    }),
  ]);
  assert.equal(signal, null);
  assert.equal(code, 143);
  await assert.rejects(access(tempDir, fsConstants.F_OK), /ENOENT/);
});

test('real connections enforce statement and lock timeouts', async () => {
  await withOwnedPostgres({
    prefix: 'masest-support-timeout-proof-',
    env: { ...process.env, PG_BIN: LOCAL_PG_BIN },
    statementTimeoutMs: 300,
    lockTimeoutMs: 200,
  }, async (cluster) => {
    const first = new Client(cluster.clientConfig);
    const second = new Client(cluster.clientConfig);
    try {
      await Promise.all([first.connect(), second.connect()]);
      await assert.rejects(first.query('select pg_sleep(2)'), /statement timeout/i);
      await first.query('create table proof_lock(id integer primary key); insert into proof_lock values (1)');
      await first.query('begin');
      await first.query('update proof_lock set id=id where id=1');
      await assert.rejects(second.query('update proof_lock set id=id where id=1'), /lock timeout/i);
      await first.query('rollback');
    } finally {
      await first.query('rollback').catch(() => {});
      await Promise.all([first.end().catch(() => {}), second.end().catch(() => {})]);
    }
  });
});
