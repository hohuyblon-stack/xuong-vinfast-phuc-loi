'use strict';

const axios = require('axios');
const logger = require('./logger');

const TELEGRAM_API = 'https://api.telegram.org/bot';

let botToken = '';

/**
 * Khởi tạo Telegram Bot token.
 */
function initTelegram(token) {
  botToken = token;
  logger.info('Telegram Bot initialized');
}

/**
 * Trích xuất thông tin từ Telegram webhook update.
 * @param {object} update - Telegram update object
 * @returns {object|null} - { messageId, chatId, senderId, senderName, text, imageFileId }
 */
function extractUpdate(update) {
  try {
    const message = update.message;
    if (!message) {
      logger.info('Ignoring non-message update');
      return null;
    }

    const chatId = message.chat && message.chat.id;
    const senderId = message.from && message.from.id;
    const senderName = message.from
      ? [message.from.first_name, message.from.last_name].filter(Boolean).join(' ')
      : '';

    // Text có thể là text hoặc caption (khi gửi ảnh kèm text)
    const text = (message.text || message.caption || '').trim();

    // Lấy file_id của ảnh có resolution cao nhất
    let imageFileId = '';
    if (message.photo && message.photo.length > 0) {
      // Telegram gửi nhiều kích thước, lấy cái cuối cùng (lớn nhất)
      imageFileId = message.photo[message.photo.length - 1].file_id;
    }

    // Phat hien file Excel gui qua Telegram (tu phong ke toan)
    let documentFileId = '';
    let documentName = '';
    if (message.document) {
      const mime = message.document.mime_type || '';
      const name = message.document.file_name || '';
      const isExcel =
        mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mime === 'application/vnd.ms-excel' ||
        name.endsWith('.xlsx') ||
        name.endsWith('.xls');

      if (isExcel) {
        documentFileId = message.document.file_id;
        documentName = name;
      }
    }

    return {
      messageId: String(message.message_id),
      chatId: String(chatId),
      senderId: String(senderId),
      senderName,
      text,
      imageFileId,
      documentFileId,
      documentName,
    };
  } catch (err) {
    logger.error('Failed to extract Telegram update', { error: err.message });
    return null;
  }
}

/**
 * Lấy URL tải ảnh từ Telegram (qua getFile API).
 * @param {string} fileId - Telegram file_id
 * @returns {string} - Download URL
 */
async function getFileUrl(fileId) {
  const response = await axios.post(`${TELEGRAM_API}${botToken}/getFile`, {
    file_id: fileId,
  }, { timeout: 10000 });

  const filePath = response.data.result.file_path;
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
}

/**
 * Gửi tin nhắn text cho 1 chat.
 * @param {string} chatId - Telegram chat ID
 * @param {string} message - Nội dung tin nhắn
 */
async function sendMessage(chatId, message) {
  try {
    await axios.post(`${TELEGRAM_API}${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
    }, { timeout: 10000 });

    logger.info('Telegram message sent', { chatId, messageLength: message.length });
  } catch (err) {
    logger.error('Telegram sendMessage failed', { error: err.message, chatId });
  }
}

/**
 * Đặt webhook URL cho Telegram Bot.
 * @param {string} url - Webhook URL (HTTPS)
 */
async function setWebhook(url, secret) {
  try {
    const body = { url, allowed_updates: ['message'] };
    if (secret) body.secret_token = secret;
    const response = await axios.post(`${TELEGRAM_API}${botToken}/setWebhook`, body, { timeout: 10000 });

    logger.info('Telegram webhook set', { url, ok: response.data.ok });
    return response.data;
  } catch (err) {
    logger.error('Set webhook failed', { error: err.message });
    throw err;
  }
}

/**
 * Lấy thông tin webhook hiện tại từ Telegram.
 * @returns {object} - { url, pending_update_count, ... }
 */
async function getWebhookInfo() {
  const response = await axios.get(`${TELEGRAM_API}${botToken}/getWebhookInfo`, { timeout: 10000 });
  return response.data.result;
}

module.exports = { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook, getWebhookInfo };
