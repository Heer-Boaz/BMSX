import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { SteppedHeadlessFrameLoop, UnpacedHeadlessFrameLoop } from '../../hosts/node/headless/frame_loop';

test('unpaced frame loop does not dispatch a frame after a timer stops it', async () => {
	const clock = new VirtualHeadlessClock();
	const frames = new UnpacedHeadlessFrameLoop(clock, 20);
	let frameCount = 0;
	let frameLoop: { stop(): void };
	clock.scheduleOnce(20, () => frameLoop.stop());
	frameLoop = frames.start(() => {
		frameCount += 1;
	});

	await new Promise<void>(resolve => setImmediate(resolve));

	assert.equal(frameCount, 0);
});

test('stepped host advances only on demand, with no frames between remote key edges', async () => {
	const clock = new VirtualHeadlessClock();
	const frames = new SteppedHeadlessFrameLoop(clock, 20);
	const observed: number[] = [];
	const loop = frames.start(time => observed.push(time));
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(observed, []);
	frames.requestFrame();
	frames.requestFrame();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(observed, [20]);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(observed, [20]);
	frames.requestFrame();
	loop.stop();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(observed, [20]);
});
