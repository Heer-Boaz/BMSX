import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const sourceExtensions = (Module as any)._extensions as Record<string, (module: any, filename: string) => void>;
for (const extension of ['.glsl', '.wgsl']) {
	sourceExtensions[extension] = (module, filename) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, dataPath, bootableCartPath] = process.argv.slice(2);
	if (!systemPath || !dataPath || !bootableCartPath) {
		throw new Error('Usage: ts_runner.ts SYSTEM_ROM DATA_CART_ROM BOOTABLE_CART_ROM');
	}

	const [
		{
			captureRuntimeSaveStateBytes,
			initializeMachineRuntime,
			initializeMachineVideoPresenter,
		},
		{ HostFrameSession, runHostFrame },
		{ RenderPresentationState },
		{ HostOverlayMenu },
		{ HostAudioOutput },
		{ SystemOutputLog },
		{ runGate },
		{ HeadlessGPUBackend },
		{ HeadlessVideoOutput },
		{ Input },
		{ SilentAudioSink },
		{ VirtualHeadlessClock },
		{ HeadlessInputHub },
		{ decodeRuntimeSaveState },
		{ applyRuntimeSaveState },
		{ CART_MMIO_BASE },
		{ CARTRIDGE_MAILBOX_CONTROL_OFFSET, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER },
		{ PSX_MACHINE_SPEC },
	] = await Promise.all([
		import('../../../hosts/common/machine_runtime'),
		import('../../../hosts/common/host_frame'),
		import('../../../hosts/common/presentation_state'),
		import('../../../hosts/common/host_overlay_menu'),
		import('../../../hosts/common/audio_output'),
		import('../../../hosts/common/system_output_log'),
		import('../../../machine/ts/common/taskgate'),
		import('../../../machine/ts/render/headless/backend'),
		import('../../../hosts/node/headless/video_output'),
		import('../../../hosts/common/input/manager'),
		import('../../../hosts/node/common/silent_audio'),
		import('../../../hosts/node/headless/clock'),
		import('../../../hosts/node/headless/input'),
		import('../../../machine/ts/machine/runtime/save_state/codec'),
		import('../../../machine/ts/machine/runtime/save_state'),
		import('../../../machine/ts/spec/bmsx/memory_map'),
		import('../../../machine/ts/spec/bmsx/cartridge'),
		import('../../../machine/ts/spec/bmsx/model'),
	]);

	const transcript: string[] = [];
	const logOutput = {
		log(_level: number, message: string): void {
			if (message.startsWith('CART-CONFORMANCE:')) {
				transcript.push(message.slice('CART-CONFORMANCE:'.length));
			}
		},
	};

	const [systemRom, dataRom, bootableCartRom] = await Promise.all([
		readFile(systemPath),
		readFile(dataPath),
		readFile(bootableCartPath),
	]);
	const clock = new VirtualHeadlessClock();
	const input = new Input(
		clock,
		new HeadlessInputHub(),
		-1,
	);
	const videoOutput = new HeadlessVideoOutput(256, 212);
	const runtime = initializeMachineRuntime(
		systemRom,
		[dataRom, bootableCartRom],
		PSX_MACHINE_SPEC,
		input,
	);
	const presenter = initializeMachineVideoPresenter(
		runtime,
		videoOutput,
		new HeadlessGPUBackend(
			256,
			212,
			PSX_MACHINE_SPEC.gxGpuVramBytes,
		),
	);
	const audioOutput = new HostAudioOutput(
		new SilentAudioSink(),
		runtime.machine.audioController,
		runtime.machine.audioOutput.outputRing,
		runtime.timing.ufpsScaled,
	);
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
	const transcriptCount = (entry: string): number => {
		let count = 0;
		for (let index = 0; index < transcript.length; index += 1) {
			if (transcript[index] === entry) {
				count += 1;
			}
		}
		return count;
	};
	const runUntil = (entry: string, count: number): void => {
		for (let frame = 0; frame < 240; frame += 1) {
			if (transcriptCount(entry) >= count) {
				return;
			}
			currentTimeMs += runtime.timing.frameDurationMs;
			runHostFrame(
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
				runGate.ready,
			);
		}
		throw new Error(`Guest did not publish ${entry} x${count}.`);
	};

	runUntil('READY', 1);
	const saved = await captureRuntimeSaveStateBytes(runtime, presenter);
	const mailboxControl = CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	runtime.machine.memory.writeMappedU32LE(mailboxControl, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	runUntil('STEP1', 1);
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(
			saved,
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().byteLength,
		),
	);
	runtime.machine.memory.writeMappedU32LE(mailboxControl, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	runUntil('STEP1', 2);

	process.stdout.write(`BMSX-CARTRIDGE-CONFORMANCE=${transcript.join('|')}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
