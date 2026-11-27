import { asClosure, valueBool } from '../../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCoroutineTest, coroutineVectors } from '../../helpers/coroutine';
import { completionBoundaryVectors, exerciseCompletionBoundary } from '../../helpers/completion_boundary';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { CPU_RESET_BANK_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { runGuestToHalt } from '../../helpers/cpu_test_harness';
import { runSystemCaseRom, systemCaseSource } from '../../helpers/system_case_rom';
import { exerciseNestedHistory } from './nested_history';

const compiled = process.argv[2] === '--compiled';
assert.deepEqual(process.argv.slice(2), compiled ? ['--compiled'] : [], 'Expected no arguments or --compiled');
const backend = compiled ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter;
// The genuine native-OFF variant must not reconfigure the other conformance binaries.
const nativeRunner = nativeConformanceRunner('bmsx_coroutine_runner', {
	buildDirectory: compiled ? 'build-native-cpu-blocks' : 'build-cpp-tests-interpreter',
	configure: [
		`-DCMAKE_BUILD_TYPE=${compiled ? 'Debug' : 'Release'}`, `-DBMSX_ENABLE_NATIVE_BLOCKS=${compiled ? 'ON' : 'OFF'}`,
		...(compiled ? ['-DBMSX_ENABLE_GLES2=OFF', '-DBMSX_ENABLE_ZLIB=OFF'] : []),
	],
});
const { interrupted, halted_tooling_call, nested_three_banks, wrap_close_ownership, ...ordinary } = coroutineVectors;
const directory = mkdtempSync(join(tmpdir(), 'bmsx-coroutines-'));
try {
	// This case replaces coroutine.close; run it after the other module consumers.
	const cases: [string, string][] = [...Object.entries(ordinary), ['wrap_close_ownership', wrap_close_ownership]];
	const suite = compileCoroutineTest(systemCaseSource(cases), 3).romBytes;
	writeFileSync(join(directory, 'suite.rom'), suite);
	runSystemCaseRom(suite, () => assert.fail('ordinary coroutine cases do not park the CPU'), backend);

	const hostCases = { interrupted, halted_tooling_call, nested_three_banks, ...completionBoundaryVectors };
	for (const [name, body] of Object.entries(hostCases)) {
		const { romBytes } = compileCoroutineTest(body, 3);
		writeFileSync(join(directory, `${name}.rom`), romBytes);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: backend }, {
			sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
		});
		runtime.boot();
		const cpu = runtime.machine.cpu;
		for (let grant = 0; grant < 256 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++grant)
			assert.equal(cpu.runUntilDepth(0, 4096), RunResult.Yielded);
		assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS, 'the authored ROM admitted its managed bank');
		if (name.startsWith('completion_')) {
			exerciseCompletionBoundary(cpu, name);
		} else if (name === 'nested_three_banks') {
			exerciseNestedHistory(runtime);
		} else if (name === 'halted_tooling_call') {
			runGuestToHalt(cpu, 500_000);
			assert.ok(cpu.isHaltedUntilIrq());
			const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
			cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.find('probe')!), cpu.gc));
			let result = RunResult.Yielded, windowFault = false;
			for (let grant = 0; grant < 10_000 && result === RunResult.Yielded; ++grant) {
				result = cpu.runUntilDepth(depth, 17);
				windowFault ||= cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_REGISTER_WINDOW;
			}
			assert.equal(result, RunResult.Halted);
			assert.ok(windowFault, 'the tooling call must take a synchronous window exception over the dormant HALT');
			assert.equal(cpu.activeThread, cpu.rootThread);
			assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('entered')!), valueBool(true));
			assert.ok(cpu.isHaltedUntilIrq() && cpu.getFrameDepth() === depth && cpu.readFramePc(depth - 1) === pc);
			const bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
			runtime.rebootSystem();
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			assert.ok(cpu.isHaltedUntilIrq() && cpu.activeThread === cpu.rootThread);
			cpu.clearHaltUntilIrq();
			runGuestToHalt(cpu, 100_000);
			assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)]);
		} else {
			let result = RunResult.Yielded, admitted = false;
			const ready = cpu.stringPool.find('interrupt_ready')!;
			for (let grant = 0; grant < 20000 && result === RunResult.Yielded; grant++) {
				if (!admitted && cpu.activeThread !== cpu.rootThread && cpu.getFrameDepth() !== 0
					&& !cpu.fixedInterruptActive() && cpu.getGlobalByKey(ready) === valueBool(true)) {
					cpu.requestNonMaskableInterrupt();
					assert.equal(cpu.enterPendingInterrupt(), true);
					admitted = true;
				}
				result = cpu.runUntilDepth(0, 17);
			}
			assert.ok(admitted && result === RunResult.Halted);
			assert.equal(cpu.captureRuntimeState().hardHalted, false);
			assert.equal(cpu.getFrameDepth(), 0);
			assert.equal(cpu.readLuaFaultReasonWord(), 0, 'the outer NMI restores its pre-entry reason');
			assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)]);
		}
	}
	execFileSync(nativeRunner, ['suite', ...Object.keys(hostCases)].flatMap(name => [join(directory, `${name}.rom`), name]), { stdio: 'inherit' });
	console.log(`COROUTINE-PARITY:PASS (${cases.length} batched guest cases and ${Object.keys(hostCases).length} host boundary cases)`);
} finally {
	rmSync(directory, { recursive: true });
}
