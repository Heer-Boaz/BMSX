import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_FIXED_STACK_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { gcStressVectors } from '../../helpers/gc_stress';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { systemCaseSource } from '../../helpers/system_case_rom';

const native = nativeConformanceRunner('bmsx_machine_conformance_runner', {
	buildDirectory: process.argv[2] ?? join('tmp', 'gc-stress-native'),
	configure: ['-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
	parallel: '3',
});
const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-stress-'));
const input = {
	sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
};

try {
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '--skiptypecheck', '-respath', 'machine/bios/res', '--debug', '-O3',
		'--output-dir', directory, '--store-dir', join(directory, 'store')], { stdio: 'inherit' });
	const systemPath = join(directory, 'system', 'bmsx-bios.debug.rom'), system = readFileSync(systemPath);
	const cases = Object.entries(gcStressVectors).map(([name, body], index): [string, string] =>
		[name, `stress_progress[0] = ${index + 1}\n${body}`]);
	const source = `bss stress_progress: word[1]
mem[${IO_IRQ_MASK}] = 0
stress_progress[0] = -1
halt_until_irq
${systemCaseSource(cases)}`;
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'gc-stress.lua'), [], { entrySource: source, optLevel: 3 });
	const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program),
		program.metadata, CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const cart = writeTestBlua32Rom(linked), cartPath = join(directory, 'stress.rom');
	writeFileSync(cartPath, cart);

	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart),
			machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: backend }, input);
		runtime.boot();
		const { cpu, memory, scheduler, gxGpu } = runtime.machine;
		const progress = () => memory.readRamRecordWord(linked.layout.header.bssAddress);
		const control = CPU_FIXED_STACK_BASE + HEAP_GC_CONTROL_OFFSET;
		const phase = () => memory.readRamRecordByte(control) & 7;
		const caseName = () => progress() === 0xffffffff ? 'startup' : cases[progress() - 1][0];
		for (let i = 0; i < 1024 && (progress() !== 0xffffffff || !cpu.isHaltedUntilIrq()); ++i) {
			if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
			runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
		}
		assert.equal(progress(), 0xffffffff, 'stock BIOS starts the cartridge');
		assert.equal(cpu.activeCartridgeSlot(), 0);
		assert.ok(cpu.isHaltedUntilIrq());
		cpu.clearHaltUntilIrq();

		const initial = join(directory, `${backend}-initial.state`);
		const tsMiddle = join(directory, `${backend}-ts-middle.state`);
		const nativeMiddle = join(directory, `${backend}-native-middle.state`);
		const trace = join(directory, `${backend}.trace`);
		writeFileSync(initial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		const commands = ['X', 'l'], rows: string[] = [];
		function observe(command: string, row?: string | number) {
			commands.push(command);
			if (row !== undefined) rows.push(String(row));
		}
		function grant(cycles: number) {
			const run = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			observe(`E ${cycles}`, `${run} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			if (run === RunResult.Halted)
				assert.equal(cpu.captureRuntimeState().hardHalted, false,
					`${caseName()}: hard halt (reason ${cpu.readLuaFaultReasonWord()}, PC 0x${cpu.lastPc.toString(16)})`);
			return run;
		}
		function fingerprint() {
			const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
			const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
			observe('P', `${depth} ${pc}`);
			observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first));
		}
		function replay(state: string, operations: string[], expected: string[]) {
			writeFileSync(trace, operations.join('\n'));
			const rows = execFileSync(native, [systemPath, trace, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(rows.length, expected.length);
			const mismatch = rows.findIndex((row, index) => row !== expected[index]);
			assert.equal(mismatch, -1, `native row ${mismatch}: ${rows[mismatch]} versus ${expected[mismatch]}`);
		}

		const grants = [1, 17, 2048];
		for (let i = 0; i < 4096 && !(phase() !== 0 && cpu.fixedInterruptActive() && progress() > 0); ++i) {
			assert.equal(grant(grants[i % grants.length]), RunResult.Yielded, `before the live collection: ${caseName()}`);
		}
		assert.ok(phase() !== 0 && cpu.fixedInterruptActive() && progress() > 0, 'suspend inside actual BIOS collection');
		const checkpoint = captureRuntimeSaveState(runtime);
		const partial = history.capture(memory, baseline);
		writeFileSync(tsMiddle, encodeRuntimeSaveState(checkpoint));
		observe('s');
		observe(`x ${nativeMiddle}`);
		const commandCut = commands.length, rowCut = rows.length;
		const phaseAtStop = phase(), pcAtStop = cpu.readFramePc(cpu.getFrameDepth() - 1);
		const advance = () => {
			assert.equal(grant(2048), RunResult.Yielded);
			assert.ok(phase() !== phaseAtStop || cpu.readFramePc(cpu.getFrameDepth() - 1) !== pcAtStop);
			fingerprint();
		};
		advance();
		const suffix = commands.slice(commandCut), suffixRows = rows.slice(rowCut);
		history.restore(memory, history.capture(memory, partial), partial);
		applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
		observe('u');
		assert.equal(phase(), phaseAtStop);
		assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), pcAtStop);
		const repeat = rows.length;
		advance();
		assert.deepEqual(rows.slice(repeat), suffixRows);

		let result = RunResult.Yielded;
		for (let i = 0; i < 16_384 && result === RunResult.Yielded; ++i) {
			result = grant(65_536);
			if (result === RunResult.Halted) assert.equal(cpu.isHaltedUntilIrq(), false, `${caseName()}: unexpected guest wait`);
		}
		assert.equal(result, RunResult.Halted);
		assert.equal(progress(), cases.length, `completed every vector (${caseName()})`);
		const completion = runtime.readCompletionValues();
		assert.deepEqual(completion, [valueBool(true), valueBool(true)]);
		observe('c', [completion.length, ...completion.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		replay(initial, commands, rows);
		replay(tsMiddle, ['X', ...suffix], suffixRows);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeMiddle), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands.length = rows.length = 0;
		advance();
		assert.deepEqual(commands, suffix);
		assert.deepEqual(rows, suffixRows);
		console.log(`GC-STRESS-PARITY:PASS (${cases.length} stock cartridge vectors, TS backend ${backend}, C++ replay, portable restore and live GC rewind)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained at ${directory}`);
	throw error;
}
