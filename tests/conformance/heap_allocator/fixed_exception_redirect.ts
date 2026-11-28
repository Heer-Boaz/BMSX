import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { load as loadCapture, UPVALUE_FLAGS, UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_OPEN, UPVALUE_OWNER, UPVALUE_RECORD_KIND, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EXCEPTION_TARGET as EXCEPTION_TARGET, CPU_CAUSE_IRQ, CPU_STATUS_SYSTEM_ENTRY } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { GC_ROOT_BANKS_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_DMA0_DONE, IRQ_DMA1_DONE, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_FIXED_STACK_BASE, CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const irqPath = 'fixture/irq', eventsPath = 'kernel/interrupts', resetPath = 'fixture/reset';
const exceptionPath = 'fixture/alternate';
const authored = [
	['main', 'module<entry>\nreturn -1'],
	[resetPath, `
bss cursor: word
bss first_allocation: word
bss refused: word
local take<const> = function(bytes)
	local base<const> = *cursor
	if bytes > ${CPU_FIXED_STACK_BASE} - base then return 0 end
	*cursor = base + bytes
	return base
end
*cursor = ${DYNAMIC_RAM_BASE}
*first_allocation = take(${CPU_FIXED_STACK_BASE - DYNAMIC_RAM_BASE})
*refused = take(4)
local last_word<const>: *word = ${CPU_FIXED_STACK_BASE - 4}
*last_word = 129
halt_until_irq
return 37`],
	[irqPath, `
bss entered: word
*entered = cop0.cause
cop0.exception_target = cop0.system_vector
`],
	[exceptionPath, `
bss observed_status: word
*observed_status = cop0.status
local events<const> = require('${eventsPath}')
local flags<const>: *word = ${IO_IRQ_FLAGS}
local ack<const>: *word = ${IO_IRQ_ACK}
local dma_sequence<const>: *word = events.dma_completion_sequence
local vblank_count<const>: *word = events.vblank_count
local handled<const> = *flags & (${IRQ_DMA0_DONE} | ${IRQ_VBLANK})
if (handled & ${IRQ_DMA0_DONE}) ~= 0 then *dma_sequence = *dma_sequence + 1 end
if (handled & ${IRQ_VBLANK}) ~= 0 then *vblank_count = *vblank_count + 1 end
*ack = handled
`],
	[eventsPath, readFileSync('machine/bios/' + eventsPath + '.lua', 'utf8')],
].map(([path, source]) => ({ path, source, displayPath: path + '.lua', chunk: parseLuaChunk(source, path) }));
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const handled = IRQ_DMA0_DONE | IRQ_VBLANK;
const flags = handled | IRQ_DMA1_DONE;

mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'authored-system-irq-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const built = buildBlua32Image({
			domain: 'system', luaModules: authored, generatedLuaModules: [], loadAddress: 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
			resetModule: resetPath, irqModule: irqPath, exceptionModule: exceptionPath, biosExports: [],
		});
		const { layout, functionProtoIndices } = built.linked, { header } = layout;
		const irq = layout.functions[functionProtoIndices.indexOf(built.object.vectors.irqProtoIndex)];
		assert.equal(built.object.sections.rodata.staticModulePaths.includes(irqPath), false);
		assert.equal(built.object.sections.rodata.moduleProtos.some(module => module.path === irqPath), false);
		const ops: OpCode[] = [];
		let transferPc = 0;
		for (let pc = irq.codeAddress; pc < irq.codeAddress + irq.codeByteCount;) {
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, header.textAddress, pc);
			ops.push(instruction.op);
			if (instruction.op === OpCode.MTC0 && instruction.b === EXCEPTION_TARGET) transferPc = pc;
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.ok(transferPc);
		assert.ok(ops.includes(OpCode.RFE), 'authored IRQ fallthrough still carries normal RFE');
		for (const op of [OpCode.RET, OpCode.CALL, OpCode.GETSYS, OpCode.GETGL]) assert.ok(!ops.includes(op), `unexpected opcode ${op}`);
		const declarations = built.linked.symbols.metadata.staticScopes.declarations;
		const bssAddress = (name: string) => {
			const address = declarations.find(symbol => symbol.name === name)!.address;
			assert.ok(address !== undefined);
			return address;
		};
		const dma = bssAddress('bios_dma_completion_sequence'), vblank = bssAddress('bios_vblank_count');
		const rom = writeTestBlua32Rom(built.linked);
		assert.equal(readLE32(rom, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET), irq.address);
		const targetAddress = readLE32(rom, BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET);
		const target = layout.functions.find(fn => fn.address === targetAddress)!;
		const entered = bssAddress('entered'), observedStatus = bssAddress('observed_status');
		const cursor = bssAddress('cursor'), first = bssAddress('first_allocation'), refused = bssAddress('refused');
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler, irqController } = runtime.machine;
		const trace: string[] = [], expected: string[] = [];
		const arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
		const heapFirst = management + HEAP_STRING_METADATA_OFFSET, heapEnd = management + GC_ROOT_BANKS_OFFSET;
		const zeroHeap = new Uint8Array(heapEnd - heapFirst), heapHash = hashBytes(zeroHeap, 0, zeroHeap.length);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		function observe(cmd: string, output?: string | number) {
			trace.push(cmd);
			if (output !== undefined) expected.push(String(output));
		}
		function observeMachine() {
			for (const address of [dma, vblank, entered, observedStatus, cursor, first, refused, CPU_FIXED_STACK_BASE - 4]) {
				const offset = address - RAM_BASE;
				observe(`H ${offset} ${offset + 4}`, hashBytes(memory.ramData(), offset, 4));
			}
			const pending = memory.readIoU32(IO_IRQ_FLAGS);
			observe(`M ${IO_IRQ_FLAGS}`, `${pending} 0`);
			assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap);
			observe(`H ${heapFirst} ${heapEnd}`, heapHash);
		}
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const elapsed = cycles - cpu.instructionBudgetRemaining;
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), 0);
			assert.equal(arena.occupiedBytes(), 0);
			observe(`J ${cycles} 1`, `${result} ${elapsed} 0 0 0`);
			return result;
		}
		assert.equal(scheduler.nowCycles, 0);
		assert.equal(arena.occupiedBytes(), 0);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), 0);
		assert.deepEqual(memory.ramData().subarray(heapFirst, heapEnd), zeroHeap);
		observe(`H ${heapFirst} ${heapEnd}`, heapHash);
		assert.equal(grant(512), RunResult.Halted);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(memory.readRamRecordWord(cursor), CPU_FIXED_STACK_BASE);
		assert.equal(memory.readRamRecordWord(first), DYNAMIC_RAM_BASE);
		assert.equal(memory.readRamRecordWord(refused), 0);
		assert.equal(memory.readRamRecordWord(CPU_FIXED_STACK_BASE - 4), 129);
		const resetPc = cpu.readFramePc(0);
		memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
		irqController.raise(flags);
		observe(`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`);
		observe(`i ${flags}`);
		assert.equal(cpu.enterPendingInterrupt(), true);
		observe('I', 1);
		assert.equal(cpu.readFramePc(1), irq.codeAddress);
		assert.equal(cpu.activeThread.currentFrame!.closureAddress, 0);
		observe('P', `2 ${irq.codeAddress}`);
		assert.equal(arena.occupiedBytes(), 0, 'vector admission uses the fixed board bank');
		for (let step = 0; step < 64 && cpu.readFramePc(1) !== transferPc; ++step)
			assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.readFramePc(1), transferPc);

		// Fixed vector source cannot create captures. Author one raw open alias
		// to check rejection of the same MTC0 without any allocator-owned object.
		const beforeRedirect = captureRuntimeSaveState(runtime);
		observe('S');
		const issuer = cpu.activeThread.currentFrame!;
		const { a: register } = decodeBlua32InstructionAtPc(layout.textBytes, header.textAddress, transferPc);
		const capture = CPU_FIXED_STACK_BASE - 0x80, cellOffset = capture - RAM_BASE;
		const openHead = issuer.controlOffset + FrameField.OpenHead;
		const capturedValue = issuer.registers.get(register);
		for (const [address, word] of [
			[capture, UPVALUE_RECORD_KIND | (UPVALUE_OPEN << (8 * UPVALUE_FLAGS))],
			[capture + UPVALUE_VALUE_WORD, issuer.stackBase + register],
			[capture + UPVALUE_OWNER, cpu.activeThread.address],
			[capture + UPVALUE_NEXT, 0],
			[openHead, capture],
		]) {
			memory.writeRamRecordWord(address, word);
			observe(`W ${address} ${word >>> 0}`);
		}
		assert.equal(loadCapture(memory, capture), capturedValue);
		const cellBytes = memory.ramData().slice(cellOffset, cellOffset + UPVALUE_HEAP_BYTES);
		assert.equal(grant(1), RunResult.Halted);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.MTC0]);
		assert.equal(cpu.captureRuntimeState().hardHalted, true);
		observe('F', 1);
		assert.equal(cpu.getFrameDepth(), 2);
		assert.equal(cpu.activeThread.currentFrame!.functionAddress, irq.address);
		assert.equal(cpu.activeThread.currentFrame!.openUpvalueHead, capture);
		assert.deepEqual(memory.ramData().subarray(cellOffset, cellOffset + UPVALUE_HEAP_BYTES), cellBytes);
		assert.equal(loadCapture(memory, capture), capturedValue);
		observe(`H ${openHead} ${openHead + 4}`, hashBytes(memory.ramData(), openHead, 4));
		observe(`H ${cellOffset} ${cellOffset + UPVALUE_HEAP_BYTES}`, hashBytes(cellBytes, 0, cellBytes.length));
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
		assert.equal(cpu.readEpcWord(), resetPc);
		assert.equal(cpu.captureRuntimeState().statusWord, beforeRedirect.cpuState.statusWord);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS), flags);
		observe('Z', `${CPU_CAUSE_IRQ} 0 ${resetPc}`);
		observeMachine();

		observe('U');
		applyRuntimeSaveState(runtime, beforeRedirect);
		assert.equal(cpu.readFramePc(1), transferPc);
		assert.equal(cpu.activeThread.currentFrame!.openUpvalueHead, 0);
		assert.equal(grant(1), RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.MTC0]);
		assert.equal(cpu.readFramePc(1), target.codeAddress, 'the vector transfer retired without executing the target');
		observe('P', `2 ${target.codeAddress}`);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ, 'neither the transfer nor the target name creates a second exception');
		assert.equal(cpu.readEpcWord(), resetPc, 'the eventual RFE still owns the original EPC');
		assert.equal(cpu.captureRuntimeState().statusWord, CPU_STATUS_SYSTEM_ENTRY << 2);
		assert.equal(memory.readRamRecordWord(entered), CPU_CAUSE_IRQ);
		observe('Z', `${CPU_CAUSE_IRQ} 0 ${resetPc}`);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS), flags, 'only the eventual handler acknowledges');
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), 0);
		// Before RAM_END is published, these authored BSS words are visible
		// to the board vector's CPU data path, not to the ordinary bus.
		for (let step = 0; step < 64 && memory.readRamRecordWord(dma) === 0; ++step) {
			assert.equal(grant(1), RunResult.Yielded);
		}
		assert.equal(memory.readRamRecordWord(dma), 1);
		assert.equal(memory.readRamRecordWord(vblank), 0);
		assert.equal(memory.readRamRecordWord(observedStatus), CPU_STATUS_SYSTEM_ENTRY << 2);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS), flags);
		observeMachine();
		const checkpoint = captureRuntimeSaveState(runtime);
		const romPath = join(dir, `O${optLevel}.rom`), state = join(dir, `O${optLevel}.state`);
		const nativeState = join(dir, `O${optLevel}.native`), script = join(dir, `O${optLevel}.trace`);
		writeFileSync(romPath, rom);
		writeFileSync(state, encodeRuntimeSaveState(checkpoint));
		observe(`x ${nativeState}`);
		observe('S');

		function finish() {
			for (let step = 0; step < 64 && cpu.getFrameDepth() === 2; ++step) {
				assert.equal(grant(1), RunResult.Yielded);
			}
			assert.equal(cpu.getFrameDepth(), 1);
			assert.equal(cpu.readFramePc(0), resetPc, 'RFE resumes exactly after the interrupted HALT');
			assert.equal(memory.readRamRecordWord(dma), 1);
			assert.equal(memory.readRamRecordWord(vblank), 1);
			assert.equal(memory.readIoU32(IO_IRQ_FLAGS), IRQ_DMA1_DONE, 'only handled bits are acknowledged');
			assert.equal(memory.readRamRecordWord(cursor), CPU_FIXED_STACK_BASE);
			assert.equal(memory.readRamRecordWord(CPU_FIXED_STACK_BASE - 4), 129);
			observeMachine();
			assert.equal(grant(64), RunResult.Halted);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
			observe('C', 37);
		}
		finish();
		observe('U');
		applyRuntimeSaveState(runtime, checkpoint);
		finish();
		observe('X');
		applyRuntimeSaveState(runtime, checkpoint);
		finish();
		writeFileSync(script, trace.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, script, state], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		console.log(`GENERIC-IRQ-TRANSFER:PASS O${optLevel} same accepted exception, exhausted firmware arena, fixed bank, mapped ACK, portable checkpoint`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
