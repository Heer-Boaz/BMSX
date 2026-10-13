import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { BrowserInputTraceBuffer } from '../../hosts/browser/input_trace_buffer';

test('input trace reuses bounded records and preserves errors after overwrite and freeze', () => {
	const buffer = new BrowserInputTraceBuffer(2);
	const first = buffer.reserve('pointerdown', 'native', 1);
	const ids = first.touchIds;
	first.pointerId = 8;
	first.width = 36;
	first.height = 28;
	first.geometryRevision = 5;
	first.touchCount = 2;
	first.touchIds[0] = 4;
	buffer.recordError('javascript', 2, 'Vertex error');
	const reused = buffer.reserve('pointermove', 'route', 3);
	assert.equal(reused, first);
	assert.equal(reused.touchIds, ids);
	assert.equal(reused.touchCount, 0);
	assert.equal(reused.pointerId, -1);
	assert.equal(reused.width, 0);
	assert.equal(reused.height, 0);
	assert.equal(reused.geometryRevision, 0);
	assert.equal(buffer.count, 2);
	assert.equal(buffer.total, 3);
	assert.equal(buffer.overwritten, 1);
	assert.deepEqual([buffer.get(0).sequence, buffer.get(1).sequence], [2, 3]);
	buffer.reserve('pointermove', 'route', 4);
	assert.equal(buffer.errorCount, 1);
	assert.equal(buffer.lastError, 'Vertex error');
	assert.equal(buffer.get(0).phase, 'route');
	buffer.freeze();
	const revision = buffer.revision;
	buffer.recordError('promise', 5, 'Late rejection');
	assert.equal(buffer.total, 4, 'a frozen trace preserves its captured event window');
	assert.ok(buffer.revision > revision);
	assert.equal(buffer.errorCount, 2);
	assert.equal(buffer.lastError, 'Late rejection', 'errors remain observable while input recording is frozen');
	buffer.clear();
	assert.equal(buffer.count, 0);
	assert.equal(buffer.total, 0);
	assert.equal(buffer.errorCount, 0);
	assert.equal(buffer.lastError, '');
	assert.equal(buffer.frozen, true, 'clear does not implicitly resume recording');
	buffer.resume();
	assert.equal(buffer.frozen, false);
});

test('early input trace observes trusted A+B, model/common mutations, cancellation and export independently of gesture routing', async t => {
	const bootstrap = await build({
		entryPoints: ['hosts/browser/input_trace_bootstrap.ts'], bundle: true, platform: 'browser',
		format: 'iife', write: false, tsconfig: 'tsconfig.base.json',
	});
	const fixture = await build({
		stdin: {
			contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';`,
			resolveDir: process.cwd(),
		},
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true, acceptDownloads: true });
	await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>#player-surface{position:fixed;inset:0;touch-action:none}#gamescreen{position:absolute;left:300px;top:100px;width:240px;height:180px}#a,#b{position:absolute;top:200px;width:70px;height:70px}#a{left:570px}#b{left:680px}</style><div id="player-surface"><canvas id="gamescreen"></canvas><div id="a"></div><div id="b"></div></div>');
	await page.addScriptTag({ content: bootstrap.outputFiles[0].text });
	await page.evaluate(() => {
		window.dispatchEvent(new ErrorEvent('error', { message: 'Early script failure', filename: 'engine.js', lineno: 7, colno: 11 }));
	});
	assert.equal(await page.locator('#bmsx-input-trace').count(), 1, 'panel exists before engine initialization');
	assert.equal(await page.locator('#player-surface #bmsx-input-trace').count(), 0, 'diagnostic UI is outside player gesture root');
	await page.addScriptTag({ content: fixture.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).fixture;
		const trace = window.bmsxInputTrace as any;
		const clock = new api.BrowserHostClock();
		const pad = new api.BrowserOnscreenGamepad(clock);
		pad.setGeometry({ padX: 140, padY: 260, padRadius: 80, padNeutralRadius: 14,
			faceX: 660, faceY: 235, faceRadius: 100,
			actions: [{ x: 605, y: 235, radius: 35, buttons: 1 }, { x: 715, y: 235, radius: 35, buttons: 2 }] });
		const hub = new api.BrowserInputHub(document.getElementById('gamescreen'), document.getElementById('player-surface'), clock, pad, 'F2');
		trace.setController(pad);
		hub.setTraceObserver(trace);
		const input = new api.Input(clock, hub, pad.gamepadIndex);
		trace.setCommonGamepad(input.getPlayerInput(1).inputHandlers.gamepad);
		(globalThis as any).traceFixture = { pad, hub, input, trace };
	});
	const cdp = await page.context().newCDPSession(page);
	const a = { id: 1, x: 605, y: 235 };
	const b = { id: 2, x: 715, y: 235 };
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
	const sequence = await page.evaluate(() => {
		const { pad, input, trace } = (globalThis as any).traceFixture;
		const records = [];
		for (let index = 0; index < trace.buffer.count; index += 1) {
			const row = trace.buffer.get(index);
			records.push({ sequence: row.sequence, kind: row.kind, phase: row.phase, id: row.pointerId, primary: row.primary,
				before: row.before, after: row.after, commonBefore: row.commonBefore, commonAfter: row.commonAfter,
				trusted: row.trusted, prevented: row.prevented, route: row.route, width: row.width, height: row.height, geometryRevision: row.geometryRevision,
				full: Array.from(row.touchIds.subarray(0, row.touchCount)), changed: Array.from(row.changedTouchIds.subarray(0, row.changedTouchCount)) });
		}
		return { model: pad.buttons, common: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), records };
	});
	assert.equal(sequence.model, 3);
	assert.equal(sequence.common, 3);
	const downs = sequence.records.filter(row => row.kind === 'pointerdown' && row.phase === 'route');
	assert.deepEqual(downs.map(row => [row.before, row.after, row.commonBefore, row.commonAfter, row.route]), [[0, 1, 0, 1, 'controller'], [1, 3, 1, 3, 'controller']]);
	assert.ok(downs.every(row => row.trusted && row.prevented));
	assert.ok(downs.every(row => row.width > 0 && row.height > 0));
	assert.ok(downs.every(row => row.geometryRevision === 1), 'routed pointers carry the admitted geometry version independently of layout-row retention');
	assert.equal(downs[1].primary, false);
	for (const down of downs) {
		assert.ok(sequence.records.some(row => row.phase === 'native' && row.kind === 'pointerdown' && row.id === down.id && row.sequence < down.sequence), 'early window capture survives owner stopImmediatePropagation');
	}
	const snapshots = sequence.records.filter(row => row.kind === 'touchstart');
	assert.deepEqual(snapshots.map(row => [row.full.length, row.changed.length]), [[1, 1], [2, 1]]);
	assert.equal(await page.evaluate(() => (globalThis as any).traceFixture.trace.buffer.errorCount), 1);
	assert.match(await page.evaluate(() => (globalThis as any).traceFixture.trace.view.text()), /Early script failure/);

	await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
	const cancellations = await page.evaluate(() => {
		const { trace } = (globalThis as any).traceFixture;
		const rows = [];
		for (let index = 0; index < trace.buffer.count; index += 1) {
			const row = trace.buffer.get(index);
			if (row.kind === 'pointercancel' && row.phase === 'route') rows.push([row.before, row.after, row.commonBefore, row.commonAfter, row.completed]);
		}
		return rows;
	});
	assert.deepEqual(cancellations, [[3, 2, 3, 2, true], [2, 0, 2, 0, true]]);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	const reset = await page.evaluate(() => {
		const { trace } = (globalThis as any).traceFixture;
		const row = trace.buffer.get(trace.buffer.count - 1);
		return { kind: row.kind, phase: row.phase, before: row.before, after: row.after, commonBefore: row.commonBefore, commonAfter: row.commonAfter, completed: row.completed };
	});
	assert.deepEqual(reset, { kind: 'blur', phase: 'reset', before: 1, after: 0, commonBefore: 1, commonAfter: 0, completed: true });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await page.locator('#bmsx-input-trace summary').tap();
	await page.getByRole('button', { name: 'Bevries opname' }).tap();
	const frozenTotal = await page.evaluate(() => (globalThis as any).traceFixture.trace.buffer.total);
	const frozenText = await page.evaluate(() => (globalThis as any).traceFixture.trace.view.text());
	await page.locator('#bmsx-input-trace summary').tap();
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
	assert.equal(await page.evaluate(() => (globalThis as any).traceFixture.pad.buttons), 1, 'freezing diagnostics does not alter input');
	assert.equal(await page.evaluate(() => (globalThis as any).traceFixture.trace.buffer.total), frozenTotal);
	assert.equal(await page.evaluate(() => (globalThis as any).traceFixture.trace.view.text()), frozenText, 'frozen export and selected text preserve captured button words');
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await page.locator('#bmsx-input-trace summary').tap();
	await page.getByRole('button', { name: 'Selecteer tekst' }).tap();
	assert.match(await page.evaluate(() => window.getSelection().toString()), /native pointerdown.*\n/s);
	const downloaded = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download trace' }).tap();
	assert.equal((await downloaded).suggestedFilename(), 'bmsx-input-trace.txt');
	await page.getByRole('button', { name: 'Wis trace' }).tap();
	assert.deepEqual(await page.evaluate(() => {
		const buffer = (globalThis as any).traceFixture.trace.buffer;
		return [buffer.count, buffer.total, buffer.errorCount, buffer.lastError];
	}), [0, 0, 0, '']);
	await page.getByRole('button', { name: 'Hervat opname' }).tap();
	await page.locator('#bmsx-input-trace summary').tap();
	await page.evaluate(() => {
		const player = document.getElementById('player-surface');
		Object.defineProperty(player, 'setPointerCapture', { configurable: true, value() { throw new Error('Trace capture failure'); } });
	});
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
	const failedRoute = await page.evaluate(() => {
		const buffer = (globalThis as any).traceFixture.trace.buffer;
		const rows = [];
		for (let index = 0; index < buffer.count; index += 1) {
			const row = buffer.get(index);
			if (row.phase === 'route' && row.kind === 'pointerdown') rows.push([row.before, row.after, row.commonBefore, row.commonAfter, row.completed]);
		}
		return { rows, error: buffer.lastError };
	});
	assert.deepEqual(failedRoute.rows, [[0, 1, 0, 1, false]], 'partial state and unsuccessful native routing are preserved');
	assert.match(failedRoute.error, /Trace capture failure/, 'original handler exception escapes to early browser error observer');
	await page.evaluate(() => { delete document.getElementById('player-surface').setPointerCapture; });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	for (const reason of ['hidden', 'pagehide', 'teardown']) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
		const lifecycleReset = await page.evaluate(reason => {
			if (reason === 'hidden') {
				Object.defineProperty(document, 'hidden', { configurable: true, value: true });
				document.dispatchEvent(new Event('visibilitychange'));
				delete (document as any).hidden;
			} else if (reason === 'pagehide') {
				window.dispatchEvent(new PageTransitionEvent('pagehide'));
			} else {
				(globalThis as any).traceFixture.input.dispose();
			}
			const buffer = (globalThis as any).traceFixture.trace.buffer;
			const row = buffer.get(buffer.count - 1);
			return [row.phase, row.kind, row.before, row.after, row.commonBefore, row.commonAfter, row.completed];
		}, reason);
		assert.deepEqual(lifecycleReset, ['reset', reason, 1, 0, 1, 0, true]);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	}
});

test('true controller-frame layout changes trace retained-contact edges independently of native events', async t => {
	const bootstrap = await build({
		entryPoints: ['hosts/browser/input_trace_bootstrap.ts'], bundle: true, platform: 'browser',
		format: 'iife', write: false, tsconfig: 'tsconfig.base.json',
	});
	const fixture = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'layoutTraceFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const template = await readFile('gamebase.html', 'utf8');
	let controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	for (const name of ['neutral', 'u', 'ru', 'r', 'rd', 'd', 'ld', 'l', 'lu']) {
		controls = controls.replace(`@@DPAD_${name.toUpperCase()}@@`, `data:image/png;base64,${(await readFile(`rom/d-pad-${name}.png`)).toString('base64')}`);
	}
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div>`);
	await page.addScriptTag({ content: bootstrap.outputFiles[0].text });
	await page.addScriptTag({ content: fixture.outputFiles[0].text });
	const a = await page.evaluate(() => {
		const api = (globalThis as any).layoutTraceFixture;
		const clock = new api.BrowserHostClock();
		const model = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, model);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view);
		const trace = window.bmsxInputTrace;
		trace.setController(model);
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, model, 'F2');
		hub.setTraceObserver(trace);
		const input = new api.Input(clock, hub, model.gamepadIndex);
		trace.setCommonGamepad(input.getPlayerInput(1).inputHandlers.gamepad);
		video.refreshLayout();
		(globalThis as any).layoutTraceProbe = { model, video, trace, input };
		const bounds = document.getElementById('a_knop')!.getBoundingClientRect();
		return { id: 1, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, radiusX: 14, radiusY: 14 };
	});
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
	await page.setViewportSize({ width: 852, height: 300 });
	const resized = await page.evaluate(() => {
		const probe = (globalThis as any).layoutTraceProbe;
		probe.video.refreshLayout();
		const layouts = [];
		for (let index = 0; index < probe.trace.buffer.count; index += 1) {
			const row = probe.trace.buffer.get(index);
			if (row.phase === 'layout') layouts.push({ revision: row.geometryRevision, bounds: [row.x, row.y, row.width, row.height],
				words: [row.before, row.after, row.commonBefore, row.commonAfter] });
		}
		return { buttons: probe.model.buttons, layouts, text: probe.trace.view.text() };
	});
	assert.equal(resized.buttons, 0, 'a true document resize moves the button away from its retained contact immediately');
	assert.deepEqual(resized.layouts, [
		{ revision: 1, bounds: [0, 0, 852, 393], words: [0, 0, 0, 0] },
		{ revision: 2, bounds: [0, 0, 852, 300], words: [1, 0, 1, 0] },
	]);
	assert.match(resized.text, /layout control-layout revision=2 bounds=0\.0,0\.0,852\.0,300\.0 route=controller model=0x1->0x0 common=0x1->0x0/);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x + 1 }] });
	const moved = await page.evaluate(() => {
		const probe = (globalThis as any).layoutTraceProbe;
		const routes = [];
		for (let index = 0; index < probe.trace.buffer.count; index += 1) {
			const row = probe.trace.buffer.get(index);
			if (row.phase === 'route' && row.kind === 'pointermove') routes.push(row);
		}
		const row = routes.at(-1);
		return { buttons: probe.model.buttons, common: probe.trace.commonGamepad.physicalGamepadButtonsWord(),
			phase: row.phase, kind: row.kind, before: row.before, after: row.after, trusted: row.trusted, geometryRevision: row.geometryRevision };
	});
	assert.equal(moved.buttons, 0, 'tiny native jitter does not postpone or introduce the already-observed layout edge');
	assert.equal(moved.common, 0);
	assert.deepEqual([moved.phase, moved.kind, moved.before, moved.after, moved.trusted], ['route', 'pointermove', 0, 0, true]);
	assert.equal(moved.geometryRevision, 2, 'the native update identifies the current admitted geometry');
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await page.evaluate(() => {
		const probe = (globalThis as any).layoutTraceProbe;
		probe.input.dispose();
		probe.video.dispose();
	});
});
