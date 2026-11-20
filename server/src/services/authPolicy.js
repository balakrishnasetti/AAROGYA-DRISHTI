export function isSyntheticDemoPatientPhone(phone) {
  const suffix = /^\+9100000(\d{5})$/.exec(phone)?.[1];
  const accountNumber = Number(suffix);
  return Number.isInteger(accountNumber) && accountNumber >= 1 && accountNumber <= 20;
}

export function otpIsUsable(otp, now = new Date(), maxAttempts = 5) {
  return Boolean(
    otp &&
    !otp.consumedAt &&
    new Date(otp.expiresAt).getTime() > now.getTime() &&
    otp.attempts < maxAttempts,
  );
}

export function resetTokenIsUsable(token, now = new Date()) {
  return Boolean(token && !token.consumedAt && new Date(token.expiresAt).getTime() > now.getTime());
}

export function consumeResetToken(model, tokenHash, now = new Date()) {
  return model.findOneAndUpdate(
    { tokenHash, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { new: true },
  );
}
