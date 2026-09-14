ALTER TABLE app_super_user ADD COLUMN user_id UUID;
UPDATE app_super_user SET user_id = gen_random_uuid() WHERE user_id IS NULL;
ALTER TABLE app_super_user ALTER COLUMN user_id SET NOT NULL;
CREATE UNIQUE INDEX app_super_user_user_id_idx ON app_super_user (user_id);

CREATE TABLE app_users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('super_user', 'administrator', 'analyst', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  password_salt TEXT NOT NULL,
  password_proof_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX app_users_email_lower_idx ON app_users (LOWER(email));

INSERT INTO app_users (
  user_id, email, display_name, title, role, status, password_salt,
  password_proof_hash, must_change_password, created_by, created_at, updated_at
)
SELECT
  user_id, email, display_name, title, 'super_user', 'active', password_salt,
  password_proof_hash, FALSE, user_id, created_at, updated_at
FROM app_super_user;

ALTER TABLE app_auth_sessions ADD COLUMN user_id UUID;
UPDATE app_auth_sessions
SET user_id = (SELECT user_id FROM app_super_user WHERE singleton = TRUE)
WHERE user_id IS NULL;
ALTER TABLE app_auth_sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE app_auth_sessions
  ADD CONSTRAINT app_auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES app_users(user_id);
CREATE INDEX app_auth_sessions_user_idx ON app_auth_sessions (user_id, expires_at);
