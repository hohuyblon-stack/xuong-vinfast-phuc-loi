'use strict';

const axios = require('axios');
const logger = require('./logger');

const TELEGRAM_API = 'https://api.telegram.org/bot';

let botToken = '';

/**
 * Khoi tao Telegram Bot token.
 */
function initTelegram(token) {
  botToken = token;
  logger.info('Telegram Bot initialized');
}

/**
 * Trich xuat thong tin tu Telegram webhook update.
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

    // Text co the la text hoac caption (khi gui anh kem text)
    const text = (message.text || message.caption || '').trim();

    // Lay file_id cua anh co resolution cao nhat
    let imageFileId = '';
    if (message.photo && message.photo.length > 0) {
      // Telegram gui nhieu kich thuoc, lay cai cuoi cung (lon nhat)
      imageFileId = message.photo[message.photo.length - 1].file_id;
    }

    return {
      messageId: String(message.message_id),
      chatId: String(chatId),
      senderId: String(senderId),
      senderName,
      text,
      imageFileId,
    };
  } catch (err) {
    logger.error('Failed to extract Telegram update', { error: err.message });
    return null;
  }
}

/**
 * Lay URL tai anh tu Telegram (qua getFile API).
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
 * Gui tin nhan text cho 1 chat.
 * @param {string} chatId - Telegram chat ID
 * @param {string} message - Noi dung tin nhan
 */
async function sendMessage(chatId, message) {
  try {
    await axios.post(`${TELEGRAM_API}${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }, { timeout: 10000 });

    logger.info('Telegram message sent', { chatId, messageLength: message.length });
  } catch (err) {
    logger.error('Telegram sendMessage failed', { error: err.message, chatId });
  }
}

/**
 * Dat webhook URL cho Telegram Bot.
 * @param {string} url - Webhook URL (HTTPS)
 */
async function setWebhook(url) {
  try {
    const response = await axios.post(`${TELEGRAM_API}${botToken}/setWebhook`, {
      url,
      allowed_updates: ['message'],
    }, { timeout: 10000 });

    logger.info('Telegram webhook set', { url, ok: response.data.ok });
    return response.data;
  } catch (err) {
    logger.error('Set webhook failed', { error: err.message });
    throw err;
  }
}

module.exports = { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook };
