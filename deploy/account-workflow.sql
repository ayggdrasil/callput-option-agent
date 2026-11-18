-- Dedicated workflow database only. No public grants or automatic expiry of records.
CREATE TABLE IF NOT EXISTS callput_workflows (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  value text NOT NULL,
  lease text,
  lease_expires timestamptz,
  CHECK ((lease IS NULL) = (lease_expires IS NULL))
);
REVOKE ALL ON callput_workflows FROM PUBLIC;
