import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) {
	extensions[extension] = (module: any, filename: string) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, cartPath, outputPrefix] = process.argv.slice(2);
	const { Runtime } = await import('../../../machine/ts/machine/runtime/runtime');
	const { parseSystemRomImage, parseCartridgePackage } = await import('../../../machine/ts/rompack/image');
	const { cartridgeMediaFromPackage } = await import('../../../hosts/common/cartridge_media');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } = await import('../../../machine/ts/spec/bmsx/io');
	const { captureRuntimeSaveState, applyRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state');
	const { encodeRuntimeSaveState, decodeRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state/codec');
	const { HistoryMode, HistorySeekResult } = await import('../../../machine/ts/machine/runtime/history/history');
	type Snapshot = import('../../../machine/ts/machine/devices/input/contracts').InputControllerSnapshot;
	let inputTick = 0;
	let rejectLiveInput = false;
	let historyCaptureMs = 0;
	let historyCaptures = 0;
	const input = {
		sampleInputControllerSnapshot(snapshot: Snapshot): void {
			assert.equal(rejectLiveInput, false, 'replay must not sample live input');
			snapshot.pads[0].buttons = (inputTick % 40) < 20 ? 1 : 1 << 15;
		},
		supervisorRequestLineHigh(): boolean {
			assert.equal(rejectLiveInput, false, 'replay must not read the live supervisor line');
			return false;
		},
		applyInputControllerVibrationEffect(): void { assert.equal(rejectLiveInput, false, 'replay must not repeat host vibration'); },
	};
	const runtime = new Runtime({
		systemRomBytes: parseSystemRomImage(readFileSync(systemPath)).bytes,
		cartridgeSlots: [cartridgeMediaFromPackage(parseCartridgePackage(readFileSync(cartPath))), null],
		machineModel: PSX_MACHINE_SPEC,
	}, input);
	const gpu = runtime.machine.gxGpu;
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const hostDeltas = [1.25, 8.5, 16.75];
	const tick = (paced = false): void => {
		inputTick = runtime.frameScheduler.lastTickSequence;
		let completed = false;
		for (let attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; attempt += 1) {
			if (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (!completed) {
				completed = paced
					? runtime.frameScheduler.runScheduledToNextLogicalTick(hostDeltas[attempt % hostDeltas.length])
					: runtime.frameScheduler.runToNextLogicalTick();
			}
		}
		assert.equal(completed, true, 'machine must reach its next PCRTC tick');
		backend.executeGxGpuCommandDrain(gpu);
		gpu.retirePresentedCommands();
		runtime.machine.audioController.synchronizeOutput().clear();
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0, 'guest fault');
		if (runtime.history.checkpointPending) {
			const start = performance.now();
			backend.captureGxGpuVramSnapshot(gpu);
			runtime.history.captureCheckpoint();
			historyCaptureMs += performance.now() - start;
			historyCaptures += 1;
		}
	};
	const capture = () => {
		backend.captureGxGpuVramSnapshot(gpu);
		return captureRuntimeSaveState(runtime);
	};
	runtime.boot();
	for (const checkpointTick of [2, 400, 1200]) {
		while (runtime.frameScheduler.lastTickSequence < checkpointTick) tick();
		const captureStart = performance.now();
		const anchor = capture();
		const captureMs = performance.now() - captureStart;
		const bytes = encodeRuntimeSaveState(anchor);
		let recycled = captureRuntimeSaveState(runtime);
		const recycledRam = recycled.machineState.machine.memory.ram;
		const recycledVram = recycled.machineState.machine.gxGpu.vramBytes;
		const recycledSampleRam = recycled.machineState.machine.audio.sampleRam;
		for (let count = 0; count < 120; count += 1) tick();
		const expected = capture();
		for (let pass = 0; pass < 3; pass += 1) {
			recycled = captureRuntimeSaveState(runtime, recycled);
			assert.equal(recycled.machineState.machine.memory.ram, recycledRam);
			assert.equal(recycled.machineState.machine.gxGpu.vramBytes, recycledVram);
			assert.equal(recycled.machineState.machine.audio.sampleRam, recycledSampleRam);
			assert.deepEqual(recycled, expected, 'reused capture must contain the new live state');
		}
		assert.deepEqual(encodeRuntimeSaveState(anchor), bytes, 'reuse must leave another checkpoint untouched');
		if (outputPrefix) writeFileSync(`${outputPrefix}-${checkpointTick}.state`, encodeRuntimeSaveState(expected));
		const restoreStart = performance.now();
		applyRuntimeSaveState(runtime, anchor);
		const restoreMs = performance.now() - restoreStart;
		const replayStart = performance.now();
		for (let count = 0; count < 120; count += 1) tick();
		const replayMs = performance.now() - replayStart;
		assert.deepEqual(capture(), expected, 'trusted in-memory replay must reproduce the full runtime state');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		for (let count = 0; count < 120; count += 1) tick();
		assert.deepEqual(capture(), expected, 'disk-codec replay must reproduce the same runtime state');
		console.log(JSON.stringify({
			host: 'ts', checkpointTick, captureMs, restoreMs, replayMs, bytes: bytes.byteLength,
			objects: anchor.cpuState.snapshot.objectCount,
			cpuSnapshotBytes: anchor.cpuState.snapshot.words.byteLength + anchor.cpuState.snapshot.objectWords.byteLength,
			cpuSnapshotCapacityBytes: anchor.cpuState.snapshot.capacityBytes,
		}));
	}

	const history = runtime.history;
	history.start({ checkpointCapacity: 4, inputCapacity: 96, checkpointIntervalCycles: runtime.timing.cycleBudgetPerFrame * 20 });
	backend.captureGxGpuVramSnapshot(gpu);
	history.captureCheckpoint();
	const initialCycles = history.earliestCycles;
	const references = new Map<number, ReturnType<typeof capture>>();
	for (let index = 1; index <= 111; index += 1) {
		tick(true);
		if ([55, 77, 111].includes(index)) references.set(index, capture());
	}
	assert.equal(history.checkpointCount, 4);
	assert.ok(history.earliestCycles > initialCycles, 'checkpoint ring must wrap');
	assert.ok(history.inputJournal.endSequence > history.inputJournal.capacity, 'input storage must wrap');
	assert.equal(history.inputJournal.storageBytes, 96 * 176);
	const retainedEnd = history.latestCycles;
	rejectLiveInput = true;
	let seekSteps = 0;
	let seekWorkMs = 0;
	let maxSeekStepMs = 0;
	let seekRestoreMs = 0;
	for (const [index, playback] of [[111, false], [55, false], [111, true], [77, false]] as const) {
		const expected = references.get(index)!;
		const restoreStart = performance.now();
		if (playback) history.beginPlayback();
		else history.beginSeek(expected.machineState.schedulerNowCycles);
		if (!playback) seekRestoreMs += performance.now() - restoreStart;
		for (let step = 0; history.mode === HistoryMode.Replaying && step < 10000; step += 1) {
			const stepStart = performance.now();
			if (playback) history.advancePlayback(1000 / 60);
			else {
				const result = history.advanceSeek(16384);
				seekSteps += 1;
				assert.notEqual(result, HistorySeekResult.Stopped, 'recorded replay must progress');
			}
			while (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			backend.executeGxGpuCommandDrain(gpu);
			gpu.retirePresentedCommands();
			runtime.machine.audioController.synchronizeOutput().clear();
			const elapsed = performance.now() - stepStart;
			if (!playback) seekWorkMs += elapsed;
			if (!playback && elapsed > maxSeekStepMs) maxSeekStepMs = elapsed;
		}
		assert.equal(history.mode, HistoryMode.Reviewing);
		assert.equal(history.latestCycles, retainedEnd, 'seek retains the recorded future');
		const actual = capture();
		assert.equal(actual.machineState.schedulerNowCycles, expected.machineState.schedulerNowCycles);
		assert.equal(actual.machineState.frameScheduler.lastTickSequence, expected.machineState.frameScheduler.lastTickSequence);
		assert.ok(isDeepStrictEqual(actual.machineState.machine, expected.machineState.machine), `history device state at ${index}`);
		// Host cycle grants/telemetry are not guest state. No guest values or
		// identities are translated when comparing paced and quantum replay.
		const { instructionBudgetRemaining: _actualGrant, ...actualCpu } = actual.cpuState;
		const { instructionBudgetRemaining: _expectedGrant, ...expectedCpu } = expected.cpuState;
		assert.ok(isDeepStrictEqual(actualCpu, expectedCpu), `history CPU state at ${index}`);
		assert.equal(actual.pendingEntryCall, expected.pendingEntryCall);
	}
	const reviewCycles = runtime.machine.scheduler.nowCycles;
	runtime.frameScheduler.run(80);
	assert.equal(runtime.machine.scheduler.nowCycles, reviewCycles, 'review does not advance on host time');
	history.input.applyInputControllerVibrationEffect(0, 10, 1);
	history.resumeRecording();
	assert.equal(history.inputJournal.endSequence, 77);
	assert.equal(history.latestCycles, reviewCycles);
	backend.captureGxGpuVramSnapshot(gpu);
	history.captureCheckpoint();
	rejectLiveInput = false;
	for (let index = 0; index < 10; index += 1) tick();
	assert.equal(history.inputJournal.endSequence, 87);
	if (outputPrefix) writeFileSync(`${outputPrefix}-history.state`, encodeRuntimeSaveState(capture()));
	console.log(JSON.stringify({ host: 'ts-history', seekSteps, seekWorkMs, maxSeekStepMs, seekRestoreMs, historyCaptures, historyCaptureMs, checkpoints: history.checkpointCount, inputBytes: history.inputJournal.storageBytes }));
	applyRuntimeSaveState(runtime, capture());
	assert.equal(history.mode, HistoryMode.Disabled, 'external load ends history');
	console.log('RUNTIME-REPLAY:PASS');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
