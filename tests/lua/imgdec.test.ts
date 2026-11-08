import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	IO_DMA0_CONTROL,
	IO_DMA0_READ_ADDR,
	IO_DMA0_STATUS,
	IO_DMA0_TRANSFER_COUNT,
	IO_DMA0_TRIGGER,
	IO_DMA0_WRITE_ADDR,
	IO_DMA1_CONTROL,
	IO_DMA1_READ_ADDR,
	IO_DMA1_STATUS,
	IO_DMA1_TRANSFER_COUNT,
	IO_DMA1_TRIGGER,
	IO_DMA1_WRITE_ADDR,
	IO_DMA_CHANNEL_COUNT,
	IO_GEO_CMD,
	IO_GX_GPU_GP0,
	IO_GX_GPU_GP1,
	IO_IMGDEC_CLUT_DESTINATION,
	IO_IMGDEC_CONTROL,
	IO_IMGDEC_DATA,
	IO_IMGDEC_INPUT_WORD_COUNT,
	IO_IMGDEC_STATUS,
	IO_IMGDEC_TEXTURE_DESTINATION,
	IO_IMGDEC_TEXTURE_SIZE,
	IO_IRQ_FLAGS,
	IRQ_DMA0_DONE,
	IRQ_DMA1_DONE,
	IRQ_IMGDEC,
} from '../../machine/ts/spec/bmsx/io';
import { IO_CMD_GEO_XFORM2_BATCH } from '../../machine/ts/machine/devices/geometry/contracts';
import {
	GX_GPU_GP0_INGRESS_COMMAND,
	GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import { GX_GPU_GP1_DMA_DIRECTION } from '../../machine/ts/spec/gx/gp1';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
} from '../../machine/ts/spec/gx/gp0';
import {
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import {
	IMGDEC_CONTROL_START,
	IMGDEC_INPUT_FIFO_WORD_CAPACITY,
	IMGDEC_STATUS_BUSY,
	IMGDEC_STATUS_DONE,
	IMGDEC_STATUS_FORMAT_FAULT,
} from '../../machine/ts/spec/imgdec/registers';
import {
	IMGDEC_HISTORY_WORD_CAPACITY,
	IMGDEC_STREAM_MAGIC,
	IMGDEC_TOKEN_KIND_BACK_REFERENCE,
	IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT,
	IMGDEC_TOKEN_KIND_LITERAL,
	IMGDEC_TOKEN_KIND_REPEAT,
	IMGDEC_TOKEN_KIND_SHIFT,
	IMGDEC_TOKEN_KIND_ZERO,
} from '../../machine/ts/spec/imgdec/stream';
import {
	SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE,
	SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR,
} from '../../machine/ts/machine/devices/system/controller';
import type { InputControllerInputSource, InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { Machine } from '../../machine/ts/machine/machine';
import { MAPPED_BUS_DMA_BLOCK_END, MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { captureMachineState, restoreMachineState, type MachineState } from '../../machine/ts/machine/save_state';
import { writeLE32 } from '../../machine/ts/common/endian';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';

const IMGDEC_INPUT_DMA_CONTROL = 0x00003d41;
const IMGDEC_OUTPUT_DMA_CONTROL = 0x00003c58;

const INPUT_SOURCE: InputControllerInputSource = {
	sampleInputControllerSnapshot(_snapshot: InputControllerSnapshot): void {},
	supervisorRequestLineHigh(): boolean { return false; },
	applyInputControllerVibrationEffect(_padIndex: number, _durationMs: number, _intensity: number): void {},
};

type ImgDecFixture = {
	machine: Machine;
	memory: Memory;
	gpu: GxGpu;
};

function createFixture(cartRom: Uint8Array): ImgDecFixture {
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots(cartRom) }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, INPUT_SOURCE, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const gpu = machine.gxGpu;
	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	return { machine, memory, gpu };
}

function armUpload(
	fixture: ImgDecFixture,
	inputWordCount: number,
	textureWordCount: number,
	clutWordCount: number,
	textureDestination: number,
	textureSize: number,
	clutDestination: number,
): void {
	const { memory, gpu } = fixture;
	const outputWordCount = textureWordCount + 3 + (clutWordCount === 0 ? 0 : clutWordCount + 3);
	memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, inputWordCount);
	memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_DESTINATION, textureDestination);
	memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_SIZE, textureSize);
	memory.writeMappedU32LE(IO_IMGDEC_CLUT_DESTINATION, clutDestination);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, IO_IMGDEC_DATA);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, outputWordCount);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, IMGDEC_OUTPUT_DMA_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, CART_ROM_BASE);
	memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, IO_IMGDEC_DATA);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, inputWordCount);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, IMGDEC_INPUT_DMA_CONTROL);
	memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
}

function runNextService(fixture: ImgDecFixture): void {
	const { machine } = fixture;
	const deadline = machine.scheduler.nextDeadline();
	assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
	machine.scheduler.advanceTo(deadline);
	while (machine.scheduler.hasDueTimer()) {
		machine.runDeviceService(machine.scheduler.popDueTimer());
	}
}

function runUntilImgDecStatus(fixture: ImgDecFixture, expectedStatus: number): void {
	for (let serviceCount = 0;
		serviceCount < 2000 && fixture.memory.readIoU32(IO_IMGDEC_STATUS) !== expectedStatus;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_STATUS), expectedStatus);
}

function runUntilGpuCommandCount(fixture: ImgDecFixture, expectedCommandCount: number): void {
	for (let serviceCount = 0;
		serviceCount < 2000 && fixture.gpu.readDeviceOutput().commandBuffer.commandCount !== expectedCommandCount;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.gpu.readDeviceOutput().commandBuffer.commandCount, expectedCommandCount);
}

test('two DMA channels stream one compressed texture and CLUT through the normal GP0 port', () => {
	const textureWordCount = 80;
	const clutWordCount = 8;
	const payload = Buffer.allocUnsafe((textureWordCount + clutWordCount) << 2);
	for (let index = 0; index < textureWordCount; index += 1) {
		payload.writeUInt32LE(Math.imul(index + 1, 0x10204081) >>> 0, index << 2);
	}
	for (let index = 0; index < clutWordCount; index += 1) {
		payload.writeUInt32LE((0x7fff0000 | index) >>> 0, (textureWordCount + index) << 2);
	}
	const stream = encodeImgDecStream(payload, textureWordCount, clutWordCount);
	const fixture = createFixture(stream);
	const textureDestination = 0x00200040;
	const textureSize = 160 | (1 << 16);
	const clutDestination = 0x00400100;
	armUpload(
		fixture,
		stream.length >> 2,
		textureWordCount,
		clutWordCount,
		textureDestination,
		textureSize,
		clutDestination,
	);
	assert.equal(fixture.machine.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'both channels arm while IMGDEC DREQ is low');
	fixture.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	let cpuReadInterleaved = false;
	for (let serviceCount = 0; serviceCount < 2000 && !cpuReadInterleaved; serviceCount += 1) {
		runNextService(fixture);
		const dmaState = fixture.machine.dmaController.captureState();
		if (dmaState.activeChannel === 1 && dmaState.scheduledReadAddressWord === IO_IMGDEC_DATA) {
			const before = fixture.machine.imgDecController.captureState();
			fixture.memory.readMappedU32LE(IO_IMGDEC_DATA);
			const after = fixture.machine.imgDecController.captureState();
			assert.equal(after.outputWordsRead, before.outputWordsRead);
			assert.deepEqual(after.outputWords, before.outputWords);
			cpuReadInterleaved = true;
		}
	}
	assert.equal(cpuReadInterleaved, true, 'test must interleave a CPU DATA read with an admitted output block');
	runUntilImgDecStatus(fixture, IMGDEC_STATUS_DONE);
	runUntilGpuCommandCount(fixture, 2);

	assert.equal(fixture.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(fixture.memory.readIoU32(IO_DMA1_STATUS), DMA_STATUS_DONE);
	assert.equal(
		fixture.memory.readIoU32(IO_IRQ_FLAGS) & (IRQ_DMA0_DONE | IRQ_DMA1_DONE | IRQ_IMGDEC),
		IRQ_DMA0_DONE | IRQ_DMA1_DONE | IRQ_IMGDEC,
	);
	const commands = fixture.gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], textureDestination);
	assert.equal(commands.words[commands.commandWordStart[0] + 2], textureSize);
	for (let index = 0; index < textureWordCount; index += 1) {
		assert.equal(commands.words[commands.commandWordStart[0] + 3 + index], payload.readUInt32LE(index << 2));
	}
	assert.equal(commands.words[commands.commandWordStart[1] + 1], clutDestination);
	assert.equal(commands.words[commands.commandWordStart[1] + 2], 16 | (1 << 16));
	for (let index = 0; index < clutWordCount; index += 1) {
		assert.equal(commands.words[commands.commandWordStart[1] + 3 + index], payload.readUInt32LE((textureWordCount + index) << 2));
	}
});

test('supervisor entry pauses IMGDEC between packets without draining unbounded user work', () => {
	const textureWordCount = 13;
	const clutWordCount = 8;
	const payload = Buffer.alloc((textureWordCount + clutWordCount) << 2);
	const stream = encodeImgDecStream(payload, textureWordCount, clutWordCount);
	const fixture = createFixture(stream);
	armUpload(fixture, stream.byteLength >> 2, textureWordCount, clutWordCount, 0, 26 | (1 << 16), 0x00000100);
	fixture.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);

	let betweenPackets = false;
	for (let serviceCount = 0; serviceCount < 2000 && !betweenPackets; serviceCount += 1) {
		runNextService(fixture);
		const dmaState = fixture.machine.dmaController.captureState();
		const gpuState = fixture.gpu.captureState();
		betweenPackets = fixture.gpu.readDeviceOutput().commandBuffer.commandCount === 1
			&& dmaState.activeChannel === IO_DMA_CHANNEL_COUNT
			&& gpuState.gp0IngressPhase === GX_GPU_GP0_INGRESS_COMMAND
			&& (fixture.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_BUSY) !== 0
			&& (fixture.memory.readIoU32(IO_DMA1_STATUS) & DMA_STATUS_BUSY) !== 0;
	}
	assert.equal(betweenPackets, true, 'test must reach the DMA gap between texture and CLUT packets');

	fixture.machine.systemController.requestSupervisorLineEdge();
	for (let serviceCount = 0;
		serviceCount < 2000
			&& fixture.machine.systemController.captureState().supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.machine.systemController.captureState().supervisorPhase, SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE);
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_BUSY, IMGDEC_STATUS_BUSY);
	assert.equal(fixture.memory.readIoU32(IO_DMA1_STATUS), DMA_STATUS_BUSY);
	assert.equal(fixture.gpu.readDeviceOutput().commandBuffer.commandCount, 1);
	const pausedImgDec = fixture.machine.imgDecController.captureState();
	assert.equal(pausedImgDec.supervisorQuiesceRequested, true);
	assert.equal(pausedImgDec.scheduledDecodeWords, 0);

	for (let serviceCount = 0;
		serviceCount < 2000
			&& fixture.gpu.readDeviceOutput().commandBuffer.executedCommandCount
				!== fixture.gpu.readDeviceOutput().commandBuffer.commandCount;
		serviceCount += 1) {
		runNextService(fixture);
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	fixture.gpu.retirePresentedCommands();
	for (let serviceCount = 0;
		serviceCount < 2000
			&& fixture.machine.systemController.captureState().supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1) {
		runNextService(fixture);
	}
	assert.equal(fixture.machine.systemController.captureState().supervisorPhase, SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR);
	assert.deepEqual(fixture.machine.imgDecController.captureState(), pausedImgDec);
});

test('IMGDEC resumes a paused stream from the exact decoder and FIFO state', () => {
	const textureWordCount = 24;
	const streamWords = [
		IMGDEC_STREAM_MAGIC,
		textureWordCount,
		0,
		(IMGDEC_TOKEN_KIND_ZERO << IMGDEC_TOKEN_KIND_SHIFT) | (textureWordCount - 1),
	];
	const fixture = createFixture(new Uint8Array());
	fixture.memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, streamWords.length);
	fixture.memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_DESTINATION, 0x00200040);
	fixture.memory.writeMappedU32LE(IO_IMGDEC_TEXTURE_SIZE, 48 | (1 << 16));
	fixture.memory.writeMappedU32LE(IO_IMGDEC_CLUT_DESTINATION, 0);
	fixture.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	for (let index = 0; index < streamWords.length; index += 1) {
		fixture.memory.writeMappedDmaU32LE(
			IO_IMGDEC_DATA,
			streamWords[index]!,
			MAPPED_BUS_MASTER_DMA | (index + 1 === streamWords.length ? MAPPED_BUS_DMA_BLOCK_END : 0),
		);
	}
	assert.notEqual(fixture.machine.imgDecController.captureState().scheduledDecodeWords, 0);

	fixture.machine.imgDecController.beginSupervisorQuiesce();
	for (let serviceCount = 0;
		serviceCount < 10 && !fixture.machine.imgDecController.supervisorQuiescent();
		serviceCount += 1) {
		runNextService(fixture);
	}
	const paused = fixture.machine.imgDecController.captureState();
	assert.equal(fixture.machine.imgDecController.supervisorQuiescent(), true);
	assert.equal(paused.statusWord & IMGDEC_STATUS_BUSY, IMGDEC_STATUS_BUSY);
	assert.equal(paused.scheduledDecodeWords, 0);
	assert.deepEqual(paused.outputWords, [0xa0000000, 0x00200040, 48 | (1 << 16)]);

	fixture.machine.imgDecController.leaveSupervisorContext();
	const outputWords: number[] = [];
	for (let serviceCount = 0;
		serviceCount < 100 && fixture.memory.readIoU32(IO_IMGDEC_STATUS) !== IMGDEC_STATUS_DONE;
		serviceCount += 1) {
		const state = fixture.machine.imgDecController.captureState();
		if (state.outputWords.length !== 0) {
			outputWords.push(fixture.memory.readMappedU32LE(IO_IMGDEC_DATA));
		} else {
			runNextService(fixture);
		}
	}
	assert.equal(fixture.memory.readIoU32(IO_IMGDEC_STATUS), IMGDEC_STATUS_DONE);
	assert.deepEqual(outputWords.slice(0, 3), [0xa0000000, 0x00200040, 48 | (1 << 16)]);
	assert.deepEqual(outputWords.slice(3), new Array<number>(textureWordCount).fill(0));
});

test('supervisor control gates reject DMA writes before device registerfiles latch them', () => {
	const fixture = createFixture(new Uint8Array());
	const { machine, memory, gpu } = fixture;
	memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, 7);
	const gp1Word = gpu.captureState().gp1Word;
	const geometryState = machine.geometryController.captureState();
	const busSignals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END;
	gpu.beginSupervisorControlQuiesce();
	machine.imgDecController.beginSupervisorQuiesce();
	machine.geometryController.beginSupervisorQuiesce();

	memory.writeMappedDmaU32LE(
		IO_GX_GPU_GP1,
		(GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
		busSignals,
	);
	memory.writeMappedDmaU32LE(IO_IMGDEC_INPUT_WORD_COUNT, 99, busSignals);
	memory.writeMappedDmaU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START, busSignals);
	memory.writeMappedDmaU32LE(IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH, busSignals);

	assert.equal(gpu.captureState().gp1Word, gp1Word);
	assert.equal(memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT), 7);
	assert.equal(memory.readIoU32(IO_IMGDEC_CONTROL), 0);
	assert.deepEqual(machine.geometryController.captureState(), {
		...geometryState,
		supervisorQuiesceRequested: true,
	});
});

test('forced DMA presents IMGDEC input words even after the physical FIFO fills', () => {
	const fixture = createFixture(new Uint8Array());
	for (let index = 0; index <= IMGDEC_INPUT_FIFO_WORD_CAPACITY; index += 1) {
		fixture.memory.writeMappedDmaU32LE(
			IO_IMGDEC_DATA,
			index + 1,
			MAPPED_BUS_MASTER_DMA | (index === IMGDEC_INPUT_FIFO_WORD_CAPACITY ? MAPPED_BUS_DMA_BLOCK_END : 0),
		);
	}

	const state = fixture.machine.imgDecController.captureState();
	assert.equal(state.inputWordsReceived, IMGDEC_INPUT_FIFO_WORD_CAPACITY + 1);
	assert.equal(state.inputWords.length, IMGDEC_INPUT_FIFO_WORD_CAPACITY);
	assert.equal(state.inputWords[IMGDEC_INPUT_FIFO_WORD_CAPACITY - 1], IMGDEC_INPUT_FIFO_WORD_CAPACITY);
});

test('a format fault leaves an already admitted GP0 block untouched instead of rolling it back', () => {
	const textureWordCount = 24;
	const streamWords = new Uint32Array(6);
	streamWords[0] = IMGDEC_STREAM_MAGIC;
	streamWords[1] = textureWordCount;
	streamWords[2] = 0;
	streamWords[3] = (IMGDEC_TOKEN_KIND_REPEAT << IMGDEC_TOKEN_KIND_SHIFT) | 19;
	streamWords[4] = 0x12345678;
	streamWords[5] = (IMGDEC_TOKEN_KIND_BACK_REFERENCE << IMGDEC_TOKEN_KIND_SHIFT) | 20;
	const stream = Buffer.allocUnsafe(streamWords.byteLength);
	for (let index = 0; index < streamWords.length; index += 1) {
		stream.writeUInt32LE(streamWords[index]!, index << 2);
	}
	const fixture = createFixture(stream);
	armUpload(fixture, streamWords.length, textureWordCount, 0, 0, 48 | (1 << 16), 0);
	fixture.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	runUntilImgDecStatus(fixture, IMGDEC_STATUS_FORMAT_FAULT);
	while (fixture.memory.readIoU32(IO_DMA1_TRANSFER_COUNT) === textureWordCount + 3) {
		runNextService(fixture);
	}

	assert.equal(fixture.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(fixture.memory.readIoU32(IO_DMA1_STATUS), DMA_STATUS_BUSY);
	assert.equal(fixture.memory.readIoU32(IO_DMA1_TRANSFER_COUNT), 11);
	assert.equal(fixture.memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	const gpuState = fixture.gpu.captureState();
	assert.equal(gpuState.gp0IngressPhase, GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD);
	assert.equal(gpuState.gp0IngressWordsRemaining, 11);
	assert.equal(fixture.gpu.readDeviceOutput().commandBuffer.commandCount, 0);
	assert.equal(fixture.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMGDEC, IRQ_IMGDEC);
});

test('active IMGDEC and both DMA channels resume from one machine-state snapshot', () => {
	const textureWordCount = 128;
	const payload = Buffer.allocUnsafe(textureWordCount << 2);
	for (let index = 0; index < textureWordCount; index += 1) {
		payload.writeUInt32LE(Math.imul(index + 7, 0x45d9f3b) >>> 0, index << 2);
	}
	const stream = encodeImgDecStream(payload, textureWordCount, 0);
	const fixture = createFixture(stream);
	armUpload(fixture, stream.length >> 2, textureWordCount, 0, 0x00010020, 256 | (1 << 16), 0);
	fixture.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);

	let snapshot: MachineState | undefined;
	for (let serviceCount = 0; serviceCount < 2000 && snapshot === undefined; serviceCount += 1) {
		runNextService(fixture);
		const imgDecState = fixture.machine.imgDecController.captureState();
		if (imgDecState.outputWordsRead !== 0 && imgDecState.outputWordsRead < textureWordCount + 3) {
			snapshot = captureMachineState(fixture.machine);
		}
	}
	assert.ok(snapshot);
	assert.equal(snapshot.dma.channels[0].statusWord, DMA_STATUS_BUSY);
	assert.equal(snapshot.dma.channels[1].statusWord, DMA_STATUS_BUSY);
	runUntilImgDecStatus(fixture, IMGDEC_STATUS_DONE);
	runUntilGpuCommandCount(fixture, 1);
	let commands = fixture.gpu.readDeviceOutput().commandBuffer;
	const firstStart = commands.commandWordStart[0];
	const firstWords = Array.from(commands.words.subarray(firstStart, firstStart + commands.commandWordCount[0]));

	restoreMachineState(fixture.machine, snapshot);
	runUntilImgDecStatus(fixture, IMGDEC_STATUS_DONE);
	runUntilGpuCommandCount(fixture, 1);
	commands = fixture.gpu.readDeviceOutput().commandBuffer;
	const restoredStart = commands.commandWordStart[0];
	assert.deepEqual(
		Array.from(commands.words.subarray(restoredStart, restoredStart + commands.commandWordCount[0])),
		firstWords,
	);
});


test('DMA prefixes retain scalar FIFO, latch, counter and last-word scheduling effects', () => {
	for (let mode = 0; mode < 8; ++mode) for (const count of [1, 2, 7, 16]) {
		const rom = new Uint8Array(4096);
		for (let n = 0; n < 16; ++n) writeLE32(rom, n * 4, 0x137b0000 + n);
		const fixtures = [createFixture(rom), createFixture(rom)];
		let source = DYNAMIC_RAM_BASE + 0x1000, target = IO_IMGDEC_DATA, step = 4;
		if (mode === 1) source = CART_ROM_BASE;
		if (mode === 2 || mode === 3 || mode === 4) { source = IO_IMGDEC_DATA; step = 0; }
		if (mode === 2 || mode === 4 || mode === 5) target = IO_GX_GPU_GP0;
		if (mode === 5) step = 0;
		if (mode === 6) source = RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 8;
		if (mode === 7) source = CART_ROM_BASE + 4092;
		for (const f of fixtures) {
			for (let n = 0; n < 16; ++n) f.memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 0x1000 + 4 * n, 0);
			const state = f.machine.imgDecController.captureState();
			if (mode === 0 || mode === 1) {
				state.inputWords = Array(IMGDEC_INPUT_FIFO_WORD_CAPACITY - 1).fill(0x02460000);
				state.inputWordsReceived = 0xfffffff9;
			}
			if (mode === 3) {
				state.statusWord = IMGDEC_STATUS_BUSY;
				state.inputWordCountWord = 16;
				state.outputWords = [IMGDEC_STREAM_MAGIC, 12, 0, 11, ...Array.from({ length: 12 }, (_, n) => 0x81230000 + n)];
			}
			if (mode === 4) state.outputWords = [0, 0, 0];
			f.machine.imgDecController.restoreState(state);
			if (mode === 2) f.memory.writeIoU32(IO_IMGDEC_DATA, 0x13572468);
			if (mode === 4) {
				const gpu = f.gpu.captureState(); gpu.supervisorIngressStopped = true;
				f.gpu.restoreState(gpu); f.memory.writeIoU32(IO_GX_GPU_GP0, 0x24681357);
			}
		}
		const [a, b] = fixtures;
		for (let n = 0; n < count; ++n) {
			const signals = MAPPED_BUS_MASTER_DMA | (n + 1 === count ? MAPPED_BUS_DMA_BLOCK_END : 0);
			const word = a.memory.readMappedDmaU32LE((source + n * step) >>> 0, signals);
			a.memory.writeMappedDmaU32LE(target, word, signals);
		}
		b.memory.transferDmaBlock(source, target, count, step, 0, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
		assert.deepEqual(b.machine.imgDecController.captureState(), a.machine.imgDecController.captureState(), `IMGDEC mode=${mode} count=${count}`);
		assert.deepEqual(b.gpu.captureState(), a.gpu.captureState(), `GP0 mode=${mode} count=${count}`);
		if (mode === 3 && count === 16) assert.ok(b.machine.imgDecController.captureState().scheduledDecodeWords > 0);
		for (const address of [IO_IMGDEC_DATA, IO_IMGDEC_STATUS, IO_GX_GPU_GP0, IO_IRQ_FLAGS]) assert.equal(b.memory.readIoU32(address), a.memory.readIoU32(address));
		assert.equal(b.memory.readBusFaultSequence(), a.memory.readBusFaultSequence());
		assert.equal(b.machine.scheduler.nextDeadline(), a.machine.scheduler.nextDeadline());
	}
});

test('payload runs cross the history ring without changing any GP0 or retained history word', () => {
	const prefix = 2 * IMGDEC_HISTORY_WORD_CAPACITY - 5;
	const run = 33;
	const words = prefix + run + 4;
	for (let mode = 0; mode < 7; ++mode) {
		const stream = [IMGDEC_STREAM_MAGIC, words, 0,
			(IMGDEC_TOKEN_KIND_REPEAT << IMGDEC_TOKEN_KIND_SHIFT) | (prefix - 17), 0x7e813579,
			(IMGDEC_TOKEN_KIND_LITERAL << IMGDEC_TOKEN_KIND_SHIFT) | 15];
		const expected: number[] = Array(prefix - 16).fill(0x7e813579);
		for (let index = 0; index < 16; ++index) {
			const word = (0x80010001 + index * 0x01010101) >>> 0;
			stream.push(word);
			expected.push(word);
		}
		if (mode === 0) {
			stream.push((IMGDEC_TOKEN_KIND_LITERAL << IMGDEC_TOKEN_KIND_SHIFT) | (run - 1));
			for (let index = 0; index < run; ++index) {
				const word = 0xfedc0000 + index;
				stream.push(word);
				expected.push(word);
			}
		} else if (mode < 3) {
			const kind = mode === 1 ? IMGDEC_TOKEN_KIND_REPEAT : IMGDEC_TOKEN_KIND_ZERO;
			const word = mode === 1 ? 0xf000ffff : 0;
			stream.push((kind << IMGDEC_TOKEN_KIND_SHIFT) | (run - 1));
			if (mode === 1) stream.push(word);
			for (let index = 0; index < run; ++index) expected.push(word);
		} else {
			const distance = [1, 3, 16, IMGDEC_HISTORY_WORD_CAPACITY][mode - 3];
			stream.push((IMGDEC_TOKEN_KIND_BACK_REFERENCE << IMGDEC_TOKEN_KIND_SHIFT)
				| ((run - IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH) << IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
				| (distance - 1));
			for (let index = 0; index < run; ++index) expected.push(expected[expected.length - distance]);
		}
		stream.push((IMGDEC_TOKEN_KIND_LITERAL << IMGDEC_TOKEN_KIND_SHIFT) | 3);
		for (const word of [0xffffffff, 0, 0x8001ffff, 0x01234567]) {
			stream.push(word);
			expected.push(word);
		}
		const rom = new Uint8Array(stream.length * 4);
		for (let index = 0; index < stream.length; ++index) writeLE32(rom, index * 4, stream[index]);
		const fixture = createFixture(rom);
		armUpload(fixture, stream.length, words, 0, 0, 64 | (257 << 16), 0);
		fixture.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
		runUntilImgDecStatus(fixture, IMGDEC_STATUS_DONE);
		runUntilGpuCommandCount(fixture, 1);
		const state = fixture.machine.imgDecController.captureState();
		assert.equal(state.decodedWordCount, words);
		assert.deepEqual(state.historyWords, expected.slice(-IMGDEC_HISTORY_WORD_CAPACITY));
		const commands = fixture.gpu.readDeviceOutput().commandBuffer;
		assert.equal(commands.commandWordCount[0], words + 3);
		const first = commands.commandWordStart[0] + 3;
		assert.deepEqual(Array.from(commands.words.subarray(first, first + words)), expected, `mode=${mode}`);
	}
});
