import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const msgs = readFileSync(new URL('../functions/api/admin/messages.js', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../functions/api/crisp/webhook.js', import.meta.url), 'utf8');

test('staff reply mirrors into the company Crisp session', () => {
  assert.match(msgs, /import \{ sendCrispMessage \} from '\.\.\/\.\.\/_lib\/crisp\.js'/);
  assert.match(msgs, /from\('crisp_sessions'\)[\s\S]*\.eq\('company_id', companyId\)/);
  assert.match(msgs, /sendCrispMessage\(env, \{ sessionId: sess\.session_id, text \}\)/);
});

test('webhook claims a pending dashboard reply instead of duplicating the echo', () => {
  assert.match(hook, /is\('external_message_id', null\)/);
  assert.match(hook, /\.update\(\{ external_message_id: externalMessageId, external_thread_id: sessionId, source: 'crisp' \}\)/);
  assert.match(hook, /return \{ routed: true, claimed: pending\.id \}/);
});
