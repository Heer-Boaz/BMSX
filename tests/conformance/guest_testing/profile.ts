import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { loadRomToolingMedia } from '../../../toolchain/ts/rompack/media';
import { createRuntimeSourceState } from '../../../ide/runtime/sources';
import { ScenarioTestCollection } from '../../../ide/testing/scenario/test_collection';
import { ScenarioResultService } from '../../../ide/testing/scenario/result_service';
import { OffscreenMachine } from '../../../hosts/common/offscreen_machine';
import { TestRun } from '../../../ide/testing/run';
import type { TestExecution } from '../../../ide/testing/execution';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';

async function main(): Promise<void> {
	const systemRom = await readFile('dist/bmsx-bios.debug.rom');
	const cartridge = await readFile('dist/emptycart.debug.rom');
	const media = await loadRomToolingMedia(systemRom, [cartridge, null]);
	const collection = new ScenarioTestCollection(createRuntimeSourceState(media.system, media.cartridgeSlots));
	const module = collection.findModuleBySourcePath(0, 'tests/carts/emptycart/bios_runtime_assert.lua');
	const cases = Array.from({ length: 24 }, (_, index) =>
		`case_${index} = function() ${index % 4 === 3 ? "error('retained')" : 'assert(1 + 1 == 2)'} end`);
	const source = `return { kind = 'unit', tests = { ${cases.join(',')} } }`;
	collection.updateSource(module, source, 1);
	const sources = collection.resolveNode(module).map(test => ({ test, source, sourceRevision: 1 }));
	const results = new ScenarioResultService();
	const result = results.beginRun(module.id, sources);
	const run = new TestRun(result, sources, { systemRom, cartridgeSlots: [cartridge, null], machineModel: PSX_MACHINE_SPEC, optLevel: 3 }, results,
		(systemRom, cartridges, model, input) => new OffscreenMachine(systemRom, cartridges, model, input), () => {});
	let peakRss = 0;
	const records: { ms: number; bootCycles: number; cycles: number; rss: number }[] = [];
	const started = performance.now();
	let caseStarted = 0;
	let active: TestExecution | null = null;
	try {
		await run.prepare();
		const compileMs = performance.now() - started;
		while (run.active) {
			if (run.execution !== null && run.execution !== active) {
				active = run.execution;
				caseStarted = performance.now();
			}
			run.advance();
			peakRss = Math.max(peakRss, process.memoryUsage().rss);
			if (active !== null && !active.active) {
				records.push({ ms: performance.now() - caseStarted, bootCycles: active.bootCycles,
					cycles: active.target.runtime.machine.scheduler.nowCycles, rss: process.memoryUsage().rss });
				active = null;
			}
			assert.ok(performance.now() - started < 60000, 'Profiling run exceeded its process watchdog');
			await setImmediate();
		}
		assert.equal(result.passedCount, 18);
		assert.equal(result.failedCount, 6);
		assert.equal(records.length, 24);
		assert.ok(peakRss <= 512 * 1024 * 1024, `Peak RSS ${peakRss} exceeds 512 MiB`);
		console.log(JSON.stringify({ compileMs, totalMs: performance.now() - started, peakRss, records }, null, 2));
	} finally { run.dispose(); }
}

void main();
