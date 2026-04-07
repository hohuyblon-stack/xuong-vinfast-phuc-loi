'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectAnomalies,
  fallbackNarrative,
  buildUserPrompt,
  PERSONA_SYSTEM_PROMPT,
} = require('../src/ai-briefing');

// ──────────────────────────────────────────────
// Persona prompt sanity check
// ──────────────────────────────────────────────

describe('PERSONA_SYSTEM_PROMPT', () => {
  it('uses correct Vietnamese pronouns (em / anh-chi)', () => {
    assert.match(PERSONA_SYSTEM_PROMPT, /xưng "em"/i);
    assert.match(PERSONA_SYSTEM_PROMPT, /anh.{0,3}chị/i);
  });

  it('forbids hallucination', () => {
    assert.match(PERSONA_SYSTEM_PROMPT, /KHÔNG bịa|TUYỆT ĐỐI không bịa/i);
  });
});

// ──────────────────────────────────────────────
// detectAnomalies — pure rules engine
// ──────────────────────────────────────────────

describe('detectAnomalies', () => {
  const baseSnapshot = {
    todayIn: 12,
    todayOut: 10,
    activelyRepairing: 8,
    ghostCount: 0,
    weeklyAvgIn: 12,
    weeklyAvgOut: 10,
    currentHour: 14,
  };

  it('returns no anomalies for healthy snapshot', () => {
    const result = detectAnomalies(baseSnapshot);
    assert.equal(result.length, 0);
  });

  it('detects NO_TRAFFIC_AM (after 10am, 0 in, weekly avg high)', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      todayIn: 0,
      currentHour: 11,
    });
    const codes = result.map(a => a.code);
    assert.ok(codes.includes('NO_TRAFFIC_AM'), `expected NO_TRAFFIC_AM, got ${codes}`);
  });

  it('does NOT trigger NO_TRAFFIC_AM before 10am', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      todayIn: 0,
      currentHour: 9,
    });
    assert.ok(!result.find(a => a.code === 'NO_TRAFFIC_AM'));
  });

  it('does NOT trigger NO_TRAFFIC_AM if weekly average is low', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      todayIn: 0,
      currentHour: 12,
      weeklyAvgIn: 3, // workshop barely used
    });
    assert.ok(!result.find(a => a.code === 'NO_TRAFFIC_AM'));
  });

  it('detects LOW_TRAFFIC after 14h', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      todayIn: 2, // 2 vs 12 avg = 17%, well below 30% threshold
      currentHour: 15,
      weeklyAvgIn: 12,
    });
    const codes = result.map(a => a.code);
    assert.ok(codes.includes('LOW_TRAFFIC'));
  });

  it('detects GHOST_DOMINANT when ghosts >= active', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      activelyRepairing: 2,
      ghostCount: 7,
    });
    const ghost = result.find(a => a.code === 'GHOST_DOMINANT');
    assert.ok(ghost, 'expected GHOST_DOMINANT anomaly');
    assert.equal(ghost.severity, 'urgent');
    assert.match(ghost.message, /77%|78%/); // 7/9 = 77.7%
  });

  it('detects MANY_GHOSTS when count >= 5 (and not already GHOST_DOMINANT)', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      activelyRepairing: 20,
      ghostCount: 5,
    });
    const codes = result.map(a => a.code);
    assert.ok(codes.includes('MANY_GHOSTS'));
    assert.ok(!codes.includes('GHOST_DOMINANT'), 'should not double-flag');
  });

  it('does not double-flag MANY_GHOSTS if GHOST_DOMINANT fires', () => {
    const result = detectAnomalies({
      ...baseSnapshot,
      activelyRepairing: 1,
      ghostCount: 7,
    });
    const codes = result.map(a => a.code);
    assert.ok(codes.includes('GHOST_DOMINANT'));
    assert.ok(!codes.includes('MANY_GHOSTS'));
  });
});

// ──────────────────────────────────────────────
// fallbackNarrative — deterministic voice
// ──────────────────────────────────────────────

describe('fallbackNarrative', () => {
  it('says ổn when no anomalies and traffic near average', () => {
    const text = fallbackNarrative(
      { todayIn: 11, todayOut: 10, activelyRepairing: 8, ghostCount: 0, weeklyAvgIn: 12 },
      [],
    );
    assert.match(text, /ổn/i);
    assert.match(text, /em/i);
  });

  it('uses "em" pronoun consistently', () => {
    const text = fallbackNarrative(
      { todayIn: 0, todayOut: 0, activelyRepairing: 0, ghostCount: 0, weeklyAvgIn: 0 },
      [],
    );
    assert.match(text, /\bem\b/i);
  });

  it('lead with "có vấn đề" for urgent anomaly', () => {
    const text = fallbackNarrative(
      { todayIn: 5, todayOut: 5, activelyRepairing: 1, ghostCount: 8, weeklyAvgIn: 12 },
      [{ severity: 'urgent', code: 'GHOST_DOMINANT', message: 'Có 8 xe ma trong DB.' }],
    );
    assert.match(text, /có vấn đề/i);
  });

  it('lead with "cần chú ý" for warning-only', () => {
    const text = fallbackNarrative(
      { todayIn: 2, todayOut: 5, activelyRepairing: 5, ghostCount: 0, weeklyAvgIn: 12 },
      [{ severity: 'warning', code: 'LOW_TRAFFIC', message: 'Hôm nay vắng.' }],
    );
    assert.match(text, /cần.*chú ý/i);
  });

  it('mentions 18h sweep when ghostCount > 0', () => {
    const text = fallbackNarrative(
      { todayIn: 5, todayOut: 5, activelyRepairing: 5, ghostCount: 3, weeklyAvgIn: 12 },
      [{ severity: 'warning', code: 'MANY_GHOSTS', message: 'Có 3 xe nghi.' }],
    );
    assert.match(text, /18h/);
  });
});

// ──────────────────────────────────────────────
// buildUserPrompt — context formatting
// ──────────────────────────────────────────────

describe('buildUserPrompt', () => {
  it('includes all snapshot numbers', () => {
    const prompt = buildUserPrompt(
      {
        today: '07/04/2026',
        currentTime: '08:00',
        todayIn: 12,
        todayOut: 10,
        activelyRepairing: 8,
        ghostCount: 3,
        weeklyAvgIn: 11,
        weeklyAvgOut: 9,
      },
      [],
    );
    assert.match(prompt, /07\/04\/2026/);
    assert.match(prompt, /12 xe/);
    assert.match(prompt, /TB tuần: 11/);
    assert.match(prompt, /3 xe/);
  });

  it('formats anomalies as bullet list', () => {
    const prompt = buildUserPrompt(
      {
        today: '07/04', currentTime: '14:00', todayIn: 0, todayOut: 0,
        activelyRepairing: 0, ghostCount: 5, weeklyAvgIn: 10, weeklyAvgOut: 10,
      },
      [
        { severity: 'urgent', code: 'X', message: 'msg one' },
        { severity: 'warning', code: 'Y', message: 'msg two' },
      ],
    );
    assert.match(prompt, /\[urgent\] msg one/);
    assert.match(prompt, /\[warning\] msg two/);
  });

  it('shows "không có gì bất thường" when no anomalies', () => {
    const prompt = buildUserPrompt(
      {
        today: '07/04', currentTime: '14:00', todayIn: 12, todayOut: 10,
        activelyRepairing: 8, ghostCount: 0, weeklyAvgIn: 12, weeklyAvgOut: 10,
      },
      [],
    );
    assert.match(prompt, /không có gì bất thường/);
  });
});
