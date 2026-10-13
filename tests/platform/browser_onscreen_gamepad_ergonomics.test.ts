import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { controlContainsPoint, controlSeparation, distanceToControl } from './touch_gamepad_geometry_oracle';

const actions = [
	{ id: 'a_knop', label: 'A', buttons: 1 << InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', label: 'B', buttons: 1 << InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', label: 'X', buttons: 1 << InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', label: 'Y', buttons: 1 << InputControllerGamepadButtonBit.Y },
	{ id: 'select_knop', label: 'SELECT', buttons: 1 << InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', label: 'START', buttons: 1 << InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', label: 'LS', buttons: 1 << InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', label: 'RS', buttons: 1 << InputControllerGamepadButtonBit.RightStick },
	{ id: 'lb_knop', label: 'LB', buttons: 1 << InputControllerGamepadButtonBit.LeftBumper },
	{ id: 'rb_knop', label: 'RB', buttons: 1 << InputControllerGamepadButtonBit.RightBumper },
	{ id: 'lt_knop', label: 'LT', buttons: 1 << InputControllerGamepadButtonBit.LeftTrigger },
	{ id: 'rt_knop', label: 'RT', buttons: 1 << InputControllerGamepadButtonBit.RightTrigger },
] as const;

// Insets are controlled fixture inputs, not measurements of a particular Safari version.
const profiles: readonly {
	name: string; width: number; height: number; insets: readonly number[]; screenshot: boolean;
	player?: { left: number; top: number; width: number; height: number };
	smallPlayer?: boolean;
}[] = [
	{ name: 'small-player-320', width: 320, height: 240, insets: [0, 0, 0, 0], screenshot: true, smallPlayer: true },
	{ name: 'small-player-319', width: 319, height: 239, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'square-player', width: 430, height: 430, insets: [0, 0, 0, 0], screenshot: true, smallPlayer: true },
	{ name: 'small-landscape-width-boundary-below', width: 567, height: 239, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'small-landscape-height-boundary-below', width: 568, height: 238, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'small-wide-landscape-height-boundary-below', width: 852, height: 238, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'compact-portrait', width: 320, height: 568, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'compact-landscape', width: 568, height: 320, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'phone14-portrait-safe', width: 390, height: 844, insets: [47, 0, 34, 0], screenshot: true },
	{ name: 'phone14-landscape-safe', width: 844, height: 390, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'portrait-width-379', width: 379, height: 844, insets: [47, 0, 34, 0], screenshot: true },
	{ name: 'portrait-width-380', width: 380, height: 844, insets: [47, 0, 34, 0], screenshot: true },
	{ name: 'phone-portrait', width: 393, height: 852, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'phone-landscape', width: 852, height: 393, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'large-portrait-safe', width: 430, height: 932, insets: [47, 0, 34, 0], screenshot: false },
	{ name: 'large-landscape-safe', width: 932, height: 430, insets: [0, 47, 21, 47], screenshot: false },
	{ name: 'browser-landscape-safe', width: 844, height: 320, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'browser-landscape-300-safe', width: 844, height: 300, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'browser-landscape-280-safe', width: 844, height: 280, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'short-landscape-640', width: 640, height: 240, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'short-landscape-568', width: 568, height: 239, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'short-landscape-852', width: 852, height: 239, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'landscape-height-profile-boundary-below', width: 852, height: 319, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'landscape-height-profile-boundary-at', width: 852, height: 320, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'tablet-portrait', width: 768, height: 1024, insets: [24, 0, 20, 0], screenshot: true },
	{ name: 'tablet-landscape', width: 1024, height: 768, insets: [0, 0, 20, 0], screenshot: true },
	{ name: 'embedded-player-offset', width: 1024, height: 768, insets: [0, 0, 0, 0], screenshot: true,
		player: { left: 92, top: 40, width: 840, height: 650 } },
] as const;

// Geometry and native desktop input contracts, not proof of hand comfort or iPhone multitouch.
test('handheld gamepad keeps aligned hands, equal faces, complete shoulders, and reachable menus', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));

	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'ergonomicsFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const evidenceDirectory = '.bmsx/hosting/handheld-gamepad-evidence';
	await mkdir(evidenceDirectory, { recursive: true });
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(actionIds => {
		const api = (globalThis as any).ergonomicsFixture;
		const clock = new api.BrowserHostClock();
		const model = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, model);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view);
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, model, 'F2');
		const pointerEvents: Array<{ type: string; id: number; trusted: boolean }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
			window.addEventListener(type, event => {
				const pointer = event as PointerEvent;
				pointerEvents.push({ type, id: pointer.pointerId, trusted: pointer.isTrusted });
			}, true);
		}
		const input = new api.Input(clock, hub, model.gamepadIndex);
		const snapshot = api.createInputControllerSnapshot();
		(globalThis as any).ergonomicsProbe = {
			video, model, pointerEvents,
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				return { buttons: model.buttons, physicalButtons: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), sampledButtons: snapshot.pads[0].buttons };
			},
			measure() {
				const read = {
					target(id: string, index: number) {
						const element = document.getElementById(id) as unknown as SVGGraphicsElement;
						const bounds = element.getBoundingClientRect();
						const bezel = element.previousElementSibling as SVGGraphicsElement;
						const geometry = model.geometry.actions[index];
						const bezelBounds = bezel.getBoundingClientRect();
						const scale = element.getScreenCTM()!.a;
						const edge = Number.parseFloat(getComputedStyle(bezel).strokeWidth) * scale / 2;
						const style = getComputedStyle(element);
						return {
							id, x: geometry.x, y: geometry.y, radius: geometry.radius,
							outline: geometry.outline ? { ...geometry.outline } : undefined,
							tag: element.tagName,
							bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
							painted: { left: bezelBounds.left - edge, top: bezelBounds.top - edge, right: bezelBounds.right + edge, bottom: bezelBounds.bottom + edge },
							presentation: { fill: style.fill, stroke: style.stroke, touched: element.getAttribute('data-touched') },
						};
					},
				};
				const padBounds = document.getElementById('d-pad-svg')!.getBoundingClientRect();

				const pad = { id: 'd-pad-svg', x: padBounds.left + padBounds.width / 2,
					y: padBounds.top + padBounds.height / 2, radius: padBounds.width / 2,
					bounds: { left: padBounds.left, top: padBounds.top, width: padBounds.width, height: padBounds.height },
					painted: { left: padBounds.left, top: padBounds.top, right: padBounds.right, bottom: padBounds.bottom },
				};
				return {
					targets: [pad, ...actionIds.map((id, index) => read.target(id, index))],
					deckTop: view.portraitDeckTop,
					canvas: (() => { const rect = canvas.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })(),
					padDirections: ['u', 'r', 'd', 'l'].map(direction => document.getElementById(`d-pad-${direction}`)!.getAttribute('data-touched')),
					labels: actionIds.map(id => {
						const label = document.getElementById(id + '_text')!;
						const bounds = label.getBoundingClientRect();
						const style = getComputedStyle(label);
						return { text: label.textContent, visibility: style.visibility, opacity: style.opacity, fill: style.fill,
							left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
					}),
					groups: ['d-pad-controls', 'button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls', 'lb-controls', 'rb-controls', 'lt-controls', 'rt-controls'].map(id => {
						const element = document.getElementById(id)!;
						const bounds = element.getBoundingClientRect();
						return { id, hidden: element.hidden, pointerEvents: getComputedStyle(element).pointerEvents,
							bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } };
					}),
				};
			},
			fills(samples: Array<{ id: string; x: number; y: number }>) {
				return samples.map(sample => {
					const shape = document.getElementById(sample.id) as unknown as SVGGeometryElement;
					const local = new DOMPoint(sample.x, sample.y).matrixTransform(shape.getScreenCTM()!.inverse());
					return shape.isPointInFill(local);
				});
			},
			background(kind: string) {
				const context = canvas.getContext('2d')!;
				const player = document.getElementById('player-surface')!;
				player.style.background = kind === 'bright'
					? 'repeating-conic-gradient(#ede6bb 0% 25%, #7eabc5 0% 50%) 0 0 / 56px 56px'
					: '#101010';
				context.fillStyle = kind === 'bright' ? '#d8dfb9' : '#101010';
				context.fillRect(0, 0, 320, 240);
				if (kind === 'bright') {
					for (let y = 0; y < 240; y += 24) {
						for (let x = 0; x < 320; x += 32) {
							context.fillStyle = (x + y) % 3 === 0 ? '#51768e' : '#af874f';
							context.fillRect(x + 3, y + 3, 20, 14);
						}
					}
				}
			},
			dispose() { input.dispose(); video.dispose(); },
		};
	}, actions.map(action => action.id));
	await page.evaluate(() => document.fonts.ready);
	const cdp = await page.context().newCDPSession(page);
	let touchActive = false;
	const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<{ id: number; x: number; y: number; radiusX?: number; radiusY?: number }>) => {
		await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
		if (type === 'touchStart') touchActive = true;
		else if (type === 'touchEnd' && touchPoints.length === 0) touchActive = false;
	};
	const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const measure = () => page.evaluate(() => (globalThis as any).ergonomicsProbe.measure());
	const poll = () => page.evaluate(() => (globalThis as any).ergonomicsProbe.poll());
	const assertTransparentArtwork = async (targets: any[]) => {
		const candidates: Array<{ id: string; x: number; y: number }> = [];
		for (const target of targets) {
			for (let row = 1; row < 8; row += 1) {
				for (let column = 1; column < 8; column += 1) {
					const x = target.bounds.left + target.bounds.width * column / 8;
					const y = target.bounds.top + target.bounds.height * row / 8;
					if ([[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]].every(([dx, dy]) => controlContainsPoint(target, x + dx, y + dy))) {
						candidates.push({ id: target.id, x, y });
					}
				}
			}
		}
		const samples = await page.evaluate(candidates => {
			const artwork = document.getElementById('controller-viewport')!;
			const textAndAccents = [...artwork.querySelectorAll('text, .action-accent')].map(element => element.getBoundingClientRect());
			const outlines = [...artwork.querySelectorAll('path, circle')].filter(element => !element.classList.contains('action-accent')) as SVGGeometryElement[];
			return candidates.filter(sample => {
				if (textAndAccents.some(rect => sample.x >= rect.left - 3 && sample.x <= rect.right + 3 && sample.y >= rect.top - 3 && sample.y <= rect.bottom + 3)) return false;
				return outlines.every(outline => [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => {
					const point = new DOMPoint(sample.x + dx, sample.y + dy).matrixTransform(outline.getScreenCTM()!.inverse());
					return !outline.isPointInStroke(point);
				}));
			});
		}, candidates);
		for (const target of targets) assert.ok(samples.some(sample => sample.id === target.id), `${target.id} has independently selected unpainted interior pixels`);
		const visible = PNG.sync.read(await page.screenshot());
		await page.evaluate(() => { document.getElementById('controller-viewport')!.style.visibility = 'hidden'; });
		const background = PNG.sync.read(await page.screenshot());
		await page.evaluate(() => { document.getElementById('controller-viewport')!.style.visibility = ''; });
		const pixelsPerCssPixel = visible.width / (await page.viewportSize())!.width;
		for (const sample of samples) {
			const offset = (Math.round(sample.y * pixelsPerCssPixel) * visible.width + Math.round(sample.x * pixelsPerCssPixel)) * 4;
			assert.deepEqual(visible.data.subarray(offset, offset + 4), background.data.subarray(offset, offset + 4),
				`${sample.id} interior preserves every underlying scene pixel, including the outlined D-pad`);
		}
	};

	t.afterEach(async () => {
		if (touchActive) await touch('touchEnd', []);
		await settle();
	});
	const evidence: Array<{ profile: string; safe: unknown; geometry: unknown; minimumControlGap: number;
		secondaryOffsets: Array<{ id: string; x: number; y: number }> }> = [];
	for (const profile of profiles) {
		await t.test(profile.name, async () => {
			const player = profile.player ?? { left: 0, top: 0, width: profile.width, height: profile.height };
			await page.setViewportSize({ width: profile.width, height: profile.height });
			await page.evaluate(({ insets, player }) => {
				const style = document.getElementById('player-surface')!.style;
				style.left = `${player.left}px`;
				style.top = `${player.top}px`;
				style.right = 'auto';
				style.bottom = 'auto';
				style.width = `${player.width}px`;
				style.height = `${player.height}px`;
				style.padding = insets.map(value => `${value}px`).join(' ');
				(globalThis as any).ergonomicsProbe.video.setDisplaySize(320, 240);
				(globalThis as any).ergonomicsProbe.video.refreshLayout();
				(globalThis as any).ergonomicsProbe.background('dark');
			}, { insets: [...profile.insets], player });
			await settle();
			const resting = await measure();
			if (profile.screenshot) await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-dark-rest.png` });
			const safe = { left: player.left + profile.insets[3], top: player.top + profile.insets[0],
				right: player.left + player.width - profile.insets[1], bottom: player.top + player.height - profile.insets[2] };
			const targets = resting.targets;
			const faceDiameter = targets[1].bounds.width;
			const width = safe.right - safe.left;
			const height = safe.bottom - safe.top;
			const landscape = width >= height;
			const scale = landscape ? Math.min(1.1, width / 568, height / 360) : Math.min(1.1, (width - 36) / 388, height / 568);
			// Browser CSS positions use a subpixel layout grid; transformed SVG
			// dimensions preserve the authored uniform scaling more precisely.
			const coordinateTolerance = 1 / 32;
			assert.equal(targets.length, 13, 'the rocker plus every one of the twelve physical gamepad buttons is present');
			assert.ok(Math.abs(faceDiameter - 80 * scale) < 0.0001, 'all face targets share the handheld width/height budget');
			for (const circle of targets.slice(1, 5)) {
				assert.ok(Math.abs(circle.bounds.width - faceDiameter) < 0.0001, `${circle.id} has the same target diameter as every other face button`);
				assert.equal(circle.presentation.fill, targets[1].presentation.fill, 'face buttons have no primary/secondary visual hierarchy');
				assert.equal(circle.presentation.stroke, targets[1].presentation.stroke);
			}
			assert.ok(Math.abs(targets[0].bounds.width - 180 * scale) < 0.0001, 'the outlined digital rocker and face deck share their authored uniform scale');
			const pad = targets[0];
			const faceCenter = { x: (targets[1].x + targets[4].x) / 2, y: (targets[1].y + targets[4].y) / 2 };
			assert.ok(Math.abs(pad.y - faceCenter.y) < coordinateTolerance, 'both thumbs use one hand row rather than a portrait stagger');
			const [select, start, ls, rs, lb, rb, lt, rt] = targets.slice(5);
			const middle = (safe.left + safe.right) / 2;
			assert.ok(select.x < middle && start.x > middle, 'SELECT and START straddle the handheld center');
			assert.ok(Math.abs(select.y - start.y) < coordinateTolerance, 'menu controls share one bottom row');
			assert.ok(select.y > pad.y && start.y > faceCenter.y, 'menu controls lie below the main hand row');
			assert.ok(ls.x < select.x && rs.x > start.x, 'stick clicks remain separate from the centered menu controls');
			assert.ok(lb.x < middle && lt.x < middle && rb.x > middle && rt.x > middle, 'each shoulder pair stays with its corresponding hand');
			const secondaryOffsets: Array<{ id: string; x: number; y: number }> = [];
			for (const shoulder of [lb, rb, lt, rt]) {
				assert.equal(shoulder.tag, 'path', `${shoulder.id} uses a physical shoulder outline, not a circular target`);
				assert.ok(shoulder.outline, `${shoulder.id} publishes its real rounded outline to input`);
				assert.ok(shoulder.bounds.width > shoulder.bounds.height, `${shoulder.id} remains horizontally oriented despite real curvature`);
				assert.ok(shoulder.outline.radius > shoulder.outline.halfWidth, `${shoulder.id} is a bent band with a real concave inner edge`);
				assert.equal(shoulder.presentation.fill, 'none', 'shoulder backgrounds are fully transparent');
				assert.ok(shoulder.bounds.width > select.bounds.width, 'shoulder contact width is larger than utility menu targets');
				assert.ok(shoulder.outline.halfWidth * 2 >= 36 * scale - coordinateTolerance,
					`${shoulder.id} keeps a real radial target thickness inside the common viewport budget`);
				const primary = shoulder === lb || shoulder === lt ? pad : faceCenter;
				assert.ok(shoulder.y < primary.y, `${shoulder.id} is reachable above its own hand, not placed at the viewport top`);
				secondaryOffsets.push({ id: shoulder.id, x: (shoulder.x - primary.x) / scale, y: (shoulder.y - primary.y) / scale });
			}
			if (landscape) {
				assert.equal(resting.deckTop, null, 'landscape retains an overlay rather than reserving a portrait deck');
			} else {
				assert.ok(resting.deckTop !== null);
				assert.ok(Math.abs(resting.canvas.top - safe.top) < coordinateTolerance, 'portrait game image is anchored at the safe top');
				assert.ok(resting.canvas.bottom <= resting.deckTop + coordinateTolerance, 'portrait video fitting does not enter the lower controller deck');
				assert.ok(lt.y < lb.y && rt.y < rb.y, 'triggers occupy a distinct outer arc, not a merged shoulder row');
				assert.ok(lb.y < pad.y - pad.radius && rb.y < faceCenter.y - 104 * scale,
					'the shoulder bands remain above rather than over the primary button targets');
			}
			const fillSamples: Array<{ id: string; x: number; y: number }> = [];
			const expectedFills: boolean[] = [];
			for (const shoulder of [lb, rb, lt, rt]) {
				for (let column = -1; column <= 9; column += 1) {
					for (let row = -1; row <= 5; row += 1) {
						const x = shoulder.bounds.left + shoulder.bounds.width * (column + 0.37) / 9;
						const y = shoulder.bounds.top + shoulder.bounds.height * (row + 0.43) / 5;
						fillSamples.push({ id: shoulder.id, x, y });
						expectedFills.push(controlContainsPoint(shoulder, x, y));
					}
				}
			}
			assert.deepEqual(await page.evaluate(samples => (globalThis as any).ergonomicsProbe.fills(samples), fillSamples), expectedFills,
				'every shoulder SVG enclosed outline consumes the same independently measured finite arc and rounded ends');
			const gaps: number[] = [];
			const paintClearance = 0;
			for (let index = 0; index < targets.length; index += 1) {
				const circle = targets[index];
				if (!circle.outline) assert.ok(Math.abs(circle.bounds.width - circle.bounds.height) < 0.0001, `${circle.id} keeps uniform CSS-client scaling`);
				assert.ok(circle.painted.left >= safe.left + paintClearance - 0.0001, `${circle.id} left paint clearance`);
				assert.ok(circle.painted.top >= safe.top + paintClearance - 0.0001, `${circle.id} top paint clearance`);
				assert.ok(circle.painted.right <= safe.right - paintClearance + 0.0001, `${circle.id} right paint clearance`);
				assert.ok(circle.painted.bottom <= safe.bottom - paintClearance + 0.0001, `${circle.id} bottom paint clearance`);
				for (let other = index + 1; other < targets.length; other += 1) {
					const next = targets[other];
					const gap = controlSeparation(circle, next);
					gaps.push(gap);
					assert.ok(gap >= -0.0001, `${circle.id}/${next.id} physical activating surfaces never overlap`);
				}
			}
			for (const group of resting.groups) {
				assert.equal(group.hidden, false, `${group.id} is visible`);
				assert.equal(group.pointerEvents, 'none', `${group.id} remains passive artwork`);
			}
			for (let index = 0; index < actions.length; index += 1) {
				const label = resting.labels[index];
				assert.equal(label.text, actions[index].label);
				assert.equal(label.visibility, 'visible');
				assert.ok(Number(label.opacity) > 0 && label.width > 0 && label.height > 0, `${actions[index].label} label is painted`);
				const circle = targets[index + 1];
				for (const x of [label.left, label.right]) {
					for (const y of [label.top, label.bottom]) {
						assert.ok(controlContainsPoint(circle, x, y), `${actions[index].label} painted text fits inside its actual contact surface`);
					}
				}
			}
			const padCenter = { id: 6, x: targets[0].x, y: targets[0].y };
			await touch('touchStart', [padCenter]);
			assert.deepEqual(await poll(), { buttons: 0, physicalButtons: 0, sampledButtons: 0 },
				'neutral center acquires a controller lease without pressing a direction');
			const travel = pad.radius * 0.7;
			const diagonalTravel = travel / Math.SQRT2;
			const masks = { up: 1 << InputControllerGamepadButtonBit.Up, right: 1 << InputControllerGamepadButtonBit.Right,
				down: 1 << InputControllerGamepadButtonBit.Down, left: 1 << InputControllerGamepadButtonBit.Left };
			const rolls = [
				{ x: pad.x + travel, y: pad.y, mask: masks.right, image: 'r' },
				{ x: pad.x + diagonalTravel, y: pad.y - diagonalTravel, mask: masks.up | masks.right, image: 'ru' },
				{ x: pad.x, y: pad.y - travel, mask: masks.up, image: 'u' },
				{ x: pad.x - diagonalTravel, y: pad.y - diagonalTravel, mask: masks.up | masks.left, image: 'lu' },
				{ x: pad.x - travel, y: pad.y, mask: masks.left, image: 'l' },
				{ x: pad.x - diagonalTravel, y: pad.y + diagonalTravel, mask: masks.down | masks.left, image: 'ld' },
				{ x: pad.x, y: pad.y + travel, mask: masks.down, image: 'd' },
				{ x: pad.x + diagonalTravel, y: pad.y + diagonalTravel, mask: masks.down | masks.right, image: 'rd' },
				{ x: pad.x + travel, y: pad.y, mask: masks.right, image: 'r' },
			];
			for (const roll of rolls) {
				await touch('touchMove', [{ ...padCenter, x: roll.x, y: roll.y, radiusX: 14, radiusY: 14 }]);
				assert.deepEqual(await poll(), { buttons: roll.mask, physicalButtons: roll.mask, sampledButtons: roll.mask },
					'digital rolling updates immediately without a center excursion or finger lift');
				await settle();
				const rolled = await measure();
				assert.deepEqual(rolled.padDirections, [masks.up, masks.right, masks.down, masks.left].map(mask => (roll.mask & mask) !== 0 ? 'true' : 'false'));
				assert.deepEqual(rolled.targets[0].bounds, resting.targets[0].bounds, 'artwork state changes never move the digital rocker frame');
			}
			await touch('touchEnd', []);
			evidence.push({ profile: profile.name, safe, geometry: resting, minimumControlGap: Math.min(...gaps), secondaryOffsets });
			for (const framebufferWidth of [256, 321, 257, 320]) {
				await page.evaluate(width => {
					(globalThis as any).ergonomicsProbe.video.setDisplaySize(width, 240);
					(globalThis as any).ergonomicsProbe.video.refreshLayout();
				}, framebufferWidth);
				const changed = await measure();
				assert.deepEqual(changed.groups, resting.groups, `framebuffer ${framebufferWidth} does not change any control group`);
				assert.deepEqual(changed.targets.map((circle: any) => circle.bounds), targets.map((circle: any) => circle.bounds));
			}
			for (let index = 0; index < actions.length; index += 1) {
				const circle = targets[index + 1];
				await touch('touchStart', [{ id: 1, x: circle.x, y: circle.y }]);
				// SELECT remains the existing host-control modifier; contact geometry does not change routing policy.
				const sampledButtons = actions[index].id === 'select_knop' ? 0 : actions[index].buttons;
				assert.deepEqual(await poll(), { buttons: actions[index].buttons, physicalButtons: actions[index].buttons, sampledButtons }, `${actions[index].label} native center has its own exact physical bit`);
				await settle();
				const pressed = await measure();
				assert.equal(pressed.targets[index + 1].presentation.touched, 'true');
				assert.equal(pressed.targets[index + 1].presentation.fill, 'none', 'held switches never obscure the underlying game with a filled background');
				assert.notEqual(pressed.targets[index + 1].presentation.stroke, circle.presentation.stroke);
				assert.deepEqual(pressed.targets.map((entry: any) => entry.bounds), targets.map((entry: any) => entry.bounds), 'press rendering never moves a target');
				await touch('touchEnd', []);
				assert.equal((await poll()).sampledButtons, 0);
				await settle();
			}
			const thumb = { id: 1, x: targets[1].x, y: targets[1].y, radiusX: 14, radiusY: 14 };
			await touch('touchStart', [thumb]);
			assert.equal((await poll()).sampledButtons, 1);
			const bridge = { ...thumb, x: (targets[1].x + targets[2].x) / 2, y: (targets[1].y + targets[2].y) / 2 };
			await touch('touchMove', [bridge]);
			assert.equal((await poll()).sampledButtons, 3, 'one reported thumb footprint bridges adjacent A and B');
			await settle();
			assert.deepEqual((await measure()).targets.slice(1, 3).map((circle: any) => circle.presentation.touched), ['true', 'true']);
			const directionThumb = { id: 2, x: rolls[1].x, y: rolls[1].y, radiusX: 14, radiusY: 14 };
			await touch('touchStart', [bridge, directionThumb]);
			assert.equal((await poll()).sampledButtons, 3 | masks.up | masks.right, 'a second thumb independently rolls a diagonal while the first presses two faces');
			await touch('touchEnd', [directionThumb]);
			assert.equal((await poll()).sampledButtons, 3, 'lifting the directional thumb leaves both face contributions held');
			await touch('touchMove', [{ ...thumb, x: targets[2].x, y: targets[2].y }]);
			assert.equal((await poll()).sampledButtons, 2, 'rolling onto B releases A without releasing the thumb');
			await touch('touchEnd', []);
			assert.equal((await poll()).sampledButtons, 0);
			await page.evaluate(() => (globalThis as any).ergonomicsProbe.background('bright'));
			if (profile.screenshot) await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-bright-rest.png` });
			if (profile.name === 'phone14-portrait-safe' || profile.name === 'phone14-landscape-safe') {
				await assertTransparentArtwork(targets);
				const heldContacts = [
					{ id: 1, x: targets[1].x, y: targets[1].y, radiusX: 14, radiusY: 14 },
					{ id: 2, x: lb.x, y: lb.y, radiusX: 14, radiusY: 14 },
					{ id: 3, x: pad.x + pad.radius * 0.7, y: pad.y, radiusX: 14, radiusY: 14 },
				];
				await touch('touchStart', heldContacts);
				assert.equal((await poll()).sampledButtons, 0x8011, 'face, shoulder and digital direction remain independently held during the transparency proof');
				await settle();
				await assertTransparentArtwork((await measure()).targets);
				await touch('touchEnd', []);
				await settle();
			}

			if (profile.name === 'phone14-portrait-safe' || profile.name === 'phone14-landscape-safe' || profile.name === 'tablet-portrait' || profile.name === 'tablet-landscape') {
				for (const background of ['dark', 'bright']) {
					await page.evaluate(kind => (globalThis as any).ergonomicsProbe.background(kind), background);
					for (const [name, roll] of [['up-right', rolls[1]], ['down-left', rolls[5]]] as const) {
						await touch('touchStart', [{ id: 1, x: roll.x, y: roll.y, radiusX: 14, radiusY: 14 }]);
						assert.equal((await poll()).sampledButtons, roll.mask);
						await settle();
						await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-${name}.png` });
						await touch('touchEnd', []);
						await settle();
					}
					await touch('touchStart', [bridge]);
					await settle();
					await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-thumb-chord.png` });
					await touch('touchEnd', []);
					await settle();
					const base = targets[0];
					const a = { id: 1, x: targets[1].x, y: targets[1].y };
					const b = { id: 2, x: targets[2].x, y: targets[2].y };
					const pad = { id: 3, x: base.x - base.radius * 0.7, y: base.y };
					await touch('touchStart', [a]);
					await touch('touchStart', [a, b]);
					await touch('touchStart', [a, b, pad]);
					assert.equal((await poll()).sampledButtons, 0x4003);
					await settle();
					const paired = await measure();
					assert.deepEqual(paired.targets.slice(1, 3).map((circle: any) => circle.presentation.touched), ['true', 'true']);
					assert.deepEqual(paired.padDirections, ['false', 'false', 'false', 'true']);
					assert.equal(paired.targets[1].presentation.fill, 'none');
					assert.notEqual(paired.targets[2].presentation.stroke, targets[2].presentation.stroke);
					await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-paired.png` });
					const scale = await page.evaluate(() => visualViewport!.scale);
					await touch('touchMove', [a, b, { ...pad, x: -40 }]);
					assert.equal((await poll()).sampledButtons, 0x4003, 'an acquired rocker continues steering when the thumb leaves its artwork');
					assert.equal(await page.evaluate(() => (globalThis as any).ergonomicsProbe.model.ownsContact((globalThis as any).ergonomicsProbe.pointerEvents.filter((event: any) => event.type === 'pointerdown').at(-1).id)), true, 'controller retains the native lease for reentry');
					assert.equal(await page.evaluate(() => visualViewport!.scale), scale);
					await settle();
					const dragged = await measure();
					assert.deepEqual(dragged.padDirections, ['false', 'false', 'false', 'true'], 'the digital LEFT indication remains held beyond the pad boundary');
					assert.deepEqual(dragged.targets.map((circle: any) => circle.bounds), targets.map((circle: any) => circle.bounds));
					await touch('touchMove', [a, b, pad]);
					assert.equal((await poll()).sampledButtons, 0x4003, 'reentry restores the held contact contribution');
					await touch('touchEnd', [a]);
					assert.equal((await poll()).sampledButtons, 0x4002);
					await settle();
					const released = await measure();
					assert.deepEqual(released.targets.slice(1, 3).map((circle: any) => circle.presentation.touched), ['false', 'true']);
					await touch('touchEnd', []);
					assert.equal((await poll()).sampledButtons, 0);
					await settle();
				}
			}
		});
	}
	await t.test('true player-frame resize resamples held contacts before any subsequent native jitter', async () => {
		await page.setViewportSize({ width: 844, height: 390 });
		await page.evaluate(() => {
			const style = document.getElementById('player-surface')!.style;
			style.left = '0px';
			style.top = '0px';
			style.width = '844px';
			style.height = '390px';
			style.padding = '0px 47px 21px 47px';
			(globalThis as any).ergonomicsProbe.video.setDisplaySize(320, 240);
			(globalThis as any).ergonomicsProbe.video.refreshLayout();
		});
		await settle();
		const initial = await measure();
		const finger = { id: 1, x: initial.targets[1].x, y: initial.targets[1].y, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [finger]);
		for (const height of [341, 340, 320, 300, 280, 390]) {
			await page.setViewportSize({ width: 844, height });
			await page.evaluate(height => {
				document.getElementById('player-surface')!.style.height = `${height}px`;
				(globalThis as any).ergonomicsProbe.video.refreshLayout();
			}, height);
			await settle();
			const current = await measure();
			const held = current.targets.slice(1).reduce((word: number, circle: any, index: number) =>
				distanceToControl(circle, finger.x, finger.y) <= 14 ? word | actions[index].buttons : word, 0);
			const word = await poll();
			assert.equal(word.buttons, held, `true document/player-frame geometry immediately applies at ${height}px height`);
			assert.equal(word.physicalButtons, word.buttons);
			assert.equal(word.sampledButtons, word.buttons & ~0x100);
			assert.equal(await page.evaluate(() => (globalThis as any).ergonomicsProbe.model.ownsContact((globalThis as any).ergonomicsProbe.pointerEvents.filter((event: any) => event.type === 'pointerdown').at(-1).id)), true,
				'true layout changes contributions, not the retained contact identity');
			assert.equal(current.targets[1].presentation.touched, (word.buttons & 1) !== 0 ? 'true' : 'false');
			finger.x += 1;
			await touch('touchMove', [finger]);
			const jittered = current.targets.slice(1).reduce((word: number, circle: any, index: number) =>
				distanceToControl(circle, finger.x, finger.y) <= 14 ? word | actions[index].buttons : word, 0);
			assert.equal((await poll()).sampledButtons, jittered & ~0x100, 'one-pixel native jitter does not reveal an edge deferred by layout');
			await page.screenshot({ path: `${evidenceDirectory}/player-resize-${height}-held.png` });
		}
		await touch('touchEnd', []);
		assert.equal((await poll()).sampledButtons, 0);
		await settle();
	});
	const pointerEvents = await page.evaluate(() => (globalThis as any).ergonomicsProbe.pointerEvents);
	assert.ok(pointerEvents.length > 160);
	assert.ok(pointerEvents.every((event: any) => event.trusted), 'browser integration uses real native contact delivery');
	assert.deepEqual(errors, []);
	await writeFile(`${evidenceDirectory}/geometry.json`, JSON.stringify(evidence, null, 2));
	await page.evaluate(() => (globalThis as any).ergonomicsProbe.dispose());
});
