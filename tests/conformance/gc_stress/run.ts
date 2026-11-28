import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { valueBool } from '../../../machine/ts/machine/cpu/value';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileCoroutineTest } from '../../helpers/coroutine';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../../helpers/cpu_execution';
import { gcStressVectors, installAllocationStress } from '../../helpers/gc_stress';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { systemCaseSource } from '../../helpers/system_case_rom';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const nativeRunner = nativeConformanceRunner('bmsx_gc_stress_runner', {
	buildDirectory: process.argv[2] ?? 'build-native-cpu-default',
	configure: ['-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
	parallel: '3',
});
const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-stress-'));
try {
	const cases = Object.entries(gcStressVectors);
	const image = compileCoroutineTest(systemCaseSource(cases), 3);
	const path = join(directory, 'allocation-stress.rom');
	writeFileSync(path, image.romBytes);
	for (const compiled of [false, true]) {
		const runtime = new Runtime({
			systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: compiled ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter,
		}, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const cpu = runtime.machine.cpu;
		const counter = installAllocationStress(cpu);
		let result = RunResult.Yielded, restored = false;
		for (let call = 0; call < 50_000 && result === RunResult.Yielded; call++) {
			result = cpu.runUntilDepth(0, call % 3 === 0 ? 1 : call % 3 === 1 ? 17 : 2048);
			assert.equal(cpu.readLuaFaultReasonWord(), 0, 'allocation stress must not fault');
			if (!restored && result === RunResult.Yielded && nativeHeapReference(cpu).gc.active()) {
				const phase = nativeHeapReference(cpu).gc.phase();
				const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
				const checkpoint = captureCpuCheckpoint(cpu);
				cpu.runUntilDepth(0, 2048);
				assert.equal(cpu.readLuaFaultReasonWord(), 0);
				assert.ok(nativeHeapReference(cpu).gc.phase() !== phase || cpu.getFrameDepth() !== depth || cpu.readFramePc(depth - 1) !== pc,
					'the live collector or program counter advances before rewind');
				restoreCpuCheckpoint(cpu, checkpoint);
				assert.equal(nativeHeapReference(cpu).gc.phase(), phase, 'restore reinstates the in-flight major collection');
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(cpu.readFramePc(depth - 1), pc);
				restored = true;
			}
		}
		assert.equal(result, RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [valueBool(true), valueBool(true)]);
		assert.ok(restored && counter.allocations > 32, 'stress reached real allocation boundaries and rewound a live collection');
		const native = execFileSync(nativeRunner, [path, compiled ? 'native' : 'scalar', 'stress'], { encoding: 'utf8' });
		assert.equal(native.trim(), String(counter.allocations), 'same allocation boundaries during stress and replay');
		console.log(`${compiled ? 'generated' : 'scalar'}: ${counter.allocations} allocation boundaries`);
	}
	console.log(`GC-STRESS-PARITY:PASS (${cases.length} guest cases, two backend pairs, one live collection rewind each)`);
} finally {
	rmSync(directory, { recursive: true });
}
