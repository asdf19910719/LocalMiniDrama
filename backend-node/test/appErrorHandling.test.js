const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classifyHttpError } = require('../src/app');

describe('app request error classification', () => {
  it('classifies JSON parser failures as a client error instead of HTTP 500', () => {
    assert.deepEqual(
      classifyHttpError({ type: 'entity.parse.failed', status: 400 }),
      { status: 400, code: 'INVALID_JSON', message: '请求体不是合法 JSON' },
    );
  });

  it('classifies oversized JSON requests as HTTP 413', () => {
    assert.deepEqual(
      classifyHttpError({ type: 'entity.too.large', status: 413 }),
      { status: 413, code: 'PAYLOAD_TOO_LARGE', message: '请求体超过 10MB 限制' },
    );
  });
});
