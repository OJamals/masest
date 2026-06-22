// Best-effort immutable audit trail for staff mutations (issue #20).
//
// recordAudit() must NEVER throw or block the underlying action — an audit-write
// failure cannot be allowed to fail a refund or an approval. Call it with the
// service-role client after the mutation succeeds:
//
//   await recordAudit(sb, { user, action: 'company.approve', targetType: 'company',
//                           targetId: id, detail: { net_terms_days } });
export async function recordAudit(sb, { user, action, targetType = null, targetId = null, detail = null }) {
  if (!action) return;
  try {
    await sb.from('audit_log').insert({
      actor_user_id: user?.id || null,
      actor_email: user?.email || null,
      action,
      target_type: targetType,
      target_id: targetId != null ? String(targetId) : null,
      detail: detail ?? null,
    });
  } catch {
    // best-effort: swallow so auditing never breaks the action it records
  }
}
