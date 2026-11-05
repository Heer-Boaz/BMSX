import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('browser frames allocate before drawing and publish target fitting before the browser paints', async t => {
	const bundle = await build({ stdin: { contents: `
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserFrameLoop } from './hosts/browser/frame_loop';
export { workbenchPixelsPerUnit } from './ide/workbench/common/display_scale';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'frameApi', write: false, tsconfig: 'tsconfig.base.json' });
	const browser = await chromium.launch(); t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
	await page.setContent('<style>body{margin:0}#player-surface{position:fixed;inset:0}canvas{position:fixed}</style><div id="player-surface"><canvas width="320" height="240"></canvas></div>');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).frameApi, canvas = document.querySelector('canvas')!;
		const video = new api.BrowserVideoOutput(canvas, null, 'fit');
		video.refreshLayout();
		let allocations = 0, draws = 0, layoutReads = 0;
		const measure = canvas.getBoundingClientRect.bind(canvas);
		canvas.getBoundingClientRect = () => { layoutReads++; return measure(); };
		video.workspace.open((availableWidth: number, availableHeight: number) => {
			const scale = api.workbenchPixelsPerUnit(availableWidth, 1);
			video.workspace.pixelsPerUnit = scale;
			canvas.width = Math.trunc(availableWidth / scale); canvas.height = Math.trunc(availableHeight / scale);
			video.setDisplaySize(canvas.width, canvas.height); allocations++;
		});
		const context = canvas.getContext('2d')!;
		let nextSize: [number, number] | undefined;
		const frames = new api.BrowserFrameLoop(video).start(() => {
			if (nextSize !== undefined) {
				[canvas.width, canvas.height] = nextSize; nextSize = undefined;
				video.setDisplaySize(canvas.width, canvas.height);
			}
			context.fillStyle = '#40a0c0'; context.fillRect(0, 0, canvas.width, canvas.height); draws++;
		});
		(globalThis as any).frames = { video, frames,
			nextTarget(width: number, height: number) { nextSize = [width, height]; },
			read() { return { allocations, draws, layoutReads, pixel: [...context.getImageData(0, 0, 1, 1).data],
				bounds: { ...video.measureDisplay() }, target: [video.geometry.targetWidth, video.geometry.targetHeight] }; },
			dispose() { frames.stop(); video.dispose(); } };
	});
	try {
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		const before = await page.evaluate(() => (globalThis as any).frames.read());
		const resized = await page.evaluate(() => new Promise<any>(resolve => {
			document.getElementById('player-surface')!.style.right = '120px';
			// Dispatch the same invalidation used by a browser resize, after the
			// next rendering frame was queued. Inspect its result before paint.
			window.dispatchEvent(new Event('resize'));
			requestAnimationFrame(() => resolve((globalThis as any).frames.read()));
		}));
		assert.equal(resized.allocations, before.allocations + 1, 'the changed work area resizes its target exactly once');
		assert.ok(resized.draws > before.draws);
		assert.deepEqual(resized.pixel, [0x40, 0xa0, 0xc0, 0xff], 'a later layout callback must not erase the frame that is about to be painted');
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		const settled = await page.evaluate(() => (globalThis as any).frames.read());
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		const idle = await page.evaluate(() => (globalThis as any).frames.read());
		assert.ok(idle.draws > settled.draws);
		assert.equal(idle.layoutReads, settled.layoutReads, 'ordinary frames do not remeasure an unchanged display');
		const targetChange = await page.evaluate(() => new Promise<any>(resolve => {
			const f = (globalThis as any).frames;
			f.video.workspace.close(); f.nextTarget(64, 64);
			requestAnimationFrame(() => {
				const painted = f.read();
				f.video.refreshLayout();
				resolve({ painted, refreshed: f.read() });
			});
		}));
		assert.deepEqual(targetChange.painted.target, [64, 64]);
		assert.deepEqual(targetChange.painted.bounds, targetChange.refreshed.bounds,
			'a target change during drawing must already have its final fit before browser paint; no second frame is needed');
		assert.deepEqual(targetChange.painted.pixel, [0x40, 0xa0, 0xc0, 0xff]);
		const stopped = await page.evaluate(() => {
			const f = (globalThis as any).frames; f.frames.stop();
			document.getElementById('player-surface')!.style.right = '240px'; window.dispatchEvent(new Event('resize'));
			return f.read();
		});
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		const retired = await page.evaluate(() => (globalThis as any).frames.read());
		assert.equal(retired.draws, stopped.draws);
		assert.equal(retired.layoutReads, stopped.layoutReads, 'stopping the host loop leaves no independent layout callback running');
	} finally { await page.evaluate(() => (globalThis as any).frames.dispose()); }
});
