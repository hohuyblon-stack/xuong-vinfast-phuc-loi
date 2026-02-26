'use strict';

const vision = require('@google-cloud/vision');
const axios = require('axios');
const { normalizePlate, isValidVietnamPlate } = require('./utils');
const logger = require('./logger');

let visionClient = null;

/**
 * Khởi tạo Google Cloud Vision client.
 */
function initOcr(credentials) {
  visionClient = new vision.ImageAnnotatorClient({
    credentials,
  });
  logger.info('Google Cloud Vision client initialized');
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
 * Đọc biển số từ ảnh.
 * @param {string} imageUrl - URL ảnh (từ Telegram)
 * @returns {{ plateText: string, confidence: number, rawTexts: string[] }}
 */
async function recognizePlate(imageUrl) {
  if (!visionClient) {
    throw new Error('OCR client not initialized. Call initOcr() first.');
  }

  const result = {
    plateText: '',
    confidence: 0,
    rawTexts: [],
  };

  try {
    // Tải ảnh
    const imageBuffer = await downloadImage(imageUrl);

    // Gọi Google Vision - text detection
    const [response] = await visionClient.textDetection({
      image: { content: imageBuffer.toString('base64') },
    });

    if (response.error) {
      logger.error('Vision API error', { error: response.error });
      return result;
    }

    const annotations = response.textAnnotations;
    if (!annotations || annotations.length === 0) {
      logger.warn('No text detected in image');
      return result;
    }

    // annotations[0] = full text, annotations[1..n] = từng word/block
    const fullText = annotations[0].description || '';
    result.rawTexts = annotations.map(a => a.description);

    // Tách candidates từ full text (mỗi dòng)
    const lines = fullText
      .split(/[\n\r]+/)
      .map(l => l.trim())
      .filter(Boolean);

    // Tìm candidate khớp pattern biển số Việt Nam
    const candidates = [];
    for (const line of lines) {
      const normalized = normalizePlate(line);
      if (isValidVietnamPlate(normalized)) {
        candidates.push({
          raw: line,
          normalized,
          // Confidence heuristic: dựa vào số block annotation match
          score: calcPlateScore(normalized, annotations),
        });
      }
    }

    // Thử ghép 2 dòng liên tiếp (biển số 2 dòng)
    for (let i = 0; i < lines.length - 1; i++) {
      const merged = lines[i] + lines[i + 1];
      const normalized = normalizePlate(merged);
      if (isValidVietnamPlate(normalized)) {
        candidates.push({
          raw: `${lines[i]} ${lines[i + 1]}`,
          normalized,
          score: calcPlateScore(normalized, annotations),
        });
      }
    }

    if (candidates.length > 0) {
      // Chọn candidate có score cao nhất
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      result.plateText = best.normalized;
      result.confidence = best.score;
    } else {
      // Fallback: lấy dòng đầu tiên có chứa số
      const fallback = lines.find(l => /\d{2,}/.test(l));
      if (fallback) {
        result.plateText = normalizePlate(fallback);
        result.confidence = 0.3; // Thấp vì không match pattern
      }
    }

    logger.info('OCR result', {
      plateText: result.plateText,
      confidence: result.confidence,
      candidateCount: candidates.length,
    });
  } catch (err) {
    logger.error('OCR processing failed', { error: err.message, imageUrl });
  }

  return result;
}

/**
 * Tính điểm confidence cho 1 candidate biển số.
 * Dựa vào: vision API confidence, format match, character consistency.
 */
function calcPlateScore(normalized, annotations) {
  let score = 0.5; // Base

  // Bonus: khớp regex Việt Nam chặt
  if (/^\d{2}[A-Z]\d?-\d{4,5}$/.test(normalized)) {
    score += 0.3;
  } else if (/^\d{3}[A-Z]\d?-\d{4,5}$/.test(normalized)) {
    score += 0.25;
  }

  // Bonus: Vision API block confidence (nếu có)
  const blockAnnotations = annotations.slice(1);
  const plateChars = normalized.replace('-', '');
  let matchedBlocks = 0;
  for (const block of blockAnnotations) {
    const blockText = (block.description || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (plateChars.includes(blockText) && blockText.length > 0) {
      matchedBlocks++;
      if (block.confidence) {
        score += block.confidence * 0.05;
      }
    }
  }

  // Cap at 0.99
  return Math.min(0.99, Math.max(0.1, score));
}

module.exports = { initOcr, recognizePlate };
