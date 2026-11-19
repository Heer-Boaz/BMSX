import assert from 'node:assert/strict';
import test from 'node:test';
import { WordFifo } from '../../machine/ts/machine/devices/word_fifo';

test('bulk FIFO reads and transfers preserve raw words across both ring boundaries', () => {
	for (let sourceStart = 0; sourceStart < 8; sourceStart += 1) {
		for (let targetStart = 0; targetStart < 16; targetStart += 1) {
			for (let count = 0; count <= 8; count += 1) {
				const source = new WordFifo(8), target = new WordFifo(16);
				for (let index = 0; index < sourceStart; index += 1) { source.writeWord(0); source.pop(); }
				for (let index = 0; index < targetStart; index += 1) { target.writeWord(0); target.pop(); }
				const words = Array.from({ length: 8 }, (_, index) => (0xe1000000 + index) >>> 0);
				for (const word of words) source.writeWord(word);
				for (const word of [0, 0xffffffff, 0x50005000]) target.writeWord(word);
				source.transferWords(target, count);
				assert.equal(source.count(), 8 - count);
				assert.equal(target.count(), 3 + count);
				assert.deepEqual(source.captureWords(), words.slice(count));
				const out = new Uint32Array(16).fill(0xdeadbeef);
				target.readWords(out, 2, 3 + count);
				assert.deepEqual(Array.from(out), [0xdeadbeef, 0xdeadbeef, 0, 0xffffffff, 0x50005000,
					...words.slice(0, count), ...new Array(11 - count).fill(0xdeadbeef)]);
				assert.equal(target.empty(), true);
				for (let index = 0; index < 16; index += 1) target.writeWord(index);
				assert.deepEqual(target.captureWords(), Array.from({ length: 16 }, (_, index) => index));
			}
		}
	}
});

test('FIFO burst writes match scalar ring order through wraps and partial/full ranges', () => {
	for (const capacity of [4, 16, 64]) {
		const scalar = new WordFifo(capacity), burst = new WordFifo(capacity);
		const words = new Uint32Array(capacity + 1);
		for (let round = 0; round < 513; ++round) {
			const remove = Math.min(scalar.count(), round % (capacity + 1));
			for (let n = 0; n < remove; ++n) assert.equal(burst.pop(), scalar.pop());
			const count = Math.min(scalar.free(), (round * 7) % (capacity + 1));
			for (let n = 0; n < count; ++n) {
				words[n + 1] = 0xf1234567 + round * capacity + n;
				scalar.writeWord(words[n + 1]);
			}
			burst.writeWords(words, 1, count);
			assert.equal(burst.count(), scalar.count());
			assert.deepEqual(burst.captureWords(), scalar.captureWords());
		}
	}
});
