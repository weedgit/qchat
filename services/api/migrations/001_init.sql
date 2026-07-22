-- Qchat core schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS enterprises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    invite_active BOOLEAN NOT NULL DEFAULT TRUE,
    retention_days INT NOT NULL DEFAULT 90,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    real_name TEXT NOT NULL DEFAULT '',
    age INT,
    region TEXT NOT NULL DEFAULT '',
    signature TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    profile_visibility TEXT NOT NULL DEFAULT 'friends', -- public|friends
    friend_privacy TEXT NOT NULL DEFAULT 'approval', -- open|approval|closed
    role TEXT NOT NULL DEFAULT 'member', -- platform_owner|enterprise_admin|member
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    register_ip TEXT NOT NULL DEFAULT '',
    register_region TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (enterprise_id, phone),
    UNIQUE (enterprise_id, username)
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_type TEXT NOT NULL, -- web|desktop|phone (one active session per type)
    device_name TEXT NOT NULL DEFAULT '',
    refresh_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS captchas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    answer TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    requester_id UUID NOT NULL REFERENCES users(id),
    addressee_id UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|blocked
    note TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    type TEXT NOT NULL, -- dm|social_group|public_channel|private_channel|announcement
    title TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    announcement TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    public_id TEXT UNIQUE,
    owner_id UUID REFERENCES users(id),
    space_id UUID,
    forbid_member_friend_add BOOLEAN NOT NULL DEFAULT FALSE,
    mute_all BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_message_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- owner|admin|member
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    history_visible_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    mute_until TIMESTAMPTZ,
    last_read_seq BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    client_msg_id TEXT NOT NULL,
    seq BIGSERIAL,
    type TEXT NOT NULL DEFAULT 'text', -- text|image|file|voice|video|system|call
    body TEXT NOT NULL DEFAULT '',
    media_url TEXT NOT NULL DEFAULT '',
    media_meta JSONB NOT NULL DEFAULT '{}',
    reply_to_id UUID,
    mentions UUID[] NOT NULL DEFAULT '{}',
    mention_all BOOLEAN NOT NULL DEFAULT FALSE,
    forwarded_from UUID,
    recalled BOOLEAN NOT NULL DEFAULT FALSE,
    recalled_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, client_msg_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq);

CREATE TABLE IF NOT EXISTS message_receipts (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL, -- delivered|read
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, status)
);

CREATE TABLE IF NOT EXISTS media_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    uploader_id UUID NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL, -- avatar|image|file|voice|video
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_key TEXT NOT NULL,
    checksum TEXT NOT NULL DEFAULT '',
    scanned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    name TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    webhook_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id UUID NOT NULL REFERENCES enterprises(id),
    conversation_id UUID REFERENCES conversations(id),
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    enterprise_id UUID,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS push_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, -- web|ios|android|huawei|xiaomi|oppo|vivo
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    initiator_id UUID NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL, -- voice|video
    room_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ringing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ
);
