import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { f32BitsToNumber, numberToF32Bits } from '../../../machine/ts/machine/common/numeric';
import {
	GX_GPU_PCRTC_PMODE_EN1,
	GX_GPU_PCRTC_PMODE_EN2,
	GX_GPU_PCRTC_PMODE_LOW,
	gxGpuPcrtcRegisterAddress,
} from '../../../machine/ts/machine/devices/gx/gpu_pcrtc';
import {
	IO_CART_SELECT,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
} from '../../../machine/ts/spec/bmsx/io';
import {
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
} from '../../../machine/ts/spec/bmsx/cartridge';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
} from '../../../machine/ts/spec/bmsx/memory_map';
import * as studio from '../../../ide/workbench/contrib/studio/protocol';

const sourceExtensions = (Module as any)._extensions as Record<string, (module: any, filename: string) => void>;
for (const extension of ['.glsl', '.wgsl']) {
	sourceExtensions[extension] = (module, filename) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, gamePath, boardPath] = process.argv.slice(2);
	if (!systemPath || !gamePath || !boardPath) {
		throw new Error('Usage: ts_runner.ts SYSTEM_ROM GAME_ROM STUDIO_BOARD_ROM');
	}
	const [
		{ initializeMachineRuntime, initializeMachineVideoPresenter },
		{ HostFrameRunResult, HostFrameSession, runHostFrame },
		{ RenderPresentationState },
		{ HostOverlayMenu },
		{ HostAudioOutput },
		{ SystemOutputLog },
		{ HeadlessGPUBackend },
		{ HeadlessVideoOutput },
		{ Input },
		{ DiscardingAudioSink },
		{ VirtualHeadlessClock },
		{ HeadlessInputHub },
		{ PSX_MACHINE_SPEC },
	] = await Promise.all([
		import('../../../hosts/common/machine_runtime'),
		import('../../../hosts/common/host_frame'),
		import('../../../hosts/common/presentation_state'),
		import('../../../hosts/common/host_overlay_menu'),
		import('../../../hosts/common/audio_output'),
		import('../../../hosts/common/system_output_log'),
		import('../../../machine/ts/render/headless/backend'),
		import('../../../hosts/node/headless/video_output'),
		import('../../../hosts/common/input/manager'),
		import('../../../hosts/node/common/discarding_audio'),
		import('../../../hosts/node/headless/clock'),
		import('../../../hosts/node/headless/input'),
		import('../../../machine/ts/spec/bmsx/model'),
	]);
	const [systemRom, gameRom, boardRom] = await Promise.all([
		readFile(systemPath),
		readFile(gamePath),
		readFile(boardPath),
	]);

	const runScenario = async (gameSlot: 0 | 1): Promise<void> => {
		const boardSlot = (1 - gameSlot) as 0 | 1;
		const clock = new VirtualHeadlessClock();
		const input = new Input(clock, new HeadlessInputHub(), -1);
		const videoOutput = new HeadlessVideoOutput(320, 240);
		const cartridgeSlots: [Uint8Array, Uint8Array] = gameSlot === 0
			? [gameRom, boardRom]
			: [boardRom, gameRom];
		const runtime = initializeMachineRuntime(
			systemRom,
			cartridgeSlots,
			PSX_MACHINE_SPEC,
			input,
		);
		const backend = new HeadlessGPUBackend(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const presenter = initializeMachineVideoPresenter(runtime, videoOutput, backend);
		const audioOutput = new HostAudioOutput(
			new DiscardingAudioSink(),
			runtime.machine.audioController,
			runtime.machine.audioOutput.outputRing,
			runtime.timing.ufpsScaled,
		);
		const outputLines: string[] = [];
		const logOutput = {
			log(_level: number, message: string): void {
				outputLines.push(message);
			},
		};
		const systemOutput = new SystemOutputLog();
		const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now());
		runtime.resetForSystemBoot();
		runtime.boot();
		systemOutput.flush(runtime, logOutput);
		audioOutput.bootstrap();
		const presentation = new RenderPresentationState();
		const hostOverlayMenu = new HostOverlayMenu(presenter, runtime, input);
		runtime.frameScheduler.clearQueuedTime();
		let currentTimeMs = session.currentTimeMs;
		const runFrames = (frameCount: number): void => {
			for (let frame = 0; frame < frameCount; frame += 1) {
				currentTimeMs += runtime.timing.frameDurationMs;
				assert.equal(runHostFrame(
					session,
					runtime,
					presenter,
					input,
					audioOutput,
					systemOutput,
					logOutput,
					presentation,
					hostOverlayMenu,
					currentTimeMs,
				), HostFrameRunResult.Continue);
			}
		};
		runFrames(140);
		assert.equal(
			runtime.machine.memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE),
			0,
			outputLines.join('\n'),
		);

		const memory = runtime.machine.memory;
		memory.writeMappedU32LE(IO_CART_SELECT, boardSlot);
		const readBoardWord = (wordOffset: number): number =>
			memory.readMappedU32LE(CART_RAM_BASE + wordOffset * 4);
		const revision = readBoardWord(studio.STUDIO_HEADER_REVISION);
		assert.ok(revision !== 0 && (revision & 1) === 0);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_MAGIC), studio.STUDIO_DESCRIPTOR_MAGIC);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_VERSION), studio.STUDIO_DESCRIPTOR_VERSION);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_OBJECT_COUNT), 1);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_COMPONENT_COUNT), 1);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_GAME_SLOT), gameSlot);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_BOARD_SLOT), boardSlot);
		const objectOffset = readBoardWord(studio.STUDIO_HEADER_OBJECT_TABLE_WORD_OFFSET);
		const objectHandle = readBoardWord(objectOffset + studio.STUDIO_OBJECT_HANDLE);
		assert.ok(objectHandle !== 0);
		assert.equal(f32BitsToNumber(readBoardWord(objectOffset + studio.STUDIO_OBJECT_X)), 80);
		assert.equal(f32BitsToNumber(readBoardWord(objectOffset + studio.STUDIO_OBJECT_Y)), 72);
		assert.equal(f32BitsToNumber(readBoardWord(objectOffset + studio.STUDIO_OBJECT_PICK_RIGHT)), 128);
		assert.equal(f32BitsToNumber(readBoardWord(objectOffset + studio.STUDIO_OBJECT_PICK_BOTTOM)), 104);
		const overlayOrigin = readBoardWord(studio.STUDIO_HEADER_OVERLAY_ORIGIN);
		const gameOrigin = readBoardWord(studio.STUDIO_HEADER_GAME_ORIGIN);
		assert.notEqual(overlayOrigin, gameOrigin);
		memory.writeMappedU32LE(IO_CART_SELECT, gameSlot);
		assert.equal(
			memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW))
				& (GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2),
			GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2,
		);

		const writeCommand = (sequence: number, opcode: number, arg0 = 0, arg1 = 0, arg2 = 0): void => {
			memory.writeMappedU32LE(IO_CART_SELECT, boardSlot);
			const commandAddress = CART_RAM_BASE + studio.STUDIO_COMMAND_WORD_OFFSET * 4;
			memory.writeMappedU32LE(commandAddress + studio.STUDIO_COMMAND_OPCODE * 4, opcode);
			memory.writeMappedU32LE(commandAddress + studio.STUDIO_COMMAND_OBJECT_HANDLE * 4, objectHandle);
			memory.writeMappedU32LE(commandAddress + studio.STUDIO_COMMAND_ARG0 * 4, arg0);
			memory.writeMappedU32LE(commandAddress + studio.STUDIO_COMMAND_ARG1 * 4, arg1);
			memory.writeMappedU32LE(commandAddress + studio.STUDIO_COMMAND_ARG2 * 4, arg2);
			memory.writeMappedU32LE(commandAddress + studio.STUDIO_COMMAND_SEQUENCE * 4, sequence);
			memory.writeMappedU32LE(CART_MMIO_BASE + CARTRIDGE_MAILBOX_DATA_OFFSET, sequence);
			memory.writeMappedU32LE(
				CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET,
				CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
					| CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE
					| CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
			);
			memory.writeMappedU32LE(IO_CART_SELECT, gameSlot);
		};

		writeCommand(1, studio.STUDIO_COMMAND_SELECT);
		runFrames(4);
		memory.writeMappedU32LE(IO_CART_SELECT, boardSlot);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_APPLIED_COMMAND_SEQUENCE), 1);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_SELECTED_OBJECT_HANDLE), objectHandle);
		memory.writeMappedU32LE(IO_CART_SELECT, gameSlot);

		writeCommand(2, studio.STUDIO_COMMAND_SET_GAMEPLAY_RUNNING, 0);
		runFrames(4);
		memory.writeMappedU32LE(IO_CART_SELECT, boardSlot);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_APPLIED_COMMAND_SEQUENCE), 2);
		assert.equal(
			readBoardWord(studio.STUDIO_HEADER_FLAGS) & studio.STUDIO_FLAG_GAMEPLAY_RUNNING,
			0,
		);
		memory.writeMappedU32LE(IO_CART_SELECT, gameSlot);

		writeCommand(
			3,
			studio.STUDIO_COMMAND_SET_POS,
			numberToF32Bits(112),
			numberToF32Bits(96),
			numberToF32Bits(4),
		);
		runFrames(4);
		memory.writeMappedU32LE(IO_CART_SELECT, boardSlot);
		assert.equal(readBoardWord(studio.STUDIO_HEADER_APPLIED_COMMAND_SEQUENCE), 3);
		assert.equal(f32BitsToNumber(readBoardWord(objectOffset + studio.STUDIO_OBJECT_X)), 112);
		assert.equal(f32BitsToNumber(readBoardWord(objectOffset + studio.STUDIO_OBJECT_Y)), 96);
		memory.writeMappedU32LE(IO_CART_SELECT, gameSlot);

		await presenter.backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		const vram = runtime.machine.gxGpu.readVramSnapshotBytes();
		const vramWord = (origin: number, x: number, y: number): number => {
			const originX = origin & 0xffff;
			const originY = origin >>> 16;
			const byteOffset = ((originY + y) * 1024 + originX + x) * 2;
			return vram[byteOffset]! | (vram[byteOffset + 1]! << 8);
		};
		assert.ok((vramWord(gameOrigin, 112, 96) & 0x7fff) !== 0);
		assert.equal(vramWord(overlayOrigin, 80, 72), 0);
		assert.ok((vramWord(overlayOrigin, 112, 96) & 0x8000) !== 0);
	};

	await runScenario(0);
	await runScenario(1);
	process.stdout.write('BMSX-STUDIO-CONFORMANCE=GAME0-BOARD1|GAME1-BOARD0\n');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
