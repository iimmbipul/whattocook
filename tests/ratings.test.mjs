// Unit tests for the meal rating rules. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addScore, addToWeeks, attendedSession, average, cleanComment, dishAverages, emptyScore,
    isSessionOpen, isStars, localTime, mergeScores, openSessions, parseRatingInput, ratingTargets,
    scoreAverage, trendSeries, weekStart,
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

const lunchDay = { breakfast: 'Poha', lunch: 'Rajma chawal' };

test('dishes go to the hired cook, the duty to the chef', () => {
    const t = ratingTargets({ session: 'breakfastLunch', dishNames: lunchDay, attendance: undefined, chefUid: 'manu', hiredCookUids: ['ramesh'], raterUid: 'riya' });
    assert.deepEqual(t, {
        dishes: [{ slot: 'breakfast', name: 'Poha' }, { slot: 'lunch', name: 'Rajma chawal' }],
        cookUids: ['ramesh'],
        chefUid: 'manu',
    });

    // Only the meals you ate.
    const skippedBreakfast = ratingTargets({ session: 'breakfastLunch', dishNames: lunchDay, attendance: { breakfast: false }, chefUid: 'manu', hiredCookUids: ['ramesh'], raterUid: 'riya' });
    assert.deepEqual(skippedBreakfast.dishes, [{ slot: 'lunch', name: 'Rajma chawal' }]);

    // Two hired cooks share the credit.
    assert.deepEqual(ratingTargets({ session: 'dinner', dishNames: { dinner: 'Dal' }, attendance: undefined, chefUid: null, hiredCookUids: ['ramesh', 'sita'], raterUid: 'riya' }).cookUids, ['ramesh', 'sita']);
});

test('nobody rates their own work', () => {
    // The chef rates the hired cook's dishes, but not their own duty.
    const chef = ratingTargets({ session: 'dinner', dishNames: { dinner: 'Dal' }, attendance: undefined, chefUid: 'manu', hiredCookUids: ['ramesh'], raterUid: 'manu' });
    assert.deepEqual(chef, { dishes: [{ slot: 'dinner', name: 'Dal' }], cookUids: ['ramesh'], chefUid: null });

    // No hired cook: the chef cooked, so flatmates rate both for the chef, and the chef rates nothing.
    const flatmate = ratingTargets({ session: 'dinner', dishNames: { dinner: 'Dal' }, attendance: undefined, chefUid: 'manu', hiredCookUids: [], raterUid: 'riya' });
    assert.deepEqual(flatmate, { dishes: [{ slot: 'dinner', name: 'Dal' }], cookUids: ['manu'], chefUid: 'manu' });
    const self = ratingTargets({ session: 'dinner', dishNames: { dinner: 'Dal' }, attendance: undefined, chefUid: 'manu', hiredCookUids: [], raterUid: 'manu' });
    assert.deepEqual(self, { dishes: [], cookUids: [], chefUid: null });

    // A hired cook on the rotation is still the cook, not a chef.
    assert.equal(ratingTargets({ session: 'dinner', dishNames: { dinner: 'Dal' }, attendance: undefined, chefUid: 'ramesh', hiredCookUids: ['ramesh'], raterUid: 'riya' }).chefUid, null);

    // Nothing planned, or nothing eaten: nothing to rate.
    assert.equal(ratingTargets({ session: 'dinner', dishNames: {}, attendance: undefined, chefUid: 'manu', hiredCookUids: ['ramesh'], raterUid: 'riya' }).chefUid, null);
    assert.equal(ratingTargets({ session: 'dinner', dishNames: { dinner: 'Dal' }, attendance: { dinner: false }, chefUid: 'manu', hiredCookUids: ['ramesh'], raterUid: 'riya' }).chefUid, null);
});

test('rating input: only what you may rate, at least one score', () => {
    const targets = { dishes: [{ slot: 'breakfast', name: 'Poha' }, { slot: 'lunch', name: 'Rajma chawal' }], cookUids: ['ramesh'], chefUid: 'manu' };
    assert.deepEqual(
        parseRatingInput({ dishes: [{ slot: 'lunch', stars: 4 }], chef: 5, cookNote: ' a bit\nsalty ', chefNote: 'great menu' }, targets),
        { dishes: [{ slot: 'lunch', stars: 4 }], chef: 5, cookNote: 'a bit salty', chefNote: 'great menu' },
    );
    // Notes only reach someone who was rated.
    assert.deepEqual(parseRatingInput({ chef: 3, cookNote: 'hi', chefNote: 'ok' }, targets), { dishes: [], chef: 3, cookNote: '', chefNote: 'ok' });

    assert.equal(parseRatingInput({}, targets), null, 'nothing rated');
    assert.equal(parseRatingInput({ dishes: [{ slot: 'dinner', stars: 4 }] }, targets), null, 'not a dish of this session');
    assert.equal(parseRatingInput({ dishes: [{ slot: 'lunch', stars: 4 }, { slot: 'lunch', stars: 2 }] }, targets), null, 'same dish twice');
    assert.equal(parseRatingInput({ dishes: [{ slot: 'lunch', stars: 6 }] }, targets), null, 'bad stars');
    assert.equal(parseRatingInput({ chef: 4 }, { ...targets, chefUid: null }), null, 'no chef to rate');
    assert.equal(parseRatingInput({ dishes: 'lunch' }, targets), null);
});

test('validation', () => {
    assert.equal(isStars(5), true);
    for (const bad of [0, 6, 3.5, '4', null]) assert.equal(isStars(bad), false);
    assert.equal(cleanComment('  too\n\nsalty\u0000 '), 'too salty');
    assert.equal(cleanComment('x'.repeat(400)).length, 300);
});

test('averages use submitted ratings only, never zero for none', () => {
    assert.equal(scoreAverage(emptyScore()), null);
    const t = addScore(emptyScore(), 5, 4);
    assert.equal(scoreAverage(t), 4.5);
    assert.deepEqual(t.hist, [0, 0, 0, 1, 1]);
    assert.deepEqual(mergeScores(t, addScore(emptyScore(), 1)), { count: 3, sum: 10, hist: [1, 0, 0, 1, 1] });
    assert.equal(average(10, 3), 3.3);
});

test('weekly trend keeps gaps and the last 12 weeks', () => {
    assert.equal(weekStart('2026-11-22'), '2026-11-16');
    let w = {};
    for (let i = 0; i < 15; i++) w = addToWeeks(w, `2026-0${i < 9 ? 8 : 9}-0${(i % 9) + 1}`, [4]);
    assert.ok(Object.keys(w).length <= 12);
    const series = trendSeries(addToWeeks({}, '2026-11-18', [5, 4]), '2026-11-21');
    assert.equal(series.length, 12);
    assert.deepEqual(series.at(-1), { week: '2026-11-16', count: 2, average: 4.5 });
    assert.equal(series[0].average, null);
});

test('dish averages group the same dish, best first', () => {
    const list = dishAverages([
        { name: 'Rajma chawal', count: 2, sum: 9 },
        { name: 'rajma  Chawal', count: 1, sum: 3 },
        { name: 'Poha', count: 3, sum: 15 },
        { name: 'Dal', count: 1, sum: 4 },
        { name: 'Unrated', count: 0, sum: 0 },
    ]);
    assert.deepEqual(list.map(d => [d.name, d.average, d.count, d.times]), [
        ['Poha', 5, 3, 1],
        ['Rajma chawal', 4, 3, 2],
        ['Dal', 4, 1, 1],
    ]);
});
