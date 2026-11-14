-- KDJ CR/CIR: Admin initial password bootstrap and mandatory password change.
-- New Admin identities must never become fully usable with an uninitialized password.
ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;

-- Existing Admin rows without a password are restricted to the password-change flow.
UPDATE public.admins
SET must_change_password = true
WHERE password_hash IS NULL;

COMMENT ON COLUMN public.admins.must_change_password IS
  'When true, Admin authentication is restricted to the initial/change-password flow until a new password is set.';
