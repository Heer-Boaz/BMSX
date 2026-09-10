import assert from 'node:assert/strict';

/** Real Chromium mouse/keyboard events through BrowserInputHub, not synthesized ICU/button words. */
export async function exerciseGraphPointer(page) {
	const step = () => page.evaluate(() => window.fixture.step());
	const position = () => page.evaluate(() => [window.fixture.view.scrollX, window.fixture.view.scrollY]);
	await page.evaluate(() => {
		const f = window.fixture;
		f.view.scrollX = f.view.scrollY = 0;
		f.view.selection = f.view.model.nodes[1];
		window.pointerChordEvents = [];
		window.pointerCaptureLosses = 0;
		const canvas = document.querySelector('canvas');
		canvas.addEventListener('lostpointercapture', () => { window.pointerCaptureLosses += 1; }, true);
		canvas.addEventListener('pointerdown', event => { window.capturedPointerId = event.pointerId; }, true);
		canvas.addEventListener('pointermove', event => { if (event.button !== -1) window.pointerChordEvents.push([event.button, event.buttons]); }, true);
	});
	for (const firstRelease of ['left', 'middle']) {
		const lossesBefore = await page.evaluate(() => window.pointerCaptureLosses);
		await page.mouse.move(150, 110); await step();
		await page.mouse.down({ button: 'middle' }); await step();
		await page.mouse.down({ button: 'left' }); await step();
		await page.mouse.move(170, 120); await step();
		assert.deepEqual(await position(), [-20, -10]);
		await page.mouse.up({ button: firstRelease }); await step();
		await page.mouse.move(180, 130); await step();
		// Chromium can emit lostpointercapture after the other button's mouseup.
		// That external cancellation wins over continued pan; never recapture it as a workaround.
		if (firstRelease === 'left' && await page.evaluate(() => window.pointerCaptureLosses) === lossesBefore) assert.deepEqual(await position(), [-30, -20]);
		else assert.deepEqual(await position(), [-20, -10]);
		await page.mouse.up({ button: firstRelease === 'left' ? 'middle' : 'left' }); await step();
		assert.equal(await page.evaluate(() => {
			const f = window.fixture;
			return !f.player.getRawButtonState('pointer_aux', 'pointer').pressed && !f.player.getRawButtonState('pointer_primary', 'pointer').pressed
				&& f.view.selection === f.view.model.nodes[1];
		}), true, 'no stuck button or node selection after a DOM chord');
		await page.evaluate(() => { window.fixture.view.scrollX = window.fixture.view.scrollY = 0; });
	}
	assert.equal(await page.evaluate(() => window.pointerChordEvents.some(([button, buttons]) => button === 1 && buttons === 1)), true,
		'Chromium actually delivered middle release as pointermove while left remained held');
	await page.mouse.move(150, 110); await step();
	await page.keyboard.down('Space');
	await page.mouse.down({ button: 'left' }); await step();
	await page.mouse.move(172, 122); await step();
	assert.deepEqual(await position(), [-22, -12]);
	await page.keyboard.up('Space');
	await page.mouse.move(178, 125); await step();
	assert.deepEqual(await position(), [-28, -15], 'Space release cannot turn a pan into a node edit');
	await page.mouse.up({ button: 'left' }); await step();
	await page.evaluate(() => { window.fixture.view.scrollX = window.fixture.view.scrollY = 0; });
	// Actual lostpointercapture resets only the logical pointer, without forging a release edge.
	await page.mouse.move(150, 110); await step();
	await page.keyboard.down('q'); await step();
	await page.mouse.down({ button: 'middle' }); await step();
	await page.mouse.move(151, 111); await step(); // Activate the browser's pending capture before releasing it.
	await page.evaluate(() => document.querySelector('canvas').releasePointerCapture(window.capturedPointerId));
	await page.mouse.move(175, 130); await step();
	assert.deepEqual(await position(), [-1, -1]);
	assert.equal(await page.evaluate(() => {
		const player = window.fixture.player;
		const middle = player.getRawButtonState('pointer_aux', 'pointer');
		return !middle.pressed && !middle.justreleased && player.getRawButtonState('KeyQ', 'keyboard').pressed;
	}), true, 'capture cancellation preserves keyboard state and never reports pointer release');
	await page.mouse.up({ button: 'middle' }); await step();
	await page.keyboard.up('q'); await step();
	await page.evaluate(() => { window.fixture.view.scrollX = window.fixture.view.scrollY = 0; });
	for (const axis of ['horizontal', 'vertical']) {
		const start = await page.evaluate(axis => {
			const f = window.fixture;
			const bar = axis === 'horizontal' ? f.view.horizontalScrollbar : f.view.verticalScrollbar;
			const thumb = bar.getThumb(), track = bar.getTrack();
			return { x: (thumb.left + thumb.right) / 2, y: (thumb.top + thumb.bottom) / 2,
				endX: axis === 'horizontal' ? track.right - 1 : track.left + 1,
				endY: axis === 'horizontal' ? track.top + 1 : track.bottom - 1 };
		}, axis);
		await page.mouse.move(start.x, start.y); await step();
		await page.mouse.down(); await step();
		await page.mouse.move(start.endX, start.endY); await step();
		await page.mouse.up(); await step();
		assert.ok((await position())[axis === 'horizontal' ? 0 : 1] > 0, 'real scrollbar drag moves that axis');
		await page.evaluate(() => { window.fixture.view.scrollX = window.fixture.view.scrollY = 0; });
	}
	// Cancellation must not commit a connection preview either.
	await page.evaluate(() => {
		const f = window.fixture;
		f.connection.view.selection = f.connection.edge;
		f.panes.openEditor(f.inputs[2]);
		f.step();
	});
	const grip = await page.evaluate(() => {
		const f = window.fixture.connection, p = f.edge.points;
		return [p[p.length - 2] + f.view.bounds.left, p[p.length - 1] + f.view.bounds.top];
	});
	await page.mouse.move(...grip); await step();
	await page.mouse.down(); await step();
	await page.mouse.move(256, 170); await step();
	assert.equal(await page.evaluate(() => window.fixture.connection.interaction.feedback.accepted), true, 'real endpoint drag is admitted before capture loss');
	await page.evaluate(() => document.querySelector('canvas').releasePointerCapture(window.capturedPointerId));
	await page.mouse.move(258, 171); await step();
	await page.mouse.up(); await step();
	assert.equal(await page.evaluate(() => window.fixture.connection.interaction.drops.length), 0, 'DOM capture loss never commits an admitted source target');
	await page.evaluate(() => { const f = window.fixture; f.panes.openEditor(f.inputs[0]); f.step(); });
}
