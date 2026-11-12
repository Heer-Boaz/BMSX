import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeRuntimeSaveState, decodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState, applyRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IO_GEO_STATUS, IO_GEO_FAULT, IO_IRQ_FLAGS, IRQ_GEO_DONE, IRQ_DMA0_DONE, IO_DMA0_READ_ADDR, IO_DMA0_WRITE_ADDR, IO_DMA0_TRANSFER_COUNT, IO_DMA0_CONTROL, IO_DMA0_TRIGGER, DMA_ROUTE_COPY, DMA_TRIGGER_START, IO_GEO_SRC0, IO_GEO_SRC1, IO_GEO_SRC2, IO_GEO_DST0, IO_GEO_DST1, IO_GEO_COUNT, IO_GEO_PARAM0, IO_GEO_PARAM1, IO_GEO_STRIDE0, IO_GEO_STRIDE1, IO_GEO_STRIDE2, IO_GEO_CMD } from '../../machine/ts/spec/bmsx/io';
import { GEO_STATUS_DONE, GEO_XFORM2_RECORD_BYTES, GEO_XFORM2_RECORD_FLAGS_OFFSET, GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, GEO_XFORM2_RECORD_DST_INDEX_OFFSET, GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, GEO_INDEX_NONE, GEO_VERTEX2_BYTES, GEO_XFORM2_MATRIX_BYTES, IO_CMD_GEO_XFORM2_BATCH } from '../../machine/ts/machine/devices/geometry/contracts';

function writeNoopXform2Record(memory: Memory, addr: number): void {
	memory.writeU32(addr + GEO_XFORM2_RECORD_FLAGS_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, GEO_INDEX_NONE);
}

function writeXform2BatchRegisters(memory: Memory, jobBase: number, count: number): void {
	memory.writeMappedWord(IO_GEO_SRC0, jobBase);
	memory.writeMappedWord(IO_GEO_SRC1, jobBase + 0x100);
	memory.writeMappedWord(IO_GEO_SRC2, jobBase + 0x200);
	memory.writeMappedWord(IO_GEO_DST0, jobBase + 0x300);
	memory.writeMappedWord(IO_GEO_DST1, 0);
	memory.writeMappedWord(IO_GEO_COUNT, count);
	memory.writeMappedWord(IO_GEO_PARAM0, 0);
	memory.writeMappedWord(IO_GEO_PARAM1, 0);
	memory.writeMappedWord(IO_GEO_STRIDE0, GEO_XFORM2_RECORD_BYTES);
	memory.writeMappedWord(IO_GEO_STRIDE1, GEO_VERTEX2_BYTES);
	memory.writeMappedWord(IO_GEO_STRIDE2, GEO_XFORM2_MATRIX_BYTES);
}



test('booted runtime: GEO started before DMA across a snapshot', () => {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RFE, 0, 0, 0, 0);
	const system = linkRawTestSystemBlua32({ text: code, functions: [{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 1 }], systemGlobalNames: LUA_BOOT_PRIMITIVES.map(p => p.name), startupFunctionIndex: 0, irqFunctionIndex: 1, exceptionFunctionIndex: 1 });
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const machine = runtime.machine, memory = machine.memory;
	const jobBase = DYNAMIC_RAM_BASE + 0x1000, source = DYNAMIC_RAM_BASE + 0x2000;
	for (let i = 0; i < 29; ++i) writeNoopXform2Record(memory, jobBase + i * GEO_XFORM2_RECORD_BYTES);
	memory.writeU32(source, 1);
	writeXform2BatchRegisters(memory, jobBase, 29);
	memory.writeMappedWord(IO_DMA0_READ_ADDR, source);
	memory.writeMappedWord(IO_DMA0_WRITE_ADDR, jobBase + 28 * GEO_XFORM2_RECORD_BYTES);
	memory.writeMappedWord(IO_DMA0_TRANSFER_COUNT, 26);
	memory.writeMappedWord(IO_DMA0_CONTROL, DMA_ROUTE_COPY);
	memory.writeMappedWord(IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH);
	const advance = (target: number) => {
			while (machine.scheduler.nextDeadline() <= target) {
						const deadline = machine.scheduler.nextDeadline();
						machine.advanceDevices(deadline - machine.scheduler.nowCycles);
						while (machine.scheduler.hasDueTimer()) machine.runDeviceService(machine.scheduler.popDueTimer());
			}
			machine.advanceDevices(target - machine.scheduler.nowCycles);
	};
	advance(6);
	memory.writeMappedWord(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	assert.equal(machine.dmaController.cpuBusHeld(), true);
	advance(58);
	assert.equal(machine.scheduler.nextDeadline(), 60);
	const saved = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	advance(60);
	const first = [memory.readIoU32(IO_GEO_STATUS), memory.readIoU32(IO_GEO_FAULT), memory.readIoU32(IO_IRQ_FLAGS)];
	assert.deepEqual(first, [GEO_STATUS_DONE, 0, IRQ_GEO_DONE | IRQ_DMA0_DONE]);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(saved, machine.memory.ramByteCount(), machine.gxGpu.readVramSnapshotBytes().byteLength));
	advance(60);
	const replay = [memory.readIoU32(IO_GEO_STATUS), memory.readIoU32(IO_GEO_FAULT), memory.readIoU32(IO_IRQ_FLAGS)];
	assert.deepEqual(replay, first);
});
