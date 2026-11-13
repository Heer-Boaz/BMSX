import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState, applyRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState, decodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { DEVICE_SERVICE_GPU } from '../../machine/ts/machine/scheduler/device';
import { IO_GX_GPU_GP0, IO_IRQ_FLAGS, IRQ_GPU } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { GX_GPU_COMMAND_FIFO_WORD_CAPACITY } from '../../machine/ts/spec/gx/gp0';
import { gxGpuPcrtcRegisterAddress, GX_GPU_PCRTC_SMODE1_LOW, GX_GPU_PCRTC_SMODE1_SINT } from '../../machine/ts/spec/gx/pcrtc';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

test('runtime codec preserves a blocked GP0 store and its wakeup', () => {
	const code = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.LOADK, 1, 0, 1, 0);
	writeInstruction(code, 2, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.U32LE, 0);
	writeInstruction(code, 3, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.RFE, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code, functions: [{ firstWord: 0, wordCount: 4, maxStack: 2 }, { firstWord: 4, wordCount: 1 }],
		constants: [IO_GX_GPU_GP0, 0x1f000000], systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
		startupFunctionIndex: 0, irqFunctionIndex: 1, exceptionFunctionIndex: 1,
	});
	const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { memory, scheduler, cpu, gxGpu: gpu } = runtime.machine;
	const mode = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(scheduler.currentNowCycles());
	for (const word of [0x020000ff, 0, 0x00010001]) gpu.writeGp0(word);
	for (let index = 0; index < GX_GPU_COMMAND_FIFO_WORD_CAPACITY; ++index) gpu.writeGp0(0xe1000000);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	assert.equal(scheduler.runCpuSlice(0, 20), RunResult.Halted);
	assert.equal(cpu.isMemoryWriteBlocked(), true);
	scheduler.advanceTo(20 - cpu.instructionBudgetRemaining);
	const encoded = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const advance = (cycle: number) => {
		while (scheduler.nextDeadline() <= cycle) {
			const deadline = scheduler.nextDeadline();
			scheduler.advanceTo(deadline);
			assert.equal(scheduler.popDueTimer(), DEVICE_SERVICE_GPU);
			gpu.onService(deadline);
		}
		scheduler.advanceTo(cycle);
	};
	for (let iteration = 0; iteration < 2; ++iteration) {
		if (iteration !== 0) {
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(encoded, memory.ramByteCount(), gpu.readVramSnapshotBytes().byteLength));
			assert.equal(cpu.isMemoryWriteBlocked(), true, 'CPU wait is restored after the device state');
			assert.equal(scheduler.nextDeadline(), 29, 'the restored CPU dependency re-arms the GPU completion deadline');
		}
		advance(28);
		assert.equal(cpu.isMemoryWriteBlocked(), true);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, 0);
		advance(29);
		assert.equal(cpu.isMemoryWriteBlocked(), false);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, 0);
		for (let attempt = 0; attempt < 4 && cpu.getFrameDepth() > 0; ++attempt) scheduler.runCpuSlice(0, 20);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.equal(cpu.isMemoryWriteBlocked(), false);
		advance(44);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, 0);
		advance(45);
		assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, IRQ_GPU);
	}
});
