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
  logger.info('Khoi tao Telegram Bot thanh cong');
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
      logger.info('Bo qua update khong phai tin nhan');
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

    return {
      messageId: String(message.message_id),
      chatId: String(chatId),
      senderId: String(senderId),
      senderName,
      text,
      imageFileId,
    };
  } catch (err) {
    logger.error('Loi trich xuat du lieu Telegram', { error: err.message });
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
      parse_mode: 'HTML',
    }, { timeout: 10000 });

    logger.info('Da gui tin nhan Telegram', { chatId, messageLength: message.length });
  } catch (err) {
    logger.error('Gui tin nhan Telegram that bai', { error: err.message, chatId });
  }
}

/**
 * Đặt webhook URL cho Telegram Bot.
 * @param {string} url - Webhook URL (HTTPS)
 */
async function setWebhook(url) {
  try {
    const response = await axios.post(`${TELEGRAM_API}${botToken}/setWebhook`, {
      url,
      allowed_updates: ['message'],
    }, { timeout: 10000 });

    logger.info('Da thiet lap webhook Telegram', { url, ok: response.data.ok });
    return response.data;
  } catch (err) {
    logger.error('Thiet lap webhook that bai', { error: err.message });
    throw err;
  }
}

module.exports = { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook };
