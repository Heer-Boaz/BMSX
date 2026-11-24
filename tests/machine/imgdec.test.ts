import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as io from '../../machine/ts/spec/bmsx/io';
import * as img from '../../machine/ts/spec/imgdec/registers';
import {
	IMGDEC_HISTORY_WORD_CAPACITY,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT, IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH,
	IMGDEC_TOKEN_KIND_BACK_REFERENCE, IMGDEC_TOKEN_KIND_SHIFT,
} from '../../machine/ts/spec/imgdec/stream';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GX_GPU_GP1_DMA_DIRECTION } from '../../machine/ts/spec/gx/gp1';
import { GX_GPU_DMA_DIRECTION_CPU_TO_GP0 } from '../../machine/ts/spec/gx/gp0';
import { GX_GPU_PCRTC_SMODE1_LOW, GX_GPU_PCRTC_SMODE1_SINT, gxGpuPcrtcRegisterAddress } from '../../machine/ts/spec/gx/pcrtc';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_IMGDEC } from '../../machine/ts/machine/scheduler/device';
import { captureMachineState, restoreMachineState } from '../../machine/ts/machine/save_state';
import { cartridgeSlots } from '../helpers/cartridge';
import { writeLE32 } from '../../machine/ts/common/endian';

function fixture(stream: number[] = [], secondSocket: Uint8Array | null = null) {
	const rom = new Uint8Array(stream.length * 4);
	for (let i = 0; i < stream.length; ++i) writeLE32(rom, i * 4, stream[i]);
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots(rom, secondSocket) }, PSX_MACHINE_SPEC.ramBytes);
	const machine = new Machine(memory, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} }, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const smode = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode, memory.readIoU32(smode) | GX_GPU_PCRTC_SMODE1_SINT);
	machine.gxGpu.onService(0);
	const services = new Uint32Array(DEVICE_SERVICE_IMGDEC + 1);
	const pump = () => {
		const deadline = machine.scheduler.nextDeadline();
		assert.notEqual(deadline, Number.MAX_SAFE_INTEGER, 'pipeline retains a pending hardware event');
		if (!machine.scheduler.hasDueTimer()) machine.scheduler.advanceTo(deadline);
		while (machine.scheduler.hasDueTimer()) {
			const kind = machine.scheduler.popDueTimer();
			services[kind] += 1;
			machine.runDeviceService(kind);
		}
	};
	const configure = (inputWords: number, outputWords: number) => {
		memory.writeMappedU32LE(io.IO_IMGDEC_INPUT_WORD_COUNT, inputWords);
		memory.writeMappedU32LE(io.IO_IMGDEC_OUTPUT_WORD_COUNT, outputWords);
	};
	const inputDma = () => {
		memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, CART_ROM_BASE);
		memory.writeMappedU32LE(io.IO_DMA0_WRITE_ADDR, io.IO_IMGDEC_DATA);
		memory.writeMappedU32LE(io.IO_DMA0_TRANSFER_COUNT, stream.length);
		memory.writeMappedU32LE(io.IO_DMA0_CONTROL, 0x00000003);
		memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_START);
	};
	const outputDma = (count: number) => {
		memory.writeMappedU32LE(io.IO_DMA1_READ_ADDR, io.IO_IMGDEC_DATA);
		memory.writeMappedU32LE(io.IO_DMA1_WRITE_ADDR, io.IO_GX_GPU_GP0);
		memory.writeMappedU32LE(io.IO_DMA1_TRANSFER_COUNT, count);
		memory.writeMappedU32LE(io.IO_DMA1_CONTROL, 0x00000005);
		memory.writeMappedU32LE(io.IO_DMA1_TRIGGER, io.DMA_TRIGGER_START);
	};
	const header = (destination: number, size: number) => {
		machine.gxGpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
		for (const word of [0xa0000000, destination, size]) memory.writeMappedU32LE(io.IO_GX_GPU_GP0, word);
	};
	const drain = () => {
		const words: number[] = [];
		for (let i = 0; i < 100000 && (memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_BUSY) !== 0; ++i) {
			if ((memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_OUTPUT_REQUEST) !== 0) words.push(memory.readMappedU32LE(io.IO_IMGDEC_DATA));
			else pump();
		}
		assert.equal(memory.readIoU32(io.IO_IMGDEC_STATUS), img.IMGDEC_STATUS_DONE);
		return words;
	};
	return { memory, machine, services, pump, configure, inputDma, outputDma, header, drain };
}

test('raw IMGDEC publishes whole blocks at completion, without GPU packet or token-run events', () => {
	const h = fixture();
	h.configure(2, 273);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 0x80000001);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 0x40000110);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 0xfedcba98);
	const pending = h.machine.imgDecController.captureState();
	assert.equal(pending.controlWord, 0x80000000);
	assert.equal(pending.assembledWordCount, 256);
	assert.equal(pending.decodedWordCount, 0);
	assert.equal(pending.blockCyclesRemaining, 512);
	h.machine.scheduler.advanceTo(511);
	assert.equal(h.machine.scheduler.hasDueTimer(), false);
	assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DECODED_WORD_COUNT), 0);
	assert.equal(h.memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_OUTPUT_REQUEST, 0);
	h.pump();
	assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DECODED_WORD_COUNT), 256);
	for (let i = 0; i < 256; ++i) assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DATA), 0xfedcba98);
	assert.equal(h.machine.imgDecController.captureState().blockCyclesRemaining, 34);
	h.pump();
	for (let i = 0; i < 17; ++i) assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DATA), 0xfedcba98);
	assert.equal(h.memory.readIoU32(io.IO_IMGDEC_STATUS), img.IMGDEC_STATUS_DONE);
	assert.equal(h.services[DEVICE_SERVICE_IMGDEC], 2);
	assert.notEqual(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_IMGDEC, 0);
});

test('unaligned socket-1 DMA borrows only backed IMGDEC input and retains the scalar terminal word', () => {
	const inputCount = 256, outputCount = inputCount - 1;
	const slot1 = new Uint8Array(1 + inputCount * 4), expected = new Uint32Array(outputCount);
	writeLE32(slot1, 1, outputCount - 1);
	for (let i = 0; i < outputCount - 1; ++i) {
		expected[i] = 0x87654321 ^ (i << 12);
		writeLE32(slot1, 1 + (i + 1) * 4, expected[i]);
	}
	expected[outputCount - 1] = 0x6d5aa5c3;
	writeLE32(slot1, slot1.byteLength - 4, expected[outputCount - 1]);
	const h = fixture([0, 0], slot1), { memory, machine } = h;
	const { scheduler, dmaController } = machine, faults = memory.readBusFaultSequence();
	memory.writeMappedU32LE(io.IO_CART_SELECT, 0);
	assert.equal(memory.readMappedU32LE(CART_ROM_BASE + 1), 0);
	h.configure(inputCount, outputCount);
	h.header(0x00200040, (2 * outputCount) | (1 << 16));
	h.outputDma(outputCount);
	memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, CART_ROM_BASE + 1);
	memory.writeMappedU32LE(io.IO_DMA0_TRANSFER_COUNT, inputCount);
	memory.writeMappedU32LE(io.IO_DMA0_CONTROL, io.DMA_ROUTE_TO_IMGDEC | (1 << io.DMA_CONTROL_READ_SLOT_SHIFT));
	memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_START);
	memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, img.IMGDEC_CONTROL_START);
	const admitted = dmaController.captureState(), inputEdge = scheduler.nowCycles + admitted.scheduledBlockCycles;
	assert.equal(admitted.activeChannel, 0);
	assert.equal(admitted.scheduledBlockWords, inputCount);
	assert.ok(admitted.scheduledBlockCycles > 0);
	assert.equal(memory.readMappedU32LE(io.IO_IMGDEC_INPUT_WORDS_RECEIVED), 0);
	for (let i = 0; i < 16 && scheduler.nowCycles < inputEdge; ++i) h.pump();
	const decoder = machine.imgDecController.captureState();
	assert.equal(scheduler.nowCycles, inputEdge);
	assert.equal(decoder.inputWordsReceived, inputCount);
	assert.equal(decoder.dataWord, expected[outputCount - 1]);
	assert.equal(decoder.decodedWordCount, 0);
	assert.equal(decoder.blockCyclesRemaining, outputCount * PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord);
	assert.equal(memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(io.IO_DMA0_READ_ADDR), CART_ROM_BASE + 1 + inputCount * 4);
	assert.equal(memory.readBusFaultSequence(), faults);
	for (let i = 0; i < 16 && machine.gxGpu.readDeviceOutput().commandBuffer.commandCount === 0; ++i) h.pump();
	const commands = machine.gxGpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandWordCount[0], 3 + outputCount);
	const first = commands.commandWordStart[0] + 3;
	assert.deepEqual(commands.words.slice(first, first + outputCount), expected);
});

test('texture and CLUT DMA preserves ring offsets, latches and completion after restoring an admitted burst', () => {
	const textureWords = 4200, clutWords = 8, total = textureWords + clutWords;
	const stream = [total - 1];
	for (let i = 0; i < total; ++i) stream.push((0x80010001 + i * 0x10001) >>> 0);
	const h = fixture(stream);
	h.configure(stream.length, total);
	h.header(0x00200040, 84 | (100 << 16));
	h.outputDma(textureWords);
	h.inputDma();
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
	const beforeWrap = IMGDEC_HISTORY_WORD_CAPACITY - img.IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY;
	for (let i = 0; i < 1000; ++i) {
		if (h.memory.readIoU32(io.IO_DMA1_TRANSFER_COUNT) === textureWords - beforeWrap
			&& h.machine.dmaController.captureState().activeChannel === 1) break;
		h.pump();
	}
	const saved = captureMachineState(h.machine);
	assert.equal(saved.imgDec.outputWordsRead, beforeWrap);
	assert.equal(saved.dma.activeChannel, 1);
	assert.equal(saved.dma.scheduledBlockWords, img.IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY);
	assert.ok(saved.dma.scheduledBlockCycles > 0);
	const replay = fixture(stream);
	replay.machine.scheduler.advanceTo(h.machine.scheduler.currentNowCycles());
	restoreMachineState(replay.machine, saved);

	const finish = (job: ReturnType<typeof fixture>) => {
		const decoderEvents = job.services[DEVICE_SERVICE_IMGDEC], dmaEvents = job.services[DEVICE_SERVICE_DMA];
		for (let i = 0; i < 1000 && job.memory.readIoU32(io.IO_DMA1_STATUS) !== io.DMA_STATUS_DONE; ++i) job.pump();
		assert.equal(job.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_DONE);
		assert.equal(job.machine.imgDecController.captureState().outputWordsRead, textureWords);
		assert.equal(job.machine.gxGpu.captureState().gp0Word, stream[textureWords]);
		job.header(0x00400100, 16 | (1 << 16));
		job.outputDma(clutWords);
		for (let i = 0; i < 1000 && job.memory.readIoU32(io.IO_IMGDEC_STATUS) !== img.IMGDEC_STATUS_DONE; ++i) job.pump();
		for (let i = 0; i < 1000 && job.machine.gxGpu.readDeviceOutput().commandBuffer.commandCount !== 2; ++i) job.pump();
		assert.equal(job.memory.readIoU32(io.IO_IMGDEC_STATUS), img.IMGDEC_STATUS_DONE);
		assert.equal(job.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_DONE);
		const irqs = io.IRQ_IMGDEC | io.IRQ_DMA0_DONE | io.IRQ_DMA1_DONE;
		assert.equal(job.memory.readIoU32(io.IO_IRQ_FLAGS) & irqs, irqs);
		assert.equal(job.memory.readIoU32(io.IO_IMGDEC_DATA), stream[total]);
		assert.equal(job.machine.gxGpu.captureState().gp0Word, stream[total]);
		const commands = job.machine.gxGpu.readDeviceOutput().commandBuffer;
		assert.equal(commands.commandCount, 2);
		assert.equal(commands.commandWordCount[0], textureWords + 3);
		assert.equal(commands.commandWordCount[1], clutWords + 3);
		for (let i = 0; i < total; ++i) {
			const command = i < textureWords ? 0 : 1, offset = i < textureWords ? i : i - textureWords;
			assert.equal(commands.words[commands.commandWordStart[command] + 3 + offset], stream[i + 1]);
		}
		return [job.services[DEVICE_SERVICE_IMGDEC] - decoderEvents, job.services[DEVICE_SERVICE_DMA] - dmaEvents,
			job.machine.scheduler.currentNowCycles()];
	};
	assert.deepEqual(finish(replay), finish(h), 'published work resumes at the same edges, without saving a borrowed slice');
	assert.equal(h.services[DEVICE_SERVICE_IMGDEC], 17);
});

test('withdrawing IMGDEC requests leaves an admitted output burst intact', () => {
	const first = 0xc0051234, last = 0x1f009087;
	const h = fixture([1, first, last]);
	h.configure(3, 2);
	h.header(0x00200040, 4 | (1 << 16));
	h.outputDma(2);
	h.inputDma();
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, img.IMGDEC_CONTROL_START);
	for (let i = 0; i < 16 && h.machine.dmaController.captureState().activeChannel !== 1; ++i) h.pump();
	const admitted = h.machine.dmaController.captureState();
	assert.equal(admitted.activeChannel, 1);
	assert.equal(admitted.scheduledBlockWords, 2);
	const dmaEdge = h.machine.scheduler.nowCycles + admitted.scheduledBlockCycles;
	h.machine.imgDecController.beginSupervisorQuiesce();
	h.machine.gxGpu.beginSupervisorQuiesce();
	assert.equal(h.memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_OUTPUT_REQUEST, 0);
	assert.equal(h.machine.dmaController.captureState().scheduledBlockCycles, admitted.scheduledBlockCycles);
	h.machine.scheduler.advanceTo(dmaEdge - 1);
	const before = h.machine.gxGpu.captureState();
	assert.equal(before.commandBuffer.commandCount, 0);
	assert.equal(before.commandBuffer.words.length, 3);
	assert.equal(before.gp0Word, 4 | (1 << 16));
	const commands = h.machine.gxGpu.readDeviceOutput().commandBuffer;
	for (let i = 0; i < 16 && commands.commandCount === 0; ++i) h.pump();
	assert.equal(h.machine.scheduler.nowCycles, dmaEdge);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandWordCount[0], 5);
	assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_DONE);
	assert.equal(h.machine.imgDecController.captureState().outputWordsRead, 2);
	const after = h.machine.gxGpu.captureState();
	assert.equal(after.gp0Word, last);
	assert.ok(after.pendingCommandCycles > 0);
	assert.equal(commands.executedCommandCount, 0);
	assert.equal(h.machine.gxGpu.backendServicePending(), false);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
	const gpuEdge = dmaEdge + after.pendingCommandCycles;
	while (h.machine.scheduler.nextDeadline() <= gpuEdge) h.pump();
	assert.equal(h.machine.scheduler.nowCycles, gpuEdge);
	assert.equal(commands.executedCommandCount, 1);
	h.machine.imgDecController.leaveSupervisorContext();
	const start = commands.commandWordStart[0] + 3;
	assert.equal(commands.words[start], first);
	assert.equal(commands.words[start + 1], last);
	assert.equal(h.memory.readIoU32(io.IO_IMGDEC_STATUS), img.IMGDEC_STATUS_DONE);
});

test('an admitted IMGDEC upload waits behind an active readback and emits the same packet once released', () => {
	const first = 0xc0051234, last = 0x1f009087;
	const uploads: number[][] = [];
	for (const blocked of [false, true]) {
		const h = fixture([1, first, last]);
		const gpu = h.machine.gxGpu;
		if (blocked) {
			for (const word of [0xc0000000, 0, 0x00010002]) gpu.writeGp0(word);
			for (let i = 0; i < 16 && !gpu.backendServicePending(); ++i) h.pump();
			assert.equal(gpu.backendServicePending(), true);
		}
		h.configure(3, 2);
		h.header(0x00200040, 0x00010004);
		h.outputDma(2);
		h.inputDma();
		h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, img.IMGDEC_CONTROL_START);
		for (let i = 0; i < 16 && h.memory.readIoU32(io.IO_DMA1_STATUS) !== io.DMA_STATUS_DONE; ++i) h.pump();
		assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_DONE);
		assert.equal(h.memory.readIoU32(io.IO_IMGDEC_DATA), last);
		const output = gpu.readDeviceOutput(), commands = output.commandBuffer;
		if (blocked) {
			const queued = gpu.captureState();
			assert.equal(queued.gp0Word, last);
			assert.equal(queued.gp0ImageLoadWordsRemaining, 0);
			assert.equal(commands.commandCount, 1);
			assert.deepEqual(queued.gp0FifoWords, [0xa0000000, 0x00200040, 0x00010004, first, last]);
			const readback = output.readbackPort;
			assert.equal(readback.claimReadback(commands.executedCommandCount), true);
			writeLE32(readback.pixelBytes, 0, 0x34561234);
			readback.completeReadback(readback.token);
			assert.equal(gpu.readGp0(), 0x34561234);
		}
		assert.equal(commands.commandCount, blocked ? 2 : 1);
		const start = commands.commandWordStart[blocked ? 1 : 0];
		uploads.push(Array.from(commands.words.subarray(start, start + 5)));
		assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
	}
	assert.deepEqual(uploads[0], uploads[1]);
});

for (let mode = 0; mode < 7; ++mode) test(`run kind/distance ${mode} crosses block and history boundaries exactly`, () => {
	const prefix = 8187, run = 333;
	const stream = [0x40000000 | (prefix - 17), 0x7e813579, 15];
	const expected = Array<number>(prefix - 16).fill(0x7e813579);
	for (let i = 0; i < 16; ++i) { const word = (0x80010001 + i * 0x01010101) >>> 0; stream.push(word); expected.push(word); }
	if (mode === 0) {
		stream.push(run - 1);
		for (let i = 0; i < run; ++i) { stream.push(0xfedc0000 + i); expected.push(stream[stream.length - 1]); }
	} else if (mode < 3) {
		const word = mode === 1 ? 0xf000ffff : 0;
		stream.push((mode === 1 ? 0x40000000 : 0xc0000000) | (run - 1));
		if (mode === 1) stream.push(word);
		expected.push(...Array<number>(run).fill(word));
	} else {
		const distance = [1, 3, 16, 4096][mode - 3];
		stream.push(0x80000000 | ((run - 3) << 12) | (distance - 1));
		for (let i = 0; i < run; ++i) expected.push(expected[expected.length - distance]);
	}
	stream.push(3);
	for (const word of [0xffffffff, 0, 0x8001ffff, 0x01234567]) { stream.push(word); expected.push(word); }
	const h = fixture(stream);
	h.configure(stream.length, expected.length);
	h.inputDma();
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
	assert.deepEqual(h.drain(), expected);
	assert.deepEqual(h.machine.imgDecController.captureState().historyWords, expected.slice(-4096));
});

test('distance-one back-reference output and timing survive an in-flight restore', () => {
	const block = img.IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY, run = block + 17, total = 1 + run;
	const word = 0xfedcba98;
	const token = ((IMGDEC_TOKEN_KIND_BACK_REFERENCE << IMGDEC_TOKEN_KIND_SHIFT)
		| ((run - IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH) << IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)) >>> 0;
	const h = fixture();
	h.configure(3, total);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, img.IMGDEC_CONTROL_START);
	for (const input of [0, word, token]) h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, input);
	const checkpoint = 113;
	h.machine.scheduler.advanceTo(checkpoint);
	const pending = captureMachineState(h.machine);
	assert.equal(pending.imgDec.assembledWordCount, block);
	assert.equal(pending.imgDec.decodedWordCount, 0);
	assert.equal(pending.imgDec.runWordsRemaining, total - block);
	const cyclesPerWord = PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord;
	assert.equal(pending.imgDec.blockCyclesRemaining, block * cyclesPerWord - checkpoint);

	const restored = fixture();
	restored.machine.scheduler.advanceTo(checkpoint);
	restoreMachineState(restored.machine, pending);
	const expected = Array<number>(total).fill(word);
	for (const row of [h, restored]) {
		assert.deepEqual(row.drain(), expected);
		assert.equal(row.services[DEVICE_SERVICE_IMGDEC], 2);
		assert.equal(row.machine.scheduler.currentNowCycles(), total * cyclesPerWord);
		assert.notEqual(row.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_IMGDEC, 0);
	}
});

test('partial filling, scheduled completion and partly read blocks restore without another output FIFO', () => {
	const h = fixture();
	h.configure(301, 300);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 299);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 0x12345678);
	const partial = captureMachineState(h.machine);
	assert.deepEqual(partial.imgDec.historyWords, [0x12345678]);
	h.machine.imgDecController.beginSupervisorQuiesce();
	assert.equal(h.machine.imgDecController.supervisorQuiescent(), true);
	restoreMachineState(h.machine, partial);
	const expected = [0x12345678];
	for (let i = 1; i < 300; ++i) { expected.push(i * 0x10203); h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, expected[i]); }
	assert.deepEqual(h.drain(), expected);
	h.machine.imgDecController.reset();
	h.configure(1, 300);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 0xc000012b);
	const start = h.machine.scheduler.currentNowCycles();
	h.machine.scheduler.advanceTo(start + 100);
	const pending = captureMachineState(h.machine);
	assert.equal(pending.imgDec.blockCyclesRemaining, 412);
	h.machine.imgDecController.beginSupervisorQuiesce();
	assert.equal(h.machine.imgDecController.supervisorQuiescent(), false);
	for (let i = 0; i < 8 && !h.machine.imgDecController.supervisorQuiescent(); ++i) h.pump();
	assert.equal(h.machine.imgDecController.supervisorQuiescent(), true);
	restoreMachineState(h.machine, pending);
	assert.equal(h.machine.imgDecController.captureState().blockCyclesRemaining, 412);
	for (let i = 0; i < 8 && (h.memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_OUTPUT_REQUEST) === 0; ++i) h.pump();
	for (let i = 0; i < 13; ++i) assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DATA), 0);
	const ready = captureMachineState(h.machine);
	h.memory.readMappedU32LE(io.IO_IMGDEC_DATA);
	restoreMachineState(h.machine, ready);
	assert.deepEqual(h.drain(), Array<number>(287).fill(0));
});

test('malformed work faults before publication; an empty job emits no invented packet', () => {
	for (const stream of [[0x80000000], [0], [0x40000000], [0xc0000001], [0xc0000000, 0]]) {
		const h = fixture(stream);
		h.configure(stream.length, 1);
		h.inputDma();
		h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
		for (let i = 0; i < 100 && (h.memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_BUSY) !== 0; ++i) h.pump();
		assert.equal(h.memory.readIoU32(io.IO_IMGDEC_STATUS), img.IMGDEC_STATUS_FORMAT_FAULT);
		assert.equal(h.machine.imgDecController.captureState().decodedWordCount, 0);
	}
	const h = fixture();
	h.configure(0, 0);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
	assert.equal(h.memory.readIoU32(io.IO_IMGDEC_STATUS), img.IMGDEC_STATUS_DONE);
});

test('wrapped history restores both a partly assembled block and unread output', () => {
	const h = fixture();
	const prefix = IMGDEC_HISTORY_WORD_CAPACITY;
	h.configure(12, prefix + 34);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_CONTROL, 1);
	for (const word of [3, 11, 22, 33, 44, 0x40000000 | (prefix - 5), 99]) {
		h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, word);
	}
	for (let i = 0; i < prefix; ++i) {
		while ((h.memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_OUTPUT_REQUEST) === 0) h.pump();
		assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DATA), i < 4 ? (i + 1) * 11 : 99);
	}
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 2);
	h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, 101);
	const filling = captureMachineState(h.machine);
	assert.equal(filling.imgDec.assembledWordCount, prefix + 1);
	assert.equal(filling.imgDec.historyWords.at(-1), 101);
	restoreMachineState(h.machine, filling);
	for (const word of [102, 103, 0x80000000 | (28 << 12) | (prefix - 1)]) {
		h.memory.writeMappedU32LE(io.IO_IMGDEC_DATA, word);
	}
	while ((h.memory.readIoU32(io.IO_IMGDEC_STATUS) & img.IMGDEC_STATUS_OUTPUT_REQUEST) === 0) h.pump();
	assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DATA), 101);
	const ready = captureMachineState(h.machine);
	assert.equal(h.memory.readMappedU32LE(io.IO_IMGDEC_DATA), 102);
	restoreMachineState(h.machine, ready);
	assert.deepEqual(h.drain(), [102, 103, 44, ...Array<number>(30).fill(99)]);
});
