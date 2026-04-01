'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Must mock before requiring ocr module
const originalPost = axios.post;
const originalGet = axios.get;

const { initOcr, recognizePlate } = require('../src/ocr');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockImageDownload() {
  // JPEG magic bytes + dummy data
  const jpegBuffer = Buffer.from([0xFF, 0xD8, 0x00, 0x00]);
  axios.get = async () => ({ data: jpegBuffer });
}

function mockPoeResponse(content) {
  axios.post = async () => ({
    data: {
      choices: [{ message: { content } }],
    },
  });
}

function mockPoeError(status, data) {
  axios.post = async () => {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data };
    throw err;
  };
}

// ──────────────────────────────────────────────
// Setup / Teardown
// ──────────────────────────────────────────────

beforeEach(() => {
  mockImageDownload();
  initOcr({ apiKey: 'test-key', model: 'GPT-4o-mini' });
});

afterEach(() => {
  axios.post = originalPost;
  axios.get = originalGet;
});

// ──────────────────────────────────────────────
// Test: initOcr
// ──────────────────────────────────────────────

describe('initOcr', () => {
  it('should initialize with apiKey and model', () => {
    assert.doesNotThrow(() => {
      initOcr({ apiKey: 'test-key', model: 'GPT-4o-mini' });
    });
  });

  it('should default to GPT-4o-mini model', () => {
    assert.doesNotThrow(() => {
      initOcr({ apiKey: 'test-key' });
    });
  });
});

// ──────────────────────────────────────────────
// Test: recognizePlate — success cases
// ──────────────────────────────────────────────

describe('recognizePlate', () => {
  it('should extract valid license plate from Poe response', async () => {
    mockPoeResponse('{"plate": "30A-12345", "vehicle_model": "VF 8"}');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '30A-12345');
    assert.ok(result.confidence >= 0.8);
    assert.equal(result.vehicleModel, 'VF 8');
    assert.ok(result.modelConfidence > 0);
  });

  it('should handle plate without vehicle model', async () => {
    mockPoeResponse('{"plate": "51F1-99999", "vehicle_model": ""}');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '51F1-99999');
    assert.ok(result.confidence > 0);
    assert.equal(result.vehicleModel, '');
  });

  it('should handle response with extra text around JSON', async () => {
    mockPoeResponse('Here is the result:\n{"plate": "29B1-23456", "vehicle_model": "Fadil"}\nDone.');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '29B1-23456');
    assert.equal(result.vehicleModel, 'Fadil');
  });

  it('should return lower confidence for non-standard plate format', async () => {
    mockPoeResponse('{"plate": "ABCD1234", "vehicle_model": ""}');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.confidence, 0.5);
  });

  it('should return empty result when no plate detected', async () => {
    mockPoeResponse('{"plate": "", "vehicle_model": ""}');

    const result = await recognizePlate('https://example.com/blank.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should store raw LLM response in rawTexts', async () => {
    const response = '{"plate": "30A-12345", "vehicle_model": ""}';
    mockPoeResponse(response);

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.ok(Array.isArray(result.rawTexts));
    assert.equal(result.rawTexts[0], response);
  });

  // ──────────────────────────────────────────────
  // Test: recognizePlate — error handling
  // ──────────────────────────────────────────────

  it('should handle Poe API 403 error gracefully', async () => {
    mockPoeError(403, '403 Forbidden');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should handle Poe API 429 rate limit', async () => {
    mockPoeError(429, 'Rate limited');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should handle image download failure', async () => {
    axios.get = async () => { throw new Error('Download failed'); };

    const result = await recognizePlate('https://broken.example.com/image.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should handle malformed JSON response', async () => {
    mockPoeResponse('I cannot read this image clearly');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should handle invalid JSON that matches regex but fails parse', async () => {
    // Contains { } but invalid JSON inside — hits the catch block in parseOcrResponse
    mockPoeResponse('Result: {plate: broken, not valid json}');

    const result = await recognizePlate('https://example.com/plate.jpg');

    assert.equal(result.plateText, '');
    assert.equal(result.confidence, 0);
  });

  it('should detect PNG mime type', async () => {
    // PNG magic bytes: 0x89 0x50
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    axios.get = async () => ({ data: pngBuffer });
    mockPoeResponse('{"plate": "30A-12345", "vehicle_model": ""}');

    const result = await recognizePlate('https://example.com/plate.png');

    assert.equal(result.plateText, '30A-12345');
  });

  it('should fallback to jpeg for unknown image format', async () => {
    // Unknown magic bytes — hits the default return
    const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    axios.get = async () => ({ data: unknownBuffer });
    mockPoeResponse('{"plate": "30A-12345", "vehicle_model": ""}');

    const result = await recognizePlate('https://example.com/plate.bmp');

    assert.equal(result.plateText, '30A-12345');
  });

  it('should throw if initOcr was not called', async () => {
    // Reset by passing null key
    initOcr({ apiKey: null });

    // recognizePlate uses poeApiKey check
    await assert.rejects(
      () => recognizePlate('https://example.com/plate.jpg'),
      { message: /not initialized/ },
    );
  });

  // ──────────────────────────────────────────────
  // Test: Poe API request format
  // ──────────────────────────────────────────────

  it('should send correct request format to Poe API', async () => {
    let capturedUrl, capturedBody, capturedHeaders;

    axios.post = async (url, body, config) => {
      capturedUrl = url;
      capturedBody = body;
      capturedHeaders = config.headers;
      return { data: { choices: [{ message: { content: '{"plate":"30A-12345","vehicle_model":""}' } }] } };
    };

    await recognizePlate('https://example.com/plate.jpg');

    assert.ok(capturedUrl.includes('api.poe.com/v1'));
    assert.equal(capturedBody.model, 'GPT-4o-mini');
    assert.ok(capturedBody.messages[0].content[1].type, 'image_url');
    assert.ok(capturedHeaders['Authorization'].startsWith('Bearer '));
    assert.ok(capturedBody.max_tokens >= 16);
  });
});
