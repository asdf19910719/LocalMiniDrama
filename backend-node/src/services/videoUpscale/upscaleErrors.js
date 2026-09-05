class VideoUpscaleError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'VideoUpscaleError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.httpStatus = options.httpStatus || null;
    this.details = options.details || null;
  }
}

function upscaleError(code, message, options) {
  return new VideoUpscaleError(code, message, options);
}

module.exports = { VideoUpscaleError, upscaleError };
