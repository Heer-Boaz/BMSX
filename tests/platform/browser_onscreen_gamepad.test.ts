import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('onscreen gamepad retains each contact until that pointer ends or the page loses focus', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	let controls = template.slice(template.indexOf('<button id="d-pad-controls"'), template.indexOf('<div id="gameContainer">'));
	for (const direction of ['neutral', 'u', 'ru', 'r', 'rd', 'd', 'ld', 'l', 'lu']) {
		const name = direction === 'neutral' ? 'DPAD_NEUTRAL' : `DPAD_${direction.toUpperCase()}`;
		const image = await readFile(`rom/d-pad-${direction}.png`);
		controls = controls.replace(`@@${name}@@`, `data:image/png;base64,${image.toString('base64')}`);
	}
	const bundle = await build({
		stdin: { contents: "export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad'; export { BrowserVideoOutput } from './hosts/browser/video_output';", resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'onscreen', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style>${controls}<canvas id="gamescreen" width="320" height="240"></canvas>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const pad = new (globalThis as any).onscreen.BrowserOnscreenGamepad(document, window);
		const video = new (globalThis as any).onscreen.BrowserVideoOutput(document.getElementById('gamescreen'), pad);
		video.setDisplaySize(320, 240);
		const buttons = new Set<string>();
		const transitions: Array<{ code: string; down: boolean; pressId: number }> = [];
		const sink = {
			inputButton(_device: string, code: string, down: boolean, _value: number, _time: number, pressId: number) {
				if (down) buttons.add(code); else buttons.delete(code);
				transitions.push({ code, down, pressId });
			},
		};
		const pointerIds: number[] = [];
		window.addEventListener('pointerdown', event => pointerIds.push(event.pointerId), true);
		(globalThis as any).touchTest = {
			pointerIds,
			poll() {
				pad.poll(performance.now(), sink);
				return { buttons: [...buttons].sort(), transitions: transitions.splice(0) };
			},
		};
	});
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const cdp = await page.context().newCDPSession(page);
	const points = await page.evaluate(() => {
		const dpad = document.getElementById('d-pad-svg')!.getBoundingClientRect();
		const surface = document.getElementById('d-pad-controls')!.getBoundingClientRect();
		const action = document.getElementById('button-controls')!.getBoundingClientRect();
		return {
			left: { id: 1, x: dpad.left + dpad.width * 0.15, y: dpad.top + dpad.height * 0.5 },
			up: { id: 1, x: dpad.left + dpad.width * 0.5, y: dpad.top + dpad.height * 0.15 },
			gap: { id: 1, x: surface.left + surface.width * 0.5, y: surface.top + surface.height * 0.25 },
			b: { id: 2, x: action.left + action.width * 0.8, y: action.top + action.height * 0.5 },
			b2: { id: 3, x: action.left + action.width * 0.75, y: action.top + action.height * 0.5 },
		};
	});
	const poll = () => page.evaluate(() => (globalThis as any).touchTest.poll());
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left] });
	const leftPress = await poll();
	assert.deepEqual(leftPress.buttons, ['left']);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left, points.b] });
	const both = await poll();
	assert.deepEqual(both.buttons, ['b', 'left']);
	assert.deepEqual(both.transitions.map((event: any) => [event.code, event.down]), [['b', true]]);

	// Compatibility mouse boundary events do not own either touch contact.
	await page.evaluate(() => document.getElementById('d-pad-l')!.dispatchEvent(new MouseEvent('mouseout', {
		bubbles: true, relatedTarget: document.getElementById('b_knop'),
	})));
	assert.deepEqual((await poll()).buttons, ['b', 'left']);

	// Position belongs to the retained pointer, even if the browser reports no pressure/buttons.
	await page.evaluate(point => {
		document.getElementById('d-pad-controls')!.dispatchEvent(new PointerEvent('pointermove', {
			bubbles: true, pointerId: (globalThis as any).touchTest.pointerIds[0], pointerType: 'touch',
			clientX: point.x, clientY: point.y, buttons: 0, pressure: 0,
		}));
	}, points.up);
	assert.deepEqual((await poll()).buttons, ['b', 'up']);

	// An unrelated hovering pointer cannot create a button press.
	await page.evaluate(point => {
		document.getElementById('button-controls')!.dispatchEvent(new PointerEvent('pointermove', {
			bubbles: true, pointerId: 900, pointerType: 'pen', clientX: point.x, clientY: point.y,
			buttons: 1, pressure: 0.5,
		}));
	}, { x: points.b.x - 60, y: points.b.y });
	assert.deepEqual((await poll()).buttons, ['b', 'up']);

	// Cancelling one captured pointer preserves every other held button.
	await page.evaluate(() => document.getElementById('d-pad-controls')!.dispatchEvent(new PointerEvent('pointercancel', {
		bubbles: true, pointerId: (globalThis as any).touchTest.pointerIds[0], pointerType: 'touch',
	})));
	assert.deepEqual((await poll()).buttons, ['b']);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	assert.deepEqual((await poll()).buttons, []);

	// Two fingers on one action retain it until the last pointer is released.
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.b] });
	const bPress = await poll();
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.b, points.b2] });
	assert.deepEqual((await poll()).transitions, []);
	// CDP releases its first retained contact; the second remains physically held.
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points.b2] });
	assert.deepEqual((await poll()).buttons, ['b']);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	const bRelease = await poll();
	assert.deepEqual(bRelease.buttons, []);
	assert.equal(bRelease.transitions[0].pressId, bPress.transitions[0].pressId);

	// Starting in an empty part of a control surface still owns the captured contact.
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.gap] });
	assert.deepEqual((await poll()).buttons, []);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [points.up] });
	assert.deepEqual((await poll()).buttons, ['up']);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	assert.deepEqual((await poll()).buttons, []);

	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left, points.b] });
	assert.deepEqual((await poll()).buttons, ['b', 'left']);
	await page.evaluate(() => {
		window.dispatchEvent(new Event('focus'));
		document.dispatchEvent(new Event('visibilitychange'));
	});
	assert.deepEqual((await poll()).buttons, ['b', 'left']);
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	assert.deepEqual((await poll()).buttons, []);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	assert.deepEqual((await poll()).buttons, []);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	assert.deepEqual((await poll()).buttons, []);
	for (const lifecycle of ['pagehide', 'hidden']) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left, points.b] });
		assert.deepEqual((await poll()).buttons, ['b', 'left']);
		await page.evaluate(lifecycle => {
			if (lifecycle === 'pagehide') {
				window.dispatchEvent(new PageTransitionEvent('pagehide'));
			} else {
				Object.defineProperty(document, 'hidden', { value: true, configurable: true });
				document.dispatchEvent(new Event('visibilitychange'));
			}
		}, lifecycle);
		assert.deepEqual((await poll()).buttons, []);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.deepEqual((await poll()).buttons, []);
	}
	assert.deepEqual(errors, []);
});
