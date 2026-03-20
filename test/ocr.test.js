'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { initOcr, recognizePlate } = require('../src/ocr');

// Mock axios and vision client
const axios = require('axios');
const vision = require('@google-cloud/vision');

const originalAxiosGet = axios.get;
const originalVisionClient = vision.ImageAnnotatorClient;

// ──────────────────────────────────────────────
// Test: initOcr
// ──────────────────────────────────────────────

describe('initOcr', () => {
  it('should initialize OCR client', () => {
    const mockCredentials = { type: 'service_account', project_id: 'test' };
    // Just ensure it doesn't throw
    initOcr(mockCredentials);
    assert.ok(true);
  });
});

// ──────────────────────────────────────────────
// Test: recognizePlate
// ──────────────────────────────────────────────

beforeEach(() => {
  // Setup mock vision client
  vision.ImageAnnotatorClient = function() {
    this.textDetection = async () => [null];
  };

  initOcr({ type: 'service_account', project_id: 'test' });
});

describe('recognizePlate', () => {
  it('should extract valid license plate from vision response', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        textAnnotations: [
          { description: '30A-12345' },
          { description: '30A' },
          { description: '12345' },
        ],
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '30A-12345');
    assert.ok(result.confidence > 0);
  });

  it('should handle multi-line plate detection', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        textAnnotations: [
          { description: '30A\n12345' }, // Multi-line format
          { description: '30A' },
          { description: '12345' },
        ],
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/plate.jpg');

    // Should still extract valid plate
    assert.ok(result.plateText !== '');
  });

  it('should return empty result when no text detected', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        textAnnotations: [], // Empty annotations
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/blank.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should use fallback when no valid plate found', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        textAnnotations: [
          { description: 'Random text with numbers 123 456' },
          { description: 'Random' },
        ],
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/bad.jpg');

    // Fallback should pick text with 2+ digits
    assert.ok(result.plateText !== '' || result.confidence === 0);
  });

  it('should handle image download error', async () => {
    axios.get = async () => {
      throw new Error('Download failed');
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://broken.example.com/image.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should handle vision API error response', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        error: { message: 'API error' },
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/error.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should prioritize valid format matches', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    // annotations[0] = full text (all lines), annotations[1..n] = individual blocks
    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        textAnnotations: [
          { description: '30A-12345\n51F1-99999' }, // Full text (line-separated)
          { description: '30A-12345' },
          { description: '51F1-99999' },
        ],
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/multiple.jpg');

    // Should pick one of the valid plates (highest score)
    assert.ok(['30A-12345', '51F1-99999'].includes(result.plateText));
    assert.ok(result.confidence > 0.5);
  });

  it('should return rawTexts array', async () => {
    axios.get = async () => {
      return {
        data: Buffer.from('fake image data'),
      };
    };

    vision.ImageAnnotatorClient = function() {
      this.textDetection = async () => [{
        textAnnotations: [
          { description: 'Full text' },
          { description: 'Full' },
          { description: 'text' },
        ],
      }];
    };

    initOcr({ type: 'service_account', project_id: 'test' });
    const result = await recognizePlate('https://example.com/text.jpg');

    assert.ok(Array.isArray(result.rawTexts));
    assert.ok(result.rawTexts.length > 0);
  });
});
