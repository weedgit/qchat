-- Remove SMS OTP tables (registration + phone-change challenges + outbox).
DROP TABLE IF EXISTS register_otp_challenges;
DROP TABLE IF EXISTS phone_change_challenges;
DROP TABLE IF EXISTS sms_outbox;
