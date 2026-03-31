'use strict';

const axios = require('axios');
const { normalizePlate, isValidVietnamPlate } = require('./utils');
const logger = require('./logger');

let poeApiKey = null;
let poeModel = null;

const POE_BASE_URL = 'https://api.poe.com/openai/chat/completions';

const OCR_PROMPT = `Bạn là hệ thống OCR biển số xe Việt Nam. Phân tích ảnh và trích xuất:
1. Biển số xe Việt Nam (format ví dụ: 30A-12345, 29B1-234.56)
2. Loại xe VinFast nếu nhận diện được: VF 3, VF 5, VF 6, VF 7, VF 8, VF 9, VF e34, Lux A2.0, Lux SA2.0, Fadil, President

Trả về ĐÚNG JSON format này, KHÔNG giải thích thêm:
{"plate": "BIỂN_SỐ", "vehicle_model": "LOẠI_XE"}

Nếu không thấy biển số: {"plate": "", "vehicle_model": ""}
Nếu không chắc loại xe: để vehicle_model rỗng.`;

/**
 * Khởi tạo Poe OCR client.
 * @param {{ apiKey: string, model?: string }} config
 */
function initOcr(config) {
  poeApiKey = config.apiKey;
  poeModel = config.model || 'GPT-4o-mini';
  logger.info(`Poe OCR initialized with model: ${poeModel}`);
}

/**
 * Tải ảnh từ URL về dạng buffer.
 */
async function downloadImage(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
  });
  return Buffer.from(response.data);
}

/**
 * Đọc biển số từ ảnh qua Poe API (OpenAI-compatible endpoint).
 * @param {string} imageUrl - URL ảnh (từ Telegram)
 * @returns {{ plateText: string, confidence: number, rawTexts: string[], vehicleModel: string, modelConfidence: number }}
 */
async function recognizePlate(imageUrl) {
  if (!poeApiKey) {
    throw new Error('OCR client not initialized. Call initOcr() first.');
  }

  const result = {
    plateText: '',
    confidence: 0,
    rawTexts: [],
    vehicleModel: '',
    modelConfidence: 0,
  };

  try {
    const imageBuffer = await downloadImage(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = detectMimeType(imageBuffer);

    const response = await axios.post(POE_BASE_URL, {
      model: poeModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 200,
    }, {
      headers: {
        'Authorization': `Bearer ${poeApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const content = response.data.choices?.[0]?.message?.content || '';
    result.rawTexts = [content];

    const parsed = parseOcrResponse(content);

    if (parsed.plate) {
      const normalized = normalizePlate(parsed.plate);
      if (isValidVietnamPlate(normalized)) {
        result.plateText = normalized;
        result.confidence = 0.85;
      } else {
        result.plateText = normalized;
        result.confidence = 0.5;
      }
    }

    if (parsed.vehicle_model) {
      result.vehicleModel = parsed.vehicle_model;
      result.modelConfidence = 0.8;
    }

    logger.info('OCR result', {
      plateText: result.plateText,
      confidence: result.confidence,
      vehicleModel: result.vehicleModel,
      model: poeModel,
    });
  } catch (err) {
    logger.error('OCR processing failed', {
      error: err.message,
      status: err.response?.status,
      data: err.response?.data,
      imageUrl,
    });
  }

  return result;
}

/**
 * Parse JSON response từ LLM.
 */
function parseOcrResponse(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    logger.warn('Failed to parse OCR JSON response', { content, error: e.message });
  }
  return { plate: '', vehicle_model: '' };
}

/**
 * Detect MIME type từ buffer header.
 */
function detectMimeType(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

module.exports = { initOcr, recognizePlate };
