import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RequestBodyTooLargeError,
  readBoundedBytes,
  readBoundedFormData,
  readBoundedJson,
} from '../functions/_lib/request-body.js';

const encoder = new TextEncoder();

test('declared oversized bodies are rejected before the stream is consumed', async () => {
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(encoder.encode('too large'));
      controller.close();
    },
  });
  const request = new Request('https://masest.co/api/test', {
    method: 'POST',
    headers: { 'content-length': '9' },
    body,
    duplex: 'half',
  });

  await assert.rejects(
    readBoundedBytes(request, 8),
    (error) => error instanceof RequestBodyTooLargeError && error.code === 'request_too_large',
  );
  assert.equal(request.body.locked, false);
});

test('streamed bodies without content-length are canceled when they cross the cap', async () => {
  let index = 0;
  let canceled = false;
  const chunks = [encoder.encode('1234'), encoder.encode('56789')];
  const request = new Request('https://masest.co/api/test', {
    method: 'POST',
    body: new ReadableStream({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel() {
        canceled = true;
      },
    }),
    duplex: 'half',
  });

  await assert.rejects(
    readBoundedBytes(request, 8),
    (error) => error instanceof RequestBodyTooLargeError && error.code === 'request_too_large',
  );
  assert.equal(canceled, true);
});

test('a false low content-length cannot bypass the streamed byte cap', async () => {
  let canceled = false;
  const request = new Request('https://masest.co/api/test', {
    method: 'POST',
    headers: { 'content-length': '1' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('123456789'));
      },
      cancel() {
        canceled = true;
      },
    }),
    duplex: 'half',
  });

  await assert.rejects(readBoundedBytes(request, 8), RequestBodyTooLargeError);
  assert.equal(canceled, true);
});

test('JSON whose encoded bytes equal the cap succeeds', async () => {
  const source = '{"ok":true}';
  const request = new Request('https://masest.co/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: source,
  });

  assert.deepEqual(await readBoundedJson(request, encoder.encode(source).byteLength), { ok: true });
});

test('under-cap JSON succeeds and malformed JSON remains a parse error', async () => {
  const valid = new Request('https://masest.co/api/test', {
    method: 'POST',
    body: '{"name":"Ava"}',
  });
  assert.deepEqual(await readBoundedJson(valid, 64), { name: 'Ava' });

  const malformed = new Request('https://masest.co/api/test', {
    method: 'POST',
    body: '{"name":',
  });
  await assert.rejects(readBoundedJson(malformed, 64), SyntaxError);
});

test('under-cap URL-encoded form data preserves repeated fields', async () => {
  const request = new Request('https://masest.co/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'product=VK100&product=VK200&name=Ava',
  });

  const form = await readBoundedFormData(request, 64);
  assert.deepEqual(form.getAll('product'), ['VK100', 'VK200']);
  assert.equal(form.get('name'), 'Ava');
});

test('under-cap multipart form data preserves repeated fields', async () => {
  const source = new FormData();
  source.append('product', 'VK100');
  source.append('product', 'VK200');
  source.append('name', 'Ava');
  const request = new Request('https://masest.co/api/test', {
    method: 'POST',
    body: source,
  });

  const form = await readBoundedFormData(request, 4 * 1024);
  assert.deepEqual(form.getAll('product'), ['VK100', 'VK200']);
  assert.equal(form.get('name'), 'Ava');
});
