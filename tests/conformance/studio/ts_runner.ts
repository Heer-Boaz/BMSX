import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { numberToF32Bits } from '../../../machine/ts/machine/common/numeric';
import {
	GX_GPU_PCRTC_PMODE_EN1,
	GX_GPU_PCRTC_PMODE_EN2,
	GX_GPU_PCRTC_PMODE_LOW,
	gxGpuPcrtcRegisterAddress,
} from '../../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { StudioBoardConnection } from '../../../ide/workbench/contrib/studio/connection';
import { StudioDescriptorModel } from '../../../ide/workbench/contrib/studio/model';
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
		const connection = new StudioBoardConnection(memory, { gameSlot, boardSlot });
		const model = new StudioDescriptorModel(connection);
		assert.equal(model.synchronize(), true);
		let snapshot = model.snapshot;
		const revision = snapshot.revision;
		assert.ok(revision !== 0 && (revision & 1) === 0);
		assert.equal(snapshot.objectCount, 1);
		assert.equal(snapshot.componentCount, 1);
		assert.equal(snapshot.gameSlot, gameSlot);
		assert.equal(snapshot.boardSlot, boardSlot);
		const object = snapshot.objects.peek(0);
		const component = snapshot.components.peek(0);
		const objectHandle = object.handle;
		const componentHandle = component.handle;
		assert.ok(objectHandle !== 0);
		assert.ok(componentHandle !== 0);
		assert.equal(object.x, 80);
		assert.equal(object.y, 72);
		assert.equal(object.pickRight, 128);
		assert.equal(object.pickBottom, 104);
		const overlayOrigin = snapshot.overlayOrigin;
		const gameOrigin = snapshot.gameOrigin;
		assert.notEqual(overlayOrigin, gameOrigin);
		assert.equal(
			memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW))
				& (GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2),
			GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2,
		);

		const applyCommand = (
			opcode: number,
			selectedObject: number,
			selectedComponent: number,
			arg0 = 0,
			arg1 = 0,
			arg2 = 0,
		): number => {
			const sequence = connection.submit(
				opcode,
				selectedObject,
				selectedComponent,
				arg0,
				arg1,
				arg2,
				0,
				0,
				0,
			);
			assert.equal(connection.commandPending, true);
			runFrames(4);
			assert.equal(model.synchronize(), true);
			snapshot = model.snapshot;
			assert.equal(snapshot.appliedCommandSequence, sequence);
			assert.equal(connection.commandPending, false);
			return sequence;
		};

		applyCommand(studio.STUDIO_COMMAND_SELECT, objectHandle, 0);
		assert.equal(snapshot.selectedObjectHandle, objectHandle);
		assert.equal(snapshot.selectedComponentHandle, 0);

		applyCommand(studio.STUDIO_COMMAND_SET_GAMEPLAY_RUNNING, 0, 0, 0);
		assert.equal(
			snapshot.flags & studio.STUDIO_FLAG_GAMEPLAY_RUNNING,
			0,
		);

		applyCommand(
			studio.STUDIO_COMMAND_SET_POS,
			objectHandle,
			0,
			numberToF32Bits(112),
			numberToF32Bits(96),
			numberToF32Bits(4),
		);
		assert.equal(snapshot.objects.peek(0).x, 112);
		assert.equal(snapshot.objects.peek(0).y, 96);

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

		applyCommand(studio.STUDIO_COMMAND_SET_VISIBLE, objectHandle, 0, 0);
		assert.equal(snapshot.objects.peek(0).flags & studio.STUDIO_OBJECT_FLAG_VISIBLE, 0);
		applyCommand(studio.STUDIO_COMMAND_SET_VISIBLE, objectHandle, 0, 1);
		assert.notEqual(snapshot.objects.peek(0).flags & studio.STUDIO_OBJECT_FLAG_VISIBLE, 0);

		applyCommand(studio.STUDIO_COMMAND_SET_COMPONENT_ENABLED, objectHandle, componentHandle, 0);
		assert.equal(snapshot.components.peek(0).flags & studio.STUDIO_COMPONENT_FLAG_ENABLED, 0);
		applyCommand(studio.STUDIO_COMMAND_SET_COMPONENT_ENABLED, objectHandle, componentHandle, 1);
		assert.notEqual(snapshot.components.peek(0).flags & studio.STUDIO_COMPONENT_FLAG_ENABLED, 0);

		applyCommand(studio.STUDIO_COMMAND_SELECT, objectHandle, componentHandle);
		assert.equal(snapshot.selectedObjectHandle, objectHandle);
		assert.equal(snapshot.selectedComponentHandle, componentHandle);
	};

	await runScenario(0);
	await runScenario(1);
	process.stdout.write('BMSX-STUDIO-CONFORMANCE=GAME0-BOARD1|GAME1-BOARD0\n');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
