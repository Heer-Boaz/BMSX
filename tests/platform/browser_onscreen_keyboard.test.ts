import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { BROWSER_KEYBOARD_PAGES } from '../../hosts/browser/onscreen_keyboard_layout';
import { ON_SCREEN_KEY_DEFINITIONS } from '../../hosts/common/input/on_screen_keyboard_keys';

test('browser keyboard pages cover every physical key and author the actual four touch rows', () => {
	const keys = new Set<number>();
	for (const page of BROWSER_KEYBOARD_PAGES) {
		assert.equal(page.rows.length, 4);
		assert.ok(page.rows.some(row => row.keys.includes(page.initialKey)));
		for (const row of page.rows) {
			assert.equal(row.keys.length, row.spans.length);
			assert.equal(row.spans.reduce((sum, span) => sum + span, 0), row.units);
			for (const key of row.keys) keys.add(key);
		}
	}
	assert.deepEqual([...keys].sort((a, b) => a - b), ON_SCREEN_KEY_DEFINITIONS.map((_, index) => index));
	assert.deepEqual(BROWSER_KEYBOARD_PAGES[0].rows.slice(0, 2).map(row => row.keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].label).join('')),
		['qwertyuiop', 'asdfghjkl']);
});

test('native browser contacts drive the shared keyboard without guest-pixel geometry or collapsed fingers', async t => {
	const template = await readFile('gamebase.html', 'utf8');
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
	const folder = '.bmsx/hosting/browser-touch-keyboard-evidence';
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
<body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
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
				const native: Array<{ type: string; id: number; trusted: boolean }> = [];
				for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, event => {
					const pointer = event as PointerEvent;
					if (pointer.pointerType === 'touch') native.push({ type, id: pointer.pointerId, trusted: pointer.isTrusted });
				}, true);
				const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, gamepad, 'F2');
				const input = new api.Input(clock, hub, gamepad.gamepadIndex);
				const model = new api.OnScreenKeyboard(input, api.BROWSER_KEYBOARD_PAGES);
				const view = new api.BrowserOnscreenKeyboard(document, model, () => model.close());
				hub.setOnscreenKeyboard(view);
				const snapshot = api.createInputControllerSnapshot();
				const controllerSource = model.allocateSource();
				(globalThis as any).keyboardProbe = {
					model, view, video, gamepad, native,
					poll() {
						input.pollInput();
						input.sampleInputControllerSnapshot(snapshot, 0);
						return { codes: api.ON_SCREEN_KEY_DEFINITIONS.filter((key: any) => {
							const usage = api.hidKeyUsageForCode(key.code);
							return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0;
						}).map((key: any) => key.code).sort(), pointer: snapshot.pointerButtons,
							gamepad: gamepad.buttons, supervisor: input.supervisorRequestLineHigh() };
					},
					controller(code: string, down: boolean) {
						if (down) model.pressKey(controllerSource, api.ON_SCREEN_KEY_INDEX_BY_CODE.get(code));
						else model.releaseSource(controllerSource);
					},
					measure() {
						const panel = document.querySelector('.bmsx-touch-keyboard')!;
						const panelBounds = panel.getBoundingClientRect();
						return { panel: { x: panelBounds.x, y: panelBounds.y, width: panelBounds.width, height: panelBounds.height },
							rows: [...panel.querySelectorAll('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-keyboard-row')].map(row =>
								[...row.querySelectorAll<HTMLButtonElement>('.bmsx-touch-key')].map(button => {
									const bounds = button.getBoundingClientRect();
									return { code: button.getAttribute('data-code'), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
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
				await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 3, radiusY: 3 })) });
			};
			const point = async (code: string, id: number) => {
				const bounds = await page.locator(`.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-code="${code}"]`).boundingBox();
				return { id, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
			};
			const tapControl = async (label: string) => {
				const bounds = await page.getByRole('button', { name: label, exact: true }).boundingBox();
				const contact = { id: 99, x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
				await touch('touchStart', [contact]);
				await touch('touchEnd', []);
				await settle();
			};
			await settle();
			const beforePicture = await picture();
			const beforeRevision = (await measure()).geometryRevision;
			await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
			await settle();
			const opening = await measure();
			assert.equal(opening.controllerVisible, 'hidden', 'keyboard replaces touch controls visually, not their input leases or geometry');
			assert.equal(opening.geometryRevision, beforeRevision);
			assert.deepEqual(await picture(), beforePicture, 'opening the CSS keyboard does not change picture policy, scale or clipping');
			assert.ok(opening.panel.y >= -1 / 32 && opening.panel.y + opening.panel.height <= profile.height + 1 / 32);
			assert.equal(opening.rows.length, 4);
			assert.deepEqual(opening.rows.slice(0, 2).map((row: any[]) => row.map(key => key.code)), BROWSER_KEYBOARD_PAGES[0].rows.slice(0, 2)
				.map(row => row.keys.map(key => ON_SCREEN_KEY_DEFINITIONS[key].code)));
			for (const row of opening.rows) for (const key of row) assert.ok(key.height >= 44, 'all real key targets retain their touch height');
			if (profile.name === 'phone-portrait') for (const key of opening.rows[0]) assert.ok(key.width >= 32 && key.width <= 37,
				'a ten-letter phone row uses an honest narrow pitch instead of claiming impossible 44px widths');
			if (profile.name.startsWith('tablet')) for (const key of opening.rows[0]) assert.ok(key.width >= 44 && key.height >= 56);
			await page.screenshot({ path: `${folder}/${profile.name}-text.png` });

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
			await p.test('one native batch preserves origin-page keys in either toolbar/key event order', async () => {
				for (const firstPage of [true, false]) {
					await tapControl('Letters');
					const q = await point('KeyQ', firstPage ? 2 : 1);
					const tab = await page.getByRole('button', { name: 'Fn', exact: true }).boundingBox();
					const command = { id: firstPage ? 1 : 2, x: tab!.x + tab!.width / 2, y: tab!.y + tab!.height / 2 };
					await touch('touchStart', firstPage ? [command, q] : [q, command]);
					assert.deepEqual((await poll()).codes, ['KeyQ'], 'the queued old-page native Q still publishes its real key identity');
					assert.deepEqual(await page.evaluate(() => ({ page: (globalThis as any).keyboardProbe.model.page,
						selected: (globalThis as any).keyboardProbe.model.selectedKey })), { page: 2, selected: 62 },
						'the new Fn page retains its own coherent selected key');
					await touch('touchEnd', []);
					assert.deepEqual((await poll()).codes, []);
				}
				await tapControl('Letters');
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
				const tab = await page.getByRole('button', { name: 'Fn', exact: true }).boundingBox();
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
				await page.screenshot({ path: `${folder}/${profile.name}-functions.png` });
				for (const [pageIndex, label] of ['Letters', '123', 'Fn'].entries()) {
					await tapControl(label);
					const current = await measure();
					assert.equal(current.rows.length, 4);
					const definition = BROWSER_KEYBOARD_PAGES[pageIndex];
					const maximumUnits = Math.max(...definition.rows.map(row => row.units));
					const centers = definition.rows.map(row => {
						let units = 0;
						return row.spans.map(span => { const center = maximumUnits - row.units + units * 2 + span; units += span; return center; });
					});
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
									'controller selection consumes exact authored touch spans, including deterministic first-column tie order');
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
						assert.ok(key.height >= 44);
						const contact = await point(key.code, 7);
						await touch('touchStart', [contact]);
						assert.deepEqual((await poll()).codes, [key.code]);
						await touch('touchCancel', []);
						assert.deepEqual((await poll()).codes, []);
					}
				}
				await tapControl('Letters');
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
			assert.equal(await page.locator('.bmsx-touch-keyboard').count(), 0, 'input teardown owns and removes its DOM keyboard view');
			await page.evaluate(() => (globalThis as any).keyboardProbe.model.open());
			await settle();
			assert.equal(await page.evaluate(() => document.body.classList.contains('bmsx-touch-keyboard-visible')), false,
				'teardown unsubscribes presentation; a later model revision cannot restore stale body UI state');
		});
	}
	await writeFile(`${folder}/profiles.json`, JSON.stringify(profileEvidence, null, 2));
});
