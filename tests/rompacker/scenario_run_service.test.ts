import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { HostAudioOutput } from '../../hosts/common/audio_output';
import { Input } from '../../hosts/common/input/manager';
import { initializeMachineRuntime } from '../../hosts/common/machine_runtime';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTaskQueue } from '../../ide/runtime/task_queue';
import { MemoryStorage } from '../../ide/testing/memory_storage';
import { ScenarioRunService } from '../../ide/workbench/contrib/scenario_lab/run_service';
import { ScenarioTestCollection } from '../../ide/workbench/contrib/scenario_lab/test_collection';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { CartridgeByteView } from '../../machine/ts/machine/devices/cartridge/contracts';
import { utf8FatalDecoder } from '../../machine/ts/common/serializer/binencoder';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import {
	buildScenarioMediaFixture,
	SCENARIO_FIXTURE_TEST_SOURCE_PATH,
} from '../helpers/scenario_media';

const ROOT = join(process.cwd(), 'tmp', 'scenario-run-service-test');
const PACKAGED_TEST_SOURCE = [
	'__bmsx_host_test = {}',
	'function __bmsx_host_test.ready()',
	'\treturn true',
	'end',
	'function __bmsx_host_test.setup()',
	'end',
	'function __bmsx_host_test.update()',
	'\treturn true',
	'end',
].join('\n');

function installedRomBytes(serviceRuntime: ReturnType<typeof initializeMachineRuntime>): Uint8Array {
	const view: CartridgeByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};
	assert.equal(
		serviceRuntime.machine.cartridgeController.bindRomByteView(
			0,
			CART_ROM_BASE,
			4,
			view,
		),
		true,
	);
	return view.bytes;
}

test('browser scenario media session installs derived execution media and restores canonical media', async () => {
	await rm(ROOT, { recursive: true, force: true });
	const clock = new VirtualHeadlessClock();
	const inputHub = new HeadlessInputHub();
	const input = new Input(clock, inputHub, -1);
	try {
		await mkdir(ROOT, { recursive: true });
		const fixture = await buildScenarioMediaFixture(ROOT, PACKAGED_TEST_SOURCE);
		const media = await loadRomToolingMedia(
			fixture.systemRom,
			[fixture.cartRom, null],
		);
		const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
		const runtime = initializeMachineRuntime(
			fixture.systemRom,
			[fixture.cartRom, null],
			PSX_MACHINE_SPEC,
			input,
		);
		const audioOutput = new HostAudioOutput(
			new DiscardingAudioSink(),
			runtime.machine.audioController,
			runtime.machine.audioOutput.outputRing,
			runtime.timing.ufpsScaled,
		);
		const fault = createRuntimeFaultState();
		const luaTooling = new RuntimeLuaTooling(
			sources,
			new SuspendedGuestSession(runtime),
		);
		const debuggerState = createRuntimeDebuggerState(runtime, sources);
		const microtasks = new IdeMicrotaskQueue();
		const runtimeTasks = new RuntimeTaskQueue(microtasks, audioOutput);
		const runService = new ScenarioRunService(
			runtime,
			sources,
			input,
			audioOutput,
			new MemoryStorage(),
			fault,
			luaTooling,
			debuggerState,
			runtimeTasks,
		);
		const collection = new ScenarioTestCollection(sources);
		const scenario = collection.findTestBySourcePath(
			0,
			SCENARIO_FIXTURE_TEST_SOURCE_PATH,
		);
		const canonicalLayer = sources.cartridgeSlots[0]!.rom;
		const canonicalRom = canonicalLayer.bytes;
		const canonicalSourceMedia = sources.currentBlua32Media;
		const currentTestSource = PACKAGED_TEST_SOURCE.replace('\treturn true', '\treturn false');
		const errors: unknown[] = [];

		const started = runService.start(
			scenario,
			{ source: currentTestSource, revision: 77 },
			[],
			error => errors.push(error),
		);
		microtasks.flush();
		await started;

		assert.deepEqual(errors, []);
		assert.equal(runService.active, true);
		assert.equal(runService.execution.active, true);
		assert.equal(runService.results.liveResult?.sourceRevision, 77);
		assert.equal(canonicalLayer.bytes, canonicalRom);
		assert.equal(
			sources.cartridgeSlots[0]!.luaSources.path2lua[SCENARIO_FIXTURE_TEST_SOURCE_PATH].src,
			PACKAGED_TEST_SOURCE,
		);
		assert.notEqual(sources.currentBlua32Media, canonicalSourceMedia);
		const scenarioRom = installedRomBytes(runtime);
		assert.notEqual(scenarioRom, canonicalRom);
		const scenarioIndex = await parseCartridgeIndex(scenarioRom);
		const testEntry = scenarioIndex.entries.find(
			entry => entry.source_path === SCENARIO_FIXTURE_TEST_SOURCE_PATH,
		)!;
		assert.equal(
			utf8FatalDecoder.decode(scenarioRom.subarray(testEntry.start, testEntry.end)),
			currentTestSource,
		);

		runService.cancel();
		assert.equal(runService.results.results[0].state, 'cancelled');
		const drained = runtimeTasks.schedule(() => {}, error => errors.push(error));
		microtasks.flush();
		await drained;

		assert.deepEqual(errors, []);
		assert.equal(runService.active, false);
		assert.equal(runService.execution.active, false);
		assert.equal(sources.currentBlua32Media, canonicalSourceMedia);
		assert.equal(sources.cartridgeSlots[0]!.rom, canonicalLayer);
		assert.equal(sources.cartridgeSlots[0]!.rom.bytes, canonicalRom);
		assert.equal(installedRomBytes(runtime), canonicalRom);
	} finally {
		input.dispose();
		await rm(ROOT, { recursive: true, force: true });
	}
});
