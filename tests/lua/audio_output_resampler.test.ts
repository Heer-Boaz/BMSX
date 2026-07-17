import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AudioOutputResampler } from '../../machine/ts/audio/output_resampler';
import { ApuOutputRing } from '../../machine/ts/machine/devices/audio/output_ring';

function sourceFrames(frameCount: number): Int16Array {
	const samples = new Int16Array(frameCount * 2);
	for (let frame = 0; frame < frameCount; frame += 1) {
		samples[frame * 2] = frame * 13 - 12000;
		samples[frame * 2 + 1] = 12000 - frame * 7;
	}
	return samples;
}

test('APU output ring exposes stereo samples as one unsigned hardware word', () => {
	const ring = new ApuOutputRing();
	ring.write(new Int16Array([0x1234, -0x8000]), 1);
	assert.equal(ring.readFramePacked(), 0x80001234);
});

test('host audio resampling retains prebuffer and chunk-continuous phase', () => {
	const source = sourceFrames(2048);
	const splitRing = new ApuOutputRing();
	const batchRing = new ApuOutputRing();
	splitRing.write(source, 2048);
	batchRing.write(source, 2048);
	const split = new AudioOutputResampler();
	const batch = new AudioOutputResampler();
	const splitFirst = new Int16Array(34);
	const splitSecond = new Int16Array(86);
	const batched = new Int16Array(120);
	split.pull(splitRing, splitFirst, 17, 48000, 0.75, 1024);
	split.pull(splitRing, splitSecond, 43, 48000, 0.75, 1024);
	batch.pull(batchRing, batched, 60, 48000, 0.75, 1024);
	assert.deepEqual(Array.from(splitFirst).concat(Array.from(splitSecond)), Array.from(batched));

	const waitingRing = new ApuOutputRing();
	waitingRing.write(source, 1000);
	const waiting = new AudioOutputResampler();
	const silence = new Int16Array(8);
	waiting.pull(waitingRing, silence, 4, 48000, 1, 1024);
	assert.deepEqual(Array.from(silence), [0, 0, 0, 0, 0, 0, 0, 0]);
	assert.equal(waitingRing.queuedFrames(), 1000);
	waitingRing.write(source, 24);
	waiting.pull(waitingRing, silence, 4, 48000, 1, 1024);
	assert.notDeepEqual(Array.from(silence), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('host audio resampling restarts from a fresh interpolation window after underrun', () => {
	const starvedRing = new ApuOutputRing();
	starvedRing.write(sourceFrames(2), 2);
	const recovered = new AudioOutputResampler();
	const starvedOutput = new Int16Array(4);
	recovered.pull(starvedRing, starvedOutput, 2, 11025, 1, 2);
	assert.deepEqual(Array.from(starvedOutput.subarray(2)), [0, 0]);

	const refill = sourceFrames(16);
	const freshRing = new ApuOutputRing();
	starvedRing.write(refill, 16);
	freshRing.write(refill, 16);
	const recoveredOutput = new Int16Array(4);
	const freshOutput = new Int16Array(4);
	recovered.pull(starvedRing, recoveredOutput, 2, 11025, 1, 2);
	new AudioOutputResampler().pull(freshRing, freshOutput, 2, 11025, 1, 2);
	assert.deepEqual(recoveredOutput, freshOutput);
});
