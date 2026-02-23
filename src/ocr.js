'use strict';

/**
 * OCR bien so xe Viet Nam bang Tesseract.js (local, mien phi).
 * Su dung Sharp de tien xu ly anh truoc khi OCR de tang do chinh xac.
 */

const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const axios = require('axios');
const { normalizePlate, isValidVietnamPlate } = require('./utils');
const logger = require('./logger');

let worker = null;

/**
 * Khoi tao Tesseract worker.
 * Goi 1 lan khi server khoi dong.
 */
async function initOcr() {
  worker = await createWorker('eng', 1, {
    logger: () => {}, // Tat log verbose cua Tesseract
  });

  // Gioi han bo chu de tang do chinh xac voi bien so
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    preserve_interword_spaces: '0',
  });

  logger.info('Tesseract OCR initialized (local, no API cost)');
}

/**
 * Tai anh tu URL ve dang buffer.
 */
async function downloadImage(imageUrl) {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
  });
  return Buffer.from(response.data);
}

/**
 * Tien xu ly anh de tang do chinh xac OCR:
 * - Scale up de bien so ro hon
 * - Chuyen grayscale
 * - Normalize contrast
 * - Sharpen canh vien
 */
async function preprocessImage(buffer) {
  return sharp(buffer)
    .resize({ width: 1200, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
}

/**
 * Doc bien so xe tu URL anh.
 * @param {string} imageUrl
 * @returns {{ plateText: string, confidence: number, rawTexts: string[] }}
 */
async function recognizePlate(imageUrl) {
  if (!worker) {
    throw new Error('OCR not initialized. Call initOcr() first.');
  }

  const result = { plateText: '', confidence: 0, rawTexts: [] };

  try {
    const rawBuffer = await downloadImage(imageUrl);
    const processed = await preprocessImage(rawBuffer);

    const { data } = await worker.recognize(processed);
    const fullText = (data.text || '').trim();
    const tesseractConf = (data.confidence || 0) / 100; // 0-100 -> 0-1

    result.rawTexts = [fullText];

    const lines = fullText
      .split(/[\n\r]+/)
      .map(l => l.trim())
      .filter(Boolean);

    const candidates = [];

    // Tim candidate tren tung dong
    for (const line of lines) {
      const normalized = normalizePlate(line);
      if (isValidVietnamPlate(normalized)) {
        candidates.push({
          normalized,
          score: calcPlateScore(normalized, tesseractConf),
        });
      }
    }

    // Thu ghep 2 dong lien tiep (bien so 2 dong)
    for (let i = 0; i < lines.length - 1; i++) {
      const merged = lines[i] + lines[i + 1];
      const normalized = normalizePlate(merged);
      if (isValidVietnamPlate(normalized)) {
        candidates.push({
          normalized,
          score: calcPlateScore(normalized, tesseractConf) - 0.05,
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      result.plateText = candidates[0].normalized;
      result.confidence = Math.min(0.99, candidates[0].score);
    } else {
      // Fallback: dong dau tien co so
      const fallback = lines.find(l => /\d{2,}/.test(l));
      if (fallback) {
        result.plateText = normalizePlate(fallback);
        result.confidence = 0.3;
      }
    }

    logger.info('OCR result', {
      plateText: result.plateText,
      confidence: result.confidence,
      tesseractConf: Math.round(tesseractConf * 100),
    });
  } catch (err) {
    logger.error('OCR processing failed', { error: err.message, imageUrl });
  }

  return result;
}

/**
 * Tinh diem confidence cho 1 candidate bien so.
 */
function calcPlateScore(normalized, tesseractConf) {
  let score = 0.4; // Base

  // Bonus neu khop format bien so Viet Nam chat
  if (/^\d{2}[A-Z]\d?-\d{4,5}$/.test(normalized)) {
    score += 0.35;
  } else if (/^\d{3}[A-Z]\d?-\d{4,5}$/.test(normalized)) {
    score += 0.3;
  }

  // Cong them confidence cua Tesseract (0-1, trong so 0.25)
  score += tesseractConf * 0.25;

  return Math.min(0.99, Math.max(0.1, score));
}

module.exports = { initOcr, recognizePlate };
