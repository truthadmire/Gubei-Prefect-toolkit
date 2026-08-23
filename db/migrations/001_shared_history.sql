CREATE TABLE IF NOT EXISTS shared_history (
  id UUID PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  rota_date DATE NOT NULL,
  code TEXT NOT NULL,
  assignments JSONB NOT NULL,
  roster_revision CHAR(64) NOT NULL,
  edit_token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT shared_history_code_size CHECK (octet_length(code) <= 60000),
  CONSTRAINT shared_history_assignments_array CHECK (jsonb_typeof(assignments) = 'array')
);

CREATE INDEX IF NOT EXISTS shared_history_feed_idx
  ON shared_history (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS shared_history_expiry_idx
  ON shared_history (expires_at);

CREATE TABLE IF NOT EXISTS shared_history_rate_limits (
  network_hash CHAR(64) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  mutation_count INTEGER NOT NULL CHECK (mutation_count > 0),
  PRIMARY KEY (network_hash, window_start)
);

CREATE INDEX IF NOT EXISTS shared_history_rate_limit_cleanup_idx
  ON shared_history_rate_limits (window_start);
