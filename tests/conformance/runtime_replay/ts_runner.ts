import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { CALL_RESULT_EXTEND_TOP } from '../../../machine/ts/machine/cpu/call_state';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { parseSystemRomImage, parseCartridgePackage } from '../../../machine/ts/rompack/image';
import { cartridgeMediaFromPackage } from '../../../hosts/common/cartridge_media';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { captureRuntimeSaveState, applyRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState, decodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HistoryMode, HistorySeekResult } from '../../../machine/ts/machine/runtime/history/history';
import { observeReplay } from './observation';
import { type InputControllerSnapshot as Snapshot } from '../../../machine/ts/machine/devices/input/contracts';

async function main(): Promise<void> {
	const [systemPath, cartPath, outputPrefix, cpuBackend = 'default'] = process.argv.slice(2);
	assert.ok(cpuBackend === 'default' || cpuBackend === 'interpreter' || cpuBackend === 'javascript', 'CPU backend must be default, interpreter or javascript');
	let inputTick = 0;
	let rejectLiveInput = false;
	let branched = false;
	const input = {
		sampleInputControllerSnapshot(snapshot: Snapshot): void {
			assert.equal(rejectLiveInput, false, 'replay must not sample live input');
			snapshot.pads[0].buttons = branched ? 2 : inputTick % 6 < 3 ? 1 : 1 << 15;
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
		cpuExecutionBackend: cpuBackend === 'default' ? undefined : cpuBackend === 'javascript' ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter,
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
			backend.captureGxGpuVramSnapshot(gpu);
			runtime.history.captureCheckpoint();
		}
	};
	const capture = () => {
		backend.captureGxGpuVramSnapshot(gpu);
		return captureRuntimeSaveState(runtime);
	};
	const observe = () => observeReplay(runtime);
	runtime.boot();
	for (let frame = 0; frame < 75 && observe().voices === 0; frame += 1) tick();
	const booted = observe();
	assert.equal(booted.voices, 1 << 4, 'fixture has started the APU voice');
	let pendingLookup = runtime.machine.cpu.rootThread.currentFrame;
	while (pendingLookup !== null && (pendingLookup.returnCount & CALL_RESULT_EXTEND_TOP) === 0)
		pendingLookup = pendingLookup.previous;
	assert.ok(pendingLookup !== null, 'the checkpoint includes a suspended implicit table read');
	assert.equal(pendingLookup.previous?.savedExecutionBank, 0, 'the suspended lookup returns to the cartridge');
	const anchor = capture();
	const bytes = encodeRuntimeSaveState(anchor);
	for (let frame = 0; frame < 6; frame += 1) tick();
	const forward = observe();
	assert.notEqual(forward.background, booted.background, 'the guest produced a different scanout');
	assert.ok(forward.inputSequence > booted.inputSequence && forward.sampleSequence > booted.sampleSequence);
	applyRuntimeSaveState(runtime, anchor);
	for (let frame = 0; frame < 6; frame += 1) tick();
	assert.deepEqual(observe(), forward, 'in-memory restore repeats the visible machine behavior');
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	for (let frame = 0; frame < 6; frame += 1) tick();
	assert.deepEqual(observe(), forward, 'the serialized restore repeats the same behavior');

	const history = runtime.history;
	history.start({ checkpointCapacity: 3, inputCapacity: 12, checkpointIntervalCycles: runtime.timing.cycleBudgetPerFrame * 4 });
	backend.captureGxGpuVramSnapshot(gpu);
	history.captureCheckpoint();
	const initialCycles = history.earliestCycles;
	const references = new Map<number, ReturnType<typeof observe>>();
	for (let index = 1; index <= 22; index += 1) {
		tick(true);
		if (index === 16 || index === 19 || index === 22) references.set(index, observe());
	}
	assert.equal(history.checkpointCount, 3);
	assert.ok(history.earliestCycles > initialCycles, 'checkpoint ring wraps');
	assert.ok(history.inputJournal.endSequence > history.inputJournal.capacity, 'input ring wraps');
	const retainedEnd = history.latestCycles;
	rejectLiveInput = true;
	const replay = [];
	for (const [index, playback] of [[22, false], [16, false], [22, true], [19, false]] as const) {
		const expected = references.get(index)!;
		if (playback) history.beginPlayback();
		else history.beginSeek(expected.cycles);
		for (let step = 0; history.mode === HistoryMode.Replaying && step < 1000; step += 1) {
			if (playback) history.advancePlayback(1000 / 60);
			else assert.notEqual(history.advanceSeek(16384), HistorySeekResult.Stopped, 'recorded replay must progress');
			while (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			backend.executeGxGpuCommandDrain(gpu);
			gpu.retirePresentedCommands();
			runtime.machine.audioController.synchronizeOutput().clear();
		}
		assert.equal(history.mode, HistoryMode.Reviewing);
		assert.equal(history.latestCycles, retainedEnd, 'seek retains the recorded future');
		const actual = observe();
		assert.deepEqual(actual, expected, `recorded input and output at boundary ${index}`);
		replay.push(actual);
	}
	const reviewCycles = runtime.machine.scheduler.nowCycles;
	runtime.frameScheduler.run(80);
	assert.equal(runtime.machine.scheduler.nowCycles, reviewCycles, 'review does not advance on host time');
	history.input.applyInputControllerVibrationEffect(0, 10, 1);
	history.resumeRecording();
	assert.equal(history.inputJournal.endSequence, 19);
	assert.equal(history.latestCycles, reviewCycles);
	backend.captureGxGpuVramSnapshot(gpu);
	history.captureCheckpoint();
	rejectLiveInput = false;
	branched = true;
	for (let index = 0; index < 3; index += 1) tick();
	assert.equal(history.inputJournal.endSequence, 22);
	let branch = observe();
	assert.equal(branch.buttons, 2, 'live branch samples new input instead of retaining the recording');
	// host_rewind.lua encodes the pad in the background's green channel.
	// The guest can be suspended in collectgarbage across device ticks.
	for (let wait = 0; wait < 8 && ((branch.background >>> 8) & 0x7f) !== 2; ++wait) {
		tick();
		branch = observe();
	}
	assert.equal((branch.background >>> 8) & 0x7f, 2, 'the guest displays the newly sampled input');
	writeFileSync(outputPrefix, JSON.stringify({ forward, replay, branch }));
	let compiledBlocks = 0;
	for (let frame = runtime.machine.cpu.rootThread.currentFrame; frame !== null; frame = frame.previous) {
		for (const page of frame.executionImage.decodedPages.values()) {
			if (page.compiledBlocks === null) continue;
			for (const block of page.compiledBlocks.entries) if (block !== null) ++compiledBlocks;
		}
	}
	if (cpuBackend === 'javascript') assert.ok(compiledBlocks > 0, 'the JavaScript replay must exercise actual generated code');
	else assert.equal(compiledBlocks, 0, 'the default and interpreter replays interpret');
	console.log(JSON.stringify({ cpuBackend, compiledBlocks }));
	applyRuntimeSaveState(runtime, capture());
	assert.equal(history.mode, HistoryMode.Disabled, 'external load ends history');
	console.log('RUNTIME-REPLAY:PASS');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
