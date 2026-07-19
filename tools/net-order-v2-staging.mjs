#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client, Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(root, 'supabase', 'schema-order-integrity.sql');

const ids = {
  companyA: '00000000-0000-4000-8000-000000000001',
  companyB: '00000000-0000-4000-8000-000000000002',
  companyC: '00000000-0000-4000-8000-000000000003',
  companyD: '00000000-0000-4000-8000-000000000004',
  userA: '10000000-0000-4000-8000-000000000001',
  userB: '10000000-0000-4000-8000-000000000002',
  userC: '10000000-0000-4000-8000-000000000003',
  userD: '10000000-0000-4000-8000-000000000004',
};

function run(binary, args) {
  try {
    return execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(`${binary} failed: ${detail}`, { cause: error });
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function item(sku, qty, unitPrice = 10) {
  return {
    sku,
    product_sku: sku.split('-')[0],
    name: `Test ${sku}`,
    qty,
    unit_price: unitPrice,
    line_total: qty * unitPrice,
  };
}

async function place(client, {
  companyId,
  userId,
  requestKey,
  items,
  subtotal = items.reduce((sum, line) => sum + line.line_total, 0),
  currency = 'usd',
  probe = false,
}) {
  const { rows } = await client.query(
    `select public.place_net_order_v2(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb, $6::numeric, $7::text, $8::boolean
     ) as result`,
    [companyId, userId, 'buyer@example.com', requestKey, JSON.stringify(items), subtotal, currency, probe],
  );
  return rows[0].result;
}

const fixture = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create type public.order_status as enum (
  'cart', 'pending_payment', 'paid', 'net_open', 'net_paid',
  'fulfilled', 'cancelled', 'refunded'
);
create type public.payment_method as enum ('stripe', 'net');
create type public.qbo_sync_status as enum ('pending', 'synced', 'failed');

create table public.companies (
  id uuid primary key,
  credit_limit numeric(12,2)
);

create table public.profiles (
  id uuid primary key,
  company_id uuid references public.companies(id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid references public.profiles(id),
  customer_email text,
  status public.order_status not null default 'cart',
  payment_method public.payment_method,
  qbo_sync_status public.qbo_sync_status not null default 'pending',
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'usd',
  stripe_payment_intent text,
  qbo_invoice_id text,
  ship_address jsonb,
  created_at timestamptz not null default now()
);

create table public.product_variants (
  vsku text primary key,
  currency text not null default 'usd',
  stock integer,
  track_stock boolean not null default false,
  allow_backorder boolean not null default false
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku text not null,
  product_sku text,
  name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null,
  backordered boolean not null default false
);
`;

const seed = `
insert into public.companies (id, credit_limit) values
  ('${ids.companyA}', 40),
  ('${ids.companyB}', 1000),
  ('${ids.companyC}', 1000),
  ('${ids.companyD}', 1000);

insert into public.profiles (id, company_id) values
  ('${ids.userA}', '${ids.companyA}'),
  ('${ids.userB}', '${ids.companyB}'),
  ('${ids.userC}', '${ids.companyC}'),
  ('${ids.userD}', '${ids.companyD}');

insert into public.product_variants
  (vsku, currency, stock, track_stock, allow_backorder)
values
  ('A-USD', 'usd', 10, true, false),
  ('B-LOW', 'usd', 1, true, false),
  ('C-BACKORDER', 'usd', 0, true, true),
  ('D-UNTRACKED', 'usd', null, false, false),
  ('E-EUR', 'eur', 10, true, false),
  ('F-ROLLBACK', 'usd', 5, true, false),
  ('X-LOCK', 'usd', 100, true, false),
  ('Y-LOCK', 'usd', 100, true, false);
`;

async function scalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return Object.values(rows[0])[0];
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'masest-net-v2-'));
  const dataDir = join(temp, 'data');
  const logPath = join(temp, 'postgres.log');
  const port = await freePort();
  let started = false;
  let client;
  let pool;

  try {
    run('initdb', ['-D', dataDir, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8']);
    try {
      run('pg_ctl', [
        '-D', dataDir,
        '-l', logPath,
        '-o', `-F -h 127.0.0.1 -p ${port}`,
        '-w', 'start',
      ]);
    } catch (error) {
      const log = await readFile(logPath, 'utf8').catch(() => '(postgres log unavailable)');
      throw new Error(`${error.message}\n${log}`, { cause: error });
    }
    started = true;

    const connection = {
      host: '127.0.0.1',
      port,
      database: 'postgres',
      user: 'postgres',
      options: '-c statement_timeout=5000',
    };
    client = new Client(connection);
    await client.connect();
    await client.query(fixture);
    await client.query(await readFile(migrationPath, 'utf8'));
    await client.query(seed);

    const signature = 'public.place_net_order_v2(uuid,uuid,text,text,jsonb,numeric,text,boolean)';
    assert.equal(await scalar(client,
      `select has_function_privilege('service_role', $1, 'EXECUTE')`, [signature]), true);
    assert.equal(await scalar(client,
      `select has_function_privilege('anon', $1, 'EXECUTE')`, [signature]), false);
    assert.equal(await scalar(client,
      `select has_function_privilege('authenticated', $1, 'EXECUTE')`, [signature]), false);

    const stockRejected = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'rollback-stock',
      items: [item('A-USD', 1), item('B-LOW', 2)],
    });
    assert.deepEqual(stockRejected, {
      rejected: true,
      reason: 'out_of_stock',
      skus: ['B-LOW'],
    });
    assert.equal(await scalar(client,
      `select count(*)::int from public.orders where company_id = $1`, [ids.companyA]), 0);
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'A-USD'`), 10);

    const creditRejected = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'rollback-credit',
      items: [item('A-USD', 5)],
    });
    assert.equal(creditRejected.reason, 'credit_limit_exceeded');
    assert.equal(await scalar(client,
      `select count(*)::int from public.orders where company_id = $1`, [ids.companyA]), 0);
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'A-USD'`), 10);

    const currencyRejected = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'rollback-currency',
      items: [item('E-EUR', 1)],
      currency: 'usd',
    });
    assert.equal(currencyRejected.reason, 'currency_mismatch');
    assert.equal(await scalar(client,
      `select count(*)::int from public.orders where company_id = $1`, [ids.companyA]), 0);

    await client.query(`update public.companies set credit_limit = 1000 where id = $1`, [ids.companyA]);
    await client.query(`
      create function public.force_net_order_v2_rollback()
      returns trigger
      language plpgsql
      as $$
      begin
        if old.vsku = 'F-ROLLBACK' then
          raise exception 'forced net order rollback';
        end if;
        return new;
      end;
      $$;

      create trigger force_net_order_v2_rollback
        before update of stock on public.product_variants
        for each row execute function public.force_net_order_v2_rollback();
    `);
    try {
      await assert.rejects(
        () => place(client, {
          companyId: ids.companyA,
          userId: ids.userA,
          requestKey: 'rollback-after-writes',
          items: [item('F-ROLLBACK', 1)],
        }),
        /forced net order rollback/,
      );
      assert.equal(await scalar(client,
        `select count(*)::int from public.orders where net_request_key = 'rollback-after-writes'`), 0);
      assert.equal(await scalar(client,
        `select count(*)::int from public.order_items where sku = 'F-ROLLBACK'`), 0);
      assert.equal(await scalar(client,
        `select stock from public.product_variants where vsku = 'F-ROLLBACK'`), 5);
    } finally {
      await client.query(`
        drop trigger force_net_order_v2_rollback on public.product_variants;
        drop function public.force_net_order_v2_rollback();
      `);
    }

    const logicalCart = [item('A-USD', 2), item('B-LOW', 1)];
    const first = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'response-loss',
      items: logicalCart,
    });
    const retry = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'response-loss',
      items: [...logicalCart].reverse(),
    });
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.order_id, first.order_id);
    const retryProbe = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'response-loss',
      items: logicalCart.map(({ sku, qty }) => ({ sku, qty })),
      subtotal: 0,
      currency: '',
      probe: true,
    });
    assert.equal(retryProbe.duplicate, true);
    assert.equal(retryProbe.order_id, first.order_id);
    assert.equal(await scalar(client,
      `select count(*)::int from public.orders where net_request_key = 'response-loss'`), 1);
    assert.equal(await scalar(client,
      `select count(*)::int from public.order_items where order_id = $1`, [first.order_id]), 2);
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'A-USD'`), 8);
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'B-LOW'`), 0);

    const conflict = await place(client, {
      companyId: ids.companyA,
      userId: ids.userA,
      requestKey: 'response-loss',
      items: [item('A-USD', 1)],
    });
    assert.deepEqual(conflict, { rejected: true, reason: 'request_key_conflict' });
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'A-USD'`), 8);

    const policy = await place(client, {
      companyId: ids.companyB,
      userId: ids.userB,
      requestKey: 'stock-policy',
      items: [item('C-BACKORDER', 2), item('D-UNTRACKED', 3)],
    });
    assert.equal(policy.rejected, false);
    const { rows: policyRows } = await client.query(
      `select sku, backordered from public.order_items where order_id = $1 order by sku`,
      [policy.order_id],
    );
    assert.deepEqual(policyRows, [
      { sku: 'C-BACKORDER', backordered: true },
      { sku: 'D-UNTRACKED', backordered: false },
    ]);
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'C-BACKORDER'`), 0);
    assert.equal(await scalar(client,
      `select stock from public.product_variants where vsku = 'D-UNTRACKED'`), null);

    pool = new Pool({ ...connection, max: 8 });
    const concurrentCart = [item('X-LOCK', 1), item('Y-LOCK', 1)];
    const concurrent = await Promise.all([
      place(pool, {
        companyId: ids.companyB,
        userId: ids.userB,
        requestKey: 'concurrent-duplicate',
        items: concurrentCart,
      }),
      place(pool, {
        companyId: ids.companyB,
        userId: ids.userB,
        requestKey: 'concurrent-duplicate',
        items: [...concurrentCart].reverse(),
      }),
    ]);
    assert.equal(concurrent.filter((result) => result.duplicate === false).length, 1);
    assert.equal(concurrent.filter((result) => result.duplicate === true).length, 1);
    assert.equal(concurrent[0].order_id, concurrent[1].order_id);
    assert.equal(await scalar(client,
      `select count(*)::int from public.orders where net_request_key = 'concurrent-duplicate'`), 1);

    const lockAttempts = [];
    for (let index = 0; index < 4; index += 1) {
      lockAttempts.push(
        place(pool, {
          companyId: ids.companyC,
          userId: ids.userC,
          requestKey: `sorted-a-${index}`,
          items: concurrentCart,
        }),
        place(pool, {
          companyId: ids.companyD,
          userId: ids.userD,
          requestKey: `sorted-b-${index}`,
          items: [...concurrentCart].reverse(),
        }),
      );
    }
    const lockResults = await Promise.all(lockAttempts);
    assert.equal(lockResults.every((result) => result.rejected === false), true);

    console.log('PASS privilege: service_role only');
    console.log('PASS rollback: rejection paths + forced failure after order/item inserts');
    console.log('PASS retry: same key/cart returns original; different cart rejects');
    console.log('PASS stock policy: backorder and untracked');
    console.log('PASS concurrency: duplicate + reversed-order cross-Company attempts');
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (client) await client.end().catch(() => {});
    if (started) {
      try {
        run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Temp directory cleanup below remains best-effort after a failed stop.
      }
    }
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
