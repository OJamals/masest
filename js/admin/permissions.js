const ROLE_LABELS = Object.freeze({
  owner: 'Owner',
  finance: 'Finance',
  support: 'Support',
  read_only: 'Read only',
});

const CAPABILITY_LABELS = Object.freeze({
  'admin.write': 'staff write access',
  'order.write': 'order editing access',
  'order.delete': 'owner access',
  'order.refund': 'finance or owner access',
  'company.credit': 'finance or owner access',
  'company.view_as': 'support, finance, or owner access',
  'product.write': 'owner catalog access',
  'content.assets': 'owner asset access',
  'content.publish': 'owner publishing access',
  'content.review': 'owner review access',
  'content.write': 'owner CMS access',
  'user.manage': 'owner user-management access',
  'user.role': 'owner role-management access',
});

export function normalizeStaffContext(value = {}) {
  // Older deployments/tests do not return staff_context; preserve the historical
  // owner UI in that compatibility case. Unknown explicit roles fail closed.
  const role = value.role == null ? 'owner' : (ROLE_LABELS[value.role] ? value.role : 'read_only');
  const defaultOwnerCapabilities = role === 'owner' && value.role == null ? Object.keys(CAPABILITY_LABELS) : [];
  return {
    role,
    email: String(value.email || ''),
    can_write: value.role == null ? true : value.can_write === true,
    capabilities: [...new Set(Array.isArray(value.capabilities) ? value.capabilities : defaultOwnerCapabilities)],
  };
}

export const staffRoleLabel = (role) => ROLE_LABELS[role] || ROLE_LABELS.read_only;

export function staffCan(context, capability) {
  if (!context || !capability) return false;
  return normalizeStaffContext(context).capabilities.includes(capability);
}

export function capabilityReason(capability) {
  return `Unavailable: ${CAPABILITY_LABELS[capability] || 'additional staff access'} is required.`;
}

function restrictControl(control, reason) {
  if (!control.dataset.permissionDisabled) {
    control.dataset.permissionDisabled = 'true';
    control.dataset.permissionWasDisabled = String(Boolean(control.disabled));
    control.dataset.permissionTitle = control.getAttribute('title') || '';
  }
  control.disabled = true;
  control.setAttribute('aria-disabled', 'true');
  control.setAttribute('title', reason);
}

function restoreControl(control) {
  if (!control.dataset.permissionDisabled) return;
  control.disabled = control.dataset.permissionWasDisabled === 'true';
  control.removeAttribute('aria-disabled');
  const title = control.dataset.permissionTitle;
  if (title) control.setAttribute('title', title);
  else control.removeAttribute('title');
  delete control.dataset.permissionDisabled;
  delete control.dataset.permissionWasDisabled;
  delete control.dataset.permissionTitle;
}

export function applyCapabilityUi(root, context) {
  if (!root || !context?.role) return;
  const normalized = normalizeStaffContext(context);

  root.querySelectorAll('[data-capability]').forEach((control) => {
    const capability = control.dataset.capability;
    const allowed = staffCan(normalized, capability);
    if (control.dataset.capabilityMode === 'hide') {
      control.hidden = !allowed;
      return;
    }
    if (allowed) restoreControl(control);
    else restrictControl(control, capabilityReason(capability));
  });

  root.querySelectorAll('[data-capability-scope]').forEach((scope) => {
    const capability = scope.dataset.capabilityScope;
    const allowed = staffCan(normalized, capability);
    scope.dataset.permissionRestricted = String(!allowed);
    scope.querySelectorAll('button, input, select, textarea').forEach((control) => {
      if (control.closest('[data-permission-exempt]')) return;
      if (control.closest('[data-capability]')) return;
      if (allowed) restoreControl(control);
      else restrictControl(control, capabilityReason(capability));
    });
  });
}
