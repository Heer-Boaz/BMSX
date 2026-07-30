import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HeadlessVideoOutput } from '../../hosts/node/headless/video_output';

test('headless presentation borrows the retained scanout without copying it', () => {
	const output = new HeadlessVideoOutput(2, 1);
	const scanout = new Uint8Array([
		0x11, 0x22, 0x33, 0x00,
		0x44, 0x55, 0x66, 0x80,
	]);
	output.presentSoftwareFrame(scanout, 2, 1);

	const presented = output.borrowPresentedPixels();
	assert.equal(presented, scanout);
});
