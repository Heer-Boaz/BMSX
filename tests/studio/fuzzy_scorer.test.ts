import assert from 'node:assert/strict';
import test from 'node:test';
import { CaseFoldedText } from '../../ide/common/search_text';
import { FuzzyScorer } from '../../ide/common/fuzzy_scorer';
import { scoreFuzzy } from '../helpers/vscode_fuzzy_scorer';

test('retained scorer preserves VS Code scoreFuzzy scores and positions, not just membership', () => {
	const scorer = new FuzzyScorer();
	const queries = [''];
	let first = 0, end = 1;
	for (let length = 1; length <= 3; length += 1) {
		for (let index = first; index < end; index += 1) for (const char of 'aAb/\\_.') queries.push(queries[index] + char);
		first = end; end = queries.length;
	}
	queries.push('ctrl', 'PC', 'pc', 'moo', 'src\\pc', 'fb', 'f_b', 'actor_start', 'not a match', 'mé');
	const targets = ['', 'a', 'b', 'Aa/b_a.lua', 'a_b-b/A', 'a..b_a/b.lua', 'a/.A/A..b.lua',
		'Controller.lua', 'game/actor_start.lua', 'src/PlayerController.ts', 'aabb', 'controller.lua',
		'moon_death_ray.lua', 'field_background.lua', 'métier.lua', `${'Aa._'.repeat(32)}b`];
	const positions = scorer.positions;
	for (const target of targets) {
		const text = new CaseFoldedText(target);
		for (const query of queries) {
			const expected = scoreFuzzy(target, query, query.toLowerCase(), true);
			const score = scorer.score(new CaseFoldedText(query), text);
			assert.equal(score, expected[0], `${query} in ${target}`);
			assert.deepEqual(scorer.positions, expected[1], `${query} in ${target}`);
			assert.equal(scorer.positions, positions);
		}
	}
});

test('fuzzy scoring has no 128-character cutoff and reuses storage across growing/shrinking dimensions', () => {
	const scorer = new FuzzyScorer();
	for (const [target, query] of [
		[`${'a'.repeat(256)}z`, 'az'], ['short/path.lua', 'sl'],
		[`start_${'long_'.repeat(40)}finish.lua`, `${'long_'.repeat(30)}finish`],
		['x', 'x'], ['mismatch', 'zz'], ['abc', 'ab'], ['aa'.repeat(128), 'a'.repeat(129)],
	]) {
		const expected = scoreFuzzy(target, query, query.toLowerCase(), true);
		assert.equal(scorer.score(new CaseFoldedText(query), new CaseFoldedText(target)), expected[0]);
		assert.deepEqual(scorer.positions, expected[1]);
	}
});

test('fold-expanded fuzzy positions map back to actual source characters instead of shifting the suffix', () => {
	const scorer = new FuzzyScorer(), target = new CaseFoldedText('İ/source_index.lua');
	assert.ok(scorer.score(new CaseFoldedText('srcidx'), target) > 0);
	const characters = scorer.positions.map(position => target.text.slice(target.sourceStart(position), target.sourceEnd(position + 1)));
	assert.equal(characters.join(''), 'srcidx');
	assert.ok(scorer.score(new CaseFoldedText('İ'), target) > 0);
	assert.deepEqual(scorer.positions.map(position => [target.sourceStart(position), target.sourceEnd(position + 1)]), [[0, 1], [0, 1]]);
});
