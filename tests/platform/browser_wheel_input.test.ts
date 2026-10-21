import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { KeyModifier } from '../../hosts/common/input/text';

test('browser wheel delivers ordered event-time context without changing sampled guest input', async t => {
	const bundle = await build({
		stdin: { contents: `import { BrowserInputHub } from './hosts/browser/input';
import { Input } from './hosts/common/input/manager';
import { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export function start() {
	const canvas = document.querySelector('canvas');
	const clock = { now: () => 123 };
	const hub = new BrowserInputHub(canvas, canvas, clock, undefined, 'ScrollLock');
	const input = new Input(clock, hub, -1);
	const events = [];
	hub.setNativeWheelHandler(event => events.push({ ...event, pollFrame: input.getPlayerInput(1).pollFrame }));
	globalThis.wheelFixture = {
		read: () => events.splice(0),
		sample() {
			hub.poll(123); input.pollInput();
			const snapshot = createInputControllerSnapshot();
			input.sampleInputControllerSnapshot(snapshot, 0);
			return { raw: input.getPlayerInput(1).getRawButtonState('pointer_wheel', 'pointer').value,
				x: snapshot.pointerXQ16, y: snapshot.pointerYQ16, wheel: snapshot.pointerWheelQ16 };
		},
	};
}`, resolveDir: process.cwd(), loader: 'ts' },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent('<canvas width="320" height="240" style="position:absolute;left:100px;top:80px;width:640px;height:480px"></canvas>');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => (globalThis as any).fixture.start());
	await page.mouse.move(150, 140);
	const ordered = await page.evaluate(() => {
		const canvas = document.querySelector('canvas');
		canvas.dispatchEvent(new WheelEvent('wheel', { clientX: 420, clientY: 320, deltaX: 5, deltaY: 10, shiftKey: true, bubbles: true }));
		canvas.dispatchEvent(new WheelEvent('wheel', { clientX: 500, clientY: 400, deltaX: -5, deltaY: -20, ctrlKey: true, bubbles: true }));
		return (globalThis as any).wheelFixture.read();
	});
	assert.deepEqual(ordered, [
		{ x: 420, y: 320, deltaX: 0.125, deltaY: 0.25, modifiers: KeyModifier.shift, timestamp: 123, pollFrame: 0 },
		{ x: 500, y: 400, deltaX: -0.125, deltaY: -0.5, modifiers: KeyModifier.ctrl, timestamp: 123, pollFrame: 0 },
	]);
	const sample = () => page.evaluate(() => (globalThis as any).wheelFixture.sample());
	assert.deepEqual(await sample(), { raw: -10, x: 25 * 65536, y: 30 * 65536, wheel: (-10 / 120 * 65536) >>> 0 });
	assert.equal((await sample()).wheel, 0);
	assert.deepEqual(await page.evaluate(() => (globalThis as any).wheelFixture.read()), [], 'polling cannot replay ordered editor input');

	for (const [mode, delta, expected] of [[0, 120, 3], [1, 3, 3], [2, 1, 12]]) {
		const event = await page.evaluate(({ mode, delta }) => {
			document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {
				clientX: 200, clientY: 180, deltaMode: mode, deltaY: delta, bubbles: true,
			}));
			return (globalThis as any).wheelFixture.read()[0];
		}, { mode, delta });
		assert.equal(event.deltaY, expected);
		assert.equal((await sample()).wheel, 65536, 'the guest retains its established attachment-wheel units');
	}
	const horizontal = await page.evaluate(() => {
		document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { clientX: 250, clientY: 200, deltaMode: 2, deltaX: 0.5, bubbles: true }));
		return (globalThis as any).wheelFixture.read()[0];
	});
	assert.equal(horizontal.deltaX, 8);
	assert.equal(horizontal.deltaY, 0);
	await page.mouse.move(450, 340);
	await page.mouse.wheel(20, 10);
	const trusted = await page.evaluate(() => (globalThis as any).wheelFixture.read());
	assert.equal(trusted.length, 1);
	assert.deepEqual([trusted[0].x, trusted[0].y, trusted[0].deltaX, trusted[0].deltaY], [450, 340, 0.5, 0.25]);
	assert.deepEqual(errors, []);
});
