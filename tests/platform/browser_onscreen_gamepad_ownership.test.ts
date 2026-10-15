import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { CONTROL_GAP } from '../../hosts/browser/onscreen_gamepad_layout';

// The production SVG/CSS are the presentation producer, not numbers copied into
// a synthetic view. These are Chromium owner/geometry checks, not iPhone proof.
test('gamepad consumes authored SVG/CSS once and keeps contact frames numerical', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const css = await readFile('gamebase.css', 'utf8');
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserHostClock } from './hosts/browser/timing';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'ownerFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const evidence: unknown[] = [];
	for (const profile of [
		{ name: 'phone portrait', width: 393, height: 852, originX: 50, originY: 50, labelSize: 13, stroke: 3 },
		{ name: 'landscape authored presentation', width: 852, height: 393, originX: 31, originY: 42, labelSize: 19, stroke: 9 },
	]) await t.test(profile.name, async p => {
		const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });
		p.after(() => page.close());
		await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
.shoulder-label { font-size: calc(${profile.labelSize}px * var(--shoulder-label-scale)); }
.shoulder-surface .control-bezel { stroke-width: ${profile.stroke}; }
</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div>`);
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		const measured = await page.evaluate(async profile => {
			const api = (globalThis as any).ownerFixture;
			const tip = document.getElementById('left-stick-tip') as unknown as SVGCircleElement;
			tip.cx.baseVal.value = profile.originX;
			tip.cy.baseVal.value = profile.originY;
			const computedStyle = window.getComputedStyle.bind(window);
			let styleReads = 0;
			window.getComputedStyle = (element, pseudo) => { styleReads += 1; return computedStyle(element, pseudo); };
			const pad = new api.BrowserOnscreenGamepad(new api.BrowserHostClock());
			pad.subscribe({ inputButton() {}, inputAxis2() {} });
			const view = new api.BrowserOnscreenGamepadView(document, window, pad);
			const constructionReads = styleReads;
			view.layout(0, 0, profile.width, profile.height);
			const geometry = pad.geometry;
			const initialRevision = pad.geometryRevision;
			const layout = view.metrics;
			const shoulder = geometry.actions.find(action => action.buttons === 0x10);
			const outerPaintedEdge = shoulder.x + shoulder.outline.left - profile.stroke / 2;
			const label = document.getElementById('lb_knop_text')!;
			const labelPixels = Number.parseFloat(computedStyle(label).fontSize);
			const layoutScale = view.layoutProfile === 'phone-portrait' ? 1 : layout.scale;
			const layoutStyleReads = styleReads;
			for (let index = 0; index < 10000; index += 1) {
				view.layout(view.layoutLeft, view.layoutTop, view.layoutWidth, view.layoutHeight, view.allocatedPortraitDeckTop);
			}
			const repeatedLayoutReads = styleReads - layoutStyleReads;
			const repeatedLayoutRevisions = pad.geometryRevision - initialRevision;
			pad.setDirectionalMode('stick');
			pad.beginContact(1, geometry.padX + geometry.stickTravelRadius, geometry.padY, 0, 0, true);
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
			const displaced = [tip.cx.baseVal.value, tip.cy.baseVal.value];
			const contactStyleReads = styleReads - layoutStyleReads;
			pad.endContact(1);
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
			const returned = [tip.cx.baseVal.value, tip.cy.baseVal.value];
			const video = new api.BrowserVideoOutput(document.getElementById('gamescreen'), view, 'fit');
			video.refreshLayout();
			const deckTop = view.portraitDeckTop;
			const deckStart = view.allocatedPortraitDeckTop;
			video.dispose();
			window.getComputedStyle = computedStyle;
			return { constructionReads, repeatedLayoutReads, repeatedLayoutRevisions, contactStyleReads,
				labelPixels, layoutScale, outerPaintedEdge, displaced, returned, deckTop, deckStart,
				hasNeutralInGeometry: Object.hasOwn(geometry, 'padNeutralRadius') };
		}, profile);
		assert.equal(measured.constructionReads, 1, 'the CSS bezel paint width is read at the retained view construction boundary');
		assert.equal(measured.repeatedLayoutReads, 0, 'unchanged layout does not read computed styles');
		assert.equal(measured.repeatedLayoutRevisions, 0, 'unchanged layout does not republish input geometry');
		assert.equal(measured.contactStyleReads, 0, 'stick acquisition and animation do not query presentation geometry or styles');
		assert.ok(Math.abs(measured.labelPixels - profile.labelSize * measured.layoutScale) < 0.001,
			'CSS owns the authored caption size; the layout publishes only its scale');
		assert.ok(Math.abs(measured.outerPaintedEdge) < 1e-8, 'actual CSS stroke thickness is reserved at the outer shoulder edge');
		assert.deepEqual(measured.displaced, [profile.originX + 24, profile.originY], 'the tip animates relative to its authored SVG origin');
		assert.deepEqual(measured.returned, [profile.originX, profile.originY], 'release returns to the authored origin rather than literal 50');
		assert.equal(measured.hasNeutralInGeometry, false, 'the view publishes physical geometry, not model deadzone policy');
		if (measured.deckTop !== null) assert.equal(measured.deckStart - measured.deckTop, CONTROL_GAP,
			'the video reservation and the actual controller deck use the same layout-owned clearance');
		evidence.push({ profile, measured });
	});
	await mkdir('.bmsx/hosting/keyboard-architecture-repair', { recursive: true });
	await writeFile('.bmsx/hosting/keyboard-architecture-repair/browser-gamepad-owners.json', JSON.stringify(evidence, null, 2));
});
