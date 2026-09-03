import { parse } from 'parse5';

import {
  createKlaviyoTemplate,
  findKlaviyoTemplatesByName,
  getKlaviyoFlowMessageContext,
  getKlaviyoTemplate,
  updateKlaviyoFlowAction,
  updateKlaviyoTemplate,
} from './klaviyo.js';

const UNSUBSCRIBE_LINK_RE = /href\s*=\s*["']\{% unsubscribe_link %\}["']/i;
const PROVIDER_REQUEST_INTERVAL_MS = 1000;

function desiredTemplate(template = {}) {
  return {
    id: String(template.id || '').trim(),
    flowSlot: template.flowSlot,
    name: String(template.templateName || '').trim().slice(0, 255),
    subject: String(template.subject || '').trim().slice(0, 255),
    previewText: String(template.previewText || '').trim().slice(0, 255),
    html: String(template.html || ''),
    text: String(template.text || ''),
  };
}

function canonicalCss(value = '') {
  return String(value)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}():;,>+~!])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function canonicalHtmlNode(node, parentTag = '') {
  if (node?.nodeName === '#text') {
    const value = parentTag === 'style'
      ? canonicalCss(node.value)
      : String(node.value || '').replace(/\s+/gu, ' ').trim();
    return value ? ['#text', value] : null;
  }
  if (node?.nodeName === '#comment') {
    return ['#comment', String(node.data || '').replace(/\s+/g, ' ').trim()];
  }
  if (node?.nodeName === '#documentType') return ['!doctype', 'html'];
  const attributes = (node?.attrs || [])
    .map((attribute) => [
      [attribute.prefix, attribute.name].filter(Boolean).join(':'),
      attribute.name === 'style' ? canonicalCss(attribute.value) : String(attribute.value || ''),
    ])
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
    ));
  const tag = node?.tagName || node?.nodeName || '';
  const children = (node?.childNodes || [])
    .map((child) => canonicalHtmlNode(child, tag))
    .filter(Boolean);
  return [tag, attributes, children];
}

function canonicalHtml(value) {
  try {
    return JSON.stringify(canonicalHtmlNode(parse(String(value || ''))));
  } catch {
    return String(value || '');
  }
}

function templateMatches(remote, desired) {
  const attributes = remote?.attributes || {};
  return String(attributes.name || '') === desired.name
    && canonicalHtml(attributes.html) === canonicalHtml(desired.html)
    && String(attributes.text || '') === desired.text;
}

function resultBase(desired, flowMessageId) {
  return {
    id: desired.id,
    templateName: desired.name,
    ...(flowMessageId ? { flowMessageId } : {}),
  };
}

function failed(desired, flowMessageId, error, extra = {}) {
  return {
    ...resultBase(desired, flowMessageId),
    ok: false,
    error,
    ...extra,
  };
}

function validEditor(remote) {
  return ['CODE', 'USER_DRAGGABLE'].includes(String(remote?.attributes?.editor_type || ''));
}

function flowContextParts(context, flowMessageId) {
  const flowMessage = context?.flowMessage;
  const flowAction = context?.flowAction;
  const flowDefinition = flowMessage?.attributes?.definition;
  const actionDefinition = flowAction?.attributes?.definition;
  const actionMessage = actionDefinition?.data?.message;
  if (String(flowMessage?.attributes?.channel || '').toLowerCase() !== 'email') {
    return { ok: false, error: 'klaviyo_flow_message_channel_incompatible' };
  }
  if (actionDefinition?.type !== 'send-email' || !actionMessage || typeof actionMessage !== 'object') {
    return { ok: false, error: 'klaviyo_flow_action_incompatible' };
  }
  if (!flowDefinition || typeof flowDefinition !== 'object') {
    return { ok: false, error: 'klaviyo_flow_message_definition_invalid' };
  }
  const expectedMessageId = String(flowMessageId || '');
  const messageIds = [flowDefinition.id, actionMessage.id].filter(Boolean).map(String);
  if (messageIds.some((id) => id !== expectedMessageId)) {
    return { ok: false, error: 'klaviyo_flow_message_binding_mismatch' };
  }
  const expectedTemplateId = String(context?.template?.id || '');
  const templateIds = [flowDefinition.template_id, actionMessage.template_id]
    .filter(Boolean)
    .map(String);
  if (!expectedTemplateId || templateIds.some((id) => id !== expectedTemplateId)) {
    return { ok: false, error: 'klaviyo_flow_template_binding_mismatch' };
  }
  return {
    ok: true,
    flowActionId: String(flowAction.id),
    templateId: expectedTemplateId,
    flowDefinition,
    actionDefinition,
    actionMessage,
  };
}

function messageMetadataMatches(parts, desired) {
  return [parts.flowDefinition, parts.actionMessage].every((message) => (
    String(message.subject_line || '') === desired.subject
    && String(message.preview_text || '') === desired.previewText
  ));
}

function definitionWithMessageMetadata(parts, desired, templateId) {
  return {
    ...parts.actionDefinition,
    data: {
      ...parts.actionDefinition.data,
      message: {
        ...parts.actionMessage,
        template_id: templateId,
        subject_line: desired.subject,
        preview_text: desired.previewText,
      },
    },
  };
}

function desiredTemplateError(desired, flowMessageId) {
  if (!desired.id || !desired.name || !desired.html.trim()) {
    return 'klaviyo_template_content_required';
  }
  if (!UNSUBSCRIBE_LINK_RE.test(desired.html)) return 'marketing_unsubscribe_required';
  if (flowMessageId && !desired.subject) return 'klaviyo_flow_message_subject_required';
  return '';
}

function incompatibleEditor(desired, flowMessageId, remote) {
  return failed(desired, flowMessageId, 'klaviyo_template_editor_incompatible', {
    templateId: String(remote?.id || ''),
    editorType: String(remote?.attributes?.editor_type || 'unknown'),
  });
}

async function inspectFlowTemplate(env, desired, flowMessageId, fetchImpl) {
  const context = await getKlaviyoFlowMessageContext(env, flowMessageId, { fetchImpl });
  if (!context.ok) return failed(desired, flowMessageId, context.error, { step: context.step });
  const flowParts = flowContextParts(context, flowMessageId);
  if (!flowParts.ok) {
    return failed(desired, flowMessageId, flowParts.error, {
      flowActionId: String(context.flowAction?.id || ''),
    });
  }
  const lookup = await findKlaviyoTemplatesByName(env, desired.name, { fetchImpl });
  if (!lookup.ok) return failed(desired, flowMessageId, lookup.error, { step: lookup.step });
  if (lookup.templates.length > 1) {
    return failed(desired, flowMessageId, 'klaviyo_template_name_ambiguous', {
      matches: lookup.templates.length,
    });
  }
  const [remote = null] = lookup.templates;
  if (remote && !validEditor(remote)) return incompatibleEditor(desired, flowMessageId, remote);
  return { ok: true, remote, boundTemplate: context.template, flowParts };
}

async function inspectStandaloneTemplate(env, desired, fetchImpl) {
  const lookup = await findKlaviyoTemplatesByName(env, desired.name, { fetchImpl });
  if (!lookup.ok) return failed(desired, '', lookup.error, { step: lookup.step });
  if (lookup.templates.length > 1) {
    return failed(desired, '', 'klaviyo_template_name_ambiguous', {
      matches: lookup.templates.length,
    });
  }
  const [remote = null] = lookup.templates;
  if (remote && !validEditor(remote)) return incompatibleEditor(desired, '', remote);
  return { ok: true, remote, flowParts: null };
}

function inspectRemoteTemplate(env, desired, flowMessageId, fetchImpl) {
  return flowMessageId
    ? inspectFlowTemplate(env, desired, flowMessageId, fetchImpl)
    : inspectStandaloneTemplate(env, desired, fetchImpl);
}

async function applyTemplateChange(env, desired, remote, fetchImpl) {
  const existingId = String(remote?.id || '');
  const mutation = remote
    ? await updateKlaviyoTemplate(env, {
      templateId: remote.id,
      name: desired.name,
      html: desired.html,
      text: desired.text,
      fetchImpl,
    })
    : await createKlaviyoTemplate(env, {
      name: desired.name,
      html: desired.html,
      text: desired.text,
      fetchImpl,
    });
  if (!mutation.ok) {
    return {
      ok: false,
      error: mutation.error,
      step: mutation.step,
      templateId: existingId,
      applied: false,
    };
  }
  const templateId = String(mutation.template.id || '');
  if (remote && templateId !== existingId) {
    return {
      ok: false,
      error: 'klaviyo_template_id_mismatch',
      templateId,
      applied: true,
    };
  }
  return { ok: true, templateId, applied: true };
}

async function verifyTemplateSync(env, desired, {
  flowMessageId,
  templateId,
  fetchImpl,
} = {}) {
  if (flowMessageId) {
    const readback = await getKlaviyoFlowMessageContext(env, flowMessageId, { fetchImpl });
    if (!readback.ok) return { ok: false, error: readback.error, step: readback.step };
    const readbackParts = flowContextParts(readback, flowMessageId);
    const matches = readbackParts.ok
      && templateMatches(readback.template, desired)
      && messageMetadataMatches(readbackParts, desired);
    return matches
      ? { ok: true }
      : { ok: false, error: 'klaviyo_flow_readback_mismatch' };
  }

  const readback = await getKlaviyoTemplate(env, templateId, { fetchImpl });
  if (!readback.ok) return { ok: false, error: readback.error, step: readback.step };
  return templateMatches(readback.template, desired)
    ? { ok: true }
    : { ok: false, error: 'klaviyo_template_readback_mismatch' };
}

export async function syncKlaviyoTemplate(env, template, {
  flowMessageId = '',
  apply = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const desired = desiredTemplate(template);
  const cleanFlowMessageId = String(flowMessageId || '').trim();
  const validationError = desiredTemplateError(desired, cleanFlowMessageId);
  if (validationError) return failed(desired, cleanFlowMessageId, validationError);

  const inspection = await inspectRemoteTemplate(
    env,
    desired,
    cleanFlowMessageId,
    fetchImpl,
  );
  if (!inspection.ok) return inspection;
  const { remote, boundTemplate, flowParts } = inspection;

  const templateChanged = !remote || !templateMatches(remote, desired);
  const templateBindingChanged = Boolean(
    flowParts && !templateMatches(boundTemplate, desired),
  );
  const messageMetadataChanged = Boolean(flowParts && !messageMetadataMatches(flowParts, desired));
  const action = flowParts
    ? (templateChanged || templateBindingChanged || messageMetadataChanged ? 'update' : 'noop')
    : (!remote ? 'create' : (templateChanged ? 'update' : 'noop'));
  const changes = {
    template: templateChanged,
    ...(flowParts ? { templateBinding: templateBindingChanged } : {}),
    messageMetadata: messageMetadataChanged,
  };
  const base = {
    ...resultBase(desired, cleanFlowMessageId),
    ok: true,
    action,
    applied: false,
    templateId: String(remote?.id || ''),
    ...(flowParts ? { flowActionId: flowParts.flowActionId } : {}),
    changes,
  };
  if (!apply || action === 'noop') {
    return { ...base, verified: action === 'noop' };
  }

  const appliedChanges = {
    template: false,
    ...(flowParts ? { templateBinding: false } : {}),
    messageMetadata: false,
  };
  let templateId = String(remote?.id || '');
  if (templateChanged) {
    const mutation = await applyTemplateChange(env, desired, remote, fetchImpl);
    if (!mutation.ok) {
      return failed(desired, cleanFlowMessageId, mutation.error, {
        action,
        step: mutation.step,
        templateId: mutation.templateId,
        applied: mutation.applied,
        appliedChanges: { ...appliedChanges, template: mutation.applied },
      });
    }
    templateId = mutation.templateId;
    appliedChanges.template = true;
  }

  if (templateBindingChanged || messageMetadataChanged) {
    const mutation = await updateKlaviyoFlowAction(env, {
      flowActionId: flowParts.flowActionId,
      definition: definitionWithMessageMetadata(flowParts, desired, templateId),
      fetchImpl,
    });
    if (!mutation.ok) {
      return failed(desired, cleanFlowMessageId, mutation.error, {
        action,
        applied: appliedChanges.template,
        appliedChanges,
        step: mutation.step,
        templateId,
        flowActionId: flowParts.flowActionId,
      });
    }
    appliedChanges.templateBinding = templateBindingChanged;
    appliedChanges.messageMetadata = messageMetadataChanged;
  }

  const verification = await verifyTemplateSync(env, desired, {
    flowMessageId: cleanFlowMessageId,
    templateId,
    fetchImpl,
  });
  if (!verification.ok) {
    return failed(desired, cleanFlowMessageId, verification.error, {
      action,
      applied: true,
      appliedChanges,
      ...(verification.step ? { step: verification.step } : {}),
      templateId,
      ...(flowParts ? { flowActionId: flowParts.flowActionId } : {}),
    });
  }
  return {
    ...base,
    applied: true,
    appliedChanges,
    verified: true,
    templateId,
  };
}

function bindingIds(bindings, template) {
  const supplied = bindings?.[template.id] ?? bindings?.[String(template.flowSlot)];
  const values = Array.isArray(supplied) ? supplied : supplied ? [supplied] : [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function pacedFetch(fetchImpl, sleepImpl) {
  let first = true;
  return async (...args) => {
    if (!first) await sleepImpl(PROVIDER_REQUEST_INTERVAL_MS);
    first = false;
    return fetchImpl(...args);
  };
}

export async function syncKlaviyoTemplateSet(env, templates, {
  bindings = {},
  apply = false,
  fetchImpl = globalThis.fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const items = [];
  const selected = Array.isArray(templates) ? templates : [];
  const providerFetch = pacedFetch(fetchImpl, sleepImpl);
  for (const template of selected) {
    if (template.flowSlot != null) {
      const ids = bindingIds(bindings, template);
      if (!ids.length) {
        items.push(failed(desiredTemplate(template), '', 'klaviyo_flow_binding_required'));
        continue;
      }
      for (let index = 0; index < ids.length; index += 1) {
        items.push(await syncKlaviyoTemplate(env, template, {
          flowMessageId: ids[index], apply, fetchImpl: providerFetch,
        }));
      }
    } else {
      items.push(await syncKlaviyoTemplate(env, template, { apply, fetchImpl: providerFetch }));
    }
  }
  const counts = items.reduce((summary, item) => {
    const key = item.ok ? item.action : 'error';
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, { create: 0, update: 0, noop: 0, error: 0 });
  return {
    ok: selected.length > 0 && items.every((item) => item.ok),
    provider: 'klaviyo',
    dryRun: !apply,
    counts,
    items,
  };
}
