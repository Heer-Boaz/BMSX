import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_RECORD_SHIFT } from '../../../toolchain/ts/firmware/stock_object_layout';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { hashCanonicalTableKey, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_STORAGE_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_CHANGED_HEAD, GC_MODE_META, GC_MODE_NODE, GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';

const source = `bss command: word
store_subject = {2, edge = 14}
store_reference = {}
store_key = 0
mem[${IO_IRQ_MASK}] = 0
while *command == 0 do halt_until_irq end
local subject, value = store_subject, store_reference
if *command == 1 then
	subject[1] = value
	return subject[1], #subject
elseif *command == 2 then
	subject[1] = 61
	subject.edge = value
	return subject.edge, subject[1]
else
	subject[store_key] = 77
	return subject[store_key]
end`;
const board = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('stock table stores leave marked reference writes and displaced-node collisions to the BIOS', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-table-reference-window-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', '-O3', '--output-dir', directory,
		'--store-dir', join(directory, 'store')], { encoding: 'utf8' });
	const systemPath = join(directory, 'system', 'bmsx-bios.debug.rom'), system = readFileSync(systemPath);
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'table-store.lua'), [], { entrySource: source, optLevel: 3 });
	const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const cart = writeTestBlua32Rom(linked), cartPath = join(directory, 'cart.rom');
	writeFileSync(cartPath, cart);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const [label, mode, op] of [['array reference', 1, OpCode.SETI], ['hash reference', 2, OpCode.SETFIELD],
		['scalar displacement', 3, OpCode.SETT]] as const) await t.test(label, () => {
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, board);
		runtime.boot();
		const { cpu, memory, gxGpu, scheduler } = runtime.machine, { gc, heapAllocator: arena } = nativeHeapReference(cpu);
		for (let i = 0; i < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++i) {
			if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
			runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
		}
		assert.equal(cpu.activeCartridgeSlot(), 0);
		assert.ok(cpu.isHaltedUntilIrq());
		const name = (identifier: string) => nativeHeapReference(cpu).stringPool.find(identifier)!;
		const reference = valuePayload(readStockGlobalValue(cpu.memory, name('store_reference')));
		let receiver = valuePayload(readStockGlobalValue(cpu.memory, name('store_subject')));
		let key = mode === 2 ? valueString(name('edge')) : valueInteger(1);
		const count = 4, home = (value: number) => hashCanonicalTableKey(value) & (count - 1);
		let anchor = valueNil(), displaced = valueNil();
		if (mode === 3) {
			// Fill index 0 and the last free node (3) with keys belonging to
			// home 0. A new home-3 key must displace the previous occupant.
			const negative = Array.from({ length: 64 }, (_, i) => valueInteger(-i - 1));
			[anchor, displaced] = negative.filter(k => home(k) === 0);
			key = negative.find(k => home(k) === 3)!;
			receiver = createReferenceTable(cpu, 0, count);
			gc.tables.set(receiver, anchor, valueInteger(11));
			gc.tables.set(receiver, displaced, valueInteger(22));
			setReferenceGlobal(cpu, name('store_subject'), valueTable(receiver));
			setReferenceGlobal(cpu, name('store_key'), key);
			assert.equal(memory.readRamRecordWord(gc.tables.hashAddress(receiver) + 3 * 4), valuePayload(displaced));
		}
		const control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const recolor = (record: number, shade: number) => memory.writeRamRecordByte(record + GC_COLOR_OFFSET,
			(memory.readRamRecordByte(record + GC_COLOR_OFFSET) & ~GC_COLOR_MASK) | shade);
		const color = (record: number) => memory.readRamRecordByte(record + GC_COLOR_OFFSET) & GC_COLOR_MASK;
		memory.writeRamRecordByte(control, (memory.readRamRecordByte(control) & ~7) | GcPhase.MarkAgain);
		recolor(reference, gc.white());
		recolor(receiver, 3);
		memory.writeRamRecordWord(control + GC_TRACE_HEAD, 0);
		memory.writeRamRecordWord(control + GC_CHANGED_HEAD, 0);
		memory.writeRamRecordPair(control + GC_TRACE_RECORD, mode === 3 ? receiver : 0, mode === 3 ? 2 : 0);
		memory.writeRamRecordPair(control + GC_MODE_META, mode === 3 ? receiver : 0, mode === 3 ? 3 : 0);
		const depth = cpu.getFrameDepth() - 1, owner = cpu.activeThread.address;
		const readInstruction = () => decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, cpu.readFramePc(depth));
		memory.writeMappedWord(linked.layout.header.bssAddress, mode);
		cpu.clearHaltUntilIrq();
		const commands = ['X'], rows: string[] = [];
		const grant = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			commands.push(`E ${cycles}`);
			rows.push([result, cycles - cpu.instructionBudgetRemaining, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
			return result;
		};
		for (let i = 0; i < 128 && readInstruction().op !== op; ++i) grant(1);
		if (mode === 2) {
			assert.equal(gc.tables.getInteger(receiver, 1), valueInteger(61), 'the preceding scalar array write stayed direct');
			assert.equal(color(receiver), 3);
		}
		const issuePc = cpu.readFramePc(depth), issue = readInstruction(), next = issue.pc + INSTRUCTION_BYTES;
		assert.equal(issue.op, op);
		const previous = gc.tables.get(receiver, key), allocated = arena.occupiedBytes(), charged = nativeHeapReference(cpu).luaHeap.usedBytes();
		const hashAddress = gc.tables.hashAddress(receiver) - RAM_BASE;
		const hashBytesCount = TableRecords.hashStorageBytes(gc.tables.hashSize(receiver));
		const previousHash = hashBytes(memory.ramData(), hashAddress, hashBytesCount);
		const snapshot = (label: string) => {
			const path = join(directory, `${mode}-${label}.state`);
			writeFileSync(path, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			return path;
		};
		const seed = snapshot('seed');
		commands.length = 1;
		rows.length = 0;
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[op]);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
		assert.equal(cpu.readEpcWord(), issuePc);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
		assert.equal(cpu.readThreadFrameWord(owner, depth, FrameField.Pc), next);
		const packet = cpu.activeThread.currentFrame!;
		assert.equal(packet.argumentCount, 6);
		assert.deepEqual([0, 1, 2].map(i => packet.registers.get(i)), [
			valueTable(receiver), key, mode === 3 ? valueInteger(77) : valueTable(reference),
		]);
		const node = packet.registers.get(5), hash = gc.tables.hashSize(receiver);
		assert.equal(node, valueInteger(mode === 1 ? -2 : mode === 3 ? -1 : hashCanonicalTableKey(key) & (hash - 1)));
		assert.equal(gc.tables.get(receiver, key), previous, 'neither Value lane was published by the issuer');
		assert.equal(color(receiver), 3);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), mode === 3 ? receiver : 0);
		assert.equal(hashBytes(memory.ramData(), hashAddress, hashBytesCount), previousHash);
		const stopped = snapshot('partial'), portable = join(directory, `${mode}-cpp.state`);
		const prefix = commands.length, rowPrefix = rows.length;
		const finish = () => {
			for (let i = 0; i < 4096 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.readEpcWord(), next);
			assert.equal(cpu.readFramePc(depth), next);
			assert.equal(arena.occupiedBytes(), allocated);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), charged);
			if (mode === 3) {
				assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
				assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), 0);
				assert.equal(memory.readRamRecordWord(control + GC_MODE_META), 0);
				assert.equal(memory.readRamRecordWord(control + GC_MODE_NODE), 0);
				assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), (receiver - RAM_BASE) >>> GC_RECORD_SHIFT);
				assert.equal(color(receiver), 2);
				assert.equal(gc.tables.get(receiver, anchor), valueInteger(11));
				assert.equal(gc.tables.get(receiver, displaced), valueInteger(22));
				assert.equal(gc.tables.get(receiver, key), valueInteger(77));
			} else {
				assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), (reference - RAM_BASE) >>> GC_RECORD_SHIFT);
				assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0);
				assert.equal(color(reference), 2);
				assert.equal(gc.tables.get(receiver, key), valueTable(reference));
			}
			for (const [first, length] of [[control, GC_MODE_NODE + 4], [receiver - RAM_BASE, TableRecords.HEADER_BYTES], [hashAddress, hashBytesCount]]) {
				commands.push(`H ${first} ${first + length}`);
				rows.push(String(hashBytes(memory.ramData(), first, length)));
			}
			assert.equal(grant(4096), RunResult.Halted);
			const result = mode === 3 ? [valueInteger(77)] : [valueTable(reference), valueInteger(mode === 1 ? 1 : 61)];
			assert.deepEqual(runtime.readCompletionValues(), result);
			commands.push('c');
			rows.push([result.length, ...result.flatMap(v => [valueTag(v), valuePayload(v)])].join(' '));
		};
		finish();
		const tail = commands.slice(prefix), tailRows = rows.slice(rowPrefix);
		const replay = (state: string, script: string[], want: string[]) => {
			const trace = join(directory, `${mode}.trace`);
			writeFileSync(trace, script.join('\n'));
			assert.deepEqual(execFileSync(native, [systemPath, trace, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'), want);
		};
		replay(seed, commands, rows);
		replay(stopped, ['X', `x ${portable}`, ...tail], tailRows);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(portable), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands.length = prefix;
		rows.length = rowPrefix;
		finish();
		assert.deepEqual(rows.slice(rowPrefix), tailRows);
	});
});
