import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';
import { openBrowserErgonomicsPage } from '../helpers/browser_controller_ergonomics';
import { PNG } from 'pngjs';
import { roundContactBankWord, controlContainsPoint, controlSeparation, distanceToControl } from './touch_gamepad_geometry_oracle';
import { afterTest } from '../helpers/test_cleanup';

const actions = [
	{ id: 'a_knop', label: 'A' },
	{ id: 'b_knop', label: 'B' },
	{ id: 'x_knop', label: 'X' },
	{ id: 'y_knop', label: 'Y' },
	{ id: 'select_knop', label: 'SELECT' },
	{ id: 'start_knop', label: 'START' },
	{ id: 'ls_knop', label: 'LS' },
	{ id: 'rs_knop', label: 'RS' },
	{ id: 'lb_knop', label: 'LB' },
	{ id: 'rb_knop', label: 'RB' },
	{ id: 'lt_knop', label: 'LT' },
	{ id: 'rt_knop', label: 'RT' },
] as const;

// Insets are controlled fixture inputs, not measurements of a particular Safari version.
const profiles: readonly {
	name: string; width: number; height: number; insets: readonly number[];
	player?: { left: number; top: number; width: number; height: number };
	layoutProfile?: 'compact-overlay';
}[] = [
	{ name: 'small-player-320', width: 320, height: 240, insets: [0, 0, 0, 0] },
	{ name: 'small-player-319', width: 319, height: 239, insets: [0, 0, 0, 0] },
	{ name: 'square-player', width: 430, height: 430, insets: [0, 0, 0, 0] },
	{ name: 'small-landscape-width-boundary-below', width: 567, height: 239, insets: [0, 0, 0, 0] },
	{ name: 'small-landscape-height-boundary-below', width: 568, height: 238, insets: [0, 0, 0, 0] },
	{ name: 'small-wide-landscape-height-boundary-below', width: 852, height: 238, insets: [0, 0, 0, 0] },
	{ name: 'compact-portrait', width: 320, height: 568, insets: [0, 0, 0, 0] },
	{ name: 'phone-footer-width-boundary-below', width: 299, height: 852, insets: [0, 0, 0, 0], layoutProfile: 'compact-overlay' },
	{ name: 'phone-footer-width-boundary-at', width: 300, height: 852, insets: [0, 0, 0, 0] },
	...[{ width: 320, height: 321 }, { width: 320, height: 360 }, { width: 393, height: 394 }, { width: 600, height: 601 }].map(size => ({
		name: `short-portrait-${size.width}x${size.height}`, ...size, insets: [0, 0, 0, 0], layoutProfile: 'compact-overlay' as const,
	})),
	{ name: 'compact-landscape', width: 568, height: 320, insets: [0, 0, 0, 0] },
	{ name: 'phone14-portrait-safe', width: 390, height: 844, insets: [47, 0, 34, 0] },
	{ name: 'phone14-landscape-safe', width: 844, height: 390, insets: [0, 47, 21, 47] },
	{ name: 'portrait-width-379', width: 379, height: 844, insets: [47, 0, 34, 0] },
	{ name: 'portrait-width-380', width: 380, height: 844, insets: [47, 0, 34, 0] },
	{ name: 'phone-portrait-360', width: 360, height: 800, insets: [0, 0, 0, 0] },
	{ name: 'phone-portrait-360-short', width: 360, height: 640, insets: [0, 0, 0, 0] },
	{ name: 'phone-landscape-360', width: 800, height: 360, insets: [0, 0, 0, 0] },
	{ name: 'phone-portrait', width: 393, height: 852, insets: [0, 0, 0, 0] },
	...[588, 599, 600, 601].map(width => ({ name: `portrait-family-boundary-${width}`, width, height: 1024, insets: [0, 0, 0, 0] })),
	{ name: 'portrait-family-safe-width-599', width: 631, height: 1024, insets: [24, 16, 20, 16] },
	{ name: 'portrait-family-safe-width-600', width: 632, height: 1024, insets: [24, 16, 20, 16] },
	{ name: 'phone-landscape', width: 852, height: 393, insets: [0, 0, 0, 0] },
	{ name: 'large-portrait-safe', width: 430, height: 932, insets: [47, 0, 34, 0] },
	{ name: 'large-landscape-safe', width: 932, height: 430, insets: [0, 47, 21, 47] },
	{ name: 'browser-landscape-safe', width: 844, height: 320, insets: [0, 47, 21, 47] },
	{ name: 'browser-landscape-300-safe', width: 844, height: 300, insets: [0, 47, 21, 47] },
	{ name: 'browser-landscape-280-safe', width: 844, height: 280, insets: [0, 47, 21, 47] },
	{ name: 'short-landscape-640', width: 640, height: 240, insets: [0, 0, 0, 0] },
	{ name: 'short-landscape-568', width: 568, height: 239, insets: [0, 0, 0, 0] },
	{ name: 'short-landscape-852', width: 852, height: 239, insets: [0, 0, 0, 0] },
	{ name: 'wide-short-player-1200', width: 1200, height: 212, insets: [0, 0, 0, 0] },
	{ name: 'landscape-height-profile-boundary-below', width: 852, height: 319, insets: [0, 0, 0, 0] },
	{ name: 'landscape-height-profile-boundary-at', width: 852, height: 320, insets: [0, 0, 0, 0] },
	{ name: 'tablet-portrait', width: 768, height: 1024, insets: [24, 0, 20, 0] },
	{ name: 'tablet-landscape', width: 1024, height: 768, insets: [0, 0, 20, 0] },
	{ name: 'large-tablet-portrait', width: 1024, height: 1366, insets: [24, 0, 20, 0] },
	{ name: 'large-tablet-landscape', width: 1366, height: 1024, insets: [0, 0, 20, 0] },
	{ name: 'embedded-player-offset', width: 1024, height: 768, insets: [0, 0, 0, 0],
		player: { left: 92, top: 40, width: 840, height: 650 } },
] as const;

// Geometry and native desktop input contracts, not proof of hand comfort or iPhone multitouch.
test('handheld gamepad keeps controls reachable and transparent across layout families', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));

	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserHostControls } from './hosts/browser/host_controls';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'ergonomicsFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	// Await paint for presentation evidence, not a physical display refresh rate.
	const browser = await chromium.launch({ args: ['--disable-frame-rate-limit'] });
	afterTest(t, () => browser.close());
	const css = await readFile('gamebase.css', 'utf8');
	const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`;
	const script = bundle.outputFiles[0].text;
	const actionIds = actions.map(action => action.id);
	const assertTransparentArtwork = async (page: Page, targets: any[]) => {
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
			const outlines = [...artwork.querySelectorAll('path, circle')].filter(element =>
				!element.classList.contains('action-accent') && getComputedStyle(element).visibility !== 'hidden'
				&& element.getBoundingClientRect().width > 0) as SVGGeometryElement[];
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

	const assertRasterLabelContrast = async (page: Page, geometry: any) => {
		// Isolate the actual browser-painted quiet glyphs and their thin stroke.
		// Sentinel magenta is neither glyph color, so untouched background and
		// anti-aliased ink can be distinguished without a text-bbox paint claim.
		await page.evaluate(() => (globalThis as any).ergonomicsProbe.background('glyph-mask'));
		const isolation = await page.addStyleTag({ content: '#controller-viewport path, #controller-viewport circle, .host-control-surface { visibility: hidden !important; }' });
		const glyphs = PNG.sync.read(await page.screenshot());
		await isolation.evaluate(element => { element.textContent += ' .action-label { visibility: hidden !important; }'; });
		const withoutGlyphs = PNG.sync.read(await page.screenshot());
		await isolation.evaluate(element => { element.parentNode!.removeChild(element); });
		await isolation.dispose();
		const ratio = glyphs.width / (await page.viewportSize())!.width;
		const masks = geometry.labels.map((label: any, index: number) => {
			assert.equal(label.fill, geometry.targets[index + 1].presentation.touched === 'true'
				? 'rgba(243, 247, 250, 0.95)' : 'rgba(232, 240, 247, 0.44)',
				'idle labels stay subordinate to the game image; a held key visibly acknowledges its own published state');
			assert.equal(label.stroke, 'rgba(8, 12, 18, 0.38)');
			assert.equal(label.strokeLinejoin, 'round');
			// Computed CSS serializes the implied trailing fill as `stroke`.
			assert.equal(label.paintOrder, 'stroke');
			assert.ok(label.strokeWidth > 0 && label.strokeWidth < 1, 'no heavy opaque label halo');
			const padding = label.strokeWidth / 2 + 1 / ratio;
			const ink: number[] = [];
			const left = Math.trunc((label.left - padding) * ratio), top = Math.trunc((label.top - padding) * ratio);
			const right = Math.trunc((label.right + padding) * ratio) + 1, bottom = Math.trunc((label.bottom + padding) * ratio) + 1;
			for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
				const offset = (y * glyphs.width + x) * 4;
				if (glyphs.data[offset] === withoutGlyphs.data[offset] && glyphs.data[offset + 1] === withoutGlyphs.data[offset + 1]
					&& glyphs.data[offset + 2] === withoutGlyphs.data[offset + 2]) continue;
				ink.push(offset);
				for (const dx of [0, 1]) for (const dy of [0, 1]) assert.ok(controlContainsPoint(geometry.targets[index + 1], (x + dx) / ratio, (y + dy) / ratio),
					`${actions[index].label} actual raster ink, including its stroke, stays inside the independent activating silhouette`);
			}
			assert.ok(ink.length > 0, `${actions[index].label} still has visible raster ink`);
			return { ink };
		});
		const checkedInk = new Set(masks.flatMap((mask: { ink: number[] }) => mask.ink));
		for (let offset = 0; offset < glyphs.data.length; offset += 4) {
			if (glyphs.data[offset] !== withoutGlyphs.data[offset] || glyphs.data[offset + 1] !== withoutGlyphs.data[offset + 1]
				|| glyphs.data[offset + 2] !== withoutGlyphs.data[offset + 2]) assert.ok(checkedInk.has(offset),
				`every browser-painted glyph pixel was inspected: missing pixel (${offset / 4 % glyphs.width}, ${Math.trunc(offset / 4 / glyphs.width)}), including any ink beyond the unstroked text bbox`);
		}
		for (const background of ['white', 'dark', 'bright']) {
			await page.evaluate(kind => (globalThis as any).ergonomicsProbe.background(kind), background);
			const scene = PNG.sync.read(await page.screenshot());
			const hidden = await page.addStyleTag({ content: '.action-label { visibility: hidden !important; }' });
			const plainScene = PNG.sync.read(await page.screenshot());
			await hidden.evaluate(element => element.parentNode!.removeChild(element));
			await hidden.dispose();
			for (let index = 0; index < masks.length; index += 1) {
				const mask = masks[index];
				const changedPixels = mask.ink.filter((offset: number) => scene.data[offset] !== plainScene.data[offset]
					|| scene.data[offset + 1] !== plainScene.data[offset + 1] || scene.data[offset + 2] !== plainScene.data[offset + 2]).length;
				assert.ok(changedPixels > 0, `${background}: ${actions[index].label} remains discoverable without opaque labels`);

			}
		}
	};

	await t.test('device-family geometry and layout thresholds share one player', async layoutTest => {
		const { page, settle, measure, finish } = await openBrowserErgonomicsPage(layoutTest, browser, html, script, actionIds);
		const phoneDimensionsByWidth = new Map<number, number[]>();
		for (const profile of profiles) await layoutTest.test(profile.name, async () => {
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
				(globalThis as any).ergonomicsProbe.video.setDisplaySize(320, 240, 320, 240);
				(globalThis as any).ergonomicsProbe.video.refreshLayout();
			}, { insets: [...profile.insets], player });
			await settle();
			const resting = await measure();

			const safe = { left: player.left + profile.insets[3], top: player.top + profile.insets[0],
				right: player.left + player.width - profile.insets[1], bottom: player.top + player.height - profile.insets[2] };
			const targets = resting.targets;
			const faceDiameter = targets[1].bounds.width;
			const width = safe.right - safe.left;
			const height = safe.bottom - safe.top;
			const landscape = width >= height;
			const overlay = landscape || profile.layoutProfile === 'compact-overlay';
			const phonePortrait = !overlay && width < 600;
			assert.equal(resting.layoutProfile, profile.layoutProfile ?? (landscape ? 'landscape' : phonePortrait ? 'phone-portrait' : 'wide-portrait'),
				'layout family follows safe player dimensions, not outer window size or orientation alone');
			const scale = faceDiameter / 80;
			// Browser CSS positions use a subpixel layout grid; transformed SVG
			// dimensions preserve the authored uniform scaling more precisely.
			const coordinateTolerance = 1 / 32;
			assert.equal(targets.length, 13, 'the rocker plus every one of the twelve physical gamepad buttons is present');
			assert.ok(faceDiameter <= 88.0001, 'tablets cap face growth instead of stretching with viewport height');
			if (width >= 568 && height >= 264) assert.ok(faceDiameter >= 60 - coordinateTolerance,
				'roomy phone landscape and wider players retain at least a 60px face target with the complete fourteen-control composition');
			if (width >= 568 && height >= 212) assert.ok(faceDiameter >= 44 - coordinateTolerance,
				'short handheld surfaces retain at least a 44px face target while composing the complete shoulders and utility footer');
			if (!phonePortrait && width >= 600 && height >= 400) assert.ok(faceDiameter >= 80 - coordinateTolerance,
				'wide portrait and roomy landscape retain the full-size face bank');
			for (const circle of targets.slice(1, 5)) {
				assert.equal(circle.radius, targets[1].radius, `${circle.id} has exactly the same numerical target radius as every other face button`);
				assert.equal(circle.transform.a, targets[1].transform.a, `${circle.id} artwork uses the same exact SVG scale as every other face button`);
				assert.ok(Math.abs(circle.bounds.width - faceDiameter) < coordinateTolerance, `${circle.id} has the same rendered target diameter within the browser's subpixel layout grid`);
				assert.equal(circle.presentation.fill, targets[1].presentation.fill, 'face buttons have no primary/secondary visual hierarchy');
				assert.equal(circle.presentation.stroke, targets[1].presentation.stroke);
			}
			const pad = targets[0];
			const faceCenter = { x: (targets[1].x + targets[4].x) / 2, y: (targets[1].y + targets[4].y) / 2 };
			if (phonePortrait) {
				// Exact owner dimensions are position-independent. DOMRect widths of
				// transformed arc paths subtract float32 absolute endpoints, so an
				// inset origin can change their final bit without changing the shape.
				const dimensions = targets.flatMap((target: any) => target.outline
					? [target.radius, target.outline.radius, target.outline.halfWidth,
						target.outline.startX, target.outline.startY, target.outline.endX, target.outline.endY,
						target.outline.left, target.outline.top, target.outline.right, target.outline.bottom]
					: [target.radius]);
				if (phoneDimensionsByWidth.has(width)) assert.deepEqual(dimensions, phoneDimensionsByWidth.get(width),
					'reducing phone height changes placement, not thumb-sized control dimensions');
				phoneDimensionsByWidth.set(width, dimensions);
				assert.ok(pad.bounds.width >= 134 - coordinateTolerance && pad.bounds.width <= 180 + coordinateTolerance,
					'phone directional target has its own thumb-sized budget, independent of the face bank');
				assert.ok(faceDiameter >= (width >= 320 ? 60 : 44) - coordinateTolerance && faceDiameter <= 80 + coordinateTolerance,
					'every phone face key remains thumb sized without consuming a tablet-sized lane');
				if (width === 320) assert.ok(Math.abs(pad.bounds.width - 144) < coordinateTolerance);
				if (width >= 393) assert.ok(Math.abs(pad.bounds.width - 180) < coordinateTolerance);
			} else {
				assert.ok(Math.abs(pad.bounds.width / faceDiameter - 180 / 80) < 0.0001,
					'wide portrait retains the established landscape artwork proportions');
			}
			assert.ok(Math.abs(pad.y - faceCenter.y) < coordinateTolerance, 'both main thumb banks share one hand row in every layout family');
			const [select, start, ls, rs, lb, rb, lt, rt] = targets.slice(5);
			const [keyboard, menu] = resting.hosts;
			const utilityGap = Math.min(12 * (phonePortrait ? 1 : scale),
				(width - 8 - 2 * (ls.bounds.width * 2 + select.bounds.width)) / 5);
			const middle = (safe.left + safe.right) / 2;
			assert.ok(select.x < middle && start.x > middle, 'SELECT and START straddle the handheld center');
			assert.ok(Math.abs(select.y - start.y) < coordinateTolerance, 'menu controls share one utility row');
			assert.ok(select.y > pad.y && start.y > faceCenter.y,
				'utilities lie below both main thumb banks in every layout family');
			assert.ok(ls.x < select.x && rs.x > start.x, 'each hand has its own LS/SELECT or START/RS pair');
			assert.ok(select.x - ls.x >= select.radius + ls.radius + utilityGap - coordinateTolerance
				&& rs.x - start.x >= rs.radius + start.radius + utilityGap - coordinateTolerance,
				'hand-side utility pairs retain clear physical gaps rather than overlapping when short');
			assert.ok(keyboard.x < ls.x && menu.x > rs.x, 'dedicated keyboard and settings targets occupy the outer lower hand corners');
			for (const host of resting.hosts) {
				assert.equal(host.hidden, false, 'host commands are visible alongside the gamepad instead of requiring a guest chord');
				assert.ok(host.label && host.label.length > 0, 'host-only icons retain semantic accessible names');
				assert.equal(host.background, 'rgba(0, 0, 0, 0)', 'dedicated host buttons do not add an opaque patch over the picture');
				assert.ok(Math.abs(host.bounds.width - ls.bounds.width) < coordinateTolerance
					&& Math.abs(host.bounds.height - ls.bounds.height) < coordinateTolerance,
					'host-only controls use the same target budget as stick-click controls');
				assert.ok(host.bounds.left >= safe.left - coordinateTolerance && host.bounds.right <= safe.right + coordinateTolerance
					&& host.bounds.top >= safe.top - coordinateTolerance && host.bounds.bottom <= safe.bottom + coordinateTolerance,
					`${host.id} stays wholly inside the actual safe player, including offset and compact surfaces`);
				for (const target of targets) assert.ok(controlSeparation(host, target) >= -coordinateTolerance,
					`${host.id} does not physically overlap ${target.id}: actual separation ${controlSeparation(host, target)}`);
			}
			if (phonePortrait) {
				const footer = [keyboard, ls, select, start, rs, menu];
				assert.ok(utilityGap >= 4 - coordinateTolerance, 'a reserved phone deck retains at least a real 4px utility gap instead of shrinking 44/48px targets');
				for (let index = 1; index < footer.length; index += 1) {
					assert.ok(Math.abs(footer[index].y - footer[0].y) < coordinateTolerance, 'phone utilities and both host icons fit one compact footer, not a second oversized toolbar');
					assert.ok(footer[index].x - footer[index - 1].x >= footer[index].radius + footer[index - 1].radius + utilityGap - coordinateTolerance,
						'all six phone utility targets retain a real reachable horizontal gap');
				}
			}
			if (phonePortrait) {
				assert.ok(Math.abs(ls.bounds.width - 44) < coordinateTolerance && Math.abs(rs.bounds.width - 44) < coordinateTolerance,
					'phone stick clicks are 44px targets independent of face or pad scale');
				assert.ok(Math.abs(select.bounds.width - 48) < coordinateTolerance && Math.abs(start.bounds.width - 48) < coordinateTolerance,
					'phone menus remain 48px targets independent of face or pad scale');
			}
			assert.ok(Math.abs(pad.bounds.left - safe.left - 4) < coordinateTolerance,
				'primary D-pad edge clearance is not enlarged to make room for an outer shoulder ring');
			assert.ok(pad.x - pad.radius >= safe.left && pad.x + pad.radius <= safe.right
				&& pad.y - pad.radius >= safe.top && pad.y + pad.radius <= safe.bottom,
				'the entire unchanged directional acquisition circle remains inside the safe player, not only the painted cross');
			assert.ok(Math.abs(targets[2].painted.right - safe.right + 4 - (1 + 1.5) * scale) < coordinateTolerance,
				'the face cluster remains at its authored primary edge, with only the actual bezel paint extending beyond the acquisition frame');
			assert.ok(lb.x < middle && lt.x < middle && rb.x > middle && rt.x > middle, 'each shoulder pair stays with its corresponding hand');
			for (const [bumper, trigger, primary] of [[lb, lt, pad], [rb, rt, faceCenter]]) {
				assert.ok(Math.abs(bumper.x + bumper.outline.centerX - primary.x) < coordinateTolerance
					&& Math.abs(trigger.x + trigger.outline.centerX - primary.x) < coordinateTolerance,
					'both adjacent shoulders share the same horizontal center as their primary control');
				assert.ok(Math.abs(bumper.y + bumper.outline.centerY - primary.y) < coordinateTolerance
					&& Math.abs(trigger.y + trigger.outline.centerY - primary.y) < coordinateTolerance,
					'bumpers and triggers follow one circle, not vertically stacked concentric rings');
				assert.equal(bumper.outline.radius, trigger.outline.radius, 'the pair has one exact centerline radius');
				assert.equal(bumper.outline.halfWidth, trigger.outline.halfWidth, 'neither shoulder in the pair has a smaller contact thickness');
				assert.ok((bumper.x - trigger.x) * (primary.x < middle ? 1 : -1) < 0,
					'the easier bumper owns the outer ring segment and the trigger stays inward in both orientations');
				const bumperSweep = Math.acos(bumper.outline.startX * bumper.outline.endX + bumper.outline.startY * bumper.outline.endY);
				const triggerSweep = Math.acos(trigger.outline.startX * trigger.outline.endX + trigger.outline.startY * trigger.outline.endY);
				assert.ok(bumperSweep > triggerSweep, 'the easier bumper has a genuinely larger finite curved target, not just a swapped label');
				if (primary === pad) {
					const directionalShoulderGap = 18 * (phonePortrait ? 1 : scale);
					for (const shoulder of [bumper, trigger]) assert.ok(Math.abs(controlSeparation(shoulder, pad) - directionalShoulderGap) < coordinateTolerance,
						'each left shoulder has its authored 18px clearance, scaled only for ring profiles, outside the unchanged acquisition disk');
				} else {
					for (const shoulder of [bumper, trigger]) assert.ok(Math.abs(shoulder.outline.radius - shoulder.outline.halfWidth - 104 * scale - 12 * (phonePortrait ? 1 : scale)) < coordinateTolerance,
						'the action-side radial shoulder clearance remains on its existing 12px policy');
				}
				const direction = primary.x < middle ? -1 : 1;
				const holdingRadius = direction < 0 ? pad.radius : targets[2].x + targets[2].radius - faceCenter.x;
				const holdingX = primary.x + direction * holdingRadius;
				assert.ok(distanceToControl(bumper, holdingX, primary.y) < distanceToControl(trigger, holdingX, primary.y),
					'the true bumper surface is nearer than the trigger from the physical outer holding point, not just an equal-radius label assertion');
				const bumperLabel = resting.labels[bumper.id === 'lb_knop' ? 8 : 9];
				const triggerLabel = resting.labels[trigger.id === 'lt_knop' ? 10 : 11];
				assert.ok(((bumperLabel.left + bumperLabel.right) - (triggerLabel.left + triggerLabel.right)) * direction > 0,
					'actual rendered bumper labels retain the same outer-side role in both orientations');
			}
			for (const shoulder of [lb, rb, lt, rt]) {
				assert.equal(shoulder.tag, 'path', `${shoulder.id} uses a physical shoulder outline, not a circular target`);
				assert.ok(shoulder.outline, `${shoulder.id} publishes its real rounded outline to input`);
				assert.equal(shoulder.transform.a, 1, 'integer SVG viewport dimensions retain the exact authored contact scale');
				assert.equal(shoulder.transform.d, 1);
				assert.ok(Math.abs(shoulder.transform.e - shoulder.x - shoulder.outline.left) < coordinateTolerance);
				assert.ok(Math.abs(shoulder.transform.f - shoulder.y - shoulder.outline.top) < coordinateTolerance);
				if (shoulder === lb || shoulder === rb) assert.ok(shoulder.bounds.width > shoulder.bounds.height, `${shoulder.id} remains a broad outer shoulder arch`);
				assert.ok(shoulder.outline.radius > shoulder.outline.halfWidth, `${shoulder.id} is a bent band with a real concave inner edge`);
				assert.equal(shoulder.presentation.fill, 'none', 'shoulder backgrounds are fully transparent');
				assert.ok(shoulder.bounds.width > select.bounds.width, 'shoulder contact width is larger than utility menu targets');
				assert.ok(shoulder.outline.halfWidth * 2 >= 44 - coordinateTolerance,
					`${shoulder.id} keeps a real radial target thickness inside the common viewport budget`);
				const primary = shoulder === lb || shoulder === lt ? pad : faceCenter;
				assert.ok(shoulder.y < primary.y,
					`${shoulder.id} follows the same upper shoulder topology in phone, wide and overlay families`);
			}
			const imageWidth = resting.canvas.right - resting.canvas.left;
			const imageHeight = resting.canvas.bottom - resting.canvas.top;
			assert.ok(imageWidth > 0 && imageHeight > 0, 'every usable player keeps a positive picture instead of a zero or negative deck slot');
			assert.ok(Math.abs(imageWidth / imageHeight - 4 / 3) < 0.0001, 'the controller profile does not alter the 4:3 picture');
			const dpr = await page.evaluate(() => devicePixelRatio);
			const halfSteps = imageWidth * dpr / 320 * 2;
			assert.ok(Math.abs(halfSteps - Math.round(halfSteps)) < 0.001, 'the positive picture retains integer/half-integer physical scaling');
			const nextWidth = (Math.round(halfSteps) + 1) * 160 / dpr;
			assert.ok(nextWidth > width || nextWidth * 3 / 4 > (overlay ? height : resting.deckTop - safe.top),
				'picture fitting selects the largest permitted quantized step for the actual profile');
			if (overlay) {
				assert.equal(resting.deckTop, null, 'landscape and compact portrait overlay controls without reserving a separate deck');
				const actualTopReach = Math.max(pad.y - lb.y - lb.outline.top, pad.y - rb.y - rb.outline.top);
				if (4 + actualTopReach <= height / 2) {
					assert.ok(Math.abs(pad.y - (safe.top + height / 2)) < coordinateTolerance,
						'normal phone and tablet primary controls are vertically centered rather than bottom-anchored');
				}
				assert.ok(lb.x < lt.x && rb.x > rt.x, 'landscape puts bumpers on the outer hand sides instead of more difficult inward segments');
			} else {
				assert.ok(resting.deckTop !== null);
				const revisionBeforeMeasure = await page.evaluate(() => (globalThis as any).ergonomicsProbe.geometryRevision());
				const deckHeight = await page.evaluate(({ width, height }) => (globalThis as any).ergonomicsProbe.measureDeck(width, height), { width, height });
				assert.equal(await page.evaluate(() => (globalThis as any).ergonomicsProbe.geometryRevision()), revisionBeforeMeasure,
					'intrinsic numerical measurement does not publish a provisional input geometry');
				const deckPaintTop = Math.min(...targets.map((target: any) => target.painted.top), ...resting.hosts.map((host: any) => host.bounds.top));
				const deckPaintBottom = Math.max(...targets.map((target: any) => target.painted.bottom), ...resting.hosts.map((host: any) => host.bounds.bottom));
				assert.ok(deckPaintTop >= resting.deckTop && deckPaintBottom <= resting.deckTop + 12 + deckHeight + coordinateTolerance,
					'the measured lower deck contains all real painted controls');
				assert.ok(deckHeight - (deckPaintBottom - deckPaintTop) >= -coordinateTolerance
					&& deckHeight - (deckPaintBottom - deckPaintTop) <= 24,
					'intrinsic deck measurement has bounded padding, not viewport-height whitespace');
				assert.ok(Math.abs(resting.canvas.top - safe.top) < coordinateTolerance, 'portrait game image is anchored at the safe top');
				assert.ok(resting.canvas.bottom <= resting.deckTop + coordinateTolerance, 'portrait video fitting does not enter the lower controller deck');
				assert.ok(lb.y < pad.y && rb.y < faceCenter.y,
					'each portrait family reserves its real upper shoulders inside the measured deck');
				assert.ok(lb.x < lt.x && rt.x < rb.x, 'portrait keeps bumpers on each hand outer side, independently of its profile');
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
			const actualFills = await page.evaluate(samples => (globalThis as any).ergonomicsProbe.fills(samples), fillSamples);
			for (let sample = 0; sample < fillSamples.length; sample += 1) {
				assert.equal(actualFills[sample], expectedFills[sample],
					`SVG and independent finite arc agree at ${JSON.stringify(fillSamples[sample])}`);
			}
			const paintClearance = 0;
			for (let index = 0; index < targets.length; index += 1) {
				const circle = targets[index];
				if (!circle.outline) {
					if (index !== 0) assert.equal(circle.transform.a, circle.transform.d, `${circle.id} has exact uniform SVG scaling`);
					assert.ok(Math.abs(circle.bounds.width - circle.bounds.height) < coordinateTolerance, `${circle.id} keeps uniform CSS-client scaling within the browser's subpixel layout grid`);
				}
				assert.ok(circle.painted.left >= safe.left + paintClearance - 0.0001, `${circle.id} left paint clearance`);
				assert.ok(circle.painted.top >= safe.top + paintClearance - 0.0001, `${circle.id} top paint clearance`);
				assert.ok(circle.painted.right <= safe.right - paintClearance + 0.0001, `${circle.id} right paint clearance`);
				assert.ok(circle.painted.bottom <= safe.bottom - paintClearance + 0.0001, `${circle.id} bottom paint clearance`);
				for (let other = index + 1; other < targets.length; other += 1) {
					const next = targets[other];
					const gap = controlSeparation(circle, next);
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
		});
		await finish();
	});

	await t.test('visible and held controls preserve gameplay pixels and legible label ink', async paintTest => {
		const { page, touch, settle, measure, poll, finish } = await openBrowserErgonomicsPage(paintTest, browser, html, script, actionIds);
		await page.evaluate(() => {
			document.getElementById('player-surface')!.style.padding = '47px 0 34px';
			const probe = (globalThis as any).ergonomicsProbe;
			probe.video.refreshLayout();
			probe.background('bright');
		});
		await settle();
		const resting = await measure();
		const targets = resting.targets;
		const [pad, a] = targets;
		const lb = targets.find((target: { id: string }) => target.id === 'lb_knop')!;
		await assertTransparentArtwork(page, targets);
		await touch('touchStart', [
			{ id: 1, x: a.x, y: a.y, radiusX: 14, radiusY: 14 },
			{ id: 2, x: lb.x, y: lb.y, radiusX: 14, radiusY: 14 },
			{ id: 3, x: pad.x + pad.radius * 0.7, y: pad.y, radiusX: 14, radiusY: 14 },
		]);
		assert.equal((await poll()).sampledButtons, 0x8011, 'face, shoulder and direction stay independently held');
		await settle();
		const held = await measure();
		await assertTransparentArtwork(page, held.targets);
		await assertRasterLabelContrast(page, held);
		await touch('touchEnd', []);
		assert.equal((await poll()).sampledButtons, 0);
		await page.evaluate(() => (globalThis as any).ergonomicsProbe.model.setDirectionalMode('stick'));
		await settle();
		const stick = await measure();
		assert.deepEqual(stick.targets.map((target: any) => target.bounds), targets.map((target: any) => target.bounds),
			'switching directional mode does not move any controls');
		assert.deepEqual(stick.hosts, resting.hosts, 'switching mode leaves host-only commands in the same corners');
		assert.deepEqual(stick.canvas, resting.canvas, 'switching mode does not change picture composition');
		assert.ok(await finish() > 0, 'held paint was produced through native input');
	});

	await t.test('true player-frame resize resamples held contacts before any subsequent native jitter', async resizeTest => {
		const { page, touch, settle, measure, poll, finish } = await openBrowserErgonomicsPage(resizeTest, browser, html, script, actionIds);
		await page.setViewportSize({ width: 844, height: 390 });
		await page.evaluate(() => {
			const style = document.getElementById('player-surface')!.style;
			style.left = '0px';
			style.top = '0px';
			style.right = style.bottom = 'auto';
			style.width = '844px';
			style.height = '390px';
			style.padding = '0px 47px 21px 47px';
			(globalThis as any).ergonomicsProbe.video.setDisplaySize(320, 240, 320, 240);
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
			const held = roundContactBankWord(current.targets.slice(1), finger.x, finger.y, 14);
			const word = await poll();
			assert.equal(word.buttons, held, `true document/player-frame geometry immediately applies at ${height}px height`);
			assert.equal(word.physicalButtons, word.buttons);
			assert.equal(word.sampledButtons, word.buttons & ~0x100);
			assert.equal(await page.evaluate(() => (globalThis as any).ergonomicsProbe.model.ownsContact((globalThis as any).ergonomicsProbe.pointerEvents.filter((event: any) => event.type === 'pointerdown').at(-1).id)), true,
				'true layout changes contributions, not the retained contact identity');
			assert.equal(current.targets[1].presentation.touched, (word.buttons & 1) !== 0 ? 'true' : 'false');
			finger.x += 1;
			await touch('touchMove', [finger]);
			const jittered = roundContactBankWord(current.targets.slice(1), finger.x, finger.y, 14);
			assert.equal((await poll()).sampledButtons, jittered & ~0x100, 'one-pixel native jitter does not reveal an edge deferred by layout');
		}
		await touch('touchEnd', []);
		assert.equal((await poll()).sampledButtons, 0);
		await settle();
		assert.ok(await finish() > 0, 'the held contact came from native input');
	});
});
