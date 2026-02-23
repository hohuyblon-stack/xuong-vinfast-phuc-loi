'use strict';

const axios = require('axios');
const logger = require('./logger');

const ZALO_API = 'https://openapi.zalo.me/v3.0/oa';

let accessToken = '';

/**
 * Khởi tạo Zalo OA access token.
 */
function initZalo(token) {
  accessToken = token;
  logger.info('Zalo OA initialized');
}

/**
 * Trích xuất thông tin từ Zalo webhook update.
 * @param {object} body - Zalo webhook body
 * @returns {object|null} - { messageId, chatId, senderId, senderName, text, imageUrl }
 */
function extractUpdate(body) {
  try {
    const eventName = body.event_name;
    if (!eventName) {
      logger.info('Ignoring unknown Zalo event');
      return null;
    }

    const isText = eventName === 'user_send_text';
    const isImage = eventName === 'user_send_image';
    const isImageWithText = eventName === 'user_send_sticker'; // Zalo dùng event này khi gửi ảnh + text

    if (!isText && !isImage && !isImageWithText) {
      logger.info('Ignoring non-text/image Zalo event', { eventName });
      return null;
    }

    const senderId = body.sender && body.sender.id;
    const senderName = (body.sender && body.sender.display_name) || '';
    const chatId = senderId; // Zalo 1-1: chatId = senderId

    const msg = body.message || {};
    const messageId = msg.msg_id || String(Date.now());

    // Lấy text
    const text = (msg.text || '').trim();

    // Lấy URL ảnh trực tiếp từ Zalo webhook (Zalo cung cấp URL sẵn)
    let imageUrl = '';
    if (isImage && msg.attachments && msg.attachments.length > 0) {
      imageUrl = (msg.attachments[0].payload && msg.attachments[0].payload.url) || '';
    }

    return {
      messageId: String(messageId),
      chatId: String(chatId),
      senderId: String(senderId),
      senderName,
      text,
      imageUrl,
    };
  } catch (err) {
    logger.error('Failed to extract Zalo update', { error: err.message });
    return null;
  }
}

/**
 * Gửi tin nhắn text cho 1 user.
 * @param {string} userId - Zalo user ID
 * @param {string} message - Nội dung tin nhắn
 */
async function sendMessage(userId, message) {
  try {
    await axios.post(
      `${ZALO_API}/message/cs`,
      {
        recipient: { user_id: userId },
        message: { text: message },
      },
      {
        headers: { access_token: accessToken },
        timeout: 10000,
      }
    );

    logger.info('Zalo message sent', { userId, messageLength: message.length });
  } catch (err) {
    logger.error('Zalo sendMessage failed', { error: err.message, userId });
  }
}

module.exports = { initZalo, extractUpdate, sendMessage };
