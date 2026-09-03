import assert from 'node:assert/strict';
import test from 'node:test';

import {
  syncKlaviyoTemplate,
  syncKlaviyoTemplateSet,
} from '../functions/_lib/klaviyo-template-sync.js';

const env = { KLAVIYO_PRIVATE_KEY: 'pk_test' };
const desired = {
  id: 'strength-hmis',
  flowSlot: 1,
  templateName: 'MASEST Nurture 01 · Strength + HMIS 0-0-0',
  subject: 'Industrial strength without the hazard tradeoff',
  previewText: 'See why VertKleen pairs serious performance with HMIS 0-0-0.',
  html: '<html><a href="{% unsubscribe_link %}">Unsubscribe</a><p>New HTML</p></html>',
  text: 'New text\nUnsubscribe: {% unsubscribe_link %}',
};

const providerNormalizedHtml = '<html><head></head><body><a href="{% unsubscribe_link %}">Unsubscribe</a><p>New HTML</p></body></html>';

function response(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function remoteTemplate({ id = 'T1', name = desired.templateName, html = 'Old HTML', text = 'Old text' } = {}) {
  return { data: { type: 'template', id, attributes: { name, editor_type: 'CODE', html, text } } };
}

function remoteFlowContext({
  flowMessageId = 'M1',
  flowActionId = 'A1',
  template = remoteTemplate().data,
  subject = 'Old subject',
  previewText = 'Old preview',
} = {}) {
  const message = {
    id: flowMessageId,
    from_email: 'noreply@send.masest.co',
    from_label: 'MASEST',
    reply_to_email: 'support@masest.co',
    subject_line: subject,
    preview_text: previewText,
    template_id: template.id,
    smart_sending_enabled: true,
  };
  return {
    data: {
      type: 'flow-message',
      id: flowMessageId,
      attributes: { channel: 'email', definition: message },
      relationships: {
        'flow-action': { data: { type: 'flow-action', id: flowActionId } },
        template: { data: { type: 'template', id: template.id } },
      },
    },
    included: [
      template,
      {
        type: 'flow-action',
        id: flowActionId,
        attributes: {
          created: '2026-09-01T00:00:00Z',
          definition: {
            id: flowActionId,
            type: 'send-email',
            links: { next: 'NEXT' },
            data: { status: 'live', message },
          },
        },
      },
    ],
  };
}

test('dry run inspects a flow-bound template without mutating Klaviyo', async () => {
  const calls = [];
  const result = await syncKlaviyoTemplate(env, desired, {
    flowMessageId: 'M1',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' });
      if (String(url).includes('/api/templates?')) return response(200, { data: [] });
      return response(200, remoteFlowContext());
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'update');
  assert.equal(result.applied, false);
  assert.equal(result.templateId, '');
  assert.equal(result.flowActionId, 'A1');
  assert.deepEqual(result.changes, { template: true, templateBinding: true, messageMetadata: true });
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET']);
  const lookupUrl = new URL(calls[0].url);
  assert.equal(lookupUrl.pathname, '/api/flow-messages/M1');
  assert.equal(lookupUrl.searchParams.get('include'), 'flow-action,template');
});

test('flow apply creates a canonical template, rebinds the action, and never patches its flow-owned template', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    if (call.method === 'GET' && call.url.includes('/api/flow-messages/M1?') && calls.length === 1) {
      return response(200, remoteFlowContext());
    }
    if (call.method === 'GET' && call.url.includes('/api/templates?')) {
      return response(200, { data: [] });
    }
    if (call.method === 'POST' && call.url.endsWith('/api/templates')) {
      return response(201, remoteTemplate({ id: 'T2', html: providerNormalizedHtml, text: desired.text }));
    }
    if (call.method === 'PATCH' && call.url.endsWith('/api/flow-actions/A1')) {
      return response(200, {
        data: {
          type: 'flow-action',
          id: 'A1',
          attributes: { definition: call.body.data.attributes.definition },
        },
      });
    }
    if (call.method === 'GET' && call.url.includes('/api/flow-messages/M1?')) {
      return response(200, remoteFlowContext({
        template: remoteTemplate({ id: 'T3', html: providerNormalizedHtml, text: desired.text }).data,
        subject: desired.subject,
        previewText: desired.previewText,
      }));
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };

  const result = await syncKlaviyoTemplate(env, desired, {
    flowMessageId: 'M1',
    apply: true,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'update');
  assert.equal(result.applied, true);
  assert.equal(result.verified, true);
  assert.equal(result.templateId, 'T2');
  assert.deepEqual(result.changes, { template: true, templateBinding: true, messageMetadata: true });
  assert.deepEqual(result.appliedChanges, { template: true, templateBinding: true, messageMetadata: true });
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'POST', 'PATCH', 'GET']);
  assert.deepEqual(calls[2].body, {
    data: {
      type: 'template',
      attributes: {
        name: desired.templateName,
        editor_type: 'CODE',
        html: desired.html,
        text: desired.text,
      },
    },
  });
  assert.deepEqual(calls[3].body, {
    data: {
      type: 'flow-action',
      id: 'A1',
      attributes: {
        definition: {
          id: 'A1',
          type: 'send-email',
          links: { next: 'NEXT' },
          data: {
            status: 'live',
            message: {
              id: 'M1',
              from_email: 'noreply@send.masest.co',
              from_label: 'MASEST',
              reply_to_email: 'support@masest.co',
              subject_line: desired.subject,
              preview_text: desired.previewText,
              template_id: 'T2',
              smart_sending_enabled: true,
            },
          },
        },
      },
    },
  });
  assert.ok(calls.every(({ url }) => !url.endsWith('/api/templates/T1')));
  assert.ok(calls.every(({ url }) => !/campaign|send-job/.test(url)));
});

test('metadata-only apply patches no template content', async () => {
  const calls = [];
  const matchingTemplate = remoteTemplate({ html: desired.html, text: desired.text }).data;
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    if (call.method === 'GET' && calls.length === 1) {
      return response(200, remoteFlowContext({ template: matchingTemplate }));
    }
    if (call.method === 'GET' && call.url.includes('/api/templates?')) {
      return response(200, { data: [matchingTemplate] });
    }
    if (call.method === 'PATCH' && call.url.endsWith('/api/flow-actions/A1')) {
      return response(200, {
        data: { type: 'flow-action', id: 'A1', attributes: { definition: call.body.data.attributes.definition } },
      });
    }
    if (call.method === 'GET') {
      return response(200, remoteFlowContext({
        template: matchingTemplate,
        subject: desired.subject,
        previewText: desired.previewText,
      }));
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };

  const result = await syncKlaviyoTemplate(env, desired, {
    flowMessageId: 'M1',
    apply: true,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.changes, { template: false, templateBinding: false, messageMetadata: true });
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'PATCH', 'GET']);
  assert.ok(calls.every((call) => !(call.method === 'PATCH' && call.url.includes('/api/templates/'))));
});

test('apply creates a missing standalone template then verifies provider readback', async () => {
  const calls = [];
  const proof = { ...desired, id: 'proof-1', flowSlot: undefined, templateName: 'MASEST Proof Series 01' };
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    if (call.method === 'GET' && call.url.includes('/api/templates?')) return response(200, { data: [] });
    if (call.method === 'POST' && call.url.endsWith('/api/templates')) {
      return response(201, remoteTemplate({ id: 'T2', name: proof.templateName, html: providerNormalizedHtml, text: proof.text }));
    }
    if (call.method === 'GET' && call.url.endsWith('/api/templates/T2')) {
      return response(200, remoteTemplate({ id: 'T2', name: proof.templateName, html: providerNormalizedHtml, text: proof.text }));
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };

  const result = await syncKlaviyoTemplate(env, proof, { apply: true, fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'create');
  assert.equal(result.templateId, 'T2');
  assert.equal(result.verified, true);
  assert.equal(new URL(calls[0].url).searchParams.get('filter'), `equals(name,"${proof.templateName}")`);
  assert.equal(calls[1].body.data.attributes.editor_type, 'CODE');
  assert.ok(calls.every(({ url }) => !/campaign|send-job/.test(url)));
});

test('sync set fails closed when a nurture template lacks explicit flow bindings', async () => {
  let calls = 0;
  const result = await syncKlaviyoTemplateSet(env, [desired], {
    bindings: {},
    fetchImpl: async () => { calls += 1; },
    sleepImpl: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.items[0].error, 'klaviyo_flow_binding_required');
  assert.equal(calls, 0);
});

test('one nurture template can update multiple explicitly bound flow messages', async () => {
  const calls = [];
  const sleeps = [];
  const result = await syncKlaviyoTemplateSet(env, [desired], {
    bindings: { 'strength-hmis': ['M1', 'M2', 'M1'] },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' });
      if (String(url).includes('/api/templates?')) {
        return response(200, { data: [remoteTemplate({ html: desired.html, text: desired.text }).data] });
      }
      const flowMessageId = new URL(String(url)).pathname.split('/').at(-1);
      return response(200, remoteFlowContext({
        flowMessageId,
        flowActionId: `A-${flowMessageId}`,
        template: remoteTemplate({ html: desired.html, text: desired.text }).data,
        subject: desired.subject,
        previewText: desired.previewText,
      }));
    },
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { create: 0, update: 0, noop: 2, error: 0 });
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'GET', 'GET']);
  assert.deepEqual(sleeps, [1000, 1000, 1000]);
});

test('sync rejects malformed marketing templates before provider access', async () => {
  let calls = 0;
  const result = await syncKlaviyoTemplate(env, { ...desired, html: '<p>No opt-out</p>' }, {
    fetchImpl: async () => { calls += 1; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'marketing_unsubscribe_required');
  assert.equal(calls, 0);
});

test('flow sync fails closed when flow-action relationship cannot be resolved', async () => {
  const malformed = remoteFlowContext();
  malformed.included = malformed.included.filter((item) => item.type !== 'flow-action');

  const result = await syncKlaviyoTemplate(env, desired, {
    flowMessageId: 'M1',
    fetchImpl: async () => response(200, malformed),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'klaviyo_flow_context_invalid_response');
  assert.equal(result.step, 'get_flow_message_context');
});
