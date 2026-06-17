// GET /api/health — liveness + env presence check (no secrets leaked).
import { json } from '../lib/supabase.js';

export default async () =>
  json(200, {
    ok: true,
    service: 'masest-commerce',
    phase: 1,
    env: {
      supabase_url: Boolean(process.env.SUPABASE_URL),
      supabase_anon: Boolean(process.env.SUPABASE_ANON_KEY),
      supabase_service: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  });

export const config = { path: '/api/health' };
