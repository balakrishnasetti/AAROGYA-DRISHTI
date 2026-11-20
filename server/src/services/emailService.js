import nodemailer from 'nodemailer';

export function createEmailProvider(environment, { logger = console } = {}) {
  if (!environment.SMTP_HOST || !environment.SMTP_FROM) {
    if (environment.NODE_ENV === 'development') {
      return {
        async sendPasswordReset(email, link) {
          logger.info(`Development-only password reset link for ${email}: ${link}`);
        },
      };
    }

    return {
      async sendPasswordReset() {
        throw new Error('Email provider is not configured.');
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT ?? 587,
    secure: environment.SMTP_PORT === 465,
    auth:
      environment.SMTP_USER && environment.SMTP_PASSWORD
        ? { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD }
        : undefined,
  });

  return {
    sendPasswordReset(email, link) {
      return transporter.sendMail({
        from: environment.SMTP_FROM,
        to: email,
        subject: 'Reset your Aarogya Drishti password',
        text: `Use this one-time link to reset your password: ${link}\n\nIf you did not request this, ignore this message.`,
      });
    },
  };
}
