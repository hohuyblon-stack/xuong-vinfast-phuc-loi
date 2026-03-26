'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidWebhookSecret, isValidAdminKey } = require('../src/middleware');

// ──────────────────────────────────────────────
// isValidWebhookSecret
// ──────────────────────────────────────────────

describe('isValidWebhookSecret', () => {
  it('passes when no secret is configured', () => {
    assert.equal(isValidWebhookSecret({}, ''), true);
    assert.equal(isValidWebhookSecret({}, undefined), true);
  });

  it('passes when header matches configured secret', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'my-secret' };
    assert.equal(isValidWebhookSecret(headers, 'my-secret'), true);
  });

  it('rejects when header is missing and secret is configured', () => {
    assert.equal(isValidWebhookSecret({}, 'my-secret'), false);
  });

  it('rejects when header does not match configured secret', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'wrong' };
    assert.equal(isValidWebhookSecret(headers, 'my-secret'), false);
  });
});

// ──────────────────────────────────────────────
// isValidAdminKey
// ──────────────────────────────────────────────

describe('isValidAdminKey', () => {
  it('passes when no key is configured', () => {
    assert.equal(isValidAdminKey({}, ''), true);
    assert.equal(isValidAdminKey({}, undefined), true);
  });

  it('passes when x-api-key header matches configured key', () => {
    const headers = { 'x-api-key': 'admin-key-123' };
    assert.equal(isValidAdminKey(headers, 'admin-key-123'), true);
  });

  it('rejects when header is missing and key is configured', () => {
    assert.equal(isValidAdminKey({}, 'admin-key-123'), false);
  });

  it('rejects when header does not match configured key', () => {
    const headers = { 'x-api-key': 'wrong' };
    assert.equal(isValidAdminKey(headers, 'admin-key-123'), false);
  });
});
