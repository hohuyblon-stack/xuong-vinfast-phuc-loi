'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidWebhookSecret, isValidAdminKey } = require('../src/middleware');

// ──────────────────────────────────────────────
// Test: isValidWebhookSecret
// ──────────────────────────────────────────────

describe('isValidWebhookSecret', () => {
  it('should return true when secret matches', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'secret123' };
    const result = isValidWebhookSecret(headers, 'secret123');

    assert.equal(result, true);
  });

  it('should return false when secret does not match', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'wrong_secret' };
    const result = isValidWebhookSecret(headers, 'secret123');

    assert.equal(result, false);
  });

  it('should return false when header is missing', () => {
    const headers = {};
    const result = isValidWebhookSecret(headers, 'secret123');

    assert.equal(result, false);
  });

  it('should return true when no expected secret is configured', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'anything' };
    const result = isValidWebhookSecret(headers, '');

    assert.equal(result, true);
  });

  it('should return true when expected secret is null', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'anything' };
    const result = isValidWebhookSecret(headers, null);

    assert.equal(result, true);
  });

  it('should return true when expected secret is undefined', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'anything' };
    const result = isValidWebhookSecret(headers, undefined);

    assert.equal(result, true);
  });

  it('should be case-sensitive', () => {
    const headers = { 'x-telegram-bot-api-secret-token': 'Secret123' };
    const result = isValidWebhookSecret(headers, 'secret123');

    assert.equal(result, false);
  });

  it('should handle empty header value', () => {
    const headers = { 'x-telegram-bot-api-secret-token': '' };
    const result = isValidWebhookSecret(headers, 'secret123');

    assert.equal(result, false);
  });
});

// ──────────────────────────────────────────────
// Test: isValidAdminKey
// ──────────────────────────────────────────────

describe('isValidAdminKey', () => {
  it('should return true when API key matches', () => {
    const headers = { 'x-api-key': 'admin_key_abc' };
    const result = isValidAdminKey(headers, 'admin_key_abc');

    assert.equal(result, true);
  });

  it('should return false when API key does not match', () => {
    const headers = { 'x-api-key': 'wrong_key' };
    const result = isValidAdminKey(headers, 'admin_key_abc');

    assert.equal(result, false);
  });

  it('should return false when header is missing', () => {
    const headers = {};
    const result = isValidAdminKey(headers, 'admin_key_abc');

    assert.equal(result, false);
  });

  it('should return true when no expected key is configured', () => {
    const headers = { 'x-api-key': 'anything' };
    const result = isValidAdminKey(headers, '');

    assert.equal(result, true);
  });

  it('should return true when expected key is null', () => {
    const headers = { 'x-api-key': 'anything' };
    const result = isValidAdminKey(headers, null);

    assert.equal(result, true);
  });

  it('should return true when expected key is undefined', () => {
    const headers = { 'x-api-key': 'anything' };
    const result = isValidAdminKey(headers, undefined);

    assert.equal(result, true);
  });

  it('should be case-sensitive', () => {
    const headers = { 'x-api-key': 'Admin_Key_ABC' };
    const result = isValidAdminKey(headers, 'admin_key_abc');

    assert.equal(result, false);
  });

  it('should handle empty header value', () => {
    const headers = { 'x-api-key': '' };
    const result = isValidAdminKey(headers, 'admin_key_abc');

    assert.equal(result, false);
  });

  it('should handle whitespace in keys', () => {
    const headers = { 'x-api-key': ' admin_key_abc ' };
    const result = isValidAdminKey(headers, 'admin_key_abc');

    // Should NOT match because of whitespace
    assert.equal(result, false);
  });
});

// ──────────────────────────────────────────────
// Integration tests for both functions
// ──────────────────────────────────────────────

describe('middleware functions together', () => {
  it('should validate both webhook and admin independently', () => {
    const headers = {
      'x-telegram-bot-api-secret-token': 'webhook_secret',
      'x-api-key': 'admin_key',
    };

    const webhookValid = isValidWebhookSecret(headers, 'webhook_secret');
    const adminValid = isValidAdminKey(headers, 'admin_key');

    assert.ok(webhookValid);
    assert.ok(adminValid);
  });

  it('should allow different secrets for different purposes', () => {
    const headers1 = { 'x-telegram-bot-api-secret-token': 'webhook_secret' };
    const headers2 = { 'x-api-key': 'admin_key' };

    assert.ok(isValidWebhookSecret(headers1, 'webhook_secret'));
    assert.ok(!isValidAdminKey(headers1, 'admin_key'));
    assert.ok(!isValidWebhookSecret(headers2, 'webhook_secret'));
    assert.ok(isValidAdminKey(headers2, 'admin_key'));
  });

  it('should both pass when no security configured', () => {
    const headers = {
      'x-telegram-bot-api-secret-token': 'anything',
      'x-api-key': 'anything',
    };

    const webhookValid = isValidWebhookSecret(headers, '');
    const adminValid = isValidAdminKey(headers, '');

    assert.ok(webhookValid);
    assert.ok(adminValid);
  });
});
