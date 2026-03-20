'use strict';

/**
 * Returns true if the incoming Telegram webhook secret is valid.
 * When no secret is configured the check is skipped (returns true).
 */
function isValidWebhookSecret(headers, expectedSecret) {
  if (!expectedSecret) return true;
  return headers['x-telegram-bot-api-secret-token'] === expectedSecret;
}

/**
 * Returns true if the incoming admin API key is valid.
 * When no key is configured the check is skipped (returns true).
 */
function isValidAdminKey(headers, expectedKey) {
  if (!expectedKey) return true;
  return headers['x-api-key'] === expectedKey;
}

module.exports = { isValidWebhookSecret, isValidAdminKey };
