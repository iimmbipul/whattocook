// Unit tests for the meal rating rules. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addRating, addToWeeks, attendedSession, average, averages, cleanComment, emptyTotals,
    isSessionOpen, isStars, localTime, openSessions, trendSeries, weekStart,
} from '../src/lib/ratings/logic.ts';

// 2026-11-21 10:00 and 15:00 in India (UTC+5:30).
const at10 = new Date('2026-11-21T04:30:00Z');
const at15 = new Date('2026-11-21T09:30:00Z');

test('local time uses the household time zone, not the device', () => {
    assert.deepEqual(localTime(new Date('2026-11-20T20:00:00Z')), { date: '2026-11-21', minutes: 90 });
});

test('open sessions follow meal boundaries', () => {
    assert.deepEqual(openSessions(at10), [
        { date: '2026-11-20', session: 'breakfastLunch' },
        { date: '2026-11-20', session: 'dinner' },
    ]);
    assert.deepEqual(openSessions(at15), [
        { date: '2026-11-20', session: 'dinner' },
        { date: '2026-11-21', session: 'breakfastLunch' },
    ]);
    assert.equal(isSessionOpen('2026-11-21', 'dinner', at15), false, 'dinner is not rateable before 21:00');
    assert.equal(isSessionOpen('2026-11-19', 'dinner', at10), false, 'expires after 24 hours');
});

test('attendance: skipped meals are not rated', () => {
    assert.equal(attendedSession(undefined, 'dinner'), true);
    assert.equal(attendedSession({ dinner: false }, 'dinner'), false);
    assert.equal(attendedSession({ breakfast: false, lunch: true }, 'breakfastLunch'), true);
    assert.equal(attendedSession({ breakfast: false, lunch: false }, 'breakfastLunch'), false);
});

test('validation', () => {
    assert.equal(isStars(5), true);
    for (const bad of [0, 6, 3.5, '4', null]) assert.equal(isStars(bad), false);
    assert.equal(cleanComment('  too\n\nsalty\u0000 '), 'too salty');
    assert.equal(cleanComment('x'.repeat(400)).length, 300);
});

test('averages use submitted ratings only, never zero for none', () => {
    assert.deepEqual(averages(emptyTotals()), { food: null, cook: null });
    let t = addRating(emptyTotals(), 5, 4);
    t = addRating(t, 4, null); // no cook score: does not lower the cook average
    assert.deepEqual(averages(t), { food: 4.5, cook: 4 });
    assert.deepEqual(t.foodHist, [0, 0, 0, 1, 1]);
    assert.equal(average(10, 3), 3.3);
});

test('weekly trend keeps gaps and the last 12 weeks', () => {
    assert.equal(weekStart('2026-11-22'), '2026-11-16');
    let w = {};
    for (let i = 0; i < 15; i++) w = addToWeeks(w, `2026-0${i < 9 ? 8 : 9}-0${(i % 9) + 1}`, 4, 3);
    assert.ok(Object.keys(w).length <= 12);
    const series = trendSeries(addToWeeks({}, '2026-11-18', 5, null), '2026-11-21');
    assert.equal(series.length, 12);
    assert.deepEqual(series.at(-1), { week: '2026-11-16', count: 1, food: 5, cook: null });
    assert.equal(series[0].food, null);
});
