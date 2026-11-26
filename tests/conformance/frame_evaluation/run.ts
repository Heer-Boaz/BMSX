import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asClosure, valueBool, valueInteger, valueNil } from '../../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileFrameEvaluationCaseRom, frameEvaluationCases } from '../../helpers/frame_evaluation';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { runGuestToHalt } from '../../helpers/cpu_test_harness';
import { runSystemCaseRom } from '../../helpers/system_case_rom';

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--case'), 'Expected no arguments or --case <name>');
const cases = Object.entries(frameEvaluationCases).filter(([name]) => args.length === 0 || name === args[1]);
assert.ok(cases.length !== 0, 'The selected frame-evaluation case exists');

const nativeRunner = nativeConformanceRunner('bmsx_frame_evaluation_runner', { parallel: '2' });
const directory = mkdtempSync(join(tmpdir(), 'bmsx-frame-evaluation-'));
try {
	const expectedSuspensions = cases.filter(([name]) => name === 'coroutine' || name === 'completion_injection').length;
	for (const optLevel of [0, 3] as const) {
		const { romBytes } = compileFrameEvaluationCaseRom(cases, optLevel);
		const path = join(directory, `firmware-frame-O${optLevel}.rom`);
		writeFileSync(path, romBytes);
		const suspensions = runSystemCaseRom(romBytes, runtime => {
			const cpu = runtime.machine.cpu;
			const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
			const bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
			runtime.rebootSystem();
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			assert.ok(cpu.isHaltedUntilIrq(), 'restore recovers the original parked activation');
			assert.equal(cpu.getFrameDepth(), depth);
			assert.equal(cpu.readFramePc(depth - 1), pc);
			if (cpu.getGlobalByKey(cpu.stringPool.find('fixture_inject_completion')!) === valueBool(true)) {
				cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.find('stopped_probe')!), cpu.gc), [valueInteger(depth - 1)]);
				runGuestToHalt(cpu, 1_000_000, depth);
				assert.deepEqual(runtime.readCompletionValues(), [valueBool(true), valueInteger(43), valueNil(), valueBool(false)]);
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(cpu.readFramePc(depth - 1), pc);
				assert.ok(cpu.isHaltedUntilIrq(), 'completion evaluates a parked scope without resuming it');
			}
		}, undefined, 64);
		assert.equal(suspensions, expectedSuspensions);
		const result = execFileSync(nativeRunner, [path, 'frame'], { encoding: 'utf8' });
		assert.equal(result.trim(), String(expectedSuspensions), 'native restored the same suspended cases');
	}
	rmSync(directory, { recursive: true });
	console.log(`FRAME-EVALUATION-PARITY:PASS (${cases.length} cases at O0/O3, including suspended scope restore and completion)`);
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
