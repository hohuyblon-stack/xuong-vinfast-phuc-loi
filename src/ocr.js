'use strict';

const axios = require('axios');
const { normalizePlate, isValidVietnamPlate } = require('./utils');
const logger = require('./logger');

let poeApiKey = null;
let poeModel = null;

const POE_BASE_URL = process.env.POE_API_ENDPOINT || 'https://api.poe.com/v1/chat/completions';

// Simple in-memory cache: imageUrl -> { result, time }
const ocrCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  ocrCache.clear();
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

  // Check cache first
  const cached = ocrCache.get(imageUrl);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    logger.info('OCR cache hit', { imageUrl: imageUrl.slice(-30) });
    return cached.result;
  }

  const result = {
    plateText: '',
    confidence: 0,
    rawTexts: [],
    vehicleModel: '',
    modelConfidence: 0,
  };

  const MAX_RETRIES = 3;

  try {
    const imageBuffer = await downloadImage(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = detectMimeType(imageBuffer);

    let response;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await axios.post(POE_BASE_URL, {
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
          max_tokens: 256,
        }, {
          headers: {
            'Authorization': `Bearer ${poeApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });
        break; // success
      } catch (retryErr) {
        const status = retryErr.response?.status;
        if (attempt === MAX_RETRIES || (status && status !== 429 && status !== 500 && status !== 502 && status !== 503)) {
          throw retryErr;
        }
        const delay = 200 * Math.pow(2, attempt - 1); // 200ms, 400ms, 800ms
        logger.warn(`OCR attempt ${attempt} failed (${status || retryErr.code}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

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

  // Cache the result
  ocrCache.set(imageUrl, { result, time: Date.now() });

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
