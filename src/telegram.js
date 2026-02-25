'use strict';

/**
 * Telegram Bot integration.
 * Interface giong zalo.js: initTelegram, extractUpdate, sendMessage.
 */

const axios = require('axios');
const logger = require('./logger');

const TELEGRAM_API = 'https://api.telegram.org';
let botToken = '';

function initTelegram(token) {
  botToken = token;
  logger.info('Telegram bot initialized');
}

/**
 * Lay URL download file tu Telegram file_id.
 * Telegram khong tra URL truc tiep - phai goi getFile truoc.
 */
async function getFileUrl(fileId) {
  const res = await axios.get(`${TELEGRAM_API}/bot${botToken}/getFile`, {
    params: { file_id: fileId },
    timeout: 10000,
  });
  const filePath = res.data.result.file_path;
  return `${TELEGRAM_API}/file/bot${botToken}/${filePath}`;
}

/**
 * Parse Telegram webhook update.
 * Tra ve { messageId, chatId, senderId, senderName, text, imageUrl } hoac null.
 *
 * Telegram gui photo theo mang PhotoSize[] (nhieu resolution).
 * Phan tu cuoi = anh lon nhat -> dung de OCR.
 * Caption = text kem voi anh (tuong duong VAO/RA trong Zalo).
 */
async function extractUpdate(body) {
  try {
    const msg = body.message || body.edited_message;
    if (!msg) return null;

    // Chi xu ly text hoac anh (co hoac khong co caption)
    if (!msg.text && !msg.photo) return null;

    const messageId = String(msg.message_id);
    const chatId    = String(msg.chat.id);
    const senderId  = String(msg.from.id);
    const senderName = [msg.from.first_name, msg.from.last_name]
      .filter(Boolean)
      .join(' ');

    // Text: msg.text cho tin nhan thuong, msg.caption cho anh kem chu
    const text = (msg.text || msg.caption || '').trim();

    // Anh: lay anh do phan giai cao nhat (phan tu cuoi cua mang photo)
    let imageUrl = '';
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      try {
        imageUrl = await getFileUrl(largest.file_id);
      } catch (err) {
        logger.error('Failed to get Telegram file URL', { error: err.message });
      }
    }

    return { messageId, chatId, senderId, senderName, text, imageUrl };
  } catch (err) {
    logger.error('Failed to extract Telegram update', { error: err.message });
    return null;
  }
}

/**
 * Gui tin nhan text.
 */
async function sendMessage(chatId, message) {
  try {
    await axios.post(
      `${TELEGRAM_API}/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: message },
      { timeout: 10000 }
    );
    logger.info('Telegram message sent', { chatId, messageLength: message.length });
  } catch (err) {
    logger.error('Telegram sendMessage failed', { error: err.message, chatId });
  }
}

module.exports = { initTelegram, extractUpdate, sendMessage };
