import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';
import { roundContactBankWord } from './touch_gamepad_geometry_oracle';

function expectedStickAxes(geometry: { padX: number; padY: number; stickTravelRadius: number; neutral: number }, pointer: { x: number; y: number }): [number, number] {
	const dx = pointer.x - geometry.padX;
	const dy = pointer.y - geometry.padY;
	const distance = Math.hypot(dx, dy);
	if (distance <= geometry.neutral) return [0, 0];
	const magnitude = Math.min(1, (distance - geometry.neutral) / (geometry.stickTravelRadius - geometry.neutral));
	return [encodeSignedFix16(dx / distance * magnitude), encodeSignedFix16(dy / distance * magnitude)];
}

// Trusted Chromium contacts prove browser ownership and the real sampled ABI,
// not physical iPhone delivery or Safari's native touchscreen implementation.
test('native switchable directional units preserve contact leases, action chords and sampled L-stick axes', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const css = await readFile('gamebase.css', 'utf8');
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { Memory } from './machine/ts/machine/memory/memory';
export { InputController } from './machine/ts/machine/devices/input/controller';
export { PSX_MACHINE_SPEC } from './machine/ts/spec/bmsx/model';
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_PAD_LX_OFFSET, IO_INP_PAD_LY_OFFSET } from './machine/ts/spec/bmsx/io';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const profile of [
		{ name: 'phone landscape', width: 852, height: 393 },
		{ name: 'phone portrait', width: 393, height: 852 },
		{ name: 'tablet landscape', width: 1180, height: 820 },
	]) {
		await t.test(profile.name, async orientation => {
			const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });
			orientation.after(() => page.close());
			const errors: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
			await page.addScriptTag({ content: bundle.outputFiles[0].text });
			await page.evaluate(() => {
				const api = (globalThis as any).fixture;
				const clock = new api.BrowserHostClock();
				const pad = new api.BrowserOnscreenGamepad(clock);
				const view = new api.BrowserOnscreenGamepadView(document, window, pad);
				const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
				const video = new api.BrowserVideoOutput(canvas, view, 'fit');
				video.refreshLayout();
				const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
				const native: Array<{ type: string; id: number; trusted: boolean; pointerType: string; x: number; y: number }> = [];
				for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
					window.addEventListener(type, event => {
						const pointer = event as PointerEvent;
						native.push({ type, id: pointer.pointerId, trusted: event.isTrusted, pointerType: pointer.pointerType, x: pointer.clientX, y: pointer.clientY });
					}, { capture: true, passive: true });
				}
				const input = new api.Input(clock, hub, pad.gamepadIndex);
				const snapshot = api.createInputControllerSnapshot();
				const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
				const controller = new api.InputController(memory, input, { supervisorContextActive() { return false; }, requestSupervisorLineEdge() {} });
				controller.reset();
				let cycle = 0;
				(globalThis as any).directionalTest = {
					pad, video, native,
					measure() {
						input.pollInput();
						input.sampleInputControllerSnapshot(snapshot, 0);
						memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
						controller.onVblankEdge(++cycle);
						const common = input.getPlayerInput(1).inputHandlers.gamepad;
						const tip = document.getElementById('left-stick-tip') as unknown as SVGCircleElement;
						const dpad = document.getElementById('d-pad-artwork')!;
						const stick = document.getElementById('left-stick-artwork')!;
						const padBounds = document.getElementById('d-pad-svg')!.getBoundingClientRect();
						return {
							mode: pad.directionalMode, active: pad.stickActive, tip: [pad.stickX, pad.stickY], model: pad.buttons,
							physical: common.physicalGamepadButtonsWord(), physicalAxes: [common.physicalGamepadAxisWord(0), common.physicalGamepadAxisWord(1)],
							sampled: snapshot.pads[0].buttons, axes: Array.from(snapshot.pads[0].axesQ16), pointer: snapshot.pointerButtons,
							mmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET),
							mmioAxes: [memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_LX_OFFSET), memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_LY_OFFSET)],
							artwork: { dpadHidden: getComputedStyle(dpad).visibility === 'hidden', stickHidden: getComputedStyle(stick).visibility === 'hidden',
								tip: [tip.cx.baseVal.value, tip.cy.baseVal.value],
								filledSurfaces: Array.from(document.querySelectorAll('#d-pad-svg path,#d-pad-svg circle,.action-button')).filter(shape => getComputedStyle(shape).fill !== 'none').length },
							geometry: { padX: pad.geometry.padX, padY: pad.geometry.padY, padRadius: pad.geometry.padRadius, neutral: pad.geometry.padRadius * 0.18, stickTravelRadius: pad.geometry.stickTravelRadius,
								a: pad.geometry.actions.find(action => action.buttons === 1), b: pad.geometry.actions.find(action => action.buttons === 2),
								shoulders: pad.geometry.actions.filter(action => action.bank === 1) },
							revision: pad.geometryRevision,
							bounds: { left: padBounds.left, top: padBounds.top, width: padBounds.width, height: padBounds.height },
							visual: { width: visualViewport!.width, height: visualViewport!.height, scale: visualViewport!.scale },
							nativeCount: native.length, nativeSample: native.at(-1),
						};
					},
					finish() { video.dispose(); view.dispose(); input.dispose(); },
				};
			});
			const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
			const measure = () => page.evaluate(() => (globalThis as any).directionalTest.measure());
			const setMode = async (mode: 'dpad' | 'stick') => {
				await page.evaluate(value => (globalThis as any).directionalTest.pad.setDirectionalMode(value), mode);
				await settle();
			};
			const cdp = await page.context().newCDPSession(page);
			const activeTouchIds = new Set<number>();
			const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: Array<{ id: number; x: number; y: number; radiusX?: number; radiusY?: number }>) => {
				await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
				if (type === 'touchStart') for (const point of touchPoints) activeTouchIds.add(point.id);
				else if (type === 'touchCancel' || type === 'touchEnd' && touchPoints.length === 0) activeTouchIds.clear();
				else if (type === 'touchEnd') for (const point of touchPoints) activeTouchIds.delete(point.id);
			};
			const assertState = async (buttons: number, x: number, y: number) => {
				await settle();
				const state = await measure();
				assert.deepEqual([state.model, state.physical, state.sampled, state.mmio], [buttons, buttons, buttons, buttons]);
				const encodedAxes = [encodeSignedFix16(state.tip[0]), encodeSignedFix16(state.tip[1])];
				assert.deepEqual(state.axes, [...encodedAxes, 0, 0, (buttons & 0x40) !== 0 ? 0x10000 : 0, (buttons & 0x80) !== 0 ? 0x10000 : 0], 'common snapshot consumes exactly the producer axes');
				assert.deepEqual(state.physicalAxes, encodedAxes);
				assert.deepEqual(state.mmioAxes, encodedAxes, 'armed ICU latches exactly the common words');
				assert.ok(Math.abs((encodedAxes[0] | 0) - (x | 0)) <= 1, 'native float contact coordinates match requested horizontal travel within one Q16 unit');
				assert.ok(Math.abs((encodedAxes[1] | 0) - (y | 0)) <= 1, 'native float contact coordinates match requested vertical travel within one Q16 unit');
				assert.equal(state.pointer, 0, 'captured controls never become canvas clicks');
				assert.equal(state.artwork.filledSurfaces, 0, 'both units and button interiors remain transparent');
				assert.equal(state.artwork.tip[0], Math.fround(50 + state.tip[0] * 24), 'SVG animated lengths consume the producer using their native float representation');
				assert.equal(state.artwork.tip[1], Math.fround(50 + state.tip[1] * 24));
				return state;
			};
			await settle();
			orientation.afterEach(async () => {
				if (activeTouchIds.size !== 0) await touch('touchCancel', []);
				await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
				await setMode('dpad');
				await assertState(0, 0, 0);
			});

			await orientation.test('a trusted digital thumb rolls through widened cardinals and deliberate diagonals without lifting', async () => {
				const { geometry } = await measure();
				const radius = geometry.padRadius * 0.7;
				const thumb = { id: 1, x: geometry.padX + radius, y: geometry.padY, radiusX: 28, radiusY: 28 };
				await touch('touchStart', [thumb]);
				await assertState(0x8000, 0, 0);
				for (const cardinal of [
					{ x: 1, y: 0, bits: 0x8000, next: 0x2000 },
					{ x: 0, y: 1, bits: 0x2000, next: 0x4000 },
					{ x: -1, y: 0, bits: 0x4000, next: 0x1000 },
					{ x: 0, y: -1, bits: 0x1000, next: 0x8000 },
				]) {
					for (const roll of [0.5, 1, 0.5]) {
						thumb.x = geometry.padX + radius * (cardinal.x - cardinal.y * roll);
						thumb.y = geometry.padY + radius * (cardinal.y + cardinal.x * roll);
						await touch('touchMove', [thumb]);
						await assertState(cardinal.bits | (roll === 1 ? cardinal.next : 0)
							| roundContactBankWord(geometry.shoulders, thumb.x, thumb.y, thumb.radiusX), 0, 0);
					}
				}
				thumb.x = geometry.padX + geometry.padRadius * 2;
				thumb.y = geometry.padY - geometry.padRadius * 0.95;
				await touch('touchMove', [thumb]);
				await assertState(0x8000 | roundContactBankWord(geometry.shoulders, thumb.x, thumb.y, thumb.radiusX), 0, 0);
				thumb.y = geometry.padY - geometry.padRadius * 2;
				await touch('touchMove', [thumb]);
				await assertState(0x9000 | roundContactBankWord(geometry.shoulders, thumb.x, thumb.y, thumb.radiusX), 0, 0);
				await touch('touchEnd', []);
				await assertState(0, 0, 0);
			});

			await orientation.test('one captured thumb drives true L-stick axes while another bridges A+B and survives outside artwork', async () => {
				await setMode('stick');
				const { geometry } = await measure();
				const stick = { id: 1, x: geometry.padX + geometry.padRadius * 1.05, y: geometry.padY, radiusX: 14, radiusY: 14 };
				const chord = { id: 2, x: (geometry.a.x + geometry.b.x) / 2, y: (geometry.a.y + geometry.b.y) / 2, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [stick]);
				await assertState(0, 0x10000, 0);
				await touch('touchStart', [stick, chord]);
				const held = await assertState(3, 0x10000, 0);
				assert.equal(held.active, true);
				assert.deepEqual([held.artwork.dpadHidden, held.artwork.stickHidden], [true, false]);
				stick.x = geometry.padX + 3 * geometry.padRadius;
				await touch('touchMove', [stick, chord]);
				await assertState(3, 0x10000, 0);
				stick.x = geometry.padX;
				stick.y = geometry.padY - geometry.padRadius * 1.05;
				await touch('touchMove', [stick, chord]);
				await assertState(3, 0, 0xffff0000);
				await touch('touchEnd', [stick]);
				assert.equal((await assertState(3, 0, 0)).active, false);
				await touch('touchEnd', []);
				await assertState(0, 0, 0);
			});

			await orientation.test('mode replacement releases only the old directional unit and retained native fingers cannot rearm it', async () => {
				const { geometry } = await measure();
				const pad = { id: 1, x: geometry.padX + geometry.padRadius * 0.8, y: geometry.padY, radiusX: 14, radiusY: 14 };
				const action = { id: 2, x: geometry.a.x, y: geometry.a.y, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [pad]);
				await touch('touchStart', [pad, action]);
				await assertState(0x8001, 0, 0);
				await setMode('stick');
				assert.equal((await assertState(1, 0, 0)).active, false);
				pad.x = geometry.padX - geometry.padRadius * 1.05;
				action.x = geometry.b.x;
				action.y = geometry.b.y;
				await touch('touchMove', [pad, action]);
				await assertState(2, 0, 0);
				const fresh = { id: 3, x: geometry.padX, y: geometry.padY + geometry.padRadius * 1.05, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [pad, action, fresh]);
				await assertState(2, 0, 0x10000);
				await setMode('dpad');
				await assertState(2, 0, 0);
				fresh.y = geometry.padY - geometry.padRadius * 1.05;
				await touch('touchMove', [pad, action, fresh]);
				await assertState(2, 0, 0);
				await touch('touchEnd', [pad, fresh]);
				const digital = { ...pad, id: 4, x: geometry.padX, y: geometry.padY - geometry.padRadius };
				await touch('touchStart', [action, digital]);
				const resumed = await assertState(0x1002 | roundContactBankWord(geometry.shoulders, digital.x, digital.y, digital.radiusX), 0, 0);
				assert.deepEqual([resumed.artwork.dpadHidden, resumed.artwork.stickHidden], [false, true]);
			});

			await orientation.test('a second pad finger cannot steal the stick or replace it after the original source releases', async () => {
				await setMode('stick');
				const { geometry } = await measure();
				const first = { id: 1, x: geometry.padX + geometry.padRadius * 1.05, y: geometry.padY, radiusX: 14, radiusY: 14 };
				const second = { id: 2, x: geometry.padX, y: geometry.padY - geometry.padRadius * 1.05, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [first]);
				await touch('touchStart', [first, second]);
				await assertState(0, 0x10000, 0);
				await touch('touchEnd', [first]);
				await assertState(0, 0, 0);
				second.x = geometry.padX - geometry.padRadius * 1.05;
				second.y = geometry.padY;
				await touch('touchMove', [second]);
				assert.equal((await assertState(0, 0, 0)).active, false);
				await touch('touchEnd', []);
				await touch('touchStart', [second]);
				await assertState(0, 0xffff0000, 0);
				await touch('touchCancel', []);
				assert.equal((await assertState(0, 0, 0)).active, false);
			});

			await orientation.test('a visual-only viewport change leaves the captured axes and interaction frame unchanged', async () => {
				await setMode('stick');
				const { geometry } = await measure();
				const thumb = { id: 1, x: geometry.padX + geometry.padRadius * 1.05, y: geometry.padY, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [thumb]);
				const before = await assertState(0, 0x10000, 0);
				await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.1 });
				const after = await assertState(0, 0x10000, 0);
				assert.notDeepEqual(after.visual, before.visual);
				assert.deepEqual(after.bounds, before.bounds);
				assert.deepEqual(after.geometry, before.geometry);
				assert.equal(after.revision, before.revision);
				assert.equal(after.nativeCount, before.nativeCount, 'a visual-only resize does not invent a new source sample');
			});

			await orientation.test('real layout changes resample held client coordinates immediately through the common encoder', async () => {
				await setMode('stick');
				const { geometry } = await measure();
				const thumb = { id: 1, x: geometry.padX + geometry.neutral + (geometry.stickTravelRadius - geometry.neutral) / 2, y: geometry.padY, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [thumb]);
				const admitted = await measure();
				const initialAxes = expectedStickAxes(admitted.geometry, admitted.nativeSample);
				assert.ok(Math.abs((initialAxes[0] | 0) - 0x8000) <= 1, 'the native browser float coordinate is near half travel');
				const before = await assertState(0, ...initialAxes);
				await page.evaluate(() => {
					document.getElementById('player-surface')!.style.paddingRight = '20px';
					(globalThis as any).directionalTest.video.refreshLayout();
				});
				await settle();
				const after = await measure();
				assert.ok(after.revision > before.revision);
				assert.equal(after.nativeCount, before.nativeCount, 'layout is the producer of the new geometry, not a fake native move');
				await assertState(0, ...expectedStickAxes(after.geometry, admitted.nativeSample));
				await page.evaluate(() => {
					document.getElementById('player-surface')!.style.paddingRight = '';
					(globalThis as any).directionalTest.video.refreshLayout();
				});
				await assertState(0, ...initialAxes);
			});
			assert.deepEqual(errors, []);
			const native = await page.evaluate(() => (globalThis as any).directionalTest.native);
			assert.ok(native.length > 0 && native.every((event: { trusted: boolean; pointerType: string }) => event.trusted && event.pointerType === 'touch'));
			await page.evaluate(() => (globalThis as any).directionalTest.finish());
		});
	}
});
