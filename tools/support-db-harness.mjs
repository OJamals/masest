import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const SUPPORTED_POSTGRES_MAJORS = new Set([16, 17, 18]);
const OWNED_PREFIX = 'masest-support-';

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function postgresServerOptions({ port, socketDir }) {
  return `-F -h 127.0.0.1 -p ${port} -k ${shellQuote(socketDir)}`;
}

function startupLogDetail(logFile) {
  try {
    const detail = readFileSync(logFile, 'utf8')
      .replace(/[^\t\n\r\x20-\x7e]/g, '?')
      .trim();
    return detail.slice(-4_000);
  } catch {
    return '';
  }
}

export function runPostgresCommand(binary, args, { timeoutMs = 30_000 } = {}) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(`${binary} ${args.join(' ')} failed: ${detail}`);
  }
}

export function checkOwnedPostgresStatus(pgCtl, dataDir, { runCommand = execFileSync } = {}) {
  try {
    runCommand(pgCtl, ['-D', dataDir, 'status'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
    });
    return 'running';
  } catch (error) {
    return error?.status === 3 ? 'stopped' : 'unknown';
  }
}

function requireExecutable(path, name) {
  try {
    accessSync(path, fsConstants.X_OK);
  } catch {
    throw new Error(`PostgreSQL harness prerequisite failed: ${path} (${name}) is not executable`);
  }
}

function parseMajor(version) {
  const match = version.match(/PostgreSQL\)\s+(\d+)(?:\.|\s|$)/i);
  return match ? Number(match[1]) : null;
}

export async function discoverPostgresBinaries({ env = process.env } = {}) {
  let bindir = env.PG_BIN;
  if (!bindir) {
    try {
      bindir = runPostgresCommand('pg_config', ['--bindir']).trim();
    } catch (error) {
      throw new Error(`PostgreSQL harness prerequisite failed: set PG_BIN to a supported PostgreSQL 16, 17, or 18 binary directory; ${error.message}`);
    }
  }

  const binaries = Object.fromEntries(['initdb', 'pg_ctl', 'postgres'].map((name) => [name, join(bindir, name)]));
  for (const [name, path] of Object.entries(binaries)) requireExecutable(path, name);

  const versions = Object.entries(binaries).map(([name, path]) => {
    const version = runPostgresCommand(path, ['--version']).trim();
    const major = parseMajor(version);
    if (!major) throw new Error(`PostgreSQL harness prerequisite failed: could not parse ${name} version from ${version}`);
    return { name, major, version };
  });
  const major = versions[0].major;
  if (versions.some((item) => item.major !== major)) {
    throw new Error(`PostgreSQL harness prerequisite failed: mixed PostgreSQL binary majors in ${bindir}`);
  }
  if (!SUPPORTED_POSTGRES_MAJORS.has(major)) {
    throw new Error(`PostgreSQL harness prerequisite failed: unsupported PostgreSQL major ${major}; supported majors: 16, 17, 18`);
  }

  return { bindir, ...binaries, major };
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

function assertOwnedDirectory(tempDir) {
  const resolvedTemp = resolve(tempDir);
  if (dirname(resolvedTemp) !== resolve(tmpdir()) || !basename(resolvedTemp).startsWith(OWNED_PREFIX)) {
    throw new Error(`refusing cleanup of non-owned PostgreSQL directory: ${tempDir}`);
  }
}

export async function cleanupOwnedPostgres(cluster, dependencies = {}) {
  const runCommand = dependencies.runCommand || runPostgresCommand;
  const remove = dependencies.remove || rm;
  assertOwnedDirectory(cluster.tempDir);
  if (cluster.started) {
    try {
      runCommand(cluster.pgCtl, ['-D', cluster.dataDir, '-m', 'fast', '-w', 'stop']);
      cluster.started = false;
    } catch (error) {
      throw new Error(`owned PostgreSQL cleanup failed; preserved ${cluster.tempDir}: ${error.message}`);
    }
  }
  await remove(cluster.tempDir, { recursive: true, force: true });
}

function cleanupOwnedPostgresOnSignal(cluster, signal) {
  try {
    assertOwnedDirectory(cluster.tempDir);
    if (cluster.started) {
      runPostgresCommand(cluster.pgCtl, ['-D', cluster.dataDir, '-m', 'fast', '-w', 'stop'], { timeoutMs: 15_000 });
      cluster.started = false;
    }
    rmSync(cluster.tempDir, { recursive: true, force: true });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  } catch (error) {
    process.stderr.write(`owned PostgreSQL cleanup failed; preserved ${cluster.tempDir}: ${error.message}\n`);
    process.exit(1);
  }
}

export async function startOwnedPostgres({
  prefix = 'masest-support-db-',
  env = process.env,
  statementTimeoutMs = 15_000,
  lockTimeoutMs = 5_000,
  connectionTimeoutMs = 5_000,
} = {}) {
  if (!prefix.startsWith(OWNED_PREFIX)) throw new Error(`owned PostgreSQL prefix must start with ${OWNED_PREFIX}`);
  const binaries = await discoverPostgresBinaries({ env });
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  const cluster = {
    tempDir,
    dataDir: join(tempDir, 'data'),
    logFile: join(tempDir, 'postgres.log'),
    pgCtl: binaries.pg_ctl,
    major: binaries.major,
    started: false,
  };

  try {
    cluster.port = await freeLoopbackPort();
    runPostgresCommand(binaries.initdb, [
      '-D', cluster.dataDir, '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8',
    ]);
    runPostgresCommand(cluster.pgCtl, [
      '-D', cluster.dataDir, '-l', cluster.logFile, '-o', postgresServerOptions({
        port: cluster.port,
        socketDir: cluster.tempDir,
      }), '-w', 'start',
    ]);
    cluster.started = true;
  } catch (startError) {
    const logDetail = startupLogDetail(cluster.logFile);
    const reportedStartError = logDetail
      ? new Error(`${startError.message}\nPostgreSQL startup log:\n${logDetail}`)
      : startError;
    const status = checkOwnedPostgresStatus(cluster.pgCtl, cluster.dataDir);
    if (status === 'stopped') {
      await rm(tempDir, { recursive: true, force: true });
      throw reportedStartError;
    }
    if (status === 'unknown') {
      throw new AggregateError([reportedStartError], `PostgreSQL start failed and owned status is unknown; preserved ${tempDir}`);
    }
    cluster.started = true;
    try {
      await cleanupOwnedPostgres(cluster);
    } catch (cleanupError) {
      throw new AggregateError([reportedStartError, cleanupError], `PostgreSQL start failed and owned cleanup was not confirmed; preserved ${tempDir}`);
    }
    throw reportedStartError;
  }

  cluster.clientConfig = {
    host: '127.0.0.1',
    port: cluster.port,
    user: 'postgres',
    database: 'postgres',
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: statementTimeoutMs + 1_000,
    options: `-c statement_timeout=${statementTimeoutMs} -c lock_timeout=${lockTimeoutMs} -c idle_in_transaction_session_timeout=${statementTimeoutMs}`,
  };
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => cleanupOwnedPostgresOnSignal(cluster, signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  cluster.stop = async () => {
    try {
      await cleanupOwnedPostgres(cluster);
    } finally {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    }
  };
  return cluster;
}

export async function withOwnedPostgres(options, callback) {
  const cluster = await startOwnedPostgres(options);
  let callbackError;
  try {
    options?.onStarted?.(cluster);
    return await callback(cluster);
  } catch (error) {
    callbackError = error;
    throw error;
  } finally {
    try {
      await cluster.stop();
    } catch (cleanupError) {
      if (callbackError) {
        throw new AggregateError([callbackError, cleanupError], cleanupError.message);
      }
      throw cleanupError;
    }
  }
}
