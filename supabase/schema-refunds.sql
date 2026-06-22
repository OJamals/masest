-- Refund status enum (issue #26 / live bug). Apply in the Supabase SQL editor. Idempotent.
--
-- BUG: admin/orders.js (deployed) sets status='refunded', but the order_status enum never
-- had that value — so every Stripe refund 500'd on the status update *after* Stripe had
-- already refunded the money (money out, order still 'paid'). Adding the value unbreaks it.
-- ALTER TYPE ... ADD VALUE must run on its own (cannot share a transaction block).
alter type order_status add value if not exists 'refunded';
