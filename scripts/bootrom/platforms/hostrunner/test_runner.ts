import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createRuntimeSourceState } from '../../../../ide/runtime/sources';
import { ScenarioTestCollection } from '../../../../ide/testing/scenario/test_collection';
import { ScenarioResultService } from '../../../../ide/testing/scenario/result_service';
import { TestRun } from '../../../../ide/testing/run';
import { PSX_MACHINE_SPEC } from '../../../../machine/ts/spec/bmsx/model';
import { loadRomToolingMedia } from '../../../../toolchain/ts/rompack/media';
import { encodeScreenshotPng } from '../../../../hosts/node/headless/screenshot';
import { deriveHeadlessCaptureOutputDir } from '../headless_capture';

/** The CLI and Studio drive the same isolated run owner, not separate guest protocols. */
export async function runGuestTests(systemRom: Uint8Array, cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null], testPath: string, ttlMs: number, caseName?: string): Promise<void> {
	const sourcePath = path.relative(process.cwd(), path.resolve(testPath)).split(path.sep).join('/');
	const source = await readFile(testPath, 'utf8');
	const media = await loadRomToolingMedia(systemRom, cartridgeSlots);
	const collection = new ScenarioTestCollection(createRuntimeSourceState(media.system, media.cartridgeSlots));
	const module = collection.findModuleBySourcePath(0, sourcePath);
	collection.updateSource(module, source, 0);
	const cases = collection.resolveNode(module);
	const selected = caseName === undefined ? cases : cases.filter(test => test.caseName === caseName);
	if (selected.length === 0) throw new Error(`No test named '${caseName}' in '${sourcePath}'.`);
	const sources = selected.map(test => ({ test, source, sourceRevision: 0 }));
	const results = new ScenarioResultService();
	const result = results.beginRun(caseName === undefined ? module.id : selected[0].id, sources);
	const writes: Promise<void>[] = [];
	let captureIndex = 0;
	const outputDir = deriveHeadlessCaptureOutputDir(testPath);
	const run = new TestRun(result, sources, { systemRom, cartridgeSlots, machineModel: PSX_MACHINE_SPEC, optLevel: 3 }, results, () => {}, undefined,
		(target, label) => {
			const frame = target.backend.latestPresentedFrame!;
			const png = encodeScreenshotPng(frame.width, frame.height, target.backend.borrowPresentedPixels());
			const output = path.join(outputDir, `frame_${String(++captureIndex).padStart(5, '0')}.png`);
			writes.push(mkdir(outputDir, { recursive: true }).then(() => writeFile(output, png)));
			console.log(`[test:capture] ${label}: ${output}`);
		});
	const started = performance.now();
	try {
		await run.prepare();
		while (run.active) {
			if (writes.length > 0) {
				await Promise.all(writes);
				writes.length = 0;
			}
			run.advance();
			if (performance.now() - started >= ttlMs) {
				run.cancel();
				throw new Error(`Test run exceeded its ${ttlMs} ms wall-clock budget.`);
			}
			await setImmediate();
		}
		for (const item of result.items) {
			console.log(`[test] ${item.test.caseName}: ${item.state}`);
			for (let index = 0; index < item.logs.length; index += 1) console.log(`[test:log] ${item.logs.at(index).text}`);
			for (const failure of item.failures) console.error(`[test:${failure.phase}] ${failure.message}\n${failure.stackTrace}`);
		}
		await Promise.all(writes);
		if (result.state !== 'passed') throw new Error(`${result.failedCount} failed, ${result.passedCount} passed, ${result.skippedCount} skipped`);
	} finally {
		run.dispose();
		await Promise.all(writes);
	}
}
