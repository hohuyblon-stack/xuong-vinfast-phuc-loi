'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { initTelegram, extractUpdate, getFileUrl, sendMessage, setWebhook } = require('../src/telegram');

// Mock axios module
const axios = require('axios');

// Store original functions
const originalPost = axios.post;
const originalGet = axios.get;

// ──────────────────────────────────────────────
// Test: extractUpdate
// ──────────────────────────────────────────────

describe('extractUpdate', () => {
  it('should extract text message with sender info', () => {
    const update = {
      message: {
        message_id: 123,
        chat: { id: 456 },
        from: { id: 789, first_name: 'John', last_name: 'Doe' },
        text: 'Hello world',
      },
    };

    const result = extractUpdate(update);
    assert.deepEqual(result, {
      messageId: '123',
      chatId: '456',
      senderId: '789',
      senderName: 'John Doe',
      text: 'Hello world',
      imageFileId: '',
      documentFileId: '',
      documentName: '',
    });
  });

  it('should extract message with image', () => {
    const update = {
      message: {
        message_id: 100,
        chat: { id: 200 },
        from: { id: 300, first_name: 'Alice' },
        text: 'Check this',
        photo: [
          { file_id: 'photo_small_id' },
          { file_id: 'photo_large_id' }, // Should pick the largest (last)
        ],
      },
    };

    const result = extractUpdate(update);
    assert.equal(result.messageId, '100');
    assert.equal(result.imageFileId, 'photo_large_id');
  });

  it('should extract message with Excel document', () => {
    const update = {
      message: {
        message_id: 111,
        chat: { id: 222 },
        from: { id: 333, first_name: 'Bob' },
        text: '',
        document: {
          file_id: 'doc_file_id',
          file_name: 'orders.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
    };

    const result = extractUpdate(update);
    assert.equal(result.documentFileId, 'doc_file_id');
    assert.equal(result.documentName, 'orders.xlsx');
  });

  it('should ignore non-Excel documents', () => {
    const update = {
      message: {
        message_id: 222,
        chat: { id: 333 },
        from: { id: 444, first_name: 'Carol' },
        text: '',
        document: {
          file_id: 'pdf_file_id',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
        },
      },
    };

    const result = extractUpdate(update);
    assert.equal(result.documentFileId, '');
    assert.equal(result.documentName, '');
  });

  it('should handle messages without sender info', () => {
    const update = {
      message: {
        message_id: 333,
        chat: { id: 444 },
        from: null,
        text: 'Orphan message',
      },
    };

    const result = extractUpdate(update);
    assert.equal(result.senderName, '');
    assert.equal(result.senderId, 'null');
  });

  it('should return null for non-message updates', () => {
    const update = {
      callback_query: { id: 123 }, // Not a message
    };

    const result = extractUpdate(update);
    assert.equal(result, null);
  });

  it('should trim and normalize text', () => {
    const update = {
      message: {
        message_id: 444,
        chat: { id: 555 },
        from: { id: 666, first_name: 'Dave' },
        text: '  help  \n',
      },
    };

    const result = extractUpdate(update);
    assert.equal(result.text, 'help');
  });

  it('should use caption if text is missing', () => {
    const update = {
      message: {
        message_id: 555,
        chat: { id: 666 },
        from: { id: 777, first_name: 'Eve' },
        text: null,
        caption: 'Photo caption',
        photo: [{ file_id: 'photo_id' }],
      },
    };

    const result = extractUpdate(update);
    assert.equal(result.text, 'Photo caption');
  });
});

// ──────────────────────────────────────────────
// Test: initTelegram
// ──────────────────────────────────────────────

describe('initTelegram', () => {
  it('should initialize with bot token', () => {
    // Just check it doesn't throw
    initTelegram('test_bot_token_12345');
    assert.ok(true);
  });
});

// ──────────────────────────────────────────────
// Test: Mocked API calls (getFileUrl, sendMessage, setWebhook)
// ──────────────────────────────────────────────

beforeEach(() => {
  initTelegram('test_token');
});

afterEach(() => {
  axios.post = originalPost;
  axios.get = originalGet;
});

describe('getFileUrl', () => {
  it('should return correct file URL', async () => {
    axios.post = async (url, data) => {
      if (url.includes('getFile')) {
        return {
          data: {
            result: {
              file_path: 'documents/file.pdf',
            },
          },
        };
      }
    };

    const fileUrl = await getFileUrl('file_id_123');
    assert.ok(fileUrl.includes('documents/file.pdf'));
    assert.ok(fileUrl.includes('test_token'));
  });
});

describe('sendMessage', () => {
  it('should call axios.post with correct params', async () => {
    let called = false;
    let capturedChatId = '';
    let capturedMessage = '';

    axios.post = async (url, data) => {
      called = true;
      capturedChatId = data.chat_id;
      capturedMessage = data.text;
      return { data: { ok: true } };
    };

    await sendMessage('123456', 'Hello');

    assert.ok(called);
    assert.equal(capturedChatId, '123456');
    assert.equal(capturedMessage, 'Hello');
  });

  it('should not throw on API error', async () => {
    axios.post = async () => {
      throw new Error('Network error');
    };

    // Should not throw
    await sendMessage('123456', 'Test');
    assert.ok(true);
  });
});

describe('setWebhook', () => {
  it('should set webhook with URL and secret', async () => {
    let capturedBody = null;

    axios.post = async (url, data) => {
      if (url.includes('setWebhook')) {
        capturedBody = data;
        return { data: { ok: true } };
      }
    };

    await setWebhook('https://example.com/webhook', 'secret123');

    assert.ok(capturedBody);
    assert.equal(capturedBody.url, 'https://example.com/webhook');
    assert.equal(capturedBody.secret_token, 'secret123');
  });

  it('should throw on webhook error', async () => {
    axios.post = async () => {
      throw new Error('Webhook setup failed');
    };

    try {
      await setWebhook('https://example.com/webhook', 'secret');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('Webhook setup failed'));
    }
  });
});
