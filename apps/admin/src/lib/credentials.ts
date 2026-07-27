/** Client-side credential checks mirroring services/api/internal/auth/password.go */

const phoneRe = /^\d{11}$/;
const passwordRe = /^[A-Za-z0-9]{8,}$/;

export function isValidPhone(phone: string): boolean {
  return phoneRe.test(phone.trim());
}

export function passwordError(password: string): string | null {
  if (!passwordRe.test(password)) {
    return "Password must be at least 8 characters and contain only letters and digits";
  }
  return null;
}

/** Returns a user-facing error, or null when phone/password look valid. */
export function validateLoginCredentials(opts: {
  phone: string;
  password: string;
}): string | null {
  if (!isValidPhone(opts.phone)) {
    return "Phone must be exactly 11 digits";
  }
  return passwordError(opts.password);
}
