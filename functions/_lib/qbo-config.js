export const QBO_CONNECT_KEY_NAMES = [
  "QBO_CONNECT_KEY",
  "CONNECT_QUICKBOOKS_KEY",
  "QUICKBOOKS_CONNECT_KEY",
];

export const QBO_REQUIRED_KEYS = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_REDIRECT_URI",
  "QBO_OAUTH_STATE_SECRET",
  "QBO_SYNC_SECRET",
  "QBO_INCOME_ACCOUNT_ID",
  "QBO_ENVIRONMENT",
];

const FIELD_MAP = {
  QBO_CLIENT_ID: "QBO_CLIENT_ID",
  QBO_CLIENT_SECRET: "QBO_CLIENT_SECRET",
  QBO_REDIRECT_URI: "QBO_REDIRECT_URI",
  QBO_OAUTH_STATE_SECRET: "QBO_OAUTH_STATE_SECRET",
  QBO_SYNC_SECRET: "QBO_SYNC_SECRET",
  QBO_INCOME_ACCOUNT_ID: "QBO_INCOME_ACCOUNT_ID",
  QBO_ENVIRONMENT: "QBO_ENVIRONMENT",
  QBO_REALM_ID: "QBO_REALM_ID",
  client_id: "QBO_CLIENT_ID",
  clientId: "QBO_CLIENT_ID",
  client_secret: "QBO_CLIENT_SECRET",
  clientSecret: "QBO_CLIENT_SECRET",
  redirect_uri: "QBO_REDIRECT_URI",
  redirectUri: "QBO_REDIRECT_URI",
  oauth_state_secret: "QBO_OAUTH_STATE_SECRET",
  oauthStateSecret: "QBO_OAUTH_STATE_SECRET",
  state_secret: "QBO_OAUTH_STATE_SECRET",
  stateSecret: "QBO_OAUTH_STATE_SECRET",
  sync_secret: "QBO_SYNC_SECRET",
  syncSecret: "QBO_SYNC_SECRET",
  income_account_id: "QBO_INCOME_ACCOUNT_ID",
  incomeAccountId: "QBO_INCOME_ACCOUNT_ID",
  environment: "QBO_ENVIRONMENT",
  realm_id: "QBO_REALM_ID",
  realmId: "QBO_REALM_ID",
};

function present(value) {
  return String(value || "").trim() !== "";
}

function connectKeyName(env = {}) {
  return QBO_CONNECT_KEY_NAMES.find((key) => present(env[key])) || "";
}

function decodeBase64(value) {
  const normalized = String(value || "").trim().replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return atob(padded);
  } catch {
    return "";
  }
}

function parseKeyValueText(value) {
  const out = {};
  for (const part of String(value || "").split(/[\n\r;&]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return out;
}

function parsePayload(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  for (const candidate of [raw, decodeBase64(raw)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next representation.
    }
  }
  return parseKeyValueText(raw);
}

function normalizePayload(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload || {})) {
    const envKey = FIELD_MAP[key] || FIELD_MAP[String(key).trim()];
    if (!envKey || !present(value)) continue;
    out[envKey] = String(value).trim();
  }
  return out;
}

export function qboConnectKeyPayloadEnv(env = {}) {
  const keyName = connectKeyName(env);
  if (!keyName) return {};
  return normalizePayload(parsePayload(env[keyName]));
}

export function qboConfigEnv(env = {}) {
  const imported = qboConnectKeyPayloadEnv(env);
  const merged = { ...env };
  for (const [key, value] of Object.entries(imported)) {
    if (!present(merged[key])) merged[key] = value;
  }
  return merged;
}

export function qboConfigStatus(env = {}) {
  const keyName = connectKeyName(env);
  const imported = qboConnectKeyPayloadEnv(env);
  const merged = qboConfigEnv(env);
  const missing = QBO_REQUIRED_KEYS.filter((key) => !present(merged[key]));
  return {
    ready: missing.length === 0,
    source: keyName || "env",
    imported_keys: Object.keys(imported).sort(),
    missing,
  };
}
