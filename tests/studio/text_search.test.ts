import assert from 'node:assert/strict';
import test from 'node:test';
import { LiteralTextMatcher, buildTextSearchSnippet } from '../../ide/common/search_text';

function collect(source: string, query: string, matchCase: boolean): readonly (readonly [number, number])[] {
	const cursor = new LiteralTextMatcher(query, matchCase).createCursor(source), matches: [number, number][] = [];
	const accept = (start: number, end: number) => { matches.push([start, end]); };
	while (cursor.step(accept)) {}
	assert.equal(cursor.offset, source.length);
	return matches;
}

function oracle(source: string, query: string, matchCase: boolean): readonly (readonly [number, number])[] {
	if (query === '') return [];
	const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'giu');
	return [...source.matchAll(expression)].map(match => [match.index, match.index + match[0].length]);
}

for (const matchCase of [false, true]) test(`literal search matches the full-source oracle across windows and surrogate boundaries (matchCase: ${matchCase})`, () => {
	const cases: readonly (readonly [string, string])[] = [
		['', 'target'], ['anything', ''], ['a.*[b]\\ a.*[b]\\', 'a.*[b]\\'],
		['a'.repeat(8191) + 'a'.repeat(8196), 'aa'],
		[' '.repeat(8190) + 'Needle'.repeat(3000), 'needle'],
		[' '.repeat(8191) + '😀x😀', '😀'],
		[' '.repeat(8191) + '😀x😀', '\ud83d'],
		[' '.repeat(8191) + '😀x😀', '\ude00'],
		[' '.repeat(8191) + '\u{10428}x\u{10400}', '\u{10400}'],
		[' '.repeat(8191) + 'ſkKSİx', 's'],
		[' '.repeat(8191) + 'ſkKSİx', 'k'],
		['x'.repeat(8190) + 'ab'.repeat(10000) + 'z', 'ab'.repeat(5000)],
	];
	for (const [source, query] of cases) assert.deepEqual(collect(source, query, matchCase), oracle(source, query, matchCase));
});

test('Unicode insensitive matches keep actual UTF-16 source indices without lowercase expansion semantics', () => {
	assert.deepEqual(collect('İx', 'x', false), [[1, 2]]);
	assert.deepEqual(collect('İx', 'i', false), []);
	assert.deepEqual(collect('İx', 'İ', false), [[0, 1]]);
	assert.deepEqual(collect('ſKkS', 'k', false), [[1, 2], [2, 3]]);
});

test('one dense-line step emits bounded matches and an abandoned cursor does no later work', () => {
	const cursor = new LiteralTextMatcher('a', true).createCursor('a'.repeat(1000000));
	let matches = 0;
	assert.equal(cursor.step(() => { matches++; }), true);
	assert.ok(matches > 0 && matches <= 256); assert.ok(cursor.offset < 8192);
	const sparse = new LiteralTextMatcher('missing', false).createCursor('x'.repeat(1000000));
	assert.equal(sparse.step(() => assert.fail('no match')), true);
	assert.ok(sparse.offset <= 8192);
});

test('independent cursors can interleave over one compiled insensitive matcher', () => {
	const matcher = new LiteralTextMatcher('x', false), first = matcher.createCursor('X'.repeat(1000)), second = matcher.createCursor('x'.repeat(700));
	const a: number[] = [], b: number[] = [];
	let pendingA = true, pendingB = true;
	while (pendingA || pendingB) {
		if (pendingA) pendingA = first.step(start => { a.push(start); });
		if (pendingB) pendingB = second.step(start => { b.push(start); });
	}
	assert.deepEqual(a, Array.from({ length: 1000 }, (_, index) => index));
	assert.deepEqual(b, Array.from({ length: 700 }, (_, index) => index));
});

test('snippets use bounded original text and exact highlights at line starts, CRLF and surrogate boundaries', () => {
	const start = buildTextSearchSnippet('needle ' + 'tail '.repeat(100), 0, 6);
	assert.equal(start.text.slice(start.matchStart, start.matchEnd), 'needle'); assert.ok(start.text.startsWith('needle'));
	const source = 'previous\r\n  needle  \r\nnext', offset = source.indexOf('needle');
	const line = buildTextSearchSnippet(source, offset, 6);
	assert.equal(line.text, '  needle  '); assert.equal(line.text.slice(line.matchStart, line.matchEnd), 'needle');
	const unicode = buildTextSearchSnippet('a😀needle😀z', 3, 6, 1);
	assert.equal(unicode.text.slice(unicode.matchStart, unicode.matchEnd), 'nee');
	assert.equal(unicode.text.charCodeAt(1), 0xd83d);
	const huge = buildTextSearchSnippet('a'.repeat(100000), 5000, 10000);
	assert.ok(huge.text.length <= 130); assert.ok(huge.matchEnd > huge.matchStart);
});
