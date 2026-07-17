import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AudioOutputResampler } from '../../machine/ts/audio/output_resampler';
import { APU_SAMPLE_RATE_HZ } from '../../machine/ts/machine/devices/audio/contracts';
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

test('host audio resampling starts at the first interpolation window and retains chunk-continuous phase', () => {
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
	assert.equal(split.pull(splitRing, splitFirst, 17, 48000, 0.75), 17);
	assert.equal(split.pull(splitRing, splitSecond, 43, 48000, 0.75), 43);
	assert.equal(batch.pull(batchRing, batched, 60, 48000, 0.75), 60);
	assert.deepEqual(Array.from(splitFirst).concat(Array.from(splitSecond)), Array.from(batched));

	const immediateRing = new ApuOutputRing();
	immediateRing.write(source, 2);
	const immediateOutput = new Int16Array(2);
	assert.equal(new AudioOutputResampler().pull(immediateRing, immediateOutput, 1, APU_SAMPLE_RATE_HZ, 1), 1);
	assert.deepEqual(immediateOutput, source.subarray(0, 2));
});

test('host audio resampling preserves PAL phase across source starvation without publishing silence', () => {
	const sourceFramesPerPalFrame = APU_SAMPLE_RATE_HZ / 50;
	const outputFramesPerPalFrame = 48000 / 50;
	const source = sourceFrames(sourceFramesPerPalFrame * 2);

	const referenceRing = new ApuOutputRing();
	referenceRing.write(source, sourceFramesPerPalFrame * 2);
	const reference = new AudioOutputResampler();
	const referenceFirst = new Int16Array((outputFramesPerPalFrame - 1) * 2);
	const referenceSecond = new Int16Array(outputFramesPerPalFrame * 2);
	assert.equal(reference.pull(referenceRing, referenceFirst, outputFramesPerPalFrame - 1, 48000, 1), outputFramesPerPalFrame - 1);
	assert.equal(reference.pull(referenceRing, referenceSecond, outputFramesPerPalFrame, 48000, 1), outputFramesPerPalFrame);

	const starvedRing = new ApuOutputRing();
	starvedRing.write(source.subarray(0, sourceFramesPerPalFrame * 2), sourceFramesPerPalFrame);
	const starved = new AudioOutputResampler();
	const starvedFirst = new Int16Array(outputFramesPerPalFrame * 2);
	starvedFirst.fill(12345);
	const producedFirst = starved.pull(starvedRing, starvedFirst, outputFramesPerPalFrame, 48000, 1);
	assert.equal(producedFirst, outputFramesPerPalFrame - 1);
	assert.deepEqual(starvedFirst.subarray(0, producedFirst * 2), referenceFirst);
	assert.deepEqual(starvedFirst.subarray(producedFirst * 2), new Int16Array([12345, 12345]));

	starvedRing.write(source.subarray(sourceFramesPerPalFrame * 2), sourceFramesPerPalFrame);
	const recoveredSecond = new Int16Array(outputFramesPerPalFrame * 2);
	assert.equal(starved.pull(starvedRing, recoveredSecond, outputFramesPerPalFrame, 48000, 1), outputFramesPerPalFrame);
	assert.deepEqual(recoveredSecond, referenceSecond);
});
