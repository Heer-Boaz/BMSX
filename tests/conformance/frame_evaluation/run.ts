import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState, type RuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileFrameEvaluationTest, frameEvaluationCases } from '../../helpers/frame_evaluation';

for (const [command, args] of [
	['cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON']],
	['cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_frame_evaluation_runner', '--parallel', '2']],
] as const) assert.equal(spawnSync(command, args, { stdio: 'inherit' }).status, 0);

const directory = mkdtempSync(join(tmpdir(), 'bmsx-frame-evaluation-'));
try {
	for (const optLevel of [0, 3] as const) for (const [name, body] of Object.entries(frameEvaluationCases)) {
		const image = compileFrameEvaluationTest(body, optLevel), path = join(directory, `${name}-O${optLevel}.rom`);
		writeFileSync(path, image.romBytes);
		const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
		});
		runtime.boot();
		const cpu = runtime.machine.cpu;
		let result = RunResult.Yielded;
		const suspended: RuntimeSaveState[] = [];
		for (let grant = 0; grant < 300 && result === RunResult.Yielded; grant++) {
			result = cpu.runUntilDepth(0, 100000);
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			const saved = cpu.captureRuntimeState();
			cpu.restoreRuntimeState(saved);
			assert.deepEqual(cpu.captureRuntimeState(), saved);
			if (result === RunResult.Halted && cpu.isHaltedUntilIrq()) {
				const bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
				const state = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
				assert.deepEqual(decodeRuntimeSaveState(encodeRuntimeSaveState(state), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes), state);
				applyRuntimeSaveState(runtime, state);
				assert.deepEqual(cpu.captureRuntimeState(), state.cpuState);
				suspended.push(state);
				if (name === 'completion_injection') {
					const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
					cpu.beginCompletionClosureInExecutionDomain(-1, cpu.getGlobalByKey(cpu.stringPool.find('stopped_probe')!) as Closure, [depth - 1]);
					assert.equal(cpu.runUntilDepth(depth, 30_000_000), RunResult.Halted);
					assert.deepEqual(runtime.readCompletionValues(), [true, 43, null, false]);
					assert.equal(cpu.getFrameDepth(), depth); assert.equal(cpu.readFramePc(depth - 1), pc);
					assert.equal(cpu.isHaltedUntilIrq(), true);
					suspended.push(captureRuntimeSaveState(runtime));
				}
				cpu.clearHaltUntilIrq();
				result = RunResult.Yielded;
			}
		}
		assert.equal(result, RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [true, true]);
		assert.equal(suspended.length, name === 'completion_injection' ? 2 : name === 'coroutine' ? 1 : 0);
		assert.equal(spawnSync('build-cpp-tests/bmsx_frame_evaluation_runner', [path, name === 'completion_injection' ? 'completion' : 'run'], { stdio: 'inherit' }).status, 0);
		for (let index = 0; index < suspended.length; index++) {
			const native = decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.suspended-${index}.state`)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
			assert.deepEqual(native, suspended[index], `${name} O${optLevel}: active scope full TS/C++ state parity`);
		}
		const native = decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.state`)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(native, captureRuntimeSaveState(runtime), `${name} O${optLevel}: complete TS/C++ state parity`);
	}
	rmSync(directory, { recursive: true });
	console.log('FRAME-EVALUATION-PARITY:PASS (firmware, physical slots, scope lifetime and full snapshots)');
} catch (error) { console.error(`Evidence retained: ${directory}`); throw error; }
