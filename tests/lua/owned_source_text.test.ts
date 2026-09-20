import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OwnedSourceText } from '../../toolchain/ts/text/owned_source_text';

test('owned source spellings preserve UTF-16 including split surrogate pairs', () => {
	const source = ('ab😀\ud800c\udc00\r\n'.repeat(500));
	const text = new OwnedSourceText(source);
	for (let start = 0; start <= source.length; start += 37) {
		for (const width of [0, 1, 2, 10, 1023, 1024, 1025, 2050]) {
			const end = Math.min(source.length, start + width);
			assert.equal(text.slice(start, end), source.slice(start, end));
		}
	}
});

test('a local source spelling copies bounded chunks once, not the source prefix', t => {
	const source = 'x'.repeat(1024 * 10000) + 'last_value';
	const text = new OwnedSourceText(source);
	const charCodeAt = String.prototype.charCodeAt;
	let reads = 0;
	t.mock.method(String.prototype, 'charCodeAt', function(this: string, index: number) {
		reads++;
		return charCodeAt.call(this, index);
	});
	assert.equal(text.slice(source.length - 10, source.length), 'last_value');
	assert.equal(reads, 10);
	assert.equal(text.slice(source.length - 5, source.length), 'value');
	assert.equal(reads, 10);
	assert.equal(text.slice(2, 9), 'xxxxxxx');
	assert.equal(reads, 1034);
});
