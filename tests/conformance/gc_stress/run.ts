import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileCoroutineTest } from '../../helpers/coroutine';
import { gcStressVectors, installAllocationStress } from '../../helpers/gc_stress';

const buildDirectory = process.argv[2] ?? 'build-native-cpu-default';
for (const [command, args] of [
	['cmake', ['-S', 'machine/cpp', '-B', buildDirectory, '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON']],
	['cmake', ['--build', buildDirectory, '--target', 'bmsx_gc_stress_runner', '--parallel', '3']],
] as const) assert.equal(spawnSync(command, args, { stdio: 'inherit' }).status, 0);

const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-stress-'));
try {
	let cases = 0;
	for (const level of [0, 3] as const) for (const [name, body] of Object.entries(gcStressVectors)) {
		const image = compileCoroutineTest(body, level);
		const path = join(directory, `${name}-O${level}.rom`);
		writeFileSync(path, image.romBytes);
		for (const compiled of [false, true]) for (const restore of [false, true]) {
			const label = `${name} O${level}, compiled=${compiled}, restore=${restore}`;
			const runtime = new Runtime({
				systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
				cpuExecutionBackend: compiled ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter,
			}, {
				sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false,
				applyInputControllerVibrationEffect: () => {},
			});
			runtime.boot();
			const cpu = runtime.machine.cpu;
			const counter = installAllocationStress(cpu);
			let result = RunResult.Yielded;
			for (let call = 0; call < 50_000 && result === RunResult.Yielded; ++call) {
				result = cpu.runUntilDepth(0, call % 3 === 0 ? 1 : call % 3 === 1 ? 17 : 2048);
				assert.equal(cpu.readExceptionReturnFrameDepth(), -1, label);
				if (restore && call % 23 === 0) {
					const strings = cpu.stringPool.captureState();
					const state = cpu.captureRuntimeState();
					cpu.stringPool.restoreState(strings);
					cpu.restoreRuntimeState(state);
					assert.deepEqual(cpu.captureRuntimeState(), state, label);
				}
			}
			assert.equal(result, RunResult.Halted, label);
			assert.deepEqual(runtime.readCompletionValues(), [true], label);
			assert.ok(counter.allocations > 32, label);
			const expected = decodeRuntimeSaveState(encodeRuntimeSaveState(captureRuntimeSaveState(runtime)),
				PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
			const native = spawnSync(`${buildDirectory}/bmsx_gc_stress_runner`,
				[path, compiled ? 'native' : 'scalar', restore ? 'restore' : 'plain'], { stdio: 'inherit' });
			assert.equal(native.status, 0, `${label}: native signal ${native.signal}`);
			const actual = decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.state`)),
				PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
			assert.deepEqual(actual, expected, `${label}: complete TS/C++ runtime-state parity`);
			console.log(`${label}: passed (${counter.allocations} TS allocation boundaries)`);
			++cases;
		}
	}
	console.log(`GC-STRESS-PARITY:PASS (${cases} paired runs)`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
