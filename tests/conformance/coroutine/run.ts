import { asClosure, valueBool } from '../../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCoroutineTest, coroutineVectors } from '../../helpers/coroutine';
import { completionBoundaryVectors, exerciseCompletionBoundary } from '../../helpers/completion_boundary';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin, type RuntimeCheckpointState } from '../../../machine/ts/machine/runtime/save_state';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const compiled = process.argv[2] === '--compiled';
assert.deepEqual(process.argv.slice(2), compiled ? ['--compiled'] : [], 'Expected no arguments or --compiled');
// The genuine native-OFF variant must not reconfigure the other conformance binaries.
const buildDirectory = compiled ? 'build-native-cpu-blocks' : 'build-cpp-tests-interpreter';
const nativeRunner = nativeConformanceRunner('bmsx_coroutine_runner', {
	buildDirectory,
	configure: [
		`-DCMAKE_BUILD_TYPE=${compiled ? 'Debug' : 'Release'}`, `-DBMSX_ENABLE_NATIVE_BLOCKS=${compiled ? 'ON' : 'OFF'}`,
		...(compiled ? ['-DBMSX_ENABLE_GLES2=OFF', '-DBMSX_ENABLE_ZLIB=OFF'] : []),
	],
});
const directory = mkdtempSync(join(tmpdir(), 'bmsx-coroutines-'));
try {
	for (const level of [0, 3] as const) {
		for (const [name, body] of Object.entries({ ...coroutineVectors, ...completionBoundaryVectors })) {
			const path = join(directory, `${name}-O${level}.rom`);
			const image = compileCoroutineTest(body, level);
			writeFileSync(path, image.romBytes);
			const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
				cpuExecutionBackend: compiled ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter }, {
				sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
			});
			runtime.boot();
			const cpu = runtime.machine.cpu;
			if (name.startsWith('completion_')) {
				exerciseCompletionBoundary(cpu, name);
			} else {
				if (name === 'halted_tooling_call') {
					assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
					assert.equal(cpu.isHaltedUntilIrq(), true);
					const depth = cpu.getFrameDepth();
					cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern('probe')), cpu.gc));
					for (let grant = 0; grant < 10000; grant++) {
						const status = cpu.runUntilDepth(depth, 17, cpu.rootThread.address);
						const snapshot = cpu.captureRuntimeState();
						cpu.restoreRuntimeState(snapshot);
						assert.deepEqual(cpu.captureRuntimeState(), snapshot, 'HALT owner survives suspended tooling call');
						if (status !== RunResult.Yielded) break;
					}
					assert.equal(cpu.activeThread, cpu.rootThread);
					assert.equal(cpu.getFrameDepth(), depth);
					assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('entered')), valueBool(true));
					assert.equal(cpu.isHaltedUntilIrq(), true, 'returning from tooling preserves the root HALT');
					applyRuntimeSaveState(runtime, decodeRuntimeSaveState(encodeRuntimeSaveState(captureRuntimeSaveState(runtime)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
					assert.equal(cpu.isHaltedUntilIrq(), true, 'HALT owner survives the full codec');
					cpu.clearHaltUntilIrq();
				}
				let result = RunResult.Yielded;
				let interrupted = false;
				const uninterrupted = name === 'nested_three_banks';
				const root = cpu.rootThread.address;
				const observedThreads = new Set<number>();
				const history = uninterrupted ? new RamHistory() : undefined;
				const memory = runtime.machine.memory;
				let historyBase: Uint32Array | undefined;
				let mid: { state: RuntimeCheckpointState; pages: Uint32Array; ram: Uint8Array } | undefined;
				if (history !== undefined) {
					history.start(memory);
					historyBase = history.capture(memory, null);
				}
				for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant += 1) {
					if (name === 'interrupted' && !interrupted && cpu.activeThread !== cpu.rootThread
						&& cpu.getGlobalByKey(cpu.stringPool.intern('interrupt_ready')) === valueBool(true)) {
						cpu.requestNonMaskableInterrupt();
						assert.equal(cpu.enterPendingInterrupt(), true);
						cpu.restoreRuntimeState(cpu.captureRuntimeState());
						interrupted = true;
					}
					result = cpu.runUntilDepth(0, 17);
					if (uninterrupted) {
						if (cpu.activeThread.address !== root) observedThreads.add(cpu.activeThread.address);
						if (observedThreads.size === 3 && mid === undefined) {
							assert.notEqual(cpu.activeThread.address, root, 'the checkpoint retains an executing nonroot bank');
							const state = captureRuntimeCheckpointState(runtime);
							const pages = history!.capture(memory, historyBase!);
							mid = { state, pages, ram: memory.ramData().slice() };
							historyBase = pages;
						}
					} else {
						cpu.restoreRuntimeState(cpu.captureRuntimeState());
					}
					if (name !== 'interrupted') assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
				}
				assert.equal(result, RunResult.Halted);
				if (uninterrupted) assert.equal(observedThreads.size, 3, 'all three nonroot records execute without an intervening restore');
				assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)]);
				if (history !== undefined) {
					assert.ok(mid !== undefined, 'history captures after all three nonroot records have executed');
					const finalState = captureRuntimeCheckpointState(runtime);
					const finalPages = history.capture(memory, historyBase!);
					const finalRam = memory.ramData().slice();
					const finalRemainder = cpu.instructionBudgetRemaining;
					const assertCpuAndRam = (state: RuntimeCheckpointState, ram: Uint8Array, boundary: string) => {
						// A restore also requests presentation of the restored VRAM.
						assert.deepEqual(cpu.captureRuntimeState(), state.cpuState, boundary + ' CPU');
						assert.deepEqual(memory.ramData(), ram, boundary + ' RAM');
					};

					history.restore(memory, finalPages, mid.pages);
					applyRuntimeCheckpointState(runtime, mid.state, RuntimeRestoreOrigin.HistorySeek);
					assertCpuAndRam(mid.state, mid.ram, 'backward active-bank checkpoint');
					history.restore(memory, mid.pages, finalPages);
					applyRuntimeCheckpointState(runtime, finalState, RuntimeRestoreOrigin.HistorySeek);
					assertCpuAndRam(finalState, finalRam, 'forward final checkpoint');

					history.restore(memory, finalPages, mid.pages);
					applyRuntimeCheckpointState(runtime, mid.state, RuntimeRestoreOrigin.HistorySeek);
					assert.equal(cpu.runUntilDepth(0, 17), RunResult.Yielded, 'an uncaptured grant executes from the active-bank checkpoint');
					assert.notDeepEqual(memory.ramData(), mid.ram, 'the uncaptured grant dirties physical Thread/frame storage');
					history.restore(memory, mid.pages, mid.pages);
					applyRuntimeCheckpointState(runtime, mid.state, RuntimeRestoreOrigin.HistorySeek);
					assertCpuAndRam(mid.state, mid.ram, 'same-map restore of uncaptured dirty pages');

					let replay = RunResult.Yielded;
					for (let grant = 0; grant < 10000 && replay === RunResult.Yielded; ++grant) replay = cpu.runUntilDepth(0, 17);
					assert.equal(replay, RunResult.Halted);
					assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)]);
					assert.equal(cpu.instructionBudgetRemaining, finalRemainder);
					assertCpuAndRam(finalState, finalRam, 'replayed suffix');
				}
			}
			const bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
			const decoded = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
			assert.deepEqual(decodeRuntimeSaveState(encodeRuntimeSaveState(decoded), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes), decoded);
			applyRuntimeSaveState(runtime, decoded);
			assert.deepEqual(cpu.captureRuntimeState(), decoded.cpuState);
			assert.equal(spawnSync(nativeRunner, [path], { stdio: 'inherit' }).status, 0);
			assert.deepEqual(decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.state`)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes), decoded, `${name} O${level}: TS/C++ runtime snapshot parity`);
		}
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
