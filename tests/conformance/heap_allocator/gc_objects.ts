import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ThreadLayout, ThreadRecords } from '../../../machine/ts/machine/cpu/thread_record';
import { RAM_BASE, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/spec/bmsx/memory_map';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_OBJECT_PREFIX } from '../../../toolchain/ts/firmware/stock_object_layout';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../helpers/firmware_heap_layout';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const source = `
local sweep<const> = require('kernel/gc_sweep_quantum').sweep_quantum
bss report: u32[2]
while report[0] == 0 do halt_until_irq end
report[1] = sweep(report[0], 1, 0, 0)
while true do halt_until_irq end
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-objects-'));
try {
	const machine = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const oracle = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const system = linkManagedTestSystem(source, opt), romBytes = writeTestBlua32Rom(system);
		const rom = join(directory, `system-O${opt}.rom`), initial = join(directory, `before-O${opt}.state`);
		const nativePartial = join(directory, `native-partial-O${opt}.state`), tsPartial = join(directory, `ts-partial-O${opt}.state`);
		const report = system.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'report')!.address!;
		writeFileSync(rom, romBytes);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		runGuestToHalt(cpu, 4_194_304);
		assert.ok(cpu.isHaltedUntilIrq());

		// Reserve the ordinary register window before taking the common seed,
		// so the guest and oracle see the same arena for the sweep quantum.
		const stack = cpu.rootThread;
		cpu.requestRegisterWindow(512, 64, scheduler.cyclesUntilDeadline());
		runGuestToHalt(cpu, 65_536, stack.frameDepth - 1);
		assert.ok(cpu.isHaltedUntilIrq());
		assert.ok(stack.stackRegisters.capacity() >= 512);

		const { gc, heapAllocator: arena, stringPool } = nativeHeapReference(cpu);
		const management = arena.managementOffset(), floor = memory.ramBusEnd() - RAM_BASE;
		const control = management + HEAP_GC_CONTROL_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		const table = createReferenceTable(cpu, 3, 8), colorShift = 8 * GC_COLOR_OFFSET;
		const header = (memory.readRamRecordWord(table) & ~(GC_COLOR_MASK << colorShift)) | ((gc.white() ^ 1) << colorShift);
		memory.writeRamRecordWord(table, header);
		memory.writeRamRecordWord(control, (memory.readRamRecordWord(control) & ~0xff) | GcPhase.Sweep);
		memory.writeRamRecordWord(control + SWEEP_LINK, control + OBJECT_HEAD);
		const inventory = memory.readRamRecordWord(control + OBJECT_COUNT);
		gc['beginPaceCredit'](inventory + stringPool.estimateSweepWork(), 0);
		const charge = memory.readRamRecordWord(occupied);
		const reportOffset = report - RAM_BASE;
		const ranges = [[floor, management], [control, management + GC_WORKSPACE_END]];
		const verify = ranges.map(([first, end]) => `H ${first} ${end}`);
		// The reference sweeps RAM without running a CPU. Its copies of the
		// caller's stack and frames therefore cannot be compared with a CALL.
		const layout = new ThreadLayout();
		new ThreadRecords(memory).readLayout(stack.address, layout);
		const execution = [
			[layout.offset, layout.offset + layout.capacity * THREAD_STACK_SLOT_BYTES],
			[layout.frameOffset, layout.frameOffset + layout.frames * FRAME_CONTROL_BYTES],
		].sort(([a], [b]) => a - b);
		const referenceRanges = [[floor, execution[0][0]], [execution[0][1], execution[1][0]],
			[execution[1][1], management], ranges[1]];
		const hashes = (regions = ranges) => regions.map(([first, end]) => String(hashBytes(memory.ramData(), first, end - first)));
		writeFileSync(initial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));

		function run(runner: string, name: string, commands: string[], checkpoint = initial) {
			const trace = join(directory, `trace-O${opt}-${name}.txt`);
			writeFileSync(trace, ['X', ...commands].join('\n'));
			return execFileSync(runner, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n');
		}
		const reference = run(oracle, 'reference', [`z ${table}`, ...referenceRanges.map(([first, end]) => `H ${first} ${end}`)]);
		assert.equal(reference[0], '1', 'the native sweep processes its one-Table quantum');

		const commands = [`W ${report} ${management}`, 'h', 'l'], expected: string[] = [];
		memory.writeRamRecordWord(report, management);
		cpu.clearHaltUntilIrq();
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			assert.ok(used > 0);
			assert.equal(result, cpu.isHaltedUntilIrq() ? RunResult.Halted : RunResult.Yielded);
			return `${result} ${used} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`;
		}
		function reach(condition: () => boolean) {
			for (let n = 0; n < 16384 && !condition(); ++n) {
				assert.ok(!cpu.isHaltedUntilIrq(), `sweep halted before the expected store (reason=${cpu.readLuaFaultReasonWord()}, report=${memory.readRamRecordWord(report + 4)})`);
				commands.push('E 1');
				expected.push(grant(1));
			}
			assert.ok(condition());
		}
		reach(() => memory.readRamRecordWord(occupied) !== charge);
		assert.equal(memory.readRamRecordWord(occupied), charge - TableRecords.allocationCharge(0, 8),
			'hash storage is released before array storage');
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory);
		commands.push(...verify);
		expected.push(...hashes());
		reach(() => memory.readRamRecordByte(table) === 0);
		assert.equal(memory.readRamRecordWord(table), header & ~0xff);
		assert.ok(arena.issuedObjectStart(table - RAM_BASE - GC_OBJECT_PREFIX), 'kind clears before arena release');
		assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), control + OBJECT_HEAD, 'cursor is unpublished at kind clear');
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory);
		assert.equal(memory.readRamRecordWord(report + 4), 0, 'the ordinary CALL has not returned');
		const partial = captureRuntimeSaveState(runtime), intermediate = hashes();
		writeFileSync(tsPartial, encodeRuntimeSaveState(partial));
		const finishCommands = ['E 65536', ...verify, `H ${reportOffset + 4} ${reportOffset + 8}`];
		function finish() {
			const outcome = grant(65_536);
			assert.ok(cpu.isHaltedUntilIrq());
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(memory.readRamRecordWord(report + 4), 1);
			return [outcome, ...hashes(), String(hashBytes(memory.ramData(), reportOffset + 4, 4))];
		}
		const final = finish();
		assert.deepEqual(hashes(referenceRanges), reference.slice(1),
			'physical arena, logical charge, sweep frontier and epoch pacing match the frozen C++ collector');
		const guest = run(machine, 'guest', [...commands, `x ${nativePartial}`, 's', ...verify,
			...finishCommands, 'u', ...finishCommands]);
		assert.deepEqual(guest, [...expected, ...intermediate, ...final, ...final],
			'both cores suspend at the same stores and native rewind replays the quantum');
		assert.deepEqual(run(machine, 'ts-to-native', finishCommands, tsPartial), final);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.deepEqual(finish(), final, 'native-to-TS restore at kind clear reproduces bytes and cycles');

		console.log(`BIOS-GC-OBJECTS:PASS O${opt} (C++ hash-first sweep, ordinary guest CALL, portable kind-clear checkpoint and rewind)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
