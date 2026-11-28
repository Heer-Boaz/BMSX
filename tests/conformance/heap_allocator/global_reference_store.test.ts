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
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_GRAY_INDEX_BITS, GC_RECORD_SHIFT } from '../../../machine/ts/machine/cpu/gc_object';
import { ValueTag, valueInteger, valuePayload, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REFERENCE_STORE, CPU_CAUSE_IRQ } from '../../../machine/ts/spec/blua32/cop0';
import { GLOBAL_BANK_OFFSET, SYSTEM_GLOBAL_BANK_OFFSET } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { readNamespaceBank, runGuestToHalt } from '../../helpers/cpu_execution';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_CHANGED_HEAD, GC_LAST_EPOCH_WORK, GC_REMARK_VISIT_STATE, GC_TRACE_HEAD, GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_MARK_WORK_OFFSET } from '../../helpers/firmware_heap_layout';

const source = `
ordinary_result = 17
irq = 29
source_object = 0
source_text = 0
halt_until_irq
ordinary_result = source_object
irq = source_text
return ordinary_result, irq
`;
const board = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('both global banks leave reference publication and its barrier to the BIOS', t => {
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-global-reference-store-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const rom = writeTestBlua32Rom(linkManagedTestSystem(source, 3));
	const romPath = join(directory, 'system.rom');
	writeFileSync(romPath, rom);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, board);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { gc, heapAllocator: arena } = nativeHeapReference(cpu);
	runGuestToHalt(cpu, 4_194_304);
	assert.ok(cpu.isHaltedUntilIrq());
	const name = (text: string) => nativeHeapReference(cpu).stringPool.find(text)!;
	assert.equal(cpu.getGlobalByKey(name('ordinary_result')), valueInteger(17));
	assert.equal(cpu.getSystemGlobalByKey(name('irq')), valueInteger(29));
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
	const object = createReferenceTable(cpu);
	const string = nativeHeapReference(cpu).stringPool.intern('RAM string only in this conformance setup');
	const references = [valueTable(object), valueString(string)];
	setReferenceGlobal(cpu, name('source_object'), references[0]);
	setReferenceGlobal(cpu, name('source_text'), references[1]);

	const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const markWork = management + HEAP_STRING_MARK_WORK_OFFSET;
	const color = () => memory.readRamRecordByte(object + GC_COLOR_OFFSET) & GC_COLOR_MASK;
	memory.writeRamRecordByte(object + GC_COLOR_OFFSET, (memory.readRamRecordByte(object + GC_COLOR_OFFSET) & ~GC_COLOR_MASK) | gc.white());
	nativeHeapReference(cpu).stringPool.beginReachabilityEpoch();
	const stringMark = memory.readRamRecordByte(string + 1);
	memory.writeRamRecordByte(control, (memory.readRamRecordByte(control) & ~7) | GcPhase.Mark);
	// At the Threads remark cursor a new object goes to Changed, not Trace.
	memory.writeRamRecordWord(control + GC_REMARK_VISIT_STATE, 1 << GC_GRAY_INDEX_BITS);
	memory.writeRamRecordWord(control + GC_CHANGED_HEAD, 0);
	memory.writeRamRecordWord(control + GC_TRACE_HEAD, 0);
	memory.writeRamRecordWord(markWork, 7);
	const epochWork = gc.epochWork();
	const allocated = arena.occupiedBytes(), charged = nativeHeapReference(cpu).luaHeap.usedBytes();
	const depth = cpu.getFrameDepth() - 1, owner = cpu.activeThread.address;
	cpu.clearHaltUntilIrq();
	const snapshot = (label: string) => {
		const path = join(directory, label + '.state');
		writeFileSync(path, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		return path;
	};
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const trace = join(directory, 'run.trace');
	const portable = join(directory, 'native.state');
	const commands = ['X'], rows: string[] = [];
	const replay = (state: string, script: string[], expected: string[]) => {
		writeFileSync(trace, script.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, trace, state], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	};
	const grant = (cycles: number) => {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push([result, cycles - cpu.instructionBudgetRemaining, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
		return result;
	};
	const seed = snapshot('seed');
	for (const [index, opcode, bankOffset, previous] of
		[[0, OpCode.SETGL, GLOBAL_BANK_OFFSET, 17], [1, OpCode.SETSYS, SYSTEM_GLOBAL_BANK_OFFSET, 29]] as const) {
		const instruction = () => decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, cpu.readFramePc(depth));
		for (let step = 0; step < 32 && instruction().op !== opcode; ++step) assert.equal(grant(1), RunResult.Yielded);
		const issue = instruction(), successor = issue.pc + INSTRUCTION_BYTES;
		assert.equal(issue.op, opcode);
		const reference = references[index], kind = valueTag(reference), address = valuePayload(reference);
		const bank = readNamespaceBank(memory, management + bankOffset);
		const wordAddress = bank.values + issue.bx * 4;
		const tagAddress = bank.values + bank.capacity * 4 + issue.bx;
		const word = () => memory.readRamRecordWord(wordAddress - RAM_BASE);
		const tag = () => memory.readRamRecordByte(tagAddress - RAM_BASE);
		const checkBeforeMark = () => {
			if (index === 0) {
				assert.equal(color(), gc.white());
				assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0);
			} else assert.equal(memory.readRamRecordByte(string + 1), stringMark);
			assert.equal(memory.readRamRecordWord(markWork), 7);
			assert.equal(gc.epochWork(), epochWork);
		};
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[opcode]);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REFERENCE_STORE);
		assert.equal(cpu.readEpcWord(), successor);
		assert.equal(cpu.readThreadFrameWord(owner, depth, FrameField.Pc), successor);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
		assert.equal(cpu.readBadAddressWord(), wordAddress);
		const packet = cpu.activeThread.currentFrame!;
		assert.equal(packet.argumentCount, 2);
		assert.equal(packet.registers.get(0), reference);
		assert.equal(packet.registers.get(1), valueInteger(tagAddress));
		assert.equal(word(), previous);
		assert.equal(tag(), ValueTag.Integer);
		checkBeforeMark();

		for (let step = 0; step < 256 && word() === previous; ++step) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(word(), address);
		assert.equal(tag(), ValueTag.Integer, 'payload is written first');
		checkBeforeMark();
		const stopped = snapshot('mid-' + index), commandStart = commands.length, rowStart = rows.length;
		const finish = () => {
			for (let step = 0; step < 32 && tag() === ValueTag.Integer; ++step) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(tag(), kind);
			checkBeforeMark(); // Neither mark occurs until both lanes are visible.
			for (let step = 0; step < 2048 && cpu.fixedInterruptActive(); ++step) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.readFramePc(depth), successor);
			assert.equal(word(), address);
			assert.equal(tag(), kind);
			assert.equal(color(), 2);
			assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), (object - RAM_BASE) >>> GC_RECORD_SHIFT);
			assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), 0);
			assert.equal(memory.readRamRecordByte(string + 1), index === 0 ? stringMark : stringMark ^ 1);
			assert.equal(memory.readRamRecordWord(markWork), index === 0 ? 7 : 0);
			assert.equal(gc.epochWork(), epochWork + (index === 0 ? 0 : 8));
			assert.equal(arena.occupiedBytes(), allocated);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), charged);
			for (const [first, bytes] of [[bank.base - RAM_BASE, bank.capacity * 17], [control, GC_LAST_EPOCH_WORK + 4],
				[markWork, 4], [object - RAM_BASE + GC_COLOR_OFFSET, 1], [string - RAM_BASE + 1, 1]]) {
				commands.push(`H ${first} ${first + bytes}`);
				rows.push(String(hashBytes(memory.ramData(), first, bytes)));
			}
		};
		finish();
		const tail = commands.slice(commandStart), expected = rows.slice(rowStart);
		replay(stopped, ['X', `x ${portable}`, ...tail], expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(portable), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands.length = commandStart;
		rows.length = rowStart;
		finish();
		assert.deepEqual(rows.slice(rowStart), expected);
	}
	assert.equal(grant(4096), RunResult.Halted);
	assert.deepEqual(runtime.readCompletionValues(), references);
	commands.push('c');
	rows.push([references.length, ...references.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	replay(seed, commands, rows);
});

test('stock VBlank returns to the original cartridge PC after a reference store inside its IRQ handler', t => {
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-irq-reference-store-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', '-O3', '--output-dir', directory,
		'--store-dir', join(directory, 'store')], { encoding: 'utf8' });
	const romPath = join(directory, 'system', 'bmsx-bios.debug.rom'), rom = readFileSync(romPath);
	const cartSource = `bss irq_report: u32[3]
mem[${IO_IRQ_MASK}] = 0
mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
irq_reference = {91}
irq_destination = 0
function irq(flags)
	irq_report[0] = irq_report[0] + 1
	irq_destination = irq_reference
	irq_report[1] = irq_destination[1]
	mem[${IO_IRQ_ACK}] = flags & ${IRQ_VBLANK}
end
halt_until_irq
irq_report[2] = 37
halt_until_irq
`;
	const compiled = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'irq-reference.lua'), [], { entrySource: cartSource, optLevel: 3 });
	const linked = linkCartBlua32Image(readBlua32BiosImports(rom), encodeCompiledProgramObject(compiled), compiled.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const cartridge = writeTestBlua32Rom(linked), cartPath = join(directory, 'cart.rom');
	writeFileSync(cartPath, cartridge);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(cartridge), machineModel: PSX_MACHINE_SPEC }, board);
	runtime.boot();
	const { cpu, memory, scheduler, irqController, gxGpu } = runtime.machine;
	for (let i = 0; i < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++i) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
	}
	assert.equal(cpu.activeCartridgeSlot(), 0,
		`cart boot; cause ${cpu.readCauseWord()}, reason ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord().toString(16)}`);
	assert.ok(cpu.isHaltedUntilIrq());
	const report = linked.layout.header.bssAddress;
	const readReport = () => [0, 4, 8].map(offset => memory.readRamRecordWord(report + offset));
	const depth = cpu.getFrameDepth(), originalPc = cpu.readFramePc(depth - 1), owner = cpu.activeThread.address;
	assert.deepEqual(readReport(), [0, 0, 0]);
	const trace = join(directory, 'irq.trace'), seed = join(directory, 'irq.state');
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands = ['X'], rows: string[] = [];
	const grant = (cycles: number) => {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push([result, cycles - cpu.instructionBudgetRemaining, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
		return result;
	};
	memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
	irqController.raise(IRQ_VBLANK);
	commands.push(`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`, `i ${IRQ_VBLANK}`);
	assert.equal(cpu.enterPendingInterrupt(), true);
	commands.push('I');
	rows.push('1');
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
	assert.equal(cpu.readEpcWord(), originalPc);
	let nested = false;
	for (let i = 0; i < 4096 && (cpu.fixedInterruptActive() || cpu.getFrameDepth() !== depth); ++i) {
		assert.equal(grant(1), RunResult.Yielded);
		if (!nested && cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_REFERENCE_STORE) {
			nested = true;
			assert.notEqual(cpu.readEpcWord(), originalPc, 'the nested store latched the cartridge handler successor');
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
			assert.deepEqual(readReport(), [1, 0, 0]);
		}
	}
	assert.ok(nested, 'stock VBlank actually entered the ordinary reference-store vector');
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), originalPc);
	assert.equal(cpu.readEpcWord(), originalPc);
	commands.push('P');
	rows.push(`${depth} ${originalPc}`);
	assert.equal(grant(4096), RunResult.Halted);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.deepEqual(readReport(), [1, 91, 37]);
	assert.equal(irqController.enabledPendingFlags(), 0);
	commands.push(`H ${report - RAM_BASE} ${report - RAM_BASE + 12}`);
	rows.push(String(hashBytes(memory.ramData(), report - RAM_BASE, 12)));
	writeFileSync(trace, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [romPath, trace, seed, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
