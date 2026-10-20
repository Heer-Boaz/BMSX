import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('browser vibration adapters preserve duration, replace effects and stop explicitly', async t => {
	const fixture = await build({
		stdin: { contents: `
export { SonyGamepadHID } from './hosts/browser/sony_gamepad_hid';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserVibration } from './hosts/browser/vibration';
export { BrowserHostClock } from './hosts/browser/timing';
export { VirtualHeadlessClock } from './hosts/node/headless/clock';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.setContent('<canvas id="screen"></canvas>');
	await page.addScriptTag({ content: fixture.outputFiles[0].text });

	await t.test('all Sony USB/Bluetooth reports use both motors and exact requested deadlines', async () => {
		const results = await page.evaluate(async () => {
			const api = (globalThis as any).fixture;
			const results = [];
			for (const [productId, reportId, offset] of [[0x05c4, 0x05, 3], [0x09cc, 0x11, 5], [0x0ce6, 0x02, 2], [0x0df2, 0x31, 3]]) {
				const clock = new api.VirtualHeadlessClock();
				const reports: number[][] = [];
				const device = { vendorId: 0x054c, productId, opened: true,
					collections: [{ outputReports: [{ reportId }] }],
					sendReport(_id: number, payload: Uint8Array) { reports.push(Array.from(payload.slice(offset, offset + 2))); return Promise.resolve(); },
					close() { this.opened = false; return Promise.resolve(); } };
				Object.defineProperty(navigator, 'hid', { configurable: true, value: { async getDevices() { return [device]; } } });
				const pad = new api.SonyGamepadHID(0, productId, clock);
				await pad.initialize();
				pad.setVibration(100, 0.25);
				clock.advance(40);
				pad.setVibration(200, 0xffffffff / 65536);
				clock.advance(60);
				const beforeReplacementDeadline = reports.length;
				clock.advance(139);
				const beforeExpiry = reports.length;
				clock.advance(1);
				pad.setVibration(100, 1);
				pad.setVibration(0, 1);
				clock.advance(100);
				pad.setVibration(100, 1);
				pad.setVibration(500, 0);
				clock.advance(500);
				pad.setVibration(0xffffffff, 1);
				clock.advance(0xfffffffe);
				const beforeLongExpiry = reports.length;
				clock.advance(1);
				results.push({ reports: reports.slice(), beforeReplacementDeadline, beforeExpiry, beforeLongExpiry });
				pad.disconnect();
				const afterDisconnect = reports.length;
				clock.advance(0xffffffff);
				if (reports.length !== afterDisconnect) throw new Error('disconnected Sony timer sent another report');
			}
			delete (navigator as any).hid;
			return results;
		});
		for (const result of results) {
			assert.deepEqual(result, {
				reports: [[63, 63], [255, 255], [0, 0], [255, 255], [0, 0], [255, 255], [0, 0], [255, 255], [0, 0]],
				beforeReplacementDeadline: 2, beforeExpiry: 2, beforeLongExpiry: 8,
			});
		}
	});

	await t.test('Gamepad actuator renewal is bounded and canceled on stop, replacement and attachment changes', async () => {
		const result = await page.evaluate(() => {
			const api = (globalThis as any).fixture;
			const clock = new api.VirtualHeadlessClock();
			const events: unknown[] = [];
			const effects: object[] = [];
			const actuator = { reset() { events.push('stop'); return Promise.resolve(); },
				playEffect(_kind: string, effect: GamepadEffectParameters) {
					effects.push(effect); events.push([effect.duration, effect.strongMagnitude, effect.weakMagnitude]); return Promise.resolve();
				} };
			const pad = { index: 0, id: 'Standard controller', timestamp: 1, buttons: [], axes: [], vibrationActuator: actuator };
			Object.defineProperty(navigator, 'getGamepads', { configurable: true, value() { return [pad]; } });
			// A phone's actuator must not make an unrelated physical controller rumble-capable.
			Object.defineProperty(navigator, 'vibrate', { configurable: true, value() { throw new Error('physical pad reached phone vibration'); } });
			const screen = document.getElementById('screen');
			const hub = new api.BrowserInputHub(screen, screen, clock, null, 'F12');
			const device = hub.devices()[2];
			device.setVibration(12000, 0xffffffff / 65536);
			hub.poll(clock.now());
			hub.poll(clock.now());
			clock.advance(5000);
			device.setVibration(8000, 0.25);
			clock.advance(4999);
			const beforeReplacementRenewal = events.length;
			clock.advance(1);
			device.setVibration(0, 1);
			clock.advance(10000);
			device.setVibration(12000, 1);
			device.setVibration(12000, 0);
			clock.advance(10000);
			device.setVibration(0xffffffff, 1);
			clock.advance(0xfffffffe);
			clock.advance(1);
			device.setVibration(12000, 1);
			const replacementEvents: unknown[] = [];
			pad.vibrationActuator = { reset() { replacementEvents.push('stop'); return Promise.resolve(); },
				playEffect(_kind: string, effect: GamepadEffectParameters) {
					replacementEvents.push(effect.duration); return Promise.resolve();
				} };
			hub.poll(clock.now());
			clock.advance(5000);
			device.setVibration(12000, 1);
			pad.vibrationActuator = null;
			hub.poll(clock.now());
			clock.advance(5000);
			const unsupported = !device.supportsVibration;
			const afterDetach = events.length;
			device.disconnect();
			clock.advance(0xffffffff);
			return { events, replacementEvents, beforeReplacementRenewal, unsupported, afterDetach,
				sameEffect: effects.every(effect => effect === effects[0]) };
		});
		assert.deepEqual(result.events, [
			[5000, 1, 1], [5000, 1, 1], [5000, 0.25, 0.25], [3000, 0.25, 0.25], 'stop',
			[5000, 1, 1], 'stop', [5000, 1, 1], [1, 1, 1], [5000, 1, 1], 'stop',
		]);
		assert.equal(result.beforeReplacementRenewal, 3);
		assert.equal(result.afterDetach, result.events.length);
		assert.deepEqual(result.replacementEvents, [5000, 'stop'],
			'actual actuator replacement is handled even when the input timestamp is unchanged');
		assert.equal(result.unsupported, true);
		assert.equal(result.sameEffect, true, 'renewal reuses the retained effect object');
	});

	await t.test('onscreen binary vibration retains duration instead of scaling it by amplitude', async () => {
		const result = await page.evaluate(() => {
			const api = (globalThis as any).fixture;
			const clock = new api.VirtualHeadlessClock();
			const pulses: number[] = [];
			const vibration = new api.BrowserVibration(clock, { vibrate(ms: number) { pulses.push(ms); return true; } });
			const pad = new api.BrowserOnscreenGamepad(clock, vibration);
			const unsubscribe = pad.subscribe(null);
			pad.setVibration(25000, 0.25);
			clock.advance(10000);
			pad.setVibration(12000, 0xffffffff / 65536);
			clock.advance(10000);
			pad.setVibration(0, 1);
			clock.advance(5000);
			pad.setVibration(12000, 1);
			pad.setVibration(12000, 0);
			clock.advance(10000);
			pad.setVibration(0xffffffff, 1);
			clock.advance(0xfffffffe);
			clock.advance(1);
			pad.setVibration(12000, 1);
			unsubscribe();
			clock.advance(10000);
			return { pulses, supported: pad.supportsVibration };
		});
		assert.deepEqual(result.pulses, [10000, 10000, 10000, 2000, 0, 10000, 0, 10000, 1, 10000, 0]);
		assert.equal(result.supported, true);
	});

	await t.test('BrowserHostClock splits full unsigned delays at native timer boundaries and cancels the current wait', async () => {
		const result = await page.evaluate(() => {
			const api = (globalThis as any).fixture;
			const setTimeout = window.setTimeout;
			const clearTimeout = window.clearTimeout;
			let now = 0;
			let nextId = 1;
			const waits = new Map<number, { callback: () => void; delay: number }>();
			const delays: number[] = [];
			const callbacks: unknown[] = [];
			const completed: number[] = [];
			window.setTimeout = ((callback: () => void, delay: number) => {
				const id = nextId++;
				waits.set(id, { callback, delay }); delays.push(delay); callbacks.push(callback); return id;
			}) as typeof window.setTimeout;
			window.clearTimeout = id => { waits.delete(id); };
			try {
				const clock = new api.BrowserHostClock();
				clock.now = () => now;
				const handle = clock.scheduleOnce(0xffffffff, (time: number) => completed.push(time));
				for (let index = 0; index < 3; index += 1) {
					const [id, wait] = waits.entries().next().value;
					waits.delete(id); now += wait.delay; wait.callback();
				}
				const completedActive = handle.isActive();
				const cancel = clock.scheduleOnce(0xffffffff, () => completed.push(-1));
				const [id, wait] = waits.entries().next().value;
				waits.delete(id); now += wait.delay; wait.callback();
				cancel.cancel();
				return { delays, completed, completedActive, canceledActive: cancel.isActive(), pending: waits.size,
					sameCallback: callbacks[0] === callbacks[1] && callbacks[1] === callbacks[2] };
			} finally {
				window.setTimeout = setTimeout;
				window.clearTimeout = clearTimeout;
			}
		});
		assert.deepEqual(result, { delays: [0x7fffffff, 0x7fffffff, 1, 0x7fffffff, 0x7fffffff],
			completed: [0xffffffff], completedActive: false, canceledActive: false, pending: 0, sameCallback: true });
	});
});
