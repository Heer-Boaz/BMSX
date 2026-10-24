import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { BROWSER_KEYBOARD_PAGES } from '../../hosts/browser/onscreen_keyboard_layout';
import { ON_SCREEN_KEY_DEFINITIONS } from '../../hosts/common/input/on_screen_keyboard_keys';
import { expandBrowserKeyboardTemplate } from '../../scripts/products/browser_keyboard';

// Hacker's Keyboard's full layout supplies conventional US typing rows and
// keeps Up above Down rather than a horizontal cursor strip.
// https://github.com/klausw/hackerskeyboard/blob/9202d9d8b1d379f1a20edf08ed7e7149038c8e43/app/src/main/res/xml/kbd_full.xml

const CODING_KEYS = [
	['Backquote', '`', '~', 53], ['Minus', '-', '_', 45], ['Equal', '=', '+', 46],
	['BracketLeft', '[', '{', 47], ['BracketRight', ']', '}', 48], ['Backslash', '\\', '|', 49],
	['Semicolon', ';', ':', 51], ['Quote', "'", '"', 52],
	['Comma', ',', '<', 54], ['Period', '.', '>', 55], ['Slash', '/', '?', 56],
] as const;

test('a conventional five-row US keyboard exposes every printable key with a supplementary three-row Fn page', () => {
	const keys = new Set<number>();
	assert.equal(BROWSER_KEYBOARD_PAGES.length, 2);
	assert.deepEqual(BROWSER_KEYBOARD_PAGES.map(page => page.rows.length), [5, 3]);
	for (const page of BROWSER_KEYBOARD_PAGES) {
		assert.ok(page.rows.some(row => row.keys.includes(page.initialKey)));
		for (const row of page.rows) {
			assert.equal(row.keys.length, row.spans.length);
			assert.equal(row.keys.length, row.starts.length);
			for (let column = 0; column < row.keys.length; column++) {
				assert.ok(row.starts[column] >= 0 && row.starts[column] + row.spans[column] <= row.units);
				if (column > 0) assert.ok(row.starts[column] >= row.starts[column - 1] + row.spans[column - 1],
					'authored key positions do not overlap, while real gaps remain possible');
				keys.add(row.keys[column]);
			}
			const occupied = row.starts.map((start, column) => ({ start, end: start + row.spans[column] }));
			for (const control of row.controls) {
				assert.ok(control.start >= 0 && control.start + control.span <= row.units);
				occupied.push({ start: control.start, end: control.start + control.span });
			}
			occupied.sort((a, b) => a.start - b.start);
			for (let slot = 1; slot < occupied.length; slot++) assert.ok(occupied[slot].start >= occupied[slot - 1].end,
				'browser commands occupy gaps instead of overlapping real keys');
		}
	}
	assert.deepEqual([...keys].sort((a, b) => a - b), ON_SCREEN_KEY_DEFINITIONS
		.map((key, index) => ({ key, index })).filter(({ key }) => key.code !== 'CapsLock').map(({ index }) => index),
		'the browser exposes supported keys without advertising a Caps Lock typing mode that consumers do not implement');
	const mainRows = BROWSER_KEYBOARD_PAGES[0].rows;
	assert.deepEqual(mainRows.map(row => row.units), [15.75, 14.25, 15.25, 15.25, 15.75]);
	assert.deepEqual(mainRows.slice(1, 4).map(row => (15.75 - row.units) / 2 + row.starts[1]), [2, 2.25, 2.75],
		'centered row extents keep the Q/A/Z stagger without oversized Ctrl or undersized Enter');
	const mainCodes = mainRows.map(row => row.keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].code));
	assert.deepEqual(mainCodes.slice(0, 4), [
		['Escape', 'Backquote', ...'1234567890'.split('').map(digit => `Digit${digit}`), 'Minus', 'Equal', 'Backspace'],
		['Tab', ...'QWERTYUIOP'.split('').map(letter => `Key${letter}`), 'BracketLeft', 'BracketRight', 'Backslash'],
		['ControlLeft', ...'ASDFGHJKL'.split('').map(letter => `Key${letter}`), 'Semicolon', 'Quote', 'Enter'],
		['ShiftLeft', ...'ZXCVBNM'.split('').map(letter => `Key${letter}`), 'Comma', 'Period', 'Slash', 'ArrowUp'],
	], 'punctuation belongs to its familiar typing row, never a separate extension or the modifier row');
	const printableCodes = ON_SCREEN_KEY_DEFINITIONS.filter(key => key.shiftLabel !== undefined).map(key => key.code);
	assert.equal(printableCodes.length, 47);
	const characters = new Set([' ']);
	for (const row of mainRows) for (const [column, key] of row.keys.entries()) {
		const definition = ON_SCREEN_KEY_DEFINITIONS[key];
		if (!printableCodes.includes(definition.code)) continue;
		assert.equal(row.spans[column], 1, 'letters, digits and punctuation have the same pitch');
		characters.add(definition.label); characters.add(definition.shiftLabel!);
	}
	assert.deepEqual([...characters].sort(), Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)), 'all printable ASCII is reachable directly or with real Shift');
	const supplementary = BROWSER_KEYBOARD_PAGES[1].rows.flatMap(row => row.keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].code));
	assert.deepEqual(supplementary.filter(code => printableCodes.includes(code)), [], 'Fn adds function/navigation/editing keys instead of duplicating primary characters');
});

test('special keys and the inverted-T cursor cluster occupy authored positions rather than a footer', () => {
	for (const page of BROWSER_KEYBOARD_PAGES) {
		const typingRows = page.rows;
		const codes = typingRows.map(row => row.keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].code));
		const enterRow = codes.find(row => row.includes('Enter'))!;
		assert.equal(enterRow.at(-1), 'Enter', 'Enter stays on a right edge');
		assert.equal(codes.at(-2)!.at(-1), 'ArrowUp');
		assert.deepEqual(codes.at(-1)!.slice(-3), ['ArrowLeft', 'ArrowDown', 'ArrowRight']);
		const up = codes.at(-2)!.indexOf('ArrowUp'), down = codes.at(-1)!.indexOf('ArrowDown');
		assert.equal(typingRows.at(-2)!.starts[up] - typingRows.at(-2)!.units / 2,
			typingRows.at(-1)!.starts[down] - typingRows.at(-1)!.units / 2, 'Up stays above Down after row centering');
		assert.equal(typingRows.at(-2)!.spans[up], typingRows.at(-1)!.spans[down]);
		assert.equal(new Set(page.rows.flatMap(row => row.keys)).size, page.rows.reduce((total, row) => total + row.keys.length, 0),
			'each key appears once per page so controller key identity has one real position');
	}
	const main = BROWSER_KEYBOARD_PAGES[0].rows;
	assert.equal(ON_SCREEN_KEY_DEFINITIONS[main[1].keys[0]].code, 'Tab');
	assert.equal(ON_SCREEN_KEY_DEFINITIONS[main[0].keys.at(-1)!].code, 'Backspace');
	assert.equal(main[0].spans.at(-1), 1.5);
	assert.equal(main[2].spans.at(-1), 2.25);
	assert.equal(main[3].spans[0], 2.5);
	assert.ok(main[2].spans.at(-1)! > main[2].spans[0], 'Enter is larger than Ctrl, not just an ordinary character cap');
	assert.deepEqual(main[4].keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].code),
		['AltLeft', 'Space', 'Home', 'End', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
	assert.deepEqual(main[4].spans.slice(0, 4), [1.5, 4.25, 2, 2], 'the bottom row retains one Space plus reachable Alt/Home/End');
});

test('package expansion uses every authored HTML fragment, including the close-button artwork', async () => {
	let source = await readFile('gamebase.html', 'utf8');
	for (const fragment of ['page', 'row', 'key', 'mode', 'close']) {
		const opening = `<template data-bmsx-keyboard="${fragment}">`;
		assert.ok(source.includes(opening));
		source = source.replace(opening, `${opening}<!-- authored-${fragment}-probe -->`);
	}
	const closeArtwork = source.indexOf('<svg ', source.indexOf('<template data-bmsx-keyboard="close">'));
	source = source.slice(0, closeArtwork) + source.slice(closeArtwork)
		.replace('<svg viewBox="0 0 24 24"', '<svg data-authored-artwork="keyboard-hide" viewBox="0 0 24 24"');
	const expanded = expandBrowserKeyboardTemplate(source);
	const pageCount = BROWSER_KEYBOARD_PAGES.length;
	const rowCount = BROWSER_KEYBOARD_PAGES.reduce((count, page) => count + page.rows.length, 0);
	const keyCount = BROWSER_KEYBOARD_PAGES.reduce((count, page) => count + page.rows.reduce((count, row) => count + row.keys.length, 0), 0);
	for (const [fragment, count] of [['page', pageCount], ['row', rowCount], ['key', keyCount], ['mode', pageCount], ['close', pageCount]] as const) {
		assert.equal([...expanded.matchAll(new RegExp(`<!-- authored-${fragment}-probe -->`, 'g'))].length, count,
			`${fragment} HTML comes from the document-owned fragment, not hand-built markup in the packager`);
	}
	assert.equal([...expanded.matchAll(/data-authored-artwork="keyboard-hide"/g)].length, pageCount);
	assert.ok(!expanded.includes('data-bmsx-keyboard=') && !expanded.includes('@@BMSX_TOUCH_KEYBOARD_PAGES@@'));
});

test('Player and Studio package the same complete keyboard before any host script runs', async t => {
	const folder = await mkdtemp(join(tmpdir(), 'bmsx-keyboard-template-'));
	t.after(() => rm(folder, { recursive: true, force: true }));
	await mkdir(join(folder, 'rom'));
	for (const file of ['gamebase.html', 'gamebase.css', 'rom/bmsx.png', 'rom/manifest.json']) {
		await copyFile(file, join(folder, file));
	}
	const builder = new URL('../../scripts/products/browser_build.ts', import.meta.url).href;
	await promisify(execFile)(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), '--input-type=module', '-e', `
import { buildBrowserPlayerPackage, buildBrowserStudioPackage } from ${JSON.stringify(builder)};
await buildBrowserPlayerPackage({ debug: false, romName: '', title: 'BMSX', shortName: 'BMSX' });
await buildBrowserStudioPackage(false);`], { cwd: folder });
	const expanded = expandBrowserKeyboardTemplate(await readFile('gamebase.html', 'utf8'));
	const markup = expanded.match(/<section id="bmsx-touch-keyboard"[\s\S]*?<\/section>/)![0];
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	for (const file of ['index.html', 'player.template.html', 'player.input-trace.template.html', 'studio.html', 'studio.template.html']) {
		const html = await readFile(join(folder, 'dist', file), 'utf8');
		assert.ok(html.includes(markup), `${file} contains the exact shared-page producer output`);
		assert.ok(!html.includes('@@BMSX_TOUCH_KEYBOARD_PAGES@@'));
		assert.ok(!html.includes('data-bmsx-keyboard='), 'package-time fragments do not remain in the runtime document');
		const staticHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
		await page.goto(`data:text/html;charset=utf-8;base64,${Buffer.from(staticHtml).toString('base64')}`, { waitUntil: 'domcontentloaded' });
		assert.equal(await page.locator('#bmsx-touch-keyboard').count(), 1);
		assert.equal(await page.locator('.bmsx-touch-keyboard-page').count(), BROWSER_KEYBOARD_PAGES.length);
		assert.equal(await page.locator('.bmsx-touch-key').count(), BROWSER_KEYBOARD_PAGES.reduce((total, definition) =>
			total + definition.rows.reduce((rowTotal, row) => rowTotal + row.keys.length, 0), 0));
		assert.equal(await page.locator('#bmsx-touch-keyboard').isVisible(), false, 'complete static keyboard starts hidden');
		assert.equal(await page.locator('.bmsx-touch-keyboard-command').count(), BROWSER_KEYBOARD_PAGES.length * 2);
		for (const row of await page.locator('.bmsx-touch-keyboard-page .bmsx-touch-keyboard-row:last-child').all()) {
			assert.equal(await row.locator('button').first().getAttribute('class'), 'bmsx-touch-keyboard-command bmsx-touch-keyboard-mode');
			assert.equal(await row.locator('button').last().getAttribute('data-code'), 'ArrowRight', 'DOM reading order follows authored visual positions, including commands');
		}
		assert.equal(await page.locator('.bmsx-touch-keyboard-command[data-key], .bmsx-touch-keyboard-command[data-code]').count(), 0,
			'presentation commands never masquerade as physical keyboard keys');
		const keyboardRules = await page.evaluate(() => [...document.querySelector<HTMLStyleElement>('head > style')!.sheet!.cssRules]
			.some(rule => rule.cssText.includes('.bmsx-touch-keyboard')));
		assert.equal(keyboardRules, true, `${file} includes keyboard CSS from gamebase.css before runtime`);
	}
});

test('native browser contacts drive the shared keyboard without guest-pixel geometry or collapsed fingers', async t => {
	const template = expandBrowserKeyboardTemplate(await readFile('gamebase.html', 'utf8'));
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const css = await readFile('gamebase.css', 'utf8');
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenKeyboard } from './hosts/browser/onscreen_keyboard';
export { BROWSER_KEYBOARD_PAGES } from './hosts/browser/onscreen_keyboard_layout';
export { OnScreenKeyboard } from './hosts/common/input/on_screen_keyboard';
export { ON_SCREEN_KEY_DEFINITIONS, ON_SCREEN_KEY_INDEX_BY_CODE } from './hosts/common/input/on_screen_keyboard_keys';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserInputTraceBuffer } from './hosts/browser/input_trace_buffer';
export { BrowserInputTraceView } from './hosts/browser/input_trace_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { hidKeyUsageForCode } from './hosts/common/input/hid_keys';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'keyboardFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const folder = '.bmsx/hosting/conventional-keyboard-evidence';
	await mkdir(folder, { recursive: true });
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const profileEvidence: unknown[] = [];
	for (const profile of [
		{ name: 'phone-portrait', width: 393, height: 852, dpr: 3 },
		{ name: 'phone-landscape', width: 852, height: 393, dpr: 3 },
		{ name: 'tablet-portrait', width: 768, height: 1024, dpr: 2 },
		{ name: 'tablet-landscape', width: 1024, height: 768, dpr: 2 },
		{ name: 'compact-landscape', width: 568, height: 239, dpr: 1 },
	]) {
		await t.test(profile.name, async p => {
			const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: true,
				hasTouch: true, deviceScaleFactor: profile.dpr });
			p.after(() => context.close());
			const page = await context.newPage();
			const errors: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
<body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas><div id="capture-other"></div></div></body>`);
			await page.addScriptTag({ content: bundle.outputFiles[0].text });
			await page.evaluate(withTrace => {
				const api = (globalThis as any).keyboardFixture;
				if (withTrace) new api.BrowserInputTraceView(document, new api.BrowserInputTraceBuffer());
				const clock = new api.BrowserHostClock();
				const gamepad = new api.BrowserOnscreenGamepad(clock);
				const gamepadView = new api.BrowserOnscreenGamepadView(document, window, gamepad);
				const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
				const video = new api.BrowserVideoOutput(canvas, gamepadView, 'overscan');
				video.refreshLayout();
				const native: Array<{ type: string; id: number; target: string; trusted: boolean; code: string | null }> = [];
				for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) window.addEventListener(type, event => {
					const pointer = event as PointerEvent;
					if (pointer.pointerType === 'touch') native.push({ type, id: pointer.pointerId, target: (pointer.target as Element).id, trusted: pointer.isTrusted, code: (pointer.target as Element).getAttribute('data-code') });
				}, true);
				const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, gamepad, 'F2');
				const input = new api.Input(clock, hub, gamepad.gamepadIndex);
				const model = new api.OnScreenKeyboard(input, api.BROWSER_KEYBOARD_PAGES);
				const staticPanel = document.getElementById('bmsx-touch-keyboard');
				const staticButtons = [...staticPanel.querySelectorAll('button')];
				const styleCount = document.querySelectorAll('style').length;
				const view = new api.BrowserOnscreenKeyboard(document, model, () => model.close());
				hub.setOnscreenKeyboard(view);
				const snapshot = api.createInputControllerSnapshot();
				const controllerSource = model.allocateSource();
				(globalThis as any).keyboardProbe = {
					model, view, video, gamepad, native,
					staticMarkup() { return { samePanel: staticPanel === document.getElementById('bmsx-touch-keyboard'),
						sameButtons: staticButtons.every(button => button.isConnected), styles: document.querySelectorAll('style').length - styleCount }; },
					poll() {
						input.pollInput();
						input.sampleInputControllerSnapshot(snapshot, 0);
						return { codes: api.ON_SCREEN_KEY_DEFINITIONS.filter((key: any) => {
							const usage = api.hidKeyUsageForCode(key.code);
							return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0;
						}).map((key: any) => key.code).sort(), keyWords: [...snapshot.keyWords], pointer: snapshot.pointerButtons,
							gamepad: gamepad.buttons, supervisor: input.supervisorRequestLineHigh() };
					},
					hostFrame() { input.pollInput(); model.updateFeedback(clock.now()); },
					controller(code: string, down: boolean) {
						if (down) model.pressKey(controllerSource, api.ON_SCREEN_KEY_INDEX_BY_CODE.get(code));
						else model.releaseSource(controllerSource);
					},
					measure() {
						const panel = document.querySelector('.bmsx-touch-keyboard')!;
						const panelBounds = panel.getBoundingClientRect();
						return { panel: { x: panelBounds.x, y: panelBounds.y, width: panelBounds.width, height: panelBounds.height },
							close: (() => { const bounds = panel.querySelector('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-keyboard-close')!.getBoundingClientRect();
								return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; })(),
							rows: [...panel.querySelectorAll('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-keyboard-row')].map(row =>
								[...row.querySelectorAll<HTMLButtonElement>('.bmsx-touch-key')].map(button => {
									const bounds = button.getBoundingClientRect();
									const text = document.createRange(); text.selectNodeContents(button);
									return { textWidth: text.getBoundingClientRect().width, code: button.getAttribute('data-code'), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
										pressed: button.getAttribute('aria-pressed'), highlighted: button.getAttribute('data-highlighted') };
								})),
							rowBounds: [...panel.querySelectorAll('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-keyboard-row')].map(row => {
								const bounds = row.getBoundingClientRect();
								return { x: bounds.x, width: bounds.width };
							}),
							controllerVisible: getComputedStyle(document.getElementById('controller-viewport')!).visibility,
							geometryRevision: gamepad.geometryRevision, sources: model.sourceCount };
					},
					picture() { const rect = canvas.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clip: canvas.style.clipPath }; },
					finish() { input.dispose(); video.dispose(); },
				};
			}, profile.name === 'compact-landscape');
			const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
			const poll = () => page.evaluate(() => (globalThis as any).keyboardProbe.poll());
			const picture = () => page.evaluate(() => (globalThis as any).keyboardProbe.picture());
			const measure = () => page.evaluate(() => (globalThis as any).keyboardProbe.measure());
			const cdp = await context.newCDPSession(page);
			const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Array<{ id: number; x: number; y: number }>) => {
				const before = type === 'touchCancel' ? await page.evaluate(() => (globalThis as any).keyboardProbe.native.length) : 0;
				await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 3, radiusY: 3 })) });
				if (type === 'touchCancel') await page.waitForFunction(before => (globalThis as any).keyboardProbe.native.slice(before)
					.some((event: { type: string; trusted: boolean }) => event.type === 'pointercancel' && event.trusted), before);
			};
			const point = async (code: string, id: number) => {
				const bounds = await page.locator(`.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="${code}"]`).boundingBox();
				return { id, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
			};
			const tapControl = async (label: string) => {
				const control = label === 'Fn' || label === 'ABC'
					? page.locator('.bmsx-touch-keyboard-mode:visible').filter({ hasText: label })
					: page.getByRole('button', { name: label, exact: true });
				const bounds = await control.boundingBox();
				const contact = { id: 99, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
				await touch('touchStart', [contact]);
				await touch('touchEnd', []);
				await settle();
			};
			await settle();
			assert.deepEqual(await page.evaluate(() => (globalThis as any).keyboardProbe.staticMarkup()),
				{ samePanel: true, sameButtons: true, styles: 0 }, 'view binds packaged nodes and never injects HTML or CSS at runtime');
			const beforePicture = await picture();
			const beforeRevision = (await measure()).geometryRevision;
			await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
			await settle();
			const opening = await measure();
			const shortSurface = profile.height === 239;
			const mainKeyHeight = shortSurface ? 44 : profile.name.startsWith('tablet') ? 56 : 48;
			assert.equal(opening.controllerVisible, 'hidden', 'keyboard replaces touch controls visually, not their input leases or geometry');
			assert.equal(opening.geometryRevision, beforeRevision);
			assert.deepEqual(await picture(), beforePicture, 'opening the CSS keyboard does not change picture policy, scale or clipping');
			assert.ok(opening.panel.y >= -1 / 32 && opening.panel.y + opening.panel.height <= profile.height + 1 / 32);
			assert.equal(opening.rows.length, 5);
			assert.equal(opening.close.y, opening.rows.at(-1)[0].y, 'Close shares the bottom key row, without a separate command bar');
			assert.equal(await page.locator('.bmsx-touch-keyboard-toolbar').count(), 0);
			assert.equal(await page.locator('.bmsx-touch-keyboard-mode:visible').count(), 1);
			assert.equal(await page.locator('.bmsx-touch-keyboard-close:visible').count(), 1);
			assert.ok(opening.close.x < opening.rows[0].at(-1).x && opening.close.width >= 32);
			assert.ok(Math.abs(opening.close.height - mainKeyHeight) <= 1 / 64);
			assert.deepEqual(opening.rows.map((row: any[]) => row.map(key => key.code)), BROWSER_KEYBOARD_PAGES[0].rows
				.map(row => row.keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].code)));
			await page.screenshot({ path: `${folder}/${profile.name}-text.png`, scale: 'css' });
			for (const row of opening.rows) for (const key of row) {
				assert.ok(Math.abs(key.height - mainKeyHeight) <= 1 / 64,
					'five conventional rows retain 44px short-surface and 48/56px ordinary target heights');
				assert.ok(key.textWidth <= key.width - 2, `${key.code} label (${key.textWidth}px) stays inside its real border (${key.width}px) rather than overflowing a narrow phone key`);
			}
			const mainKeys = opening.rows.flat();
			const keyWidth = (code: string) => mainKeys.find((key: any) => key.code === code).width;
			assert.ok(keyWidth('Backspace') > keyWidth('KeyQ') && keyWidth('Enter') > keyWidth('ControlLeft'));
			assert.ok(keyWidth('ShiftLeft') > keyWidth('AltLeft'));
			for (const definition of ON_SCREEN_KEY_DEFINITIONS) if (definition.shiftLabel !== undefined) {
				assert.ok(Math.abs(keyWidth(definition.code) - keyWidth('KeyQ')) <= 1 / 64, 'all printable keys have equal measured widths, including punctuation');
			}
			const panelHeight = shortSurface ? 236 : profile.name.startsWith('tablet') ? 328 : profile.name === 'phone-portrait' ? 272 : 280;
			assert.ok(Math.abs(opening.panel.height - panelHeight) <= 5 / 64, 'the primary keyboard needs five rows, not an extension or footer toolbar');
			if (profile.name === 'phone-portrait') assert.ok(keyWidth('KeyQ') >= 21.5 && keyWidth('KeyQ') <= 22.5,
				'the full conventional row exposes its genuinely narrow phone targets instead of claiming 44px widths');
			if (profile.name.startsWith('tablet')) for (const key of opening.rows[0]) assert.ok(key.width >= 43 && key.height >= 56);
			await p.test('every keyboard page preserves scene pixels while selected, held and acknowledged keys remain visible', async () => {
				// A two-tone scene exposes opaque plates, key fills and backdrop blurring.
				// Compare browser-painted pixels, not just declared stylesheet values.
				await page.evaluate(() => {
					const scene = document.createElement('div');
					scene.id = 'keyboard-transparency-scene';
					Object.assign(scene.style, { position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'none',
						background: 'conic-gradient(#f3e6b8 25%, #172b46 0 50%, #f3e6b8 0 75%, #172b46 0) 0 0 / 24px 24px' });
					document.getElementById('player-surface')!.append(scene);
				});
				for (let keyboardPage = 0; keyboardPage < BROWSER_KEYBOARD_PAGES.length; keyboardPage++) {
					await page.evaluate(index => {
						const model = (globalThis as any).keyboardProbe.model;
						model.setPage(index); model.updateFeedback(0);
					}, keyboardPage);
					await settle();
					const code = ON_SCREEN_KEY_DEFINITIONS[BROWSER_KEYBOARD_PAGES[keyboardPage].initialKey].code;
					const selected = page.locator(`.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="${code}"]`);
					const contact = await point(code, 81);
					const baseGeometry = await measure();
					const paints: Array<{ color: string; border: string; outline: string }> = [];
					for (const state of ['selected', 'held', 'acknowledged'] as const) {
						if (state === 'held') await touch('touchStart', [contact]);
						if (state === 'acknowledged') await touch('touchEnd', []);
						await settle();
						assert.deepEqual((await poll()).codes, state === 'held' ? [code] : [],
							'paint acknowledgement does not prolong the actual forwarded key');
						const presentation = await page.evaluate(() => {
							const panel = document.getElementById('bmsx-touch-keyboard')!;
							const surfaces = [panel.parentElement!, panel, ...panel.querySelectorAll('*')].map(element => {
								const style = getComputedStyle(element);
								return { background: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity,
									shadow: style.boxShadow, filter: style.filter, backdrop: style.backdropFilter };
								});
							const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.bmsx-touch-keyboard-page:not([hidden]) button')].map(button => {
								const bounds = button.getBoundingClientRect(), style = getComputedStyle(button);
								const text = document.createRange(); text.selectNodeContents(button);
								const glyph = button.querySelector('svg')?.getBoundingClientRect() ?? text.getBoundingClientRect();
								return { label: button.getAttribute('data-code') || button.getAttribute('aria-label') || button.textContent,
									bounds: bounds.toJSON(), glyph: glyph.toJSON(), color: style.color, border: style.borderTopStyle };
								});
							return { surfaces, buttons };
						});
						for (const surface of presentation.surfaces) assert.deepEqual(surface, { background: 'rgba(0, 0, 0, 0)', image: 'none',
							opacity: '1', shadow: 'none', filter: 'none', backdrop: 'none' }, 'transparency belongs to backgrounds, not a faded/blurred keyboard subtree');
						const visible = PNG.sync.read(await page.screenshot({ path: `${folder}/${profile.name}-page${keyboardPage}-${state}-transparent.png`, scale: 'css' }));
						await page.locator('#bmsx-touch-keyboard').evaluate(panel => { panel.style.visibility = 'hidden'; });
						const underneath = PNG.sync.read(await page.screenshot({ scale: 'css' }));
						await page.locator('#bmsx-touch-keyboard').evaluate(panel => { panel.style.visibility = ''; });
						for (const button of presentation.buttons) {
							for (const y of [button.bounds.y + 6, button.bounds.y + button.bounds.height - 6]) {
								const offset = (Math.round(y) * visible.width + Math.round(button.bounds.x + button.bounds.width / 2)) * 4;
								assert.deepEqual(visible.data.subarray(offset, offset + 4), underneath.data.subarray(offset, offset + 4),
									`${button.label}/${state} leaves the underlying scene unchanged inside its border`);
							}
							let glyphPixels = 0;
							for (let y = Math.round(button.glyph.y); y < button.glyph.y + button.glyph.height; y++) {
								for (let x = Math.round(button.glyph.x); x < button.glyph.x + button.glyph.width; x++) {
									const offset = (y * visible.width + x) * 4;
									if (!visible.data.subarray(offset, offset + 4).equals(underneath.data.subarray(offset, offset + 4))) glyphPixels++;
								}
							}
							assert.ok(glyphPixels > 0, `${button.label}/${state} still has real browser-painted label or command artwork`);
							assert.equal(button.border, 'solid');
							assert.notEqual(button.color, 'rgba(0, 0, 0, 0)');
						}
						paints.push(await selected.evaluate(element => ({ color: getComputedStyle(element).color,
							border: getComputedStyle(element).borderColor, outline: getComputedStyle(element).outlineStyle })));
						assert.deepEqual((await measure()).rows.map((row: any[]) => row.map(({ x, y, width, height }) => ({ x, y, width, height }))),
							baseGeometry.rows.map((row: any[]) => row.map(({ x, y, width, height }) => ({ x, y, width, height }))), 'transparent feedback does not move approved targets');
					}
					assert.notEqual(paints[0].border, paints[1].border);
					assert.notEqual(paints[0].color, paints[1].color);
					assert.equal(paints[1].outline, 'solid');
					assert.deepEqual(paints[2], paints[1], 'released keys retain a brief, visible outline/glyph acknowledgement, not a fill');
					await page.evaluate(() => (globalThis as any).keyboardProbe.model.updateFeedback(121));
					await settle();
					assert.deepEqual(await selected.evaluate(element => ({ color: getComputedStyle(element).color,
						border: getComputedStyle(element).borderColor, outline: getComputedStyle(element).outlineStyle })), paints[0]);
				}
				await page.evaluate(() => {
					document.getElementById('keyboard-transparency-scene')!.remove();
					(globalThis as any).keyboardProbe.model.open();
				});
				await settle();
				assert.deepEqual(await picture(), beforePicture, 'transparent presentation does not change the game image or viewport');
			});
			await p.test('shifted legends retain the same conventional positions and fit without resizing keys', async () => {
				await page.keyboard.down('Shift');
				await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
				await settle();
				const shifted = await measure();
				for (const [rowIndex, row] of shifted.rows.entries()) for (const [column, key] of row.entries()) {
					const base = opening.rows[rowIndex][column];
					assert.deepEqual([key.x, key.y, key.width, key.height], [base.x, base.y, base.width, base.height]);
					assert.ok(key.textWidth <= key.width - 2, `${key.code} uppercase/shifted legend fits without sacrificing character pitch`);
				}
				await page.screenshot({ path: `${folder}/${profile.name}-shifted.png`, scale: 'css' });
				await page.keyboard.up('Shift');
				await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
				await settle();
				assert.deepEqual((await poll()).codes, []);
			});

			await p.test('native capture transfer preserves an unused modifier until its real up or cancellation', async () => {
				for (const end of ['touchEnd', 'touchCancel'] as const) {
					const shift = await point('ShiftLeft', 1);
					const firstEvent = await page.evaluate(() => (globalThis as any).keyboardProbe.native.length);
					let held = false;
					try {
						await touch('touchStart', [shift]);
						held = true;
						await touch('touchMove', [{ ...shift, x: shift.x + 0.1 }]);
						await page.evaluate(first => {
							const events = (globalThis as any).keyboardProbe.native.slice(first);
							const id = events.find((event: { type: string }) => event.type === 'pointerdown').id;
							document.getElementById('capture-other')!.setPointerCapture(id);
						}, firstEvent);
						await touch('touchMove', [{ ...shift, x: shift.x + 0.2 }]);
						await page.waitForFunction(first => (globalThis as any).keyboardProbe.native.slice(first).some((event: { type: string; target: string; trusted: boolean }) =>
							event.type === 'gotpointercapture' && event.target === 'capture-other' && event.trusted), firstEvent);
						const events = await page.evaluate(first => (globalThis as any).keyboardProbe.native.slice(first), firstEvent);
						assert.ok(events.some((event: { type: string; target: string; trusted: boolean }) => event.type === 'lostpointercapture'
							&& event.target === 'player-surface' && event.trusted));
						assert.equal(events.some((event: { type: string }) => event.type === 'pointercancel'), false);
						assert.deepEqual((await poll()).codes, ['ShiftLeft'], 'DOM capture transfer must retain the actual modifier contact');
						await touch(end, []);
						held = false;
						assert.deepEqual((await poll()).codes, end === 'touchEnd' ? ['ShiftLeft'] : [], 'only actual native UP may complete a sticky modifier tap');
						if (end === 'touchEnd') {
							const q = await point('KeyQ', 2);
							await touch('touchStart', [q]);
							held = true;
							assert.deepEqual((await poll()).codes, ['KeyQ', 'ShiftLeft']);
							await touch('touchEnd', []);
							held = false;
							assert.deepEqual((await poll()).codes, []);
						}
					} finally { if (held) { await touch('touchEnd', []); await poll(); } }
				}
			});

			await p.test('two fingers and controller source retain independent key leases', async () => {
				const q = await point('KeyQ', 1), w = await point('KeyW', 2);
				await touch('touchStart', [q]);
				assert.deepEqual((await poll()).codes, ['KeyQ']);
				await touch('touchStart', [q, w]);
				assert.deepEqual((await poll()).codes, ['KeyQ', 'KeyW']);
				await page.evaluate(() => (globalThis as any).keyboardProbe.controller('KeyQ', true));
				await touch('touchEnd', [q]);
				assert.deepEqual((await poll()).codes, ['KeyQ', 'KeyW'], 'lifting one Q source cannot release the controller source or W');
				await page.evaluate(() => (globalThis as any).keyboardProbe.controller('KeyQ', false));
				assert.deepEqual((await poll()).codes, ['KeyW']);
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, []);
				assert.equal((await poll()).pointer, 0, 'keyboard contacts do not become guest pointers');
			});
			await p.test('same-key fingers and outside movement remain independent physical sources', async () => {
				const first = await point('KeyQ', 1), second = await point('KeyQ', 2);
				await touch('touchStart', [first, second]);
				assert.deepEqual((await poll()).codes, ['KeyQ']);
				await touch('touchEnd', [first]);
				assert.deepEqual((await poll()).codes, ['KeyQ'], 'another finger remains physically held on the same key');
				await touch('touchMove', [{ ...second, x: 4, y: 4 }]);
				assert.deepEqual((await poll()).codes, ['KeyQ'], 'a native key lease does not retarget just because the finger leaves its visual key');
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, []);
			});
			await p.test('real held modifiers chord while an unused Shift tap latches exactly one following key', async () => {
				const shift = await point('ShiftLeft', 1), q = await point('KeyQ', 2);
				await touch('touchStart', [shift]);
				await touch('touchStart', [shift, q]);
				assert.deepEqual((await poll()).codes, ['KeyQ', 'ShiftLeft']);
				await touch('touchEnd', [shift]);
				assert.deepEqual((await poll()).codes, ['KeyQ'], 'a used Shift contact releases without creating a latch');
				await touch('touchEnd', []);
				await touch('touchStart', [shift]);
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, ['ShiftLeft'], 'an unused modifier tap latches before its actual source release');
				await touch('touchStart', [q]);
				assert.deepEqual((await poll()).codes, ['KeyQ', 'ShiftLeft']);
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, [], 'the shared model consumes one-shot Shift on release of its chosen key');
				await touch('touchStart', [shift]);
				await touch('touchCancel', []);
				assert.deepEqual((await poll()).codes, [], 'a genuine native cancel must never create a modifier latch');
			});
			await p.test('number-row Shift changes keycaps but forwards physical HID chords for held and tapped modifiers', async () => {
				await settle();
				const shift = await point('ShiftLeft', 1), digit = await point('Digit1', 2);
				const cap = page.locator('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="Digit1"]');
				const q = page.locator('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="KeyQ"]');
				assert.equal(await cap.textContent(), '1');
				for (const latched of [false, true]) {
					await touch('touchStart', [shift]);
					if (latched) await touch('touchEnd', []);
					await settle();
					assert.equal(await cap.textContent(), '!');
					assert.equal(await q.textContent(), 'Q');
					assert.deepEqual((await poll()).codes, ['ShiftLeft']);
					await touch('touchStart', latched ? [digit] : [shift, digit]);
					assert.deepEqual((await poll()).codes, ['Digit1', 'ShiftLeft'],
						'! is an actual Shift+Digit1 chord, not a synthetic character or fake key');
					await touch('touchEnd', latched ? [] : [digit]);
					assert.deepEqual((await poll()).codes, latched ? [] : ['ShiftLeft']);
					if (!latched) await touch('touchEnd', []);
					await settle();
					assert.deepEqual((await poll()).codes, []);
					assert.equal(await cap.textContent(), '1');
					assert.equal(await q.textContent(), 'q');
				}
			});
			await p.test('all coding punctuation is directly touchable on the main page and preserves base HID identity under every Shift source', async () => {
				const sourceHighWater = (await measure()).sources;
				for (const [code, base, shifted, usage] of CODING_KEYS) {
					const cap = page.locator(`.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="${code}"]`);
					const key = await point(code, 2), shift = await point('ShiftLeft', 1);
					for (const mode of ['plain', 'held', 'latched', 'hardware']) {
						if (mode === 'held' || mode === 'latched') {
							await touch('touchStart', [shift]);
							if (mode === 'latched') await touch('touchEnd', []);
						} else if (mode === 'hardware') {
							await page.keyboard.down('Shift');
							await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
						}
						await settle();
						assert.equal(await cap.textContent(), mode === 'plain' ? base : shifted);
						assert.equal(await cap.getAttribute('data-code'), code, 'Shift changes the cap, not the physical key identity');
						assert.equal(await page.evaluate(() => (globalThis as any).keyboardProbe.model.page), 0, 'coding punctuation requires no Fn page switch');
						await touch('touchStart', mode === 'held' ? [shift, key] : [key]);
						const pressed = await poll();
						assert.deepEqual(pressed.codes, (mode === 'plain' ? [code] : [code, 'ShiftLeft']).sort());
						assert.deepEqual(pressed.keyWords, [0, 1 << (usage & 31), 0, 0, 0, 0, 0, mode === 'plain' ? 0 : 2],
							`${code}/${mode} publishes its USB usage and real Shift225, never a character code`);
						await touch('touchEnd', mode === 'held' ? [key] : []);
						assert.deepEqual((await poll()).codes, mode === 'held' || mode === 'hardware' ? ['ShiftLeft'] : [], 'ordinary UP releases only its own source');
						if (mode === 'held') await touch('touchCancel', []);
						if (mode === 'hardware') {
							await page.keyboard.up('Shift');
							await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
						}
						await settle();
						assert.deepEqual((await poll()).codes, []);
						assert.equal(await cap.textContent(), base);
					}
				}
				assert.equal((await measure()).sources, sourceHighWater, 'the coding row uses the same retained contact slots');
			});
			await p.test('digits and letters share one native page and the cursor gutters remain non-keys', async () => {
				const digit = await point('Digit1', 1), q = await point('KeyQ', 2);
				await touch('touchStart', [digit, q]);
				assert.deepEqual((await poll()).codes, ['Digit1', 'KeyQ']);
				await touch('touchEnd', []);
				const layout = await measure();
				const keys = layout.rows.flat();
				const up = keys.find((key: any) => key.code === 'ArrowUp');
				const down = keys.find((key: any) => key.code === 'ArrowDown');
				const left = keys.find((key: any) => key.code === 'ArrowLeft');
				const right = keys.find((key: any) => key.code === 'ArrowRight');
				assert.ok(Math.abs(up.x - down.x) <= 1 / 64 && up.y + up.height < down.y);
				assert.ok(left.x + left.width < down.x && down.x + down.width < right.x);
				assert.ok(Math.abs(up.height - mainKeyHeight) <= 1 / 64 && up.height === down.height, 'the inverted T keeps the same full row height as typing keys');
				const gutter = { id: 3, x: right.x + right.width / 2, y: up.y + up.height / 2 };
				await touch('touchStart', [gutter]);
				assert.deepEqual((await poll()).codes, []);
				assert.equal((await poll()).pointer, 0, 'a cursor gutter belongs to the keyboard, never the guest pointer');
				const id = await page.evaluate(() => (globalThis as any).keyboardProbe.native.filter((event: any) => event.type === 'pointerdown').at(-1).id);
				assert.equal(await page.evaluate(id => (globalThis as any).keyboardProbe.view.ownsContact(id), id), true);
				await touch('touchEnd', []);
			});

			await p.test('shared modifier eligibility observes controller chords in both source orders', async () => {
				const shift = await point('ShiftLeft', 1);
				await touch('touchStart', [shift]);
				await page.evaluate(() => (globalThis as any).keyboardProbe.controller('KeyQ', true));
				assert.deepEqual((await poll()).codes, ['KeyQ', 'ShiftLeft']);
				await page.evaluate(() => (globalThis as any).keyboardProbe.controller('KeyQ', false));
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, [], 'a controller key invalidates an already-held native modifier tap');
				await page.evaluate(() => (globalThis as any).keyboardProbe.controller('KeyQ', true));
				await touch('touchStart', [shift]);
				await page.evaluate(() => (globalThis as any).keyboardProbe.controller('KeyQ', false));
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, [], 'a modifier begun during a controller key is not an unused tap');
			});
			await p.test('physical Shift updates touch labels and survives a separately released touch key', async () => {
				const cap = page.locator('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="Digit1"]');
				await page.keyboard.down('Shift');
				await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
				await settle();
				assert.equal(await cap.textContent(), '!');
				assert.deepEqual((await poll()).codes, ['ShiftLeft']);
				const digit = await point('Digit1', 1);
				await touch('touchStart', [digit]);
				assert.deepEqual((await poll()).codes, ['Digit1', 'ShiftLeft']);
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, ['ShiftLeft'], 'the hardware modifier survives release of the independent virtual key');
				await page.keyboard.up('Shift');
				await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
				await settle();
				assert.deepEqual((await poll()).codes, []);
				assert.equal(await cap.textContent(), '1');
			});
			await p.test('physical letter chords prevent an unused-touch-modifier latch in both source orders', async () => {
				for (const physicalFirst of [false, true]) {
					const shift = await point('ShiftLeft', 1);
					if (physicalFirst) await page.keyboard.down('q');
					await touch('touchStart', [shift]);
					if (!physicalFirst) await page.keyboard.down('q');
					await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
					assert.deepEqual((await poll()).codes, ['KeyQ', 'ShiftLeft']);
					await page.keyboard.up('q');
					await touch('touchEnd', []);
					await page.evaluate(() => (globalThis as any).keyboardProbe.hostFrame());
					await settle();
					assert.deepEqual((await poll()).codes, [], 'a virtual Shift used with a physical key was not an unused modifier tap');
					assert.equal(await page.locator('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="Digit1"]').textContent(), '1');
				}
			});

			await p.test('one native batch preserves origin-page keys in either mode/key event order', async () => {
				for (const firstPage of [true, false]) {
					assert.equal(await page.evaluate(() => (globalThis as any).keyboardProbe.model.page), 0);
					const q = await point('KeyQ', firstPage ? 2 : 1);
					const tab = await page.locator('.bmsx-touch-keyboard-mode:visible').boundingBox();
					const command = { id: firstPage ? 1 : 2, x: tab!.x + tab!.width / 2, y: tab!.y + tab!.height / 2 };
					await touch('touchStart', firstPage ? [command, q] : [q, command]);
					assert.deepEqual((await poll()).codes, ['KeyQ'], 'the queued old-page native Q still publishes its real key identity');
					assert.deepEqual(await page.evaluate(() => ({ page: (globalThis as any).keyboardProbe.model.page,
						selected: (globalThis as any).keyboardProbe.model.selectedKey })), { page: 1, selected: BROWSER_KEYBOARD_PAGES[1].initialKey },
						'the new Fn page retains its own coherent selected key');
					await touch('touchEnd', []);
					assert.deepEqual((await poll()).codes, []);
					await tapControl('ABC');
					assert.equal(await page.evaluate(() => (globalThis as any).keyboardProbe.model.page), 0);
					assert.deepEqual((await poll()).codes, [], 'mode cycling never emits a guest key');
				}
			});
			await p.test('afterglow acknowledges already forwarded keys without extending raw key lifetime', async () => {
				await page.evaluate(() => (globalThis as any).keyboardProbe.model.updateFeedback(1000));
				const key = await point('Backspace', 1);
				await touch('touchStart', [key]);
				assert.deepEqual((await poll()).codes, ['Backspace']);
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).codes, []);
				await settle();
				const button = page.locator('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="Backspace"]');
				assert.equal(await button.getAttribute('aria-pressed'), 'false');
				assert.equal(await button.getAttribute('data-highlighted'), 'true');
				await page.evaluate(() => (globalThis as any).keyboardProbe.model.updateFeedback(1121));
				await settle();
				assert.equal(await button.getAttribute('data-highlighted'), 'false');
				assert.deepEqual((await poll()).codes, []);
			});
			const navigationRounding: unknown[] = [];
			let maximumCenterRounding = 0;
			await p.test('page changes preserve held fingers and expose every physical key', async () => {
				const held = await point('KeyQ', 1);
				await touch('touchStart', [held]);
				const tab = await page.locator('.bmsx-touch-keyboard-mode:visible').boundingBox();
				const pageContact = { id: 2, x: tab!.x + tab!.width / 2, y: tab!.y + tab!.height / 2 };
				await touch('touchStart', [held, pageContact]);
				await touch('touchEnd', [pageContact]);
				await settle();
				assert.deepEqual((await poll()).codes, ['KeyQ']);
				const fn = await point('F12', 3);
				await touch('touchStart', [held, fn]);
				assert.deepEqual((await poll()).codes, ['F12', 'KeyQ']);
				await touch('touchEnd', [held]);
				assert.deepEqual((await poll()).codes, ['F12']);
				await touch('touchEnd', []);
				await settle();
				await page.screenshot({ path: `${folder}/${profile.name}-functions.png`, scale: 'css' });
				const modeBounds = await page.locator('.bmsx-touch-keyboard-mode:visible').boundingBox();
				for (const [pageIndex, label] of ['ABC', 'Fn'].entries()) {
					await tapControl(label);
					const current = await measure();
					assert.equal(current.rows.length, pageIndex === 0 ? 5 : 3);
					assert.deepEqual(current.close, opening.close, 'Close retains its location across page sizes');
					assert.deepEqual(await page.locator('.bmsx-touch-keyboard-mode:visible').boundingBox(), modeBounds);
					assert.deepEqual(current.rows.at(-1).slice(-3).map(({ x, y, width, height }: any) => ({ x, y, width, height })),
						opening.rows.at(-1).slice(-3).map(({ x, y, width, height }: any) => ({ x, y, width, height })), 'the bottom arrow cluster never moves between modes');
					const keyHeight = mainKeyHeight;
					const expectedPanel = pageIndex === 0 ? panelHeight : panelHeight - 2 * (keyHeight + (shortSurface ? 2 : profile.name.startsWith('tablet') ? 8 : 6));
					assert.ok(Math.abs(current.panel.height - expectedPanel) <= current.rows.length / 64);
					const definition = BROWSER_KEYBOARD_PAGES[pageIndex];
					const maximumUnits = Math.max(...definition.rows.map(row => row.units));
					const centers = definition.rows.map(row => row.spans.map((span, column) => maximumUnits - row.units + row.starts[column] * 2 + span));
					const pageLeft = current.rowBounds[0].x, unitWidth = current.rowBounds[0].width / (maximumUnits * 2);
					for (let rowIndex = 0; rowIndex < current.rows.length; rowIndex += 1) {
						for (const [column, key] of current.rows[rowIndex].entries()) {
							const clientCenter = key.x + key.width / 2;
							const logicalCenter = centers[rowIndex][column];
							const rounding = Math.abs(clientCenter - pageLeft - unitWidth * logicalCenter);
							maximumCenterRounding = Math.max(maximumCenterRounding, rounding);
							assert.ok(rounding <= (current.rows[rowIndex].length + 2) / 64,
								`${label}/${key.code} actual CSS center differs only by accumulated 1/64px slot rounding: ${rounding}`);
							for (const direction of [-1, 1]) {
								const selectedCode = await page.evaluate(({ code, direction }) => {
									const api = (globalThis as any).keyboardFixture, model = (globalThis as any).keyboardProbe.model;
									model.selectKey(api.ON_SCREEN_KEY_INDEX_BY_CODE.get(code));
									model.moveVertical(direction);
									return api.ON_SCREEN_KEY_DEFINITIONS[model.selectedKey].code;
								}, { code: key.code, direction });
								const nextIndex = (rowIndex + current.rows.length + direction) % current.rows.length;
								const nextRow = current.rows[nextIndex];
								const logicalDistances = centers[nextIndex].map(center => Math.abs(center - logicalCenter));
								const minimumLogicalDistance = Math.min(...logicalDistances);
								const expectedColumn = logicalDistances.indexOf(minimumLogicalDistance);
								assert.equal(selectedCode, nextRow[expectedColumn].code,
									'controller selection consumes exact authored touch spans, including authored gaps and deterministic first-column tie order');
								const distance = (candidate: any) => Math.abs(candidate.x + candidate.width / 2 - clientCenter);
								const measuredDistances = nextRow.map(distance);
								const nearestDistance = Math.min(...measuredDistances);
								const measuredNearestColumn = measuredDistances.indexOf(nearestDistance);
								if (measuredDistances[expectedColumn] > nearestDistance) {
									assert.equal(logicalDistances[measuredNearestColumn], minimumLogicalDistance,
										'CSS rounding can perturb only an exact logical tie, never choose a logically farther key');
									const latticeTolerance = (current.rows[rowIndex].length + nextRow.length) / 64;
									assert.ok(measuredDistances[expectedColumn] <= nearestDistance + latticeTolerance);
									navigationRounding.push({ page: label, from: key.code, direction, selected: selectedCode,
										measuredNearest: nextRow[measuredNearestColumn].code, exactLogicalDistance: minimumLogicalDistance,
										selectedDistance: measuredDistances[expectedColumn], nearestDistance });
								}
							}
						}
					}
					for (const row of current.rows) for (const key of row) {
						assert.ok(Math.abs(key.height - keyHeight) <= 1 / 64);
						assert.ok(key.textWidth <= key.width - 2, `${label}/${key.code} cap text remains inside its actual key`);
						const contact = await point(key.code, 7);
						await touch('touchStart', [contact]);
						assert.deepEqual((await poll()).codes, [key.code]);
						await touch('touchCancel', []);
						assert.deepEqual((await poll()).codes, []);
					}
				}
				await tapControl('ABC');
			});
			await p.test('Close and key contacts in one native batch never leak through to the underlying gamepad', async () => {
				const sourceHighWater = (await measure()).sources;
				for (const closeFirst of [true, false]) {
					await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
					await settle();
					const firstEvent = await page.evaluate(() => (globalThis as any).keyboardProbe.native.length);
					const key = await point('Digit9', closeFirst ? 2 : 1);
					const bounds = await page.locator('.bmsx-touch-keyboard-close:visible').boundingBox();
					const close = { id: closeFirst ? 1 : 2, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
					await touch('touchStart', closeFirst ? [close, key] : [key, close]);
					const batch = await page.evaluate(first => (globalThis as any).keyboardProbe.native.slice(first)
						.filter((event: any) => event.type === 'pointerdown'), firstEvent);
					assert.equal(batch.length, 2);
					assert.ok(batch.every((event: any) => event.trusted));
					assert.equal(batch[closeFirst ? 1 : 0].code, 'Digit9', 'the browser pre-targeted a real keyboard key, not an underlying gamepad surface');
					assert.equal(await page.evaluate(() => (globalThis as any).keyboardProbe.model.visible), false);
					const closed = await poll();
					assert.deepEqual(closed.codes, []);
					assert.equal(closed.gamepad, 0, 'a keyboard-targeted contact cannot become a gamepad press after another contact closes its model');
					assert.equal(closed.pointer, 0);
					for (const event of batch) assert.equal(await page.evaluate(id => (globalThis as any).keyboardProbe.view.ownsContact(id), event.id), true);
					await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
					await settle();
					await touch('touchMove', [close, { ...key, x: key.x + 1 }]);
					const reopened = await poll();
					assert.deepEqual(reopened.codes, [], 'reopening cannot rearm a contact admitted to the closing keyboard');
					assert.equal(reopened.gamepad, 0);
					assert.equal(reopened.pointer, 0);
					await touch(closeFirst ? 'touchEnd' : 'touchCancel', []);
					for (const event of batch) assert.equal(await page.evaluate(id => (globalThis as any).keyboardProbe.view.ownsContact(id), event.id), false);
					assert.equal((await measure()).sources, sourceHighWater, 'closed-target contacts reuse the same completed contact slots');
				}
			});

			await p.test('closing hides but retains native contact identities until actual release', async () => {
				const q = await point('KeyQ', 1);
				await touch('touchStart', [q]);
				const id = await page.evaluate(() => (globalThis as any).keyboardProbe.native.filter((event: any) => event.type === 'pointerdown').at(-1).id);
				const close = await page.getByRole('button', { name: 'Close on-screen keyboard', exact: true }).boundingBox();
				const command = { id: 2, x: close!.x + close!.width / 2, y: close!.y + close!.height / 2 };
				await touch('touchStart', [q, command]);
				assert.deepEqual((await poll()).codes, []);
				assert.equal(await page.evaluate(id => (globalThis as any).keyboardProbe.view.ownsContact(id), id), true);
				await touch('touchEnd', [command]);
				await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
				await settle();
				await touch('touchMove', [q]);
				assert.deepEqual((await poll()).codes, [], 'reopening cannot reinterpret an already owned held finger');
				await touch('touchEnd', []);
				assert.equal(await page.evaluate(id => (globalThis as any).keyboardProbe.view.ownsContact(id), id), false);
				const w = await point('KeyW', 1);
				const peak = (await measure()).sources;
				for (let tap = 0; tap < 24; tap += 1) { await touch('touchStart', [w]); await touch('touchEnd', []); }
				assert.equal((await measure()).sources, peak, 'completed touch slots are reused instead of allocating a new model source for every tap');
				assert.deepEqual((await poll()).codes, []);
			});
			await tapControl('Close on-screen keyboard');
			assert.deepEqual(await picture(), beforePicture);
			assert.equal((await measure()).geometryRevision, beforeRevision);
			assert.equal((await measure()).controllerVisible, 'visible');
			if (profile.name === 'compact-landscape') assert.equal(await page.evaluate(() => {
				const bounds = document.getElementById('bmsx-input-trace')!.getBoundingClientRect();
				return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)!.closest('#bmsx-input-trace') !== null;
			}), true, 'closing the actual short-frame keyboard returns the diagnostic hit plane to its own header');
			const events = await page.evaluate(() => (globalThis as any).keyboardProbe.native);
			assert.ok(events.some((event: any) => event.type === 'pointerdown') && events.some((event: any) => event.type === 'pointerup')
				&& events.some((event: any) => event.type === 'pointercancel') && events.every((event: any) => event.trusted),
				'the actual down/up/cancel contacts are trusted browser input, not dispatched DOM pointer events');
			profileEvidence.push({ profile, opening, picture: beforePicture, nativeEvents: events.length, maximumCenterRounding, navigationRounding });
			assert.deepEqual(errors, []);
			await page.evaluate(() => (globalThis as any).keyboardProbe.finish());
			assert.equal(await page.locator('.bmsx-touch-keyboard').count(), 1, 'teardown preserves the document-owned keyboard template');
			assert.equal(await page.locator('.bmsx-touch-keyboard').isVisible(), false);
			assert.deepEqual(await page.evaluate(() => (globalThis as any).keyboardProbe.staticMarkup()),
				{ samePanel: true, sameButtons: true, styles: 0 });
			await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
			await settle();
			assert.equal(await page.evaluate(() => document.body.classList.contains('bmsx-touch-keyboard-visible')), false,
				'teardown unsubscribes presentation; a later model revision cannot restore stale body UI state');
		});
	}
	await writeFile(`${folder}/profiles.json`, JSON.stringify(profileEvidence, null, 2));
});
