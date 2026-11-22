import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asClosure, valueBool, valueInteger, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import type { CompiledRegion } from '../../../machine/ts/machine/cpu/compiled_region';
import { DecodedDispatchOp } from '../../../machine/ts/machine/cpu/execution_image';
import { MAPPED_PAGE_BYTE_SIZE } from '../../../machine/ts/machine/memory/mapped_page';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, BLUA32_FUNCTION_RECORD_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
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
const phases = ['before-bind', 'first-bind', 'first-warm', 'repeat-warm', 'same-shape-bindings',
	'new-topology-bound', 'new-topology-warm', 'new-topology-repeat', 'completed'];
type Evaluator = { function: number; code: number; bytecodeBytes: number; compiled: boolean; regionBytes: number };
const evaluatorLayout = ({ function: address, code, bytecodeBytes }: Evaluator) => ({ address, code, bytecodeBytes });
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
		const run = spawnSync(runner, [romPath, cartPath], { encoding: 'utf8' });
		writeFileSync(`${prefix}.jsonl`, run.stdout);
		writeFileSync(`${prefix}.err`, run.stderr);
		assert.equal(run.status, 0, `${backend} O${optLevel}: ${run.stderr}\n${run.stdout}`);
		const records = run.stdout.trim().split('\n').map(line => JSON.parse(line) as Observation);
		assert.equal(records.length, phases.length);
		for (const record of records) for (let evaluator = 0; evaluator < record.evaluators.length; evaluator++) {
			if (index === 1) assert.equal(record.evaluators[evaluator].compiled, false, 'OFF binary must not emit native code');
			else if (record.phase >= 2)
				assert.equal(record.evaluators[evaluator].compiled, true, 'specific warmed evaluator entry must exist');
		}
		return records;
	});
	for (let phase = 0; phase < phases.length; phase++) {
		assert.equal(observations[0][phase].activeCycles, observations[1][phase].activeCycles, `O${optLevel} ${phases[phase]}: C++ guest cycles`);
		assert.equal(observations[0][phase].remainingCycles, observations[1][phase].remainingCycles, `O${optLevel} ${phases[phase]}: C++ HALT budget`);
		assert.deepEqual(observations[0][phase].evaluators.map(evaluatorLayout), observations[1][phase].evaluators.map(evaluatorLayout),
			`O${optLevel} ${phases[phase]}: firmware evaluator layout must not depend on the backend`);
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
		let retained: CompiledRegion | null = null;
		for (let phase = 0; phase < phases.length; phase++) {
			const grant = 1_000_000;
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Halted, `${name} phase ${phase}`);
			assert.equal(cpu.readLuaFaultReasonWord(), 0, `${name} phase ${phase}: guest fault`);
			activeCycles += grant - cpu.instructionBudgetRemaining;
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			assert.equal(cpu.isHaltedUntilIrq(), phase !== 8);
			if (phase !== 8) assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('fsm_phase')!), valueInteger(phase));
			else assert.deepEqual(runtime.readCompletionValues(), [valueBool(true), valueBool(true)]);
			const reference = observations[0][phase];
			assert.equal(activeCycles, reference.activeCycles, `${name} O${optLevel} ${phases[phase]}: exact guest cycles`);
			assert.equal(cpu.instructionBudgetRemaining, reference.remainingCycles, `${name} O${optLevel} ${phases[phase]}: HALT budget`);
			if (phase >= 1 && phase < 8) {
				const image = cpu.rootThread.currentFrame!.executionImage;
				const cartEnd = CART_ROM_BASE + images.cartRomBytes.length;
				for (let evaluator = 0; evaluator < (phase >= 5 ? 2 : 1); evaluator++) {
					const closure = asClosure(cpu.getGlobalByKey(cpu.stringPool.find(evaluator === 0 ? 'fsm_evaluator' : 'fsm_other')!), cpu.gc);
					const binding = cpu.captureClosureBinding(closure);
					assert.equal(binding.executionDomainId, image.executionDomainId);
					const address = binding.functionAddress;
					const code = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
					const bytecodeBytes = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
					assert.ok(address >= CART_ROM_BASE && address + BLUA32_FUNCTION_RECORD_SIZE <= cartEnd
						&& code >= CART_ROM_BASE && code + bytecodeBytes <= cartEnd);
					assert.deepEqual({ function: address, code, bytecodeBytes },
						{ function: reference.evaluators[evaluator].function, code: reference.evaluators[evaluator].code, bytecodeBytes: reference.evaluators[evaluator].bytecodeBytes });
					if (phase === 1) primaryFunction = address;
					assert.equal(address, primaryFunction, 'different topology binds the same ROM evaluator');
					if (backend === CpuExecutionBackend.JavaScript && phase >= 2) {
						const page = image.compiledCodeLookup!.find(code, 0)!;
						const word = (code & (MAPPED_PAGE_BYTE_SIZE - 1)) / 4;
						const block = page.compiledBlocks!.entries[word]!;
						assert.ok(block, 'specific actual firmware evaluator acquired its generated entry');
						assert.equal(page.dispatchOps[word], DecodedDispatchOp.Compiled);
						if (retained === null) retained = block.region;
						else assert.ok(block.region === retained, `${name} O${optLevel} ${phases[phase]}: retained evaluator region changed`);
					}
				}
				if (phase >= 4) {
					const bindings = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('fsm_bindings')!));
					for (let index = 1; index <= 3; index++)
						assert.equal(cpu.captureClosureBinding(asClosure(cpu.gc.tables.getInteger(bindings, index), cpu.gc)).functionAddress, primaryFunction);
				}
			}
			if (phase !== 8) cpu.clearHaltUntilIrq();
		}
	}
}
console.log('FIRMWARE-FSM-NATIVE-PARITY:PASS (2 ROM optimization levels, 4 backends, 9 checkpoints each)');
