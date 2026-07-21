import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DMA_CONTROL_BLOCK_WORDS_16,
	DMA_CONTROL_READ_INCREMENT,
	DMA_CONTROL_REQUEST_FORCE,
	DMA_CONTROL_REQUEST_GX_WRITE,
	DMA_CONTROL_REQUEST_IMGDEC_WRITE,
	DMA_TRIGGER_START,
	IO_DMA_CONTROL,
	IO_DMA_READ_ADDR,
	IO_DMA_TRANSFER_COUNT,
	IO_DMA_TRIGGER,
	IO_DMA_WRITE_ADDR,
	IO_GX_GPU_GP0,
	IO_IMGDEC_CLUT_DESTINATION,
	IO_IMGDEC_CONTROL,
	IO_IMGDEC_DATA,
	IO_IMGDEC_DECODED_WORD_COUNT,
	IO_IMGDEC_INPUT_WORD_COUNT,
	IO_IMGDEC_INPUT_WORDS_RECEIVED,
	IO_IMGDEC_STATUS,
	IO_IMGDEC_TEXTURE_DESTINATION,
	IO_IMGDEC_TEXTURE_SIZE,
	IO_IRQ_FLAGS,
	IRQ_IMGDEC,
} from '../../machine/ts/machine/bus/io';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import {
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_READBACK_PENDING,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_INGRESS_COMMAND,
	GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_GP1_CLEAR_FIFO,
	GX_GPU_GP1_DMA_DIRECTION,
	GX_GPU_GP1_RESET,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { ImgDecController } from '../../machine/ts/machine/devices/imgdec/controller';
import {
	IMGDEC_CONTROL_START,
	IMGDEC_DECODE_BATCH_WORDS,
	IMGDEC_STATUS_DONE,
	IMGDEC_STATUS_FORMAT_FAULT,
	IMGDEC_STATUS_OUTPUT_ABORTED,
	IMGDEC_STATUS_OUTPUT_BLOCKED,
	IMGDEC_STREAM_MAGIC,
	IMGDEC_TOKEN_KIND_LITERAL,
	IMGDEC_TOKEN_KIND_SHIFT,
} from '../../machine/ts/machine/devices/imgdec/contracts';
import type { InputControllerInputSource, InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, PROGRAM_STATIC_RAM_BASE } from '../../machine/ts/machine/memory/map';
import {
	DEVICE_SERVICE_DMA,
	DEVICE_SERVICE_GPU,
	DEVICE_SERVICE_IMGDEC,
	DEVICE_SERVICE_SYSTEM,
	DeviceScheduler,
} from '../../machine/ts/machine/scheduler/device';
import {
	SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR,
	type SystemController,
} from '../../machine/ts/machine/devices/system/controller';
import { encodeImgDecStream } from '../../scripts/rompacker/imgdec';

const IMGDEC_DMA_CONTROL = DMA_CONTROL_READ_INCREMENT
	| DMA_CONTROL_REQUEST_IMGDEC_WRITE
	| DMA_CONTROL_BLOCK_WORDS_16;
const SINGLE_WORD_IMGDEC_STREAM = encodeImgDecStream(Buffer.from([0xef, 0xcd, 0xab, 0x89]), 1, 0);

type ImgDecFixture = {
	memory: Memory;
	irq: IrqController;
	scheduler: DeviceScheduler;
	dma: DmaController;
	gpu: GxGpu;
	imgdec: ImgDecController;
	system: SystemController;
};

const IMGDEC_INPUT_SOURCE: InputControllerInputSource = {
	sampleInputControllerSnapshot(_currentTimeMs: number, _snapshot: InputControllerSnapshot): void {},
	supervisorRequestLineHigh(): boolean { return false; },
	applyInputControllerVibrationEffect(_padIndex: number, _durationMs: number, _intensity: number): void {},
};

function createImgDecFixture(cartRom: Uint8Array): ImgDecFixture {
	const memory = new Memory({ systemRom: new Uint8Array(), cartRom });
	const machine = new Machine(memory, IMGDEC_INPUT_SOURCE);
	machine.resetDevices();
	const irq = machine.irqController;
	const scheduler = machine.scheduler;
	const dma = machine.dmaController;
	const gpu = machine.gxGpu;
	const imgdec = machine.imgDecController;
	const system = machine.systemController;
	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	return { memory, irq, scheduler, dma, gpu, imgdec, system };
}

function configureImgDecUpload(
	fixture: ImgDecFixture,
	compressedWordCount: number,
	textureDestination: number,
	textureSize: number,
	clutDestination: number,
): void {
	const { memory } = fixture;
	memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, compressedWordCount);
	memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_DESTINATION, textureDestination);
	memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_SIZE, textureSize);
	memory.writeMappedU32LE(IO_IMGDEC_CLUT_DESTINATION, clutDestination);
	memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
}

function programImgDecUpload(
	fixture: ImgDecFixture,
	compressedWordCount: number,
	textureDestination: number,
	textureSize: number,
	clutDestination: number,
): void {
	configureImgDecUpload(fixture, compressedWordCount, textureDestination, textureSize, clutDestination);
	prepareImgDecDma(fixture, CART_ROM_BASE, compressedWordCount);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
}

function prepareImgDecDma(fixture: ImgDecFixture, sourceAddress: number, wordCount: number): void {
	const { memory } = fixture;
	memory.writeMappedU32LE(IO_DMA_READ_ADDR, sourceAddress);
	memory.writeMappedU32LE(IO_DMA_WRITE_ADDR, IO_IMGDEC_DATA);
	memory.writeMappedU32LE(IO_DMA_TRANSFER_COUNT, wordCount);
	memory.writeMappedU32LE(IO_DMA_CONTROL, IMGDEC_DMA_CONTROL);
}

function prepareGxDma(fixture: ImgDecFixture, sourceAddress: number, wordCount: number): void {
	const { memory } = fixture;
	fixture.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	memory.writeMappedU32LE(IO_DMA_READ_ADDR, sourceAddress);
	memory.writeMappedU32LE(IO_DMA_WRITE_ADDR, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_TRANSFER_COUNT, wordCount);
	memory.writeMappedU32LE(
		IO_DMA_CONTROL,
		DMA_CONTROL_READ_INCREMENT | DMA_CONTROL_REQUEST_GX_WRITE | DMA_CONTROL_BLOCK_WORDS_16,
	);
}

function runNextService(fixture: ImgDecFixture): void {
	const deadline = fixture.scheduler.nextDeadline();
	assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
	fixture.scheduler.advanceTo(deadline);
	while (fixture.scheduler.hasDueTimer()) {
		switch (fixture.scheduler.popDueTimer() & 0xff) {
			case DEVICE_SERVICE_DMA:
				fixture.dma.onService(deadline);
				break;
			case DEVICE_SERVICE_GPU:
				fixture.gpu.onService(deadline);
				break;
			case DEVICE_SERVICE_IMGDEC:
				fixture.imgdec.onService(deadline);
				break;
			case DEVICE_SERVICE_SYSTEM:
				fixture.system.onService();
				break;
		}
	}
}

function runUntilComplete(fixture: ImgDecFixture): boolean {
	let outputBlocked = false;
	let status = fixture.memory.readIoU32(IO_IMGDEC_STATUS);
	for (let serviceCount = 0;
		serviceCount < 1000 && status !== IMGDEC_STATUS_DONE;
		serviceCount += 1) {
		runNextService(fixture);
		status = fixture.memory.readIoU32(IO_IMGDEC_STATUS);
		outputBlocked ||= (status & IMGDEC_STATUS_OUTPUT_BLOCKED) !== 0;
	}
	assert.equal(status, IMGDEC_STATUS_DONE);
	return outputBlocked;
}

function runUntilGpuCommandCount(fixture: ImgDecFixture, commandCount: number): void {
	for (let serviceCount = 0;
		serviceCount < 1000 && fixture.gpu.readDeviceOutput().commandBuffer.commandCount < commandCount;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.gpu.readDeviceOutput().commandBuffer.commandCount, commandCount);
}

test('IMGDEC streams compressed texture and CLUT words from cartridge ROM into native GP0 uploads', () => {
	const textureWordCount = 80;
	const clutWordCount = 8;
	const payload = Buffer.alloc((textureWordCount + clutWordCount) << 2);
	for (let index = 0; index < textureWordCount; index += 1) {
		payload.writeUInt32LE(Math.imul(index + 1, 0x10204081) >>> 0, index << 2);
	}
	for (let index = 0; index < clutWordCount; index += 1) {
		payload.writeUInt32LE((0x7fff0000 | index) >>> 0, (textureWordCount + index) << 2);
	}
	const compressed = encodeImgDecStream(payload, textureWordCount, clutWordCount);
	const fixture = createImgDecFixture(compressed);
	const textureDestination = 0x00200040;
	const textureSize = 160 | (1 << 16);
	const clutDestination = 0x00400100;
	programImgDecUpload(fixture, compressed.byteLength >> 2, textureDestination, textureSize, clutDestination);
	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 2);

	assert.equal(fixture.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMGDEC, IRQ_IMGDEC);
	const commands = fixture.gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], textureDestination);
	assert.equal(commands.words[commands.commandWordStart[0] + 2], textureSize);
	assert.deepEqual(
		Array.from(commands.words.subarray(commands.commandWordStart[0] + 3, commands.commandWordStart[0] + 3 + textureWordCount)),
		readPayloadWords(payload, 0, textureWordCount),
	);
	assert.equal(commands.words[commands.commandWordStart[1] + 1], clutDestination);
	assert.equal(commands.words[commands.commandWordStart[1] + 2], 16 | (1 << 16));
	assert.deepEqual(
		Array.from(commands.words.subarray(commands.commandWordStart[1] + 3, commands.commandWordStart[1] + 3 + clutWordCount)),
		readPayloadWords(payload, textureWordCount, clutWordCount),
	);

	for (let commandIndex = 0; commandIndex < 5; commandIndex += 1) {
		fixture.gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
		fixture.gpu.writeGp0(0);
		fixture.gpu.writeGp0(0x01ff03ff);
	}
	assert.equal(fixture.memory.mappedWriteReady(IO_IMGDEC_CONTROL), true);
	programImgDecUpload(fixture, compressed.byteLength >> 2, textureDestination, textureSize, clutDestination);
	assert.equal(runUntilComplete(fixture), true);
	runUntilGpuCommandCount(fixture, 9);
});

test('IMGDEC waits for the active CPU packet before GX grants GP0 ingress', () => {
	const fixture = createImgDecFixture(SINGLE_WORD_IMGDEC_STREAM);
	const fillHeader = ((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x123456) >>> 0;
	fixture.gpu.writeGp0(fillHeader);
	configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);

	assert.equal(fixture.gpu.captureState().imgDecGp0Active, false);
	assert.equal(fixture.gpu.captureState().imgDecGp0DmaContinuation, false);
	assert.equal(fixture.memory.mappedWriteReady(IO_GX_GPU_GP0), true);
	for (let index = 0; index < 16; index += 1) {
		fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + (index << 2), 0);
	}
	prepareGxDma(fixture, PROGRAM_STATIC_RAM_BASE, 16);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	assert.equal(fixture.dma.hasAdmittedGxGpuWriteBlock(), false);
	assert.equal(fixture.gpu.captureState().imgDecGp0DmaContinuation, false);
	fixture.gpu.writeGp0(0x00100020);
	fixture.gpu.writeGp0(0x00040008);
	assert.equal(fixture.gpu.captureState().imgDecGp0Active, true);
	assert.equal(fixture.memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	for (let byteOffset = 0; byteOffset < SINGLE_WORD_IMGDEC_STREAM.byteLength; byteOffset += 4) {
		fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, SINGLE_WORD_IMGDEC_STREAM.readUInt32LE(byteOffset));
	}

	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 2);
	const commands = fixture.gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.words[commands.commandWordStart[0]], fillHeader);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], 0x00100020);
	assert.equal(commands.words[commands.commandWordStart[0] + 2], 0x00040008);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
});

for (const [resetName, resetOpcode] of [
	['CLEAR_FIFO', GX_GPU_GP1_CLEAR_FIFO],
	['RESET', GX_GPU_GP1_RESET],
] as const) {
	test(`IMGDEC is granted when GP1 ${resetName} aborts the active CPU packet`, () => {
		const fixture = createImgDecFixture(SINGLE_WORD_IMGDEC_STREAM);
		fixture.gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
		configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
		assert.equal(fixture.gpu.captureState().imgDecGp0Active, false);

		fixture.gpu.writeGp1(resetOpcode << 24);
		assert.equal(fixture.gpu.captureState().imgDecGp0Active, true);
		for (let byteOffset = 0; byteOffset < SINGLE_WORD_IMGDEC_STREAM.byteLength; byteOffset += 4) {
			fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, SINGLE_WORD_IMGDEC_STREAM.readUInt32LE(byteOffset));
		}

		runUntilComplete(fixture);
		runUntilGpuCommandCount(fixture, 1);
		assert.equal(fixture.gpu.readDeviceOutput().commandBuffer.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	});
}

for (const [resetName, resetOpcode] of [
	['CLEAR_FIFO', GX_GPU_GP1_CLEAR_FIFO],
	['RESET', GX_GPU_GP1_RESET],
] as const) {
	test(`GP1 ${resetName} aborts an active IMGDEC output packet at the GX owner`, () => {
		const textureWordCount = 80;
		const compressed = encodeImgDecStream(Buffer.alloc(textureWordCount << 2), textureWordCount, 0);
		const fixture = createImgDecFixture(new Uint8Array());
		configureImgDecUpload(fixture, compressed.byteLength >> 2, 0x00200040, 160 | (1 << 16), 0);
		for (let byteOffset = 0; byteOffset < compressed.byteLength; byteOffset += 4) {
			fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, compressed.readUInt32LE(byteOffset));
		}
		runNextService(fixture);
		assert.equal(fixture.gpu.captureState().gp0IngressPhase, GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD);
		assert.equal(fixture.gpu.captureState().imgDecGp0Active, true);

		fixture.gpu.writeGp1(resetOpcode << 24);
		assert.equal(fixture.gpu.captureState().imgDecGp0AbortPending, true);
		runNextService(fixture);
		assert.equal(fixture.memory.readIoU32(IO_IMGDEC_STATUS), IMGDEC_STATUS_OUTPUT_ABORTED);
		assert.equal(fixture.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMGDEC, IRQ_IMGDEC);
		assert.equal(fixture.gpu.captureState().gp0IngressPhase, GX_GPU_GP0_INGRESS_COMMAND);
		assert.equal(fixture.gpu.captureState().imgDecGp0Active, false);
		assert.equal(fixture.gpu.captureState().imgDecGp0AbortPending, false);

		configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
		for (let byteOffset = 0; byteOffset < SINGLE_WORD_IMGDEC_STREAM.byteLength; byteOffset += 4) {
			fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, SINGLE_WORD_IMGDEC_STREAM.readUInt32LE(byteOffset));
		}
		runUntilComplete(fixture);
		runUntilGpuCommandCount(fixture, 1);
		assert.equal(fixture.gpu.readDeviceOutput().commandBuffer.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	});
}

test('IMGDEC waits for physical FIFO capacity after an admitted GX DMA block', () => {
	const fixture = createImgDecFixture(SINGLE_WORD_IMGDEC_STREAM);
	fixture.gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
	fixture.gpu.writeGp0(0);
	fixture.gpu.writeGp0((1023 | (511 << 16)) >>> 0);
	for (let index = 0; index < 15; index += 1) {
		fixture.gpu.writeGp0(0x03000000);
	}
	assert.equal(fixture.gpu.captureState().gp0FifoWordCount, 15);
	for (let index = 0; index < 16; index += 1) {
		fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + (index << 2), 0x03000000);
	}
	prepareGxDma(fixture, PROGRAM_STATIC_RAM_BASE, 16);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	assert.equal(fixture.dma.hasAdmittedGxGpuWriteBlock(), true);

	configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
	assert.equal(fixture.gpu.captureState().imgDecGp0Active, false);
	runNextService(fixture);
	const gpuState = fixture.gpu.captureState();
	assert.equal(gpuState.gp0FifoWordCount, 31);
	assert.equal(gpuState.imgDecGp0Active, true);
	assert.equal(fixture.gpu.imgDecGp0WritableWordCount(fixture.scheduler.nowCycles), 0);

	prepareImgDecDma(fixture, CART_ROM_BASE, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 2);
});

test('an admitted GX DMA transfer finishes its partial GP0 packet before IMGDEC takes ingress', () => {
	const fixture = createImgDecFixture(new Uint8Array());
	const payloadWordCount = 32;
	const packetWordCount = payloadWordCount + 3;
	fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE, GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + 4, 0x00100020);
	fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + 8, 64 | (1 << 16));
	for (let index = 0; index < payloadWordCount; index += 1) {
		fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + 12 + (index << 2), index + 1);
	}
	prepareGxDma(fixture, PROGRAM_STATIC_RAM_BASE, packetWordCount);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	assert.equal(fixture.dma.hasAdmittedGxGpuWriteBlock(), true);
	configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
	assert.equal(fixture.gpu.captureState().imgDecGp0DmaContinuation, true);

	runNextService(fixture);
	assert.equal(fixture.gpu.captureState().gp0IngressPhase, GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD);
	assert.equal(fixture.gpu.captureState().imgDecGp0Active, false);
	assert.equal(fixture.gpu.captureState().imgDecGp0DmaContinuation, true);
	assert.equal(fixture.dma.hasAdmittedGxGpuWriteBlock(), true);
	for (let byteOffset = 0; byteOffset < SINGLE_WORD_IMGDEC_STREAM.byteLength; byteOffset += 4) {
		fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, SINGLE_WORD_IMGDEC_STREAM.readUInt32LE(byteOffset));
	}

	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 2);
	const commands = fixture.gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandWordCount[0], packetWordCount);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
});

test('IMGDEC continuation ends with the pre-request GX DMA transfer epoch', () => {
	const fixture = createImgDecFixture(new Uint8Array());
	const payloadWordCount = 16;
	const packetWordCount = payloadWordCount + 3;
	const dmaWordCount = 16;
	fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE, GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + 4, 0x00100020);
	fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + 8, 32 | (1 << 16));
	for (let index = 0; index < dmaWordCount - 3; index += 1) {
		fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + 12 + (index << 2), index + 1);
	}
	prepareGxDma(fixture, PROGRAM_STATIC_RAM_BASE, dmaWordCount);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
	assert.equal(fixture.gpu.captureState().imgDecGp0DmaContinuation, true);
	runNextService(fixture);
	assert.equal(fixture.gpu.captureState().gp0IngressPhase, GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD);
	assert.equal(fixture.gpu.captureState().imgDecGp0DmaContinuation, false);
	assert.equal(fixture.dma.captureState().transferStarted, false);

	for (let index = 0; index < 16; index += 1) {
		fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + (index << 2), 0);
	}
	prepareGxDma(fixture, PROGRAM_STATIC_RAM_BASE, 16);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	assert.equal(fixture.dma.hasAdmittedGxGpuWriteBlock(), false);
	assert.equal(fixture.memory.mappedWriteReady(IO_GX_GPU_GP0), true);
	for (let index = dmaWordCount - 3; index < payloadWordCount; index += 1) {
		fixture.memory.writeMappedU32LE(IO_GX_GPU_GP0, index + 1);
	}
	assert.equal(fixture.gpu.captureState().imgDecGp0Active, true);
	for (let byteOffset = 0; byteOffset < SINGLE_WORD_IMGDEC_STREAM.byteLength; byteOffset += 4) {
		fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, SINGLE_WORD_IMGDEC_STREAM.readUInt32LE(byteOffset));
	}

	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 2);
	const commands = fixture.gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandWordCount[0], packetWordCount);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
});

test('IMGDEC input FIFO drops forced-DMA overflow while counting bus words', () => {
	const zeroStream = encodeImgDecStream(Buffer.alloc(1024 << 2), 1024, 0);
	const fixture = createImgDecFixture(new Uint8Array());
	configureImgDecUpload(fixture, 48, 0x00200040, 256 | (8 << 16), 0);
	for (let index = 0; index < 48; index += 1) {
		const word = index < (zeroStream.byteLength >> 2)
			? zeroStream.readUInt32LE(index << 2)
			: 0x03000000;
		fixture.memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE + (index << 2), word);
	}
	fixture.memory.writeMappedU32LE(IO_DMA_READ_ADDR, PROGRAM_STATIC_RAM_BASE);
	fixture.memory.writeMappedU32LE(IO_DMA_WRITE_ADDR, IO_IMGDEC_DATA);
	fixture.memory.writeMappedU32LE(IO_DMA_TRANSFER_COUNT, 48);
	fixture.memory.writeMappedU32LE(
		IO_DMA_CONTROL,
		DMA_CONTROL_READ_INCREMENT | DMA_CONTROL_REQUEST_FORCE | DMA_CONTROL_BLOCK_WORDS_16,
	);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	while (fixture.memory.readIoU32(IO_IMGDEC_INPUT_WORDS_RECEIVED) !== 48) {
		runNextService(fixture);
	}
	const state = fixture.imgdec.captureState();
	assert.equal(state.inputWordsReceived, 48);
	assert.equal(state.inputWords.length, 32);
});

test('IMGDEC format fault aborts only its partial GP0 packet and leaves GX reusable', () => {
	const malformedWords = [
		IMGDEC_STREAM_MAGIC,
		2,
		0,
		IMGDEC_TOKEN_KIND_LITERAL << IMGDEC_TOKEN_KIND_SHIFT,
		0x12345678,
	];
	const fixture = createImgDecFixture(new Uint8Array());
	configureImgDecUpload(fixture, malformedWords.length, 0x00200040, 4 | (1 << 16), 0);
	for (let index = 0; index < malformedWords.length; index += 1) {
		fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, malformedWords[index]!);
	}
	for (let serviceCount = 0;
		serviceCount < 1000 && fixture.memory.readIoU32(IO_IMGDEC_STATUS) !== IMGDEC_STATUS_FORMAT_FAULT;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_STATUS), IMGDEC_STATUS_FORMAT_FAULT);
	assert.equal(fixture.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMGDEC, IRQ_IMGDEC);
	const faultedGpuState = fixture.gpu.captureState();
	assert.equal(faultedGpuState.gp0IngressPhase, GX_GPU_GP0_INGRESS_COMMAND);
	assert.equal(faultedGpuState.gp0ImageLoadWordsRemaining, 0);
	assert.equal(faultedGpuState.gp0CommandWordCount, 0);

	configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
	for (let byteOffset = 0; byteOffset < SINGLE_WORD_IMGDEC_STREAM.byteLength; byteOffset += 4) {
		fixture.memory.writeMappedU32LE(IO_IMGDEC_DATA, SINGLE_WORD_IMGDEC_STREAM.readUInt32LE(byteOffset));
	}
	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 1);
	const commandBuffer = fixture.gpu.readDeviceOutput().commandBuffer;
	assert.equal(commandBuffer.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commandBuffer.words[commandBuffer.commandWordStart[0] + 3], 0x89abcdef);
	while (commandBuffer.executedCommandCount < commandBuffer.commandCount) {
		runNextService(fixture);
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	fixture.gpu.retirePresentedCommands();
	fixture.system.requestSupervisorLineEdge();
	for (let serviceCount = 0;
		serviceCount < 1000 && fixture.system.captureState().supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.system.captureState().supervisorPhase, SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR);
});

test('IMGDEC DMA started during supervisor quiesce completes existing decoder work', () => {
	const blockedStart = createImgDecFixture(SINGLE_WORD_IMGDEC_STREAM);
	blockedStart.system.requestSupervisorLineEdge();
	assert.equal(blockedStart.memory.mappedWriteReady(IO_IMGDEC_CONTROL), false);

	const fixture = createImgDecFixture(SINGLE_WORD_IMGDEC_STREAM);
	configureImgDecUpload(fixture, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2, 0x00200040, 2 | (1 << 16), 0);
	fixture.system.requestSupervisorLineEdge();
	prepareImgDecDma(fixture, CART_ROM_BASE, SINGLE_WORD_IMGDEC_STREAM.byteLength >> 2);
	assert.equal(fixture.memory.mappedWriteReady(IO_DMA_TRIGGER), true);
	fixture.memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	runUntilComplete(fixture);
	while (fixture.gpu.readDeviceOutput().commandBuffer.executedCommandCount
		< fixture.gpu.readDeviceOutput().commandBuffer.commandCount) {
		runNextService(fixture);
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	fixture.gpu.retirePresentedCommands();
	for (let serviceCount = 0;
		serviceCount < 1000 && fixture.system.captureState().supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.system.captureState().supervisorPhase, SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR);
});

test('IMGDEC publishes decoded words only on cumulative batch deadlines', () => {
	const textureWordCount = 64;
	const compressed = encodeImgDecStream(Buffer.alloc(textureWordCount << 2), textureWordCount, 0);
	const fixture = createImgDecFixture(compressed);
	programImgDecUpload(fixture, compressed.byteLength >> 2, 0x00200040, 128 | (1 << 16), 0);

	let state = fixture.imgdec.captureState();
	for (let serviceCount = 0;
		serviceCount < 100 && state.scheduledDecodeWords !== IMGDEC_DECODE_BATCH_WORDS;
		serviceCount += 1) {
		runNextService(fixture);
		state = fixture.imgdec.captureState();
	}
	assert.equal(state.scheduledDecodeWords, IMGDEC_DECODE_BATCH_WORDS);
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_DECODED_WORD_COUNT), 0);
	const decodeDeadline = fixture.scheduler.nowCycles + state.scheduledDecodeCycles;
	assert.equal(fixture.scheduler.nextDeadline(), decodeDeadline);
	fixture.scheduler.advanceTo(decodeDeadline - 1);
	assert.equal(fixture.scheduler.hasDueTimer(), false);
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_DECODED_WORD_COUNT), 0);
	runNextService(fixture);
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_DECODED_WORD_COUNT), IMGDEC_DECODE_BATCH_WORDS);
	runUntilComplete(fixture);
});

test('IMGDEC resumes from GPUREAD backpressure on the GX readiness edge', () => {
	const textureWordCount = 80;
	const compressed = encodeImgDecStream(Buffer.alloc(textureWordCount << 2), textureWordCount, 0);
	const fixture = createImgDecFixture(compressed);
	fixture.gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	fixture.gpu.writeGp0(0);
	fixture.gpu.writeGp0(1 | (1 << 16));

	let output = fixture.gpu.readDeviceOutput();
	for (let serviceCount = 0;
		serviceCount < 100 && output.readbackPort.phase !== GX_GPU_READBACK_PENDING;
		serviceCount += 1) {
		runNextService(fixture);
		output = fixture.gpu.readDeviceOutput();
	}
	assert.equal(output.readbackPort.phase, GX_GPU_READBACK_PENDING);
	assert.equal(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), true);
	output.readbackPort.pixelBytes[0] = 0x34;
	output.readbackPort.pixelBytes[1] = 0x12;
	output.readbackPort.completeReadback(output.readbackPort.token);

	programImgDecUpload(fixture, compressed.byteLength >> 2, 0x00200040, 160 | (1 << 16), 0);
	for (let serviceCount = 0;
		serviceCount < 1000
			&& (fixture.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_BLOCKED) === 0;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.notEqual(fixture.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_BLOCKED, 0);
	const blockedDeadline = fixture.scheduler.nextDeadline();
	assert.ok(blockedDeadline === Number.MAX_SAFE_INTEGER || blockedDeadline > fixture.scheduler.nowCycles);
	assert.equal(fixture.gpu.readGp0(), 0x1234);
	runUntilComplete(fixture);
	runUntilGpuCommandCount(fixture, 2);
});

test('IMGDEC save state preserves a pending GP1 output abort edge', () => {
	const textureWordCount = 80;
	const compressed = encodeImgDecStream(Buffer.alloc(textureWordCount << 2), textureWordCount, 0);
	const original = createImgDecFixture(new Uint8Array());
	configureImgDecUpload(original, compressed.byteLength >> 2, 0x00200040, 160 | (1 << 16), 0);
	for (let byteOffset = 0; byteOffset < compressed.byteLength; byteOffset += 4) {
		original.memory.writeMappedU32LE(IO_IMGDEC_DATA, compressed.readUInt32LE(byteOffset));
	}
	runNextService(original);
	original.gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	const gpuState = original.gpu.captureState();
	const imgDecState = original.imgdec.captureState();
	const dmaState = original.dma.captureState();
	const irqState = original.irq.captureState();
	assert.equal(gpuState.imgDecGp0Requested, true);
	assert.equal(gpuState.imgDecGp0AbortPending, true);

	const restored = createImgDecFixture(new Uint8Array());
	restored.scheduler.reset();
	restored.scheduler.setNowCycles(original.scheduler.nowCycles);
	restored.dma.restoreState(dmaState, restored.scheduler.nowCycles);
	restored.gpu.restoreState(gpuState);
	restored.imgdec.restoreState(imgDecState);
	restored.irq.restoreState(irqState);
	restored.dma.postLoad();
	assert.equal(restored.scheduler.nextDeadline(), restored.scheduler.nowCycles);
	runNextService(restored);
	assert.equal(restored.memory.readIoU32(IO_IMGDEC_STATUS), IMGDEC_STATUS_OUTPUT_ABORTED);
	assert.equal(restored.gpu.captureState().imgDecGp0AbortPending, false);
});

test('IMGDEC save state resumes an active back-reference stream without replaying output', () => {
	const textureWordCount = 4096;
	const payload = Buffer.alloc(textureWordCount << 2);
	for (let index = 0; index < 256; index += 1) {
		payload.writeUInt32LE(Math.imul(index + 1, 0x9e3779b1) >>> 0, index << 2);
	}
	for (let index = 256; index < textureWordCount; index += 1) {
		payload.writeUInt32LE(payload.readUInt32LE((index & 255) << 2), index << 2);
	}
	const compressed = encodeImgDecStream(payload, textureWordCount, 0);
	const original = createImgDecFixture(compressed);
	programImgDecUpload(original, compressed.byteLength >> 2, 0x00200040, 256 | (32 << 16), 0);
	let imgDecState = original.imgdec.captureState();
	for (let index = 0; index < 1000 && imgDecState.historyWords.length < 256; index += 1) {
		runNextService(original);
		imgDecState = original.imgdec.captureState();
	}
	const gpuState = original.gpu.captureState();
	const dmaState = original.dma.captureState();
	const irqState = original.irq.captureState();
	assert.ok(imgDecState.historyWords.length !== 0);
	assert.notEqual(original.memory.readIoU32(IO_IMGDEC_STATUS), IMGDEC_STATUS_DONE);

	const restored = createImgDecFixture(compressed);
	restored.scheduler.reset();
	restored.scheduler.setNowCycles(original.scheduler.nowCycles);
	restored.dma.restoreState(dmaState, restored.scheduler.nowCycles);
	restored.gpu.restoreState(gpuState);
	restored.imgdec.restoreState(imgDecState);
	restored.irq.restoreState(irqState);
	restored.dma.postLoad();
	runUntilComplete(original);
	runUntilComplete(restored);

	assert.deepEqual(restored.gpu.captureState().commandBuffer, original.gpu.captureState().commandBuffer);
});

function readPayloadWords(payload: Buffer, start: number, count: number): number[] {
	const words = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		words[index] = payload.readUInt32LE((start + index) << 2);
	}
	return words;
}
