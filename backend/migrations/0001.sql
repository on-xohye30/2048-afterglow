PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  kakao_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_expiry ON oauth_states(expires_at);
-- One rolling fixed-window bucket per hashed subject/scope, not per request.
CREATE TABLE rate_buckets (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_expiry ON rate_buckets(expires_at);
CREATE TRIGGER rate_bucket_capacity BEFORE INSERT ON rate_buckets
WHEN NOT EXISTS (SELECT 1 FROM rate_buckets WHERE key = NEW.key)
 AND (SELECT COUNT(*) FROM rate_buckets) >= 10000
BEGIN SELECT RAISE(ABORT, 'rate_capacity'); END;
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);
CREATE INDEX rooms_owner ON rooms(owner_id);
CREATE TRIGGER room_owner_capacity BEFORE INSERT ON rooms
WHEN (SELECT COUNT(*) FROM rooms WHERE owner_id = NEW.owner_id) >= 5
BEGIN SELECT RAISE(ABORT, 'owner_capacity'); END;
CREATE TABLE memberships (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(room_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);
CREATE TRIGGER room_member_capacity BEFORE INSERT ON memberships
WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE room_id = NEW.room_id AND user_id = NEW.user_id)
 AND (SELECT COUNT(*) FROM memberships WHERE room_id = NEW.room_id) >= 30
BEGIN SELECT RAISE(ABORT, 'room_capacity'); END;
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  seed INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  submitted_at INTEGER,
  submit_nonce TEXT UNIQUE,
  score INTEGER,
  max_tile INTEGER,
  moves INTEGER,
  FOREIGN KEY(room_id, user_id) REFERENCES memberships(room_id, user_id) ON DELETE CASCADE
);
CREATE INDEX runs_active ON runs(user_id, day, submitted_at);
CREATE INDEX runs_expiry ON runs(created_at);
CREATE TRIGGER run_capacity BEFORE INSERT ON runs
WHEN (SELECT COUNT(*) FROM runs WHERE user_id = NEW.user_id AND day = NEW.day
      AND submitted_at IS NULL AND expires_at > NEW.created_at) >= 100
BEGIN SELECT RAISE(ABORT, 'run_capacity'); END;
CREATE TABLE scores (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score >= 0),
  max_tile INTEGER NOT NULL CHECK(max_tile >= 2),
  moves INTEGER NOT NULL CHECK(moves > 0 AND moves <= 10000),
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY(room_id, user_id, day),
  FOREIGN KEY(room_id, user_id) REFERENCES memberships(room_id, user_id) ON DELETE CASCADE
);
CREATE INDEX scores_day ON scores(day);
