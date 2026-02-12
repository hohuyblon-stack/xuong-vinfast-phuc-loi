'use strict';

const crypto = require('crypto');
const axios = require('axios');
const logger = require('./logger');

const ZALO_API_BASE = 'https://openapi.zalo.me/v3.0/oa';

/**
 * Xác thực webhook signature từ Zalo OA.
 * Zalo OA gửi header: X-ZEvent-Signature = mac(app_id + data + timestamp + OA_secret_key)
 *
 * @param {string} rawBody - Raw request body (string)
 * @param {string} signature - Giá trị header X-ZEvent-Signature
 * @param {string} secretKey - Zalo OA secret key
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature, secretKey) {
  if (!signature || !secretKey) {
    logger.warn('Missing signature or secret key - skipping verification');
    return true; // Cho qua nếu chưa config
  }

  try {
    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch (err) {
    logger.error('Signature verification failed', { error: err.message });
    return false;
  }
}

/**
 * Trích xuất thông tin từ webhook payload của Zalo OA.
 *
 * Zalo OA webhook event format:
 * {
 *   "app_id": "...",
 *   "event_name": "user_send_text" | "user_send_image",
 *   "timestamp": "...",
 *   "sender": { "id": "..." },
 *   "message": {
 *     "msg_id": "...",
 *     "text": "...",
 *     "attachments": [{ "type": "image", "payload": { "url": "..." } }]
 *   }
 * }
 *
 * @param {object} body - Parsed JSON body
 * @returns {object|null} - { messageId, senderId, timestamp, text, imageUrl } hoặc null
 */
function extractWebhookData(body) {
  try {
    const eventName = body.event_name;

    // Chỉ xử lý tin nhắn text và image từ user
    if (!['user_send_text', 'user_send_image'].includes(eventName)) {
      logger.info('Ignoring non-message event', { eventName });
      return null;
    }

    const sender = body.sender || {};
    const message = body.message || {};
    const attachments = message.attachments || [];

    // Tìm URL ảnh
    let imageUrl = '';
    for (const att of attachments) {
      if (att.type === 'image' && att.payload && att.payload.url) {
        imageUrl = att.payload.url;
        break;
      }
    }

    return {
      messageId: message.msg_id || '',
      senderId: sender.id || '',
      timestamp: body.timestamp || '',
      text: (message.text || '').trim(),
      imageUrl,
    };
  } catch (err) {
    logger.error('Failed to extract webhook data', { error: err.message });
    return null;
  }
}

/**
 * Gửi tin nhắn text reply cho user qua Zalo OA API.
 *
 * @param {string} userId - Zalo user ID
 * @param {string} message - Nội dung tin nhắn
 * @param {string} accessToken - Zalo OA access token
 */
async function sendReply(userId, message, accessToken) {
  try {
    const response = await axios.post(
      `${ZALO_API_BASE}/message/cs`,
      {
        recipient: { user_id: userId },
        message: { text: message },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          access_token: accessToken,
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.error !== 0) {
      logger.error('Zalo reply failed', {
        error: response.data.error,
        message: response.data.message,
      });
    } else {
      logger.info('Zalo reply sent', { userId, messageLength: message.length });
    }
  } catch (err) {
    logger.error('Zalo reply HTTP error', { error: err.message, userId });
  }
}

module.exports = { verifyWebhookSignature, extractWebhookData, sendReply };
