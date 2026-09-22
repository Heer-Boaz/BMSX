import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCoroutineTest, coroutineVectors } from '../../helpers/coroutine';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';

for (const [command, args] of [
	['cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON', '-DCMAKE_BUILD_TYPE=Release']],
	['cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_coroutine_runner', '--parallel', '4']],
] as const) {
	assert.equal(spawnSync(command, args, { stdio: 'inherit' }).status, 0);
}
const directory = mkdtempSync(join(tmpdir(), 'bmsx-coroutines-'));
try {
	for (const level of [0, 3] as const) {
		for (const [name, body] of Object.entries(coroutineVectors)) {
			const path = join(directory, `${name}-O${level}.rom`);
			const image = compileCoroutineTest(body, level);
			writeFileSync(path, image.romBytes);
			const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
				sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
			});
			runtime.boot();
			const cpu = runtime.machine.cpu;
			if (name === 'halted_tooling_call') {
				assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
				assert.equal(cpu.isHaltedUntilIrq(), true);
				const depth = cpu.getFrameDepth();
				cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.intern('probe')) as Closure);
				for (let grant = 0; grant < 10000; grant++) {
					const status = cpu.runUntilDepth(depth, 17, cpu.rootThread);
					const snapshot = cpu.captureRuntimeState();
					cpu.restoreRuntimeState(snapshot);
					assert.deepEqual(cpu.captureRuntimeState(), snapshot, 'HALT owner survives suspended tooling call');
					if (status !== RunResult.Yielded) break;
				}
				assert.equal(cpu.activeThread, cpu.rootThread);
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('entered')), true);
				assert.equal(cpu.isHaltedUntilIrq(), true, 'returning from tooling preserves the root HALT');
				applyRuntimeSaveState(runtime, decodeRuntimeSaveState(encodeRuntimeSaveState(captureRuntimeSaveState(runtime)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
				assert.equal(cpu.isHaltedUntilIrq(), true, 'HALT owner survives the full codec');
				cpu.clearHaltUntilIrq();
			}
			let result = RunResult.Yielded;
			let interrupted = false;
			for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant += 1) {
				if (name === 'interrupted' && !interrupted && cpu.activeThread !== cpu.rootThread
					&& cpu.getGlobalByKey(cpu.stringPool.intern('interrupt_ready')) === true) {
					cpu.requestNonMaskableInterrupt();
					assert.equal(cpu.enterPendingInterrupt(), true);
					cpu.restoreRuntimeState(cpu.captureRuntimeState());
					interrupted = true;
				}
				result = cpu.runUntilDepth(0, 17);
				cpu.restoreRuntimeState(cpu.captureRuntimeState());
				if (name !== 'interrupted') assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			}
			assert.equal(result, RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), [true]);
			const bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
			const decoded = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
			assert.deepEqual(decodeRuntimeSaveState(encodeRuntimeSaveState(decoded), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes), decoded);
			applyRuntimeSaveState(runtime, decoded);
			assert.deepEqual(cpu.captureRuntimeState(), decoded.cpuState);
			assert.equal(spawnSync('build-cpp-tests/bmsx_coroutine_runner', [path], { stdio: 'inherit' }).status, 0);
			assert.deepEqual(decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.state`)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes), decoded, `${name} O${level}: TS/C++ runtime snapshot parity`);
		}
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
