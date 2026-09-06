# Durable support and quote communication

Support messages and public quote intake commit their canonical database row and
transactional delivery intent in one database transaction. The integration-effect
worker performs provider delivery with stable idempotency keys and retries transient
provider, configuration, and reply-address failures. A committed business row is
never rolled back because mail is unavailable.

Quote marketing consent is recorded at intake before the nurture effect is queued.
The effect carries the original consent timestamp and never re-enables a recipient;
later unsubscribe state remains authoritative at materialization and send time.

Apply the durable communication migration only after the integration-events,
support-thread, newsletter preference, and quote lifecycle schemas. Verify the
readiness RPC reports enabled support-message and quote-intake triggers before
serving writes from the new application code. Drain old workers before retiring
any prior inline delivery path.

Run the disposable replay proof after applying the order-email migration with
`psql -h /tmp/masest-email-pg-root/socket -p 55439 -d email_review -v ON_ERROR_STOP=1 -f supabase/tests/order-email-replay.sql`.
It uses separate committed transactions to verify one event/effect and preservation
of the first return-email metadata across normal-finalize and reconciliation retries.

For support envelope durability, apply
`supabase/migrate-support-email-envelope-2026-09-05.sql` before the durable support
message migration. It stores the first-send envelope on the private canonical
integration effect, never on the buyer-readable `messages` row. Deploy the worker
and application code before these migrations; readiness remains false until the
preparation RPC exists, so support writes and delivery fail closed during a partial
rollout.
