import assert from 'node:assert/strict';
import test from 'node:test';
import { CaseFoldedText } from '../../ide/common/search_text';
import { FuzzySymbolScorer } from '../../ide/common/fuzzy_symbol_scorer';
import { fuzzyScore } from '../helpers/vscode_fuzzy_symbol_scorer';

test('retained symbol scorer preserves the production scores and alignments across changing bounds', () => {
	const scorer = new FuzzySymbolScorer(), storage = scorer.positions;
	const queries = ['', 'pcc', 'editor', 'mm', 'é', 'actor_start', 'fb', 'abc', 'nomatch'];
	let words = [''];
	for (let length = 0; length < 3; length += 1) {
		words = words.flatMap(prefix => [...'aAb_.'].map(char => prefix + char)); queries.push(...words);
	}
	const targets = ['', 'a', 'b', 'aabb', 'a_abAb', 'A_B.a(b)', 'ab.Aab..b_A', 'a A B a',
		'makeMember', 'memberManager', 'PlayerCharacterController', 'owner.actor_start', 'owner.base_start',
		'findByOwner', 'some.editor.model', 'écriture', 'Aa/🦉_b', 'a\tAb', 'a$/b', 'a<Ab>{b}',
		`${'Ab_a_'.repeat(20)}z`];
	for (const target of targets) for (const query of queries) {
		const expected = fuzzyScore(query, query.toLowerCase(), 0, target, target.toLowerCase(), 0,
			{ firstMatchCanBeWeak: true, boostFullMatch: true });
		const actual = scorer.score(new CaseFoldedText(query), new CaseFoldedText(target));
		assert.equal(actual, expected?.[0], `${query} in ${target}`);
		assert.deepEqual(scorer.positions, expected === undefined ? [] : expected.slice(2).reverse(), `${query} in ${target}`);
		assert.equal(scorer.positions, storage);
	}
});

test('symbol matching keeps negative scores and full queries beyond the upstream fixed table bound', () => {
	const scorer = new FuzzySymbolScorer();
	const long = 'a'.repeat(160) + 'Z';
	const score = scorer.score(new CaseFoldedText('aZ'), new CaseFoldedText(long))!;
	assert.ok(score < 0); assert.deepEqual(scorer.positions, [0, 160]);
	assert.equal(scorer.score(new CaseFoldedText('aZq'), new CaseFoldedText(long)), undefined, 'a matched prefix cannot hide a missing suffix');
	const same = 'a'.repeat(160);
	assert.ok(scorer.score(new CaseFoldedText(same), new CaseFoldedText(same))! > 0);
	assert.deepEqual(scorer.positions, Array.from({ length: 160 }, (_, index) => index));
	assert.equal(scorer.score(new CaseFoldedText('a'), new CaseFoldedText('a')), 4);
	assert.equal(scorer.score(new CaseFoldedText('b'), new CaseFoldedText('a')), undefined);
	assert.ok(scorer.score(new CaseFoldedText('aZ'), new CaseFoldedText(long))! < 0);
	assert.deepEqual(scorer.positions, [0, 160]);
});

test('symbol score positions stay in the search representation until the text owner maps them to source', () => {
	const scorer = new FuzzySymbolScorer(), target = new CaseFoldedText('İ.owner_source');
	assert.notEqual(scorer.score(new CaseFoldedText('İos'), target), undefined);
	const characters = scorer.positions.map(index => target.text.slice(target.sourceStart(index), target.sourceEnd(index + 1)));
	assert.deepEqual(characters, ['İ', 'İ', 'o', 's']);
});
