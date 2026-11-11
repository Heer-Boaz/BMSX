import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import type { CompiledRegion } from '../../../machine/ts/machine/cpu/compiled_region';
import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import { DecodedDispatchOp } from '../../../machine/ts/machine/cpu/execution_image';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { MAPPED_PAGE_BYTE_SIZE } from '../../../machine/ts/machine/memory/mapped_page';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, BLUA32_FUNCTION_RECORD_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { cartridgeSlots } from '../../helpers/cartridge';

// Like LuaJIT's production tests, inspect real generated-code owners after normal
// execution, independently from semantic assertions. No instruction hooks/restore.
// https://github.com/tarantool/luajit/blob/8af934d93cf26fb1e9b08b28a8b51833d55fc8e8/test/tarantool-tests/utils/jit/generators.lua
const suppliedRunners = process.argv.slice(2);
const directory = suppliedRunners[2] ?? mkdtempSync(join(tmpdir(), 'bmsx-firmware-fsm-'));
const runners = suppliedRunners.length === 0
	? ['build-firmware-fsm-native/bmsx_firmware_fsm_runner', 'build-firmware-fsm-interpreter/bmsx_firmware_fsm_runner']
	: suppliedRunners.slice(0, 2);
assert.equal(runners.length, 2, 'provide native and genuinely native-OFF runner binaries');
if (suppliedRunners.length === 0) for (const [index, enabled] of ['ON', 'OFF'].entries()) {
	const build = index === 0 ? 'build-firmware-fsm-native' : 'build-firmware-fsm-interpreter';
	for (const args of [
		['-S', 'machine/cpp', '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Debug', '-DBMSX_BUILD_TESTS=ON',
			'-DBMSX_BUILD_LIBRETRO=OFF', '-DBMSX_ENABLE_GLES2=OFF', `-DBMSX_ENABLE_NATIVE_BLOCKS=${enabled}`],
		['--build', build, '--target', 'bmsx_firmware_fsm_runner', '--parallel', '2'],
	]) assert.equal(spawnSync('cmake', args, { stdio: 'inherit' }).status, 0);
}
const phases = ['before-compile', 'compiled-once', 'first-warm', 'repeat-warm', 'same-shape-bindings',
	'new-shape-compiled', 'new-shape-warm', 'new-shape-repeat', 'completed'];
type Evaluator = { function: number; code: number; bytecodeBytes: number; compiled: boolean; regionBytes: number };
type Observation = { phase: number; activeCycles: number; remainingCycles: number; evaluators: Evaluator[] };
console.log(`Firmware FSM evidence: ${directory}`);

for (const optLevel of [0, 3] as const) {
	const body = readFileSync('tests/conformance/frame_evaluation/native_fsm.lua', 'utf8');
	const { images } = compileCartlibProgram(`return pcall(function()\n${body}\nend)`, { optLevel });
	const romPath = join(directory, `fsm-O${optLevel}.system.rom`);
	const cartPath = join(directory, `fsm-O${optLevel}.cart.rom`);
	writeFileSync(romPath, images.systemRomBytes);
	writeFileSync(cartPath, images.cartRomBytes);
	const observations = runners.map((runner, index) => {
		const backend = index === 0 ? 'cpp-native' : 'cpp-interpreter';
		const prefix = join(directory, `O${optLevel}-${backend}`);
		const run = spawnSync(runner, [romPath, cartPath, prefix], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
		writeFileSync(`${prefix}.jsonl`, run.stdout);
		writeFileSync(`${prefix}.err`, run.stderr);
		assert.equal(run.status, 0, `${backend} O${optLevel}: ${run.stderr}\n${run.stdout}`);
		const records = run.stdout.trim().split('\n').map(line => JSON.parse(line) as Observation);
		assert.equal(records.length, phases.length);
		for (const record of records) for (let evaluator = 0; evaluator < record.evaluators.length; evaluator++) {
			if (index === 1) assert.equal(record.evaluators[evaluator].compiled, false, 'OFF binary must not emit native code');
			else if ((evaluator === 0 && record.phase >= 2) || (evaluator === 1 && record.phase >= 6))
				assert.equal(record.evaluators[evaluator].compiled, true, 'specific warmed evaluator entry must exist');
		}
		return records;
	});
	for (let phase = 0; phase < phases.length; phase++) {
		assert.equal(observations[0][phase].activeCycles, observations[1][phase].activeCycles, `O${optLevel} ${phases[phase]}: C++ guest cycles`);
		assert.equal(observations[0][phase].remainingCycles, observations[1][phase].remainingCycles, `O${optLevel} ${phases[phase]}: C++ HALT budget`);
		const native = readFileSync(join(directory, `O${optLevel}-cpp-native.${phase}.state`));
		const interpreter = readFileSync(join(directory, `O${optLevel}-cpp-interpreter.${phase}.state`));
		assert.ok(native.equals(interpreter), `O${optLevel} ${phases[phase]}: complete C++ native/OFF serialized state`);
	}
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const name = backend === CpuExecutionBackend.Interpreter ? 'ts-interpreter' : 'ts-generated';
		const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: backend }, {
			sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {},
		});
		runtime.boot();
		const { cpu, memory } = runtime.machine;
		let primaryFunction = 0, activeCycles = 0;
		const retained: Array<CompiledRegion | null> = [null, null];
		for (let phase = 0; phase < phases.length; phase++) {
			const grant = 100000000;
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Halted, `${name} phase ${phase}`);
			activeCycles += grant - cpu.instructionBudgetRemaining;
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			assert.equal(cpu.isHaltedUntilIrq(), phase !== 8);
			if (phase !== 8) assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('fsm_phase')!), phase);
			else assert.deepEqual(runtime.readCompletionValues(), [true, true]);
			const reference = observations[0][phase];
			assert.equal(activeCycles, reference.activeCycles, `${name} O${optLevel} ${phases[phase]}: exact guest cycles`);
			assert.equal(cpu.instructionBudgetRemaining, reference.remainingCycles, `${name} O${optLevel} ${phases[phase]}: HALT budget`);
			if (phase >= 1 && phase < 8) {
				for (let evaluator = 0; evaluator < (phase >= 5 ? 2 : 1); evaluator++) {
					const closure = cpu.getGlobalByKey(cpu.stringPool.find(evaluator === 0 ? 'fsm_evaluator' : 'fsm_other')!) as Closure;
					const address = closure.functionAddress;
					const code = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
					const bytecodeBytes = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
					assert.ok(address >= DYNAMIC_RAM_BASE && address + BLUA32_FUNCTION_RECORD_SIZE <= RAM_BASE + PSX_MACHINE_SPEC.ramBytes
						&& code >= DYNAMIC_RAM_BASE && code + bytecodeBytes <= RAM_BASE + PSX_MACHINE_SPEC.ramBytes);
					assert.deepEqual({ function: address, code, bytecodeBytes },
						{ function: reference.evaluators[evaluator].function, code: reference.evaluators[evaluator].code, bytecodeBytes: reference.evaluators[evaluator].bytecodeBytes });
					if (phase === 1) primaryFunction = address;
					if (evaluator === 0) assert.equal(address, primaryFunction);
					else assert.notEqual(address, primaryFunction);
					if (backend === CpuExecutionBackend.JavaScript && ((evaluator === 0 && phase >= 2) || (evaluator === 1 && phase >= 6))) {
						const page = cpu.rootThread.currentFrame!.executionImage.compiledCodeLookup!.find(code, 0)!;
						const word = (code & (MAPPED_PAGE_BYTE_SIZE - 1)) / 4;
						const block = page.compiledBlocks!.entries[word]!;
						assert.ok(block, 'specific actual firmware evaluator acquired its generated entry');
						assert.equal(page.dispatchOps[word], DecodedDispatchOp.Compiled);
						if (retained[evaluator] === null) retained[evaluator] = block.region;
						else assert.equal(block.region, retained[evaluator], 'warm evaluator region survives execution, same-shape rebinding and new-shape compilation');
					}
				}
				if (phase >= 4) for (let index = 1; index <= 32; index++)
					assert.equal(((cpu.getGlobalByKey(cpu.stringPool.find('fsm_bindings')!) as Table).getInteger(index) as Closure).functionAddress, primaryFunction);
			}
			const state = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
			writeFileSync(join(directory, `O${optLevel}-${name}.${phase}.state`), state);
			const expected = readFileSync(join(directory, `O${optLevel}-cpp-native.${phase}.state`));
			assert.ok(expected.equals(state), `${name} O${optLevel} ${phases[phase]}: complete TS/C++ serialized state`);
			console.log(JSON.stringify({ optLevel, backend: name, phase: phases[phase], activeCycles,
				stateSha256: createHash('sha256').update(state).digest('hex') }));
			if (phase !== 8) cpu.clearHaltUntilIrq();
		}
	}
}
console.log('FIRMWARE-FSM-NATIVE-PARITY:PASS (2 ROM optimization levels, 4 backends, 9 checkpoints each)');
