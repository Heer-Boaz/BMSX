import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CART_ROM_BASE, CPU_FIXED_STACK_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { gcPressureBody } from '../../helpers/gc_pressure';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-pressure-'));
const management = CPU_FIXED_STACK_BASE - RAM_BASE;
const control = management + HEAP_GC_CONTROL_OFFSET;
// Stock gc_control and its adjacent accounting state, observed only.
const phase = 0, lastEpochWork = 0x60, fullEpochs = 0x8c;
const board = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner', {
		buildDirectory: process.argv[2] ?? join(directory, 'native'),
		configure: ['-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
	});
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '--skiptypecheck', '-respath', 'machine/bios/res', '--debug', '-O3',
		'--output-dir', directory, '--store-dir', join(directory, 'store')], { stdio: 'inherit' });
	const biosPath = join(directory, 'system', 'bmsx-bios.debug.rom'), bios = readFileSync(biosPath);
	const compiled = compileLuaChunkToProgram(parseLuaChunk(gcPressureBody, 'pressure.lua'), [], { entrySource: gcPressureBody, optLevel: 3 });
	const cart = writeTestBlua32Rom(linkCartBlua32Image(readBlua32BiosImports(bios), encodeCompiledProgramObject(compiled),
		compiled.metadata, CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes));
	const cartPath = join(directory, 'pressure.rom');
	writeFileSync(cartPath, cart);

	const runtime = new Runtime({
		systemRomBytes: bios, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter,
	}, board);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine;
	for (let grant = 0; grant < 2048 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++grant) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
	}
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(cpu.isHaltedUntilIrq(), true, 'the cartridge finished control and reference warmup');
	const commands: string[] = [], rows: string[] = [];
	const grant = (cycles: number) => {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		assert.equal(cpu.readLuaFaultReasonWord(), 0, `guest fault at ${cpu.readEpcWord().toString(16)}`);
		commands.push(`E ${cycles}`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	};
	function runToWait() {
		let result = RunResult.Yielded;
		for (let i = 0; i < 4096 && result === RunResult.Yielded; ++i) result = grant(65536);
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.isHaltedUntilIrq(), true);
	}
	cpu.clearHaltUntilIrq();
	runToWait();
	const priorFullEpochs = memory.readRamRecordWord(control + fullEpochs);
	const history = new RamHistory();
	history.start(memory);
	const baseline = history.capture(memory, null);
	cpu.clearHaltUntilIrq();
	for (let i = 0; i < 65536 && (memory.readRamRecordByte(control + phase) & 7) !== 3; ++i)
		assert.equal(grant(251), RunResult.Yielded, 'pressure must reach the BIOS final pass before the third wait');
	assert.equal(memory.readRamRecordByte(control + phase) & 7, 3, 'the allocator admitted live final-mark work');
	assert.ok(cpu.fixedInterruptActive(), 'the window exception has not yet returned to the cartridge');

	const partial = history.capture(memory, baseline), checkpoint = captureRuntimeCheckpointState(runtime);
	const portable = captureRuntimeSaveState(runtime);
	const tsPath = join(directory, 'partial.ts'), nativePath = join(directory, 'partial.native'), trace = join(directory, 'trace');
	writeFileSync(tsPath, encodeRuntimeSaveState(portable));
	commands.length = rows.length = 0;
	const fingerprint = () => {
		const data = memory.ramData();
		commands.push(`H 0 ${data.length}`);
		rows.push(String(hashBytes(data, 0, data.length)));
	};
	function finish() {
		runToWait();
		assert.ok(memory.readRamRecordWord(control + lastEpochWork) > 0, 'guest allocation finished an epoch');
		assert.equal(memory.readRamRecordWord(control + fullEpochs), priorFullEpochs, 'no emergency full collection');
		fingerprint();
		cpu.clearHaltUntilIrq();
		commands.push('h');
		assert.equal(grant(65536), RunResult.Halted);
		assert.equal(cpu.isHaltedUntilIrq(), false);
		assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)], 'guest verifies field, array, capture, weak and String edges');
		commands.push('c');
		rows.push('1 2 0');
		fingerprint();
	}

	finish();
	const tail = commands.slice(), expected = rows.slice();
	const end = history.capture(memory, partial);
	history.restore(memory, end, partial);
	applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
	commands.length = rows.length = 0;
	finish();
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);

	writeFileSync(trace, ['X', `x ${nativePath}`, 'l', 's', ...tail, 'u', ...tail].join('\n'));
	assert.deepEqual(execFileSync(native, [biosPath, trace, tsPath, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'),
		[...expected, ...expected]);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish();
	assert.deepEqual(rows, expected);
	console.log('GC-PRESSURE-PARITY:PASS (stock cartridge, paced final mark, portable state and rewind on both cores)');
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Pressure evidence retained at ${directory}`);
	throw error;
}
