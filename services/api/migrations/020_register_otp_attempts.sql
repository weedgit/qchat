-- Cap guesses per registration OTP challenge, matching phone_change_challenges.
ALTER TABLE register_otp_challenges
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
