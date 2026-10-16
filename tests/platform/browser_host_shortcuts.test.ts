import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { HOST_MENU_HOLD_MS } from '../../hosts/common/input/shortcuts';

test('trusted browser keyboard chords use real host time and distinguish short, long and cancellation', async t => {
	const bundle = await build({
		stdin: {
			contents: `export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { HOST_MENU_BUTTON, HOST_MENU_HOLD_MS } from './hosts/common/input/shortcuts';
export { hidKeyUsageForCode } from './hosts/common/input/hid_keys';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';`,
			resolveDir: process.cwd(),
		},
		bundle: true, platform: 'browser', format: 'iife', globalName: 'shortcutApi', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent('<!doctype html><div id="player-surface"><canvas id="gamescreen"></canvas></div>');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).shortcutApi;
		const clock = new api.BrowserHostClock();
		const canvas = document.getElementById('gamescreen');
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, undefined, 'ScrollLock');
		const native: Array<{ type: string; code: string; trusted: boolean; repeat: boolean }> = [];
		for (const type of ['keydown', 'keyup']) {
			window.addEventListener(type, event => {
				const key = event as KeyboardEvent;
				native.push({ type, code: key.code, trusted: key.isTrusted, repeat: key.repeat });
			}, true);
		}
		const input = new api.Input(clock, hub, -1);
		hub.setKeyboardCapture(input.shouldCaptureKey);
		const keyboard = input.getPlayerInput(1).inputHandlers.keyboard;
		const snapshot = api.createInputControllerSnapshot();
		const actions: Array<{ kind: string; time: number; frame: number }> = [];
		input.getGlobalShortcutRegistry().registerControlShortcut(1, api.HOST_MENU_BUTTON, {
			kind: 'short-hold', holdDurationMs: api.HOST_MENU_HOLD_MS,
			onShortPress() { actions.push({ kind: 'short', time: input.getPlayerInput(1).pollTimestampMs, frame: fixture.frames }); },
			onLongPress() { actions.push({ kind: 'long', time: input.getPlayerInput(1).pollTimestampMs, frame: fixture.frames }); },
		});
		let animation = 0;
		let previousChord = false;
		const fixture = {
			frames: 0,
			chordBeganAt: 0,
			chord: false,
			frame() {
				hub.poll(clock.now());
				input.pollInput();
				fixture.frames += 1;
				fixture.chord = keyboard.physicalKeyPressed('ControlRight') && keyboard.physicalKeyPressed('AltRight');
				if (fixture.chord && !previousChord) fixture.chordBeganAt = input.getPlayerInput(1).pollTimestampMs;
				previousChord = fixture.chord;
				input.sampleInputControllerSnapshot(snapshot, 0);
				animation = requestAnimationFrame(fixture.frame);
			},
			read() {
				return { frames: fixture.frames, chord: fixture.chord, beganAt: fixture.chordBeganAt,
					now: clock.now(), actions, native, keys: Array.from(snapshot.keyWords) };
			},
			physicalKeyPressed(code: string) { return keyboard.physicalKeyPressed(code); },
			keyRouted(code: string) {
				const usage = api.hidKeyUsageForCode(code);
				return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0;
			},
			finish() { cancelAnimationFrame(animation); input.dispose(); },
		};
		(globalThis as any).hostShortcutFixture = fixture;
		animation = requestAnimationFrame(fixture.frame);
	});
	const read = () => page.evaluate(() => (globalThis as any).hostShortcutFixture.read());
	await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.frames > 0);

	await t.test('a short chord does nothing on down and opens only on release', async () => {
		await page.keyboard.down('ControlRight');
		await page.keyboard.down('AltRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.chord, undefined, { polling: 'raf' });
		const held = await read();
		assert.deepEqual(held.actions, []);
		assert.equal(await page.evaluate(() => (globalThis as any).hostShortcutFixture.keyRouted('ControlRight')), false);
		assert.equal(await page.evaluate(() => (globalThis as any).hostShortcutFixture.keyRouted('AltRight')), false);
		await page.keyboard.up('AltRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.read().actions.length === 1, undefined, { polling: 'raf' });
		const released = await read();
		assert.equal(released.actions[0].kind, 'short');
		assert.ok(released.actions[0].time - held.beganAt < HOST_MENU_HOLD_MS);
		await page.keyboard.up('ControlRight');
		await page.waitForFunction(() => !(globalThis as any).hostShortcutFixture.physicalKeyPressed('ControlRight'), undefined, { polling: 'raf' });
	});

	await t.test('a sustained chord fires one long action at the real deadline; repeats and release are inert', async () => {
		await page.keyboard.down('ControlRight');
		await page.keyboard.down('AltRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.chord, undefined, { polling: 'raf' });
		const held = await read();
		assert.equal(held.actions.length, 1);
		await page.keyboard.down('AltRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.read().actions.length === 2, undefined, { polling: 'raf' });
		const fired = await read();
		assert.equal(fired.actions[1].kind, 'long');
		assert.ok(fired.actions[1].time - held.beganAt >= HOST_MENU_HOLD_MS);
		assert.ok(fired.actions[1].frame > held.frames, 'recognition progressed through real RAF polls, not a manually advanced clock');
		await page.waitForFunction(deadline => (globalThis as any).hostShortcutFixture.read().now >= deadline,
			fired.actions[1].time + HOST_MENU_HOLD_MS, { polling: 'raf' });
		assert.equal((await read()).actions.length, 2, 'holding for another threshold cannot report a second long action');
		await page.keyboard.up('ControlRight');
		await page.waitForFunction(() => !(globalThis as any).hostShortcutFixture.chord, undefined, { polling: 'raf' });
		assert.equal(await page.evaluate(() => (globalThis as any).hostShortcutFixture.keyRouted('AltRight')), false,
			'releasing the modifier first retains capture of the target');
		await page.keyboard.up('AltRight');
		await page.waitForFunction(() => !(globalThis as any).hostShortcutFixture.physicalKeyPressed('AltRight'), undefined, { polling: 'raf' });
		assert.equal((await read()).actions.length, 2, 'release after long never dispatches the short menu action');
	});

	await t.test('a lifecycle blur cancels a pending chord, including stale key-ups after the old deadline', async () => {
		await page.keyboard.down('ControlRight');
		await page.keyboard.down('AltRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.chord, undefined, { polling: 'raf' });
		const pending = await read();
		// Exercise the production browser lifecycle listener, not Input.resetInput directly.
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await page.waitForFunction(() => !(globalThis as any).hostShortcutFixture.chord, undefined, { polling: 'raf' });
		await page.waitForFunction(deadline => (globalThis as any).hostShortcutFixture.read().now >= deadline,
			pending.beganAt + HOST_MENU_HOLD_MS + 50, { polling: 'raf' });
		assert.equal((await read()).actions.length, 2);
		await page.keyboard.up('AltRight');
		await page.keyboard.up('ControlRight');
		await page.waitForFunction(() => !(globalThis as any).hostShortcutFixture.physicalKeyPressed('ControlRight'), undefined, { polling: 'raf' });
		assert.equal((await read()).actions.length, 2, 'late releases from a canceled gesture are not a short press');
		await page.keyboard.down('ControlRight');
		await page.keyboard.down('AltRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.chord, undefined, { polling: 'raf' });
		await page.keyboard.up('AltRight');
		await page.keyboard.up('ControlRight');
		await page.waitForFunction(() => (globalThis as any).hostShortcutFixture.read().actions.length === 3, undefined, { polling: 'raf' });
		assert.equal((await read()).actions[2].kind, 'short', 'a fresh chord works after cancellation');
	});

	await t.test('ordinary Ctrl+X and Ctrl+Z remain routed keyboard input', async () => {
		for (const control of ['ControlLeft', 'ControlRight']) {
			await page.keyboard.down(control);
			for (const key of ['KeyX', 'KeyZ']) {
				await page.keyboard.down(key);
				await page.waitForFunction(code => (globalThis as any).hostShortcutFixture.physicalKeyPressed(code), key, { polling: 'raf' });
				assert.equal(await page.evaluate(code => (globalThis as any).hostShortcutFixture.keyRouted(code), key), true);
				assert.equal(await page.evaluate(code => (globalThis as any).hostShortcutFixture.keyRouted(code), control), control === 'ControlLeft');
				assert.equal((await read()).actions.length, 3);
				await page.keyboard.up(key);
			}
			await page.keyboard.up(control);
			await page.waitForFunction(code => !(globalThis as any).hostShortcutFixture.physicalKeyPressed(code), control, { polling: 'raf' });
		}
	});
	const result = await read();
	assert.ok(result.native.length > 0);
	assert.ok(result.native.every(event => event.trusted), 'all keyboard input came from trusted browser events');
	assert.ok(result.native.some(event => event.code === 'AltRight' && event.type === 'keydown' && event.repeat));
	await page.evaluate(() => (globalThis as any).hostShortcutFixture.finish());
	assert.deepEqual(errors, []);
});
