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
		stdin: { contents: "export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad'; export { BrowserVideoOutput } from './hosts/browser/video_output'; export { BrowserInputHub } from './hosts/browser/input'; export { BrowserHostClock } from './hosts/browser/timing';", resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'onscreen', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240"></canvas></div><button id="outside-player" style="position:fixed;left:420px;top:20px;width:30px;height:20px">Outside</button>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const clock = new (globalThis as any).onscreen.BrowserHostClock();
		const pad = new (globalThis as any).onscreen.BrowserOnscreenGamepad(document, window, clock);
		const hub = new (globalThis as any).onscreen.BrowserInputHub(document.getElementById('gamescreen'), document.getElementById('player-surface'), clock, pad, 'F2');
		const video = new (globalThis as any).onscreen.BrowserVideoOutput(document.getElementById('gamescreen'), pad);
		video.setDisplaySize(320, 240);
		const buttons = new Set<string>();
		const transitions: Array<{ code: string; down: boolean; pressId: number }> = [];
		const sink = {
			resetInput() { buttons.clear(); },
			inputButton(_device: string, code: string, down: boolean, _value: number, _time: number, pressId: number) {
				if (down) buttons.add(code); else buttons.delete(code);
				transitions.push({ code, down, pressId });
			},
		};
		hub.subscribe(sink);
		const pointerIds: number[] = [];
		const nativeTouches: Array<{ type: string; controls: boolean; player: boolean; prevented: boolean; trusted: boolean }> = [];
		window.addEventListener('pointerdown', event => pointerIds.push(event.pointerId), true);
		for (const type of ['touchstart', 'touchmove', 'touchend']) {
			window.addEventListener(type, event => nativeTouches.push({
				type, controls: !!(event.target as Element).closest('#d-pad-controls, #button-controls'),
				player: !!(event.target as Element).closest('#player-surface'),
				prevented: event.defaultPrevented, trusted: event.isTrusted,
			}));
		}
		(globalThis as any).touchTest = {
			pointerIds, nativeTouches,
			poll() {
				hub.poll(performance.now());
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
			a: { id: 3, x: action.left + action.width * 0.5, y: action.top + action.height * 140 / 220 },
			x: { id: 4, x: action.left + action.width * 0.2, y: action.top + action.height * 0.5 },
			y: { id: 5, x: action.left + action.width * 0.5, y: action.top + action.height * 80 / 220 },
		};
	});
	const poll = () => page.evaluate(() => (globalThis as any).touchTest.poll());
	await t.test('native gestures are cancelled on controls and missed controls, not outside the player', async () => {
		await page.touchscreen.tap(points.b.x, points.b.y);
		const control = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.deepEqual(control.map((event: any) => [event.type, event.controls, event.prevented, event.trusted]), [
			['touchstart', true, true, true], ['touchend', true, true, true],
		]);
		await page.touchscreen.tap(430, 5);
		const miss = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.deepEqual(miss.map((event: any) => [event.type, event.controls, event.player, event.prevented, event.trusted]), [
			['touchstart', false, true, true, true], ['touchend', false, true, true, true],
		]);
		await page.touchscreen.tap(430, 30);
		const outside = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.deepEqual(outside.map((event: any) => [event.type, event.controls, event.prevented, event.trusted]), [
			['touchstart', false, false, true], ['touchend', false, false, true],
		]);
	});
	await poll();
	await t.test('double and triple taps publish every press and release without a frame poll', async () => {
		const initialScale = await page.evaluate(() => visualViewport!.scale);
		for (let tap = 0; tap < 3; tap++) await page.touchscreen.tap(points.b.x, points.b.y);
		const taps = await poll();
		assert.deepEqual(taps.buttons, []);
		assert.deepEqual(taps.transitions.map((event: any) => [event.code, event.down]), [
			['b', true], ['b', false], ['b', true], ['b', false], ['b', true], ['b', false],
		]);
		for (let press = 0; press < 3; press++) assert.equal(taps.transitions[press * 2].pressId, taps.transitions[press * 2 + 1].pressId);
		assert.equal(new Set(taps.transitions.filter((event: any) => event.down).map((event: any) => event.pressId)).size, 3);
		assert.equal(await page.evaluate(() => visualViewport!.scale), initialScale);
	});
	await t.test('four action buttons and the d-pad retain all five contacts independently', async () => {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left, points.b, points.a, points.x, points.y] });
		assert.deepEqual((await poll()).buttons, ['a', 'b', 'left', 'x', 'y']);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points.left] });
		const remaining = await poll();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.deepEqual(remaining.buttons, ['a', 'b', 'x', 'y']);
		assert.deepEqual((await poll()).buttons, []);
	});
	await t.test('moving the d-pad and action contacts apart does not start a zoom gesture', async () => {
		await page.evaluate(() => { (globalThis as any).touchTest.nativeTouches.length = 0; });
		const initialScale = await page.evaluate(() => visualViewport!.scale);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left] });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.left, points.b] });
		assert.deepEqual((await poll()).buttons, ['b', 'left']);
		for (const distance of [8, 16, 8, 0]) {
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
				{ ...points.left, x: points.left.x - distance },
				{ ...points.b, x: points.b.x + distance },
			] });
			assert.deepEqual((await poll()).buttons, ['b', 'left']);
			assert.equal(await page.evaluate(() => visualViewport!.scale), initialScale);
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points.left] });
		const remaining = await poll();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.deepEqual(remaining.buttons, ['b']);
		assert.deepEqual((await poll()).buttons, []);
		const native = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.ok(native.some((event: any) => event.type === 'touchmove'));
		assert.ok(native.every((event: any) => event.controls && event.prevented && event.trusted));
		assert.equal(await page.evaluate(() => visualViewport!.scale), initialScale);
	});
	await t.test('a second finger missing a control does not release the held button or enable zoom', async () => {
		await page.evaluate(() => { (globalThis as any).touchTest.nativeTouches.length = 0; });
		const initialScale = await page.evaluate(() => visualViewport!.scale);
		const miss = { id: 10, x: 430, y: 5 };
		for (const [control, button] of [[points.left, 'left'], [points.b, 'b']] as const) {
			for (const order of [[miss, control], [control, miss]]) {
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [order[0]] });
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: order });
				assert.deepEqual((await poll()).buttons, [button]);
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
					{ ...control, x: control.x + 8 }, { ...miss, x: miss.x - 16 },
				] });
				assert.deepEqual((await poll()).buttons, [button]);
				assert.equal(await page.evaluate(() => visualViewport!.scale), initialScale);
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [miss] });
				const remaining = await poll();
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
				assert.deepEqual(remaining.buttons, [button]);
				assert.deepEqual((await poll()).buttons, []);
			}
		}
		const native = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.ok(native.some((event: any) => !event.controls));
		assert.ok(native.every((event: any) => event.player && event.prevented && event.trusted));
		assert.equal(await page.evaluate(() => visualViewport!.scale), initialScale);
	});
	await page.evaluate(() => { (globalThis as any).touchTest.pointerIds.length = 0; });
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
	// Release one contact while the other remains physically held.
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
