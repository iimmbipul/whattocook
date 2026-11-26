// Unit tests for the grocery rules. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addDays, applyPinnedInterval, applyReport, applyRestock, buildTermIndex, cleanSettings, dailyChecks,
    learnInterval, matchItem, newPantryState, parseLevelWords, splitNote,
    exactItem, isMemberLevel, matchScore, pendingChecks, searchItems,
} from '../src/lib/grocery/logic.ts';

test('learning: shorter at once, longer halfway', () => {
    assert.equal(learnInterval(3, 2), 2);
    assert.equal(learnInterval(2, 5), 4); // ceil((2 + 5) / 2)
    assert.equal(learnInterval(3, 3), 3);
    assert.equal(learnInterval(10, 0), 1); // never below 1 day
    assert.equal(learnInterval(28, 60), 29); // halfway towards the 30-day maximum
    assert.equal(learnInterval(30, 60), 30); // never above 30 days
});

test('the onion example from the PRD', () => {
    const day = n => addDays('2026-11-20', n);
    let s = applyRestock(newPantryState(3, day(0)), day(0)); // Bought on day 0
    assert.equal(s.nextCheckDate, day(3));

    // Day 2: cook reports Empty on their own; it ran out in 2 days.
    let r = applyReport(s, 'empty', day(2));
    assert.deepEqual(r.change, { from: 3, to: 2, observedDays: 2 });
    assert.equal(r.state.intervalDays, 2);
    assert.equal(r.state.intervalSource, 'learned');

    // Someone taps Bought on day 2: next check on day 4.
    s = applyRestock(r.state, day(2));
    assert.equal(s.nextCheckDate, day(4));

    // Day 4: Quarter again after 2 days, so the interval stays at 2.
    r = applyReport(s, 'quarter', day(4));
    assert.equal(r.change, null);
    assert.equal(r.state.intervalDays, 2);

    // A slow week: bought on day 10, Quarter on day 15 → halfway from 2 to 5 = 4.
    s = applyRestock(r.state, day(10));
    r = applyReport(s, 'quarter', day(15));
    assert.equal(r.state.intervalDays, 4);
});

test('one lesson per cycle, and pinned intervals never change', () => {
    let s = applyRestock(newPantryState(5, '2026-11-01'), '2026-11-01');
    s = applyReport(s, 'quarter', '2026-11-03').state; // learns 5 → 2
    assert.equal(s.intervalDays, 2);
    s = applyReport(s, 'empty', '2026-11-06').state; // same cycle: no second lesson
    assert.equal(s.intervalDays, 2);

    let p = applyPinnedInterval(applyRestock(newPantryState(3, '2026-11-01'), '2026-11-01'), 7, '2026-11-01');
    assert.equal(p.intervalSource, 'pinned');
    p = applyReport(p, 'empty', '2026-11-02').state;
    assert.equal(p.intervalDays, 7);
});

test('half and quarter bring the next check forward', () => {
    const s = applyRestock(newPantryState(6, '2026-11-01'), '2026-11-01');
    assert.equal(applyReport(s, 'half', '2026-11-03').state.nextCheckDate, '2026-11-06'); // + ceil(6 / 2)
    assert.equal(applyReport(s, 'quarter', '2026-11-03').state.nextCheckDate, '2026-11-04'); // learned 2 → + ceil(2 / 4)
    assert.equal(applyReport(s, 'full', '2026-11-03').state.nextCheckDate, '2026-11-09');
});

test('the daily list: due or needed, most urgent first, capped', () => {
    const today = '2026-11-23';
    const c = (itemId, level, nextCheckDate, neededOn = null, extra = {}) =>
        ({ itemId, active: true, level, nextCheckDate, lastCheckedDate: null, neededOn, intervalDays: 7, ...extra });
    const list = dailyChecks([
        c('salt', 'full', '2026-11-30'), // not due, not needed: skip
        c('oil', 'full', '2026-11-22'), // due
        c('onion', 'unknown', '2026-11-23', '2026-11-24'), // needed tomorrow, unknown
        c('rajma', 'half', '2026-11-28', '2026-11-23'), // needed today, only half
        c('ghee', 'full', '2026-11-28', '2026-11-23'), // needed but full: skip
        c('atta', 'empty', '2026-11-20'), // empty: already on the list
        c('rice', 'half', '2026-11-22', null, { lastCheckedDate: today }), // checked today
        c('milk', 'quarter', '2026-11-21', null, { active: false }), // not tracked
    ], today, 8);
    assert.deepEqual(list, ['rajma', 'onion', 'oil']);
    assert.equal(dailyChecks([c('a', 'full', today), c('b', 'full', today), c('c', 'full', today)], today, 2).length, 2);

    // Among items needed the same day, fast-running ones (onion, every 3 days)
    // come before slow ones (cardamom, every 30), whatever their names.
    const spiced = dailyChecks([
        c('cardamom', 'unknown', today, today, { intervalDays: 30 }),
        c('bay_leaf', 'unknown', today, today, { intervalDays: 30 }),
        c('onion', 'unknown', today, today, { intervalDays: 3 }),
        c('tomato', 'unknown', today, today, { intervalDays: 2 }),
    ], today, 2);
    assert.deepEqual(spiced, ['tomato', 'onion']);
});

test('settings are clamped to sane values', () => {
    assert.deepEqual(cleanSettings({ lookAheadDays: 30, dailyCheckCap: 0, learning: 'yes' }), { lookAheadDays: 7, dailyCheckCap: 3, learning: true });
    assert.deepEqual(cleanSettings(null), { lookAheadDays: 3, dailyCheckCap: 8, learning: true });
});

test('typed notes in Hinglish, Hindi and Odia', () => {
    const index = buildTermIndex([
        { id: 'onion', names: ['Onion', 'प्याज़', 'ପିଆଜ', 'pyaz', 'pyaaz', 'kanda'] },
        { id: 'green_chilli', names: ['Green chilli', 'hari mirch'] },
        { id: 'chilli_powder', names: ['Red chilli powder', 'chilli powder'] },
        { id: 'atta', names: ['Atta', 'आटा', 'ଅଟା', 'wheat flour'] },
        { id: 'sugar', names: ['Sugar', 'चीनी', 'ଚିନି', 'cheeni'] },
    ]);
    assert.equal(matchItem(index, 'pyaz khatam'), 'onion');
    assert.equal(matchItem(index, 'Onions'), 'onion');
    assert.equal(matchItem(index, 'green chilli'), 'green_chilli');
    assert.equal(matchItem(index, 'आटा आधा है'), 'atta');
    assert.equal(matchItem(index, 'ଚିନି ସରିଗଲା'), 'sugar');
    assert.equal(matchItem(index, 'dhaniya patta'), null);

    assert.equal(parseLevelWords('pyaz khatam'), 'empty');
    assert.equal(parseLevelWords('आटा आधा है'), 'half');
    assert.equal(parseLevelWords('ଚିନି ସରିଗଲା'), 'empty');
    assert.equal(parseLevelWords('cheeni thoda'), 'quarter');
    assert.equal(parseLevelWords('dhaniya patta'), null);

    assert.deepEqual(splitNote('pyaz khatam, aata aadha aur cheeni thoda'), ['pyaz khatam', 'aata aadha', 'cheeni thoda']);
});

const ITEMS = [
    { id: 'onion', names: ['Onion', 'प्याज़', 'ପିଆଜ', 'pyaz', 'kanda', 'onions'] },
    { id: 'green_chilli', names: ['Green chilli', 'हरी मिर्च', 'hari mirch', 'mirchi'] },
    { id: 'tomato', names: ['Tomato', 'टमाटर', 'tamatar'] },
    { id: 'custom-paneer', names: ['Paneer', 'पनीर'] },
];

test('members can only set Out of stock or Full', () => {
    assert.equal(isMemberLevel('empty'), true);
    assert.equal(isMemberLevel('full'), true);
    assert.equal(isMemberLevel('half'), false);
    assert.equal(isMemberLevel('quarter'), false);
    assert.equal(isMemberLevel(undefined), false);
});

test('search: exact, prefix, word prefix and substring, any language or spelling', () => {
    assert.equal(matchScore(['Onion'], 'onion'), 100);
    assert.equal(matchScore(['Tomato'], 'tomatoes'), 95); // plural dropped
    assert.equal(matchScore(['Onion'], 'oni'), 80);
    assert.equal(matchScore(['Green chilli'], 'chil'), 60);
    assert.equal(matchScore(['Paneer'], 'nee'), 40);
    assert.equal(matchScore(['Paneer'], 'ne'), 0); // substrings need 3+ letters
    assert.deepEqual(searchItems(ITEMS, 'pyaz').map(i => i.id), ['onion']);
    assert.deepEqual(searchItems(ITEMS, 'प्याज़').map(i => i.id), ['onion']);
    assert.deepEqual(searchItems(ITEMS, 'mir').map(i => i.id), ['green_chilli']);
    assert.deepEqual(searchItems(ITEMS, 'xyz'), []);
    assert.equal(searchItems(ITEMS, 'a', 2).length <= 2, true);
});

test('adding a name that already exists marks that item instead of a duplicate', () => {
    assert.equal(exactItem(ITEMS, 'Onions')?.id, 'onion');
    assert.equal(exactItem(ITEMS, '  PYAZ ')?.id, 'onion');
    assert.equal(exactItem(ITEMS, 'paneer')?.id, 'custom-paneer');
    assert.equal(exactItem(ITEMS, 'oni'), null); // a prefix is not the same item
    assert.equal(exactItem(ITEMS, 'Mushroom'), null);
});

test('the daily stock-check list is fixed; items checked today by anyone drop off', () => {
    const today = '2026-11-26';
    const items = new Map([
        ['onion', { active: true, lastCheckedDate: today }], // member marked it this morning
        ['rice', { active: true, lastCheckedDate: '2026-11-20' }],
        ['salt', { active: false, lastCheckedDate: null }], // no longer tracked
        ['milk', { active: true, lastCheckedDate: null }],
    ]);
    assert.deepEqual(pendingChecks(['onion', 'rice', 'salt', 'milk', 'gone'], items, today), ['rice', 'milk']);
    assert.deepEqual(pendingChecks([], items, today), []);
});

test('a member marking Out of stock follows the same rules as the cook', () => {
    const day = n => addDays('2026-11-20', n);
    const s = applyRestock(newPantryState(5, day(0)), day(0));
    const r = applyReport(s, 'empty', day(3)); // ran out after 3 days
    assert.equal(r.state.level, 'empty');
    assert.equal(r.state.intervalDays, 3);
    assert.equal(r.state.lastCheckedDate, day(3));
    const full = applyReport(r.state, 'full', day(4)); // marked Full: a new cycle starts
    assert.equal(full.state.lastRestockDate, day(4));
    assert.equal(full.state.nextCheckDate, day(7));
});
