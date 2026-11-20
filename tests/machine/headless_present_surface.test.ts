import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';

test('headless presentation borrows the retained scanout without copying it', () => {
	const backend = new HeadlessGPUBackend(2, 1, 0);
	backend.resizePresentationTarget(2, 1);
	const scanout = backend.framebufferPixels;
	scanout.set([
		0x11, 0x22, 0x33, 0x00,
		0x44, 0x55, 0x66, 0x80,
	]);
	backend.publishPresentation();

	const presented = backend.borrowPresentedPixels();
	assert.equal(presented, scanout);
});
