export const loggerOptions = {
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        path: req.url.split('?')[0].replace(/[a-f\d]{24}/gi, '[record]'),
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.otp',
      'req.body.token',
    ],
    censor: '[REDACTED]',
  },
};
