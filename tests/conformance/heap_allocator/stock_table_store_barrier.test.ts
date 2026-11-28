import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import { stockHeapManagementOffset } from '../../../toolchain/ts/firmware/stock_heap_layout';
import { StockStringIndex } from '../../../toolchain/ts/firmware/stock_string_index';
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
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../helpers/firmware_heap_layout';

const enum CollectorField { Phase = 0, White = 1, TraceHead = 4, ChangedHead = 8, TraceRecord = 0x34, TraceCursor = 0x38, ModeMeta = 0x4c, ModeNode = 0x50 }
const markAgain = 2, arenaOccupiedOffset = 0x400 + 0x1ac;
const hashSlots = 4;
const home = (key: number) => hashCanonicalTableKey(valueInteger(key)) & (hashSlots - 1);
const negativeKeys = Array.from({ length: 64 }, (_, i) => -i - 1);
const [anchor, displaced] = negativeKeys.filter(key => home(key) === 0);
const incoming = negativeKeys.find(key => home(key) === 3)!;
const source = `bss command: word
store_subject = {2, edge = 14}
store_reference = {}
-- The nil field requests the four-slot hash lane without claiming a node.
displacement_subject = { [${anchor}] = 11, [${displaced}] = 22, [${incoming}] = nil }
store_key = ${incoming}
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
	subject = displacement_subject
	subject[store_key] = 77
	return subject[store_key]
end`;
const board = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('stock table stores leave marked reference writes and displaced-node collisions to the BIOS', async t => {
	t.mock.method(WebAssembly, 'Instance', () => assert.fail('stock table stores must not instantiate the allocator oracle'));
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
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const [label, mode, op] of [['array reference', 1, OpCode.SETI], ['hash reference', 2, OpCode.SETFIELD],
		['scalar displacement', 3, OpCode.SETT]] as const) await t.test(label, () => {
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, board);
		runtime.boot();
		const { cpu, memory, gxGpu, scheduler } = runtime.machine;
		const { tables } = cpu;
		for (let i = 0; i < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++i) {
			if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
			runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
		}
		assert.equal(cpu.activeCartridgeSlot(), 0);
		assert.ok(cpu.isHaltedUntilIrq());
		const strings = new StockStringIndex(memory);
		const reference = valuePayload(readStockGlobalValue(memory, strings.find('store_reference')!));
		const receiver = valuePayload(readStockGlobalValue(memory, strings.find(mode === 3 ? 'displacement_subject' : 'store_subject')!));
		const key = mode === 2 ? valueString(strings.find('edge')!) : valueInteger(mode === 3 ? incoming : 1);
		if (mode === 3) {
			assert.equal(tables.hashSize(receiver), hashSlots);
			const words = tables.hashAddress(receiver);
			assert.equal(memory.readRamRecordWord(words), anchor >>> 0);
			assert.equal(memory.readRamRecordWord(words + 3 * 4), displaced >>> 0, 'guest populated the displaced home-3 node');
			assert.equal(tables.get(receiver, key), valueNil(), 'the incoming key does not already exist');
		}
		const management = stockHeapManagementOffset(memory), control = management + HEAP_GC_CONTROL_OFFSET;
		const occupiedOffset = management + arenaOccupiedOffset, chargeOffset = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		const recolor = (record: number, shade: number) => memory.writeRamRecordByte(record + GC_COLOR_OFFSET,
			(memory.readRamRecordByte(record + GC_COLOR_OFFSET) & ~GC_COLOR_MASK) | shade);
		const color = (record: number) => memory.readRamRecordByte(record + GC_COLOR_OFFSET) & GC_COLOR_MASK;
		memory.writeRamRecordByte(control + CollectorField.Phase, (memory.readRamRecordByte(control + CollectorField.Phase) & ~7) | markAgain);
		recolor(reference, memory.readRamRecordByte(control + CollectorField.White) & 1);
		recolor(receiver, 3);
		memory.writeRamRecordWord(control + CollectorField.TraceHead, 0);
		memory.writeRamRecordWord(control + CollectorField.ChangedHead, 0);
		memory.writeRamRecordPair(control + CollectorField.TraceRecord, mode === 3 ? receiver : 0, mode === 3 ? 2 : 0);
		memory.writeRamRecordPair(control + CollectorField.ModeMeta, mode === 3 ? receiver : 0, mode === 3 ? 3 : 0);
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
			assert.equal(tables.getInteger(receiver, 1), valueInteger(61), 'the preceding scalar array write stayed direct');
			assert.equal(color(receiver), 3);
		}
		const issuePc = cpu.readFramePc(depth), issue = readInstruction(), next = issue.pc + INSTRUCTION_BYTES;
		assert.equal(issue.op, op);
		const previous = tables.get(receiver, key);
		const allocated = memory.readRamRecordWord(occupiedOffset), charged = memory.readRamRecordWord(chargeOffset);
		const hashAddress = tables.hashAddress(receiver) - RAM_BASE;
		const hashBytesCount = TableRecords.hashStorageBytes(tables.hashSize(receiver));
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
		const node = packet.registers.get(5), hash = tables.hashSize(receiver);
		assert.equal(node, valueInteger(mode === 1 ? -2 : mode === 3 ? -1 : hashCanonicalTableKey(key) & (hash - 1)));
		assert.equal(tables.get(receiver, key), previous, 'neither Value lane was published by the issuer');
		assert.equal(color(receiver), 3);
		assert.equal(memory.readRamRecordWord(control + CollectorField.TraceRecord), mode === 3 ? receiver : 0);
		assert.equal(hashBytes(memory.ramData(), hashAddress, hashBytesCount), previousHash);
		const stopped = snapshot('partial'), portable = join(directory, `${mode}-cpp.state`);
		const prefix = commands.length, rowPrefix = rows.length;
		const finish = () => {
			for (let i = 0; i < 4096 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.readEpcWord(), next);
			assert.equal(cpu.readFramePc(depth), next);
			assert.equal(memory.readRamRecordWord(occupiedOffset), allocated);
			assert.equal(memory.readRamRecordWord(chargeOffset), charged);
			if (mode === 3) {
				assert.equal(memory.readRamRecordWord(control + CollectorField.TraceRecord), 0);
				assert.equal(memory.readRamRecordWord(control + CollectorField.TraceCursor), 0);
				assert.equal(memory.readRamRecordWord(control + CollectorField.ModeMeta), 0);
				assert.equal(memory.readRamRecordWord(control + CollectorField.ModeNode), 0);
				assert.equal(memory.readRamRecordWord(control + CollectorField.ChangedHead), (receiver - RAM_BASE) >>> GC_RECORD_SHIFT);
				assert.equal(color(receiver), 2);
				assert.equal(tables.get(receiver, valueInteger(anchor)), valueInteger(11));
				assert.equal(tables.get(receiver, valueInteger(displaced)), valueInteger(22));
				assert.equal(tables.get(receiver, key), valueInteger(77));
			} else {
				assert.equal(memory.readRamRecordWord(control + CollectorField.TraceHead), (reference - RAM_BASE) >>> GC_RECORD_SHIFT);
				assert.equal(memory.readRamRecordWord(control + CollectorField.ChangedHead), 0);
				assert.equal(color(reference), 2);
				assert.equal(tables.get(receiver, key), valueTable(reference));
			}
			for (const [first, length] of [[control, CollectorField.ModeNode + 4], [receiver - RAM_BASE, TableRecords.HEADER_BYTES],
				[hashAddress, hashBytesCount], [occupiedOffset, 4], [chargeOffset, 4]]) {
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
