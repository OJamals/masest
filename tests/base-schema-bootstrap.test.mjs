import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(
  new URL("../supabase/schema.sql", import.meta.url),
  "utf8",
);

test("base schema defines profiles.is_staff before its RLS policy", () => {
  const profilesStart = schema.indexOf(
    "create table if not exists public.profiles",
  );
  const profilesEnd = schema.indexOf(");", profilesStart);
  const policyStart = schema.indexOf(
    "create policy profiles_self_update",
    profilesEnd,
  );

  assert.ok(profilesStart >= 0, "profiles table must be defined");
  assert.ok(profilesEnd > profilesStart, "profiles table must terminate");
  assert.ok(policyStart > profilesEnd, "profiles policy must follow the table");
  assert.match(
    schema.slice(profilesStart, profilesEnd),
    /is_staff\s+boolean\s+not null\s+default false/,
  );
  assert.match(
    schema.slice(profilesEnd, policyStart),
    /alter table public\.profiles\s+add column if not exists is_staff boolean not null default false;/,
  );
});
