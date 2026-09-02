import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { UnpacedHeadlessFrameLoop } from '../../hosts/node/headless/frame_loop';

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
