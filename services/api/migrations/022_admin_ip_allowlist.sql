-- Per-enterprise admin login IP allowlist. Empty list = policy off.
CREATE TABLE IF NOT EXISTS admin_ip_allowlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
    cidr TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (enterprise_id, cidr)
);

CREATE INDEX IF NOT EXISTS idx_admin_ip_allowlist_enterprise
    ON admin_ip_allowlist (enterprise_id);
