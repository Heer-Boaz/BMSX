import { createBrowserBackend } from '../../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../../hosts/browser/video_output';
import { HostAudioOutput, type AudioOutputPuller } from '../../../hosts/common/audio_output';
import { HostFrameSession, runHostFrame } from '../../../hosts/common/host_frame';
import { HostOverlayMenu } from '../../../hosts/common/host_overlay_menu';
import { Input } from '../../../hosts/common/input/manager';
import { initializeMachineRuntime, initializeMachineVideoPresenter } from '../../../hosts/common/machine_runtime';
import { RenderPresentationState } from '../../../hosts/common/presentation_state';
import { HostRewind } from '../../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../../hosts/common/runtime_task_queue';
import { SystemOutputLog } from '../../../hosts/common/system_output_log';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { HistoryMode } from '../../../machine/ts/machine/runtime/history/history';
import { WebGPUBackend } from '../../../machine/ts/render/backend/webgpu/backend';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';

function require(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** Real browser backend and host loop; virtual time/input only make the test repeatable. */
export async function runBrowserRewindConformance(canvas: HTMLCanvasElement) {
	const bios = new Uint8Array(await (await fetch('/bios.rom')).arrayBuffer());
	const cart = new Uint8Array(await (await fetch('/cart.rom')).arrayBuffer());
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const runtime = initializeMachineRuntime(bios, [cart, null], PSX_MACHINE_SPEC, input);
	const backend = await createBrowserBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes);
	require(backend instanceof WebGPUBackend, 'this test requires actual WebGPU, not browser fallback');
	const errors: string[] = [];
	backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const presenter = initializeMachineVideoPresenter(runtime, new BrowserVideoOutput(canvas, null), backend);
	presenter.crt_postprocessing_enabled = false;
	let puller: AudioOutputPuller | null = null;
	let audioFrames = 0;
	let audible = false;
	const samples = new Int16Array(2048);
	const audioOutput = new HostAudioOutput({
		setRuntimeAudioPuller(value) { puller = value; },
		pumpRuntimeAudio() {
			if (!puller) return;
			const frames = puller(samples, 960, 48000);
			audioFrames += frames;
			for (let index = 0; index < frames * 2; index += 1) audible ||= samples[index] !== 0;
		},
		resume() {}, suspend() {}, setEmulationFrameTimeSec() {},
	}, runtime.machine.audioController, runtime.machine.audioOutput.outputRing, runtime.timing.ufpsScaled);
	const log = { log(level: number, message: string) { if (level === 3) errors.push(message); } };
	const tasks = new RuntimeTaskQueue(audioOutput, runtime, presenter);
	const presentation = new RenderPresentationState();
	const rewind = new HostRewind(runtime, presenter, presentation, tasks, audioOutput, log);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now(), rewind);
	const menu = new HostOverlayMenu(presenter, runtime, input, rewind);
	const output = new SystemOutputLog();
	const history = runtime.history;
	let hostFrames = 0;
	const frame = async () => {
		clock.advance(runtime.timing.frameDurationMs);
		runHostFrame(session, runtime, presenter, input, audioOutput, output, log, presentation, menu, clock.now());
		hostFrames += 1;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		require(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 0, 'real cart fault');
		require(errors.length === 0, errors.join('\n'));
	};
	const settle = async () => {
		for (let count = 0; count < 8000 && (!tasks.ready || history.mode === HistoryMode.Replaying); count += 1) await frame();
		require(tasks.ready && history.mode !== HistoryMode.Replaying, 'asynchronous seek must complete');
	};
	let pressId = 1;
	const press = async (...keys: string[]) => {
		const id = pressId++;
		for (const key of keys) input.inputButton('keyboard:0', key, true, 1, clock.now(), id);
		await frame();
		for (const key of keys) input.inputButton('keyboard:0', key, false, 0, clock.now(), id);
		await frame();
	};
	const openRewind = async () => {
		await press('ControlRight', 'AltRight');
		for (let index = 0; index < 3; index += 1) await press('ArrowUp');
		await press('KeyX');
	};
	runtime.boot();
	audioOutput.bootstrap();
	for (let count = 0; count < 8000 && history.latestCycles < runtime.timing.cpuHz * 22; count += 1) await frame();
	require(history.checkpointCount === 2 && history.earliestCycles > runtime.timing.cpuHz * 6, 'continuous two-slot collection must wrap');
	require(audible && audioFrames > 48000, 'ordinary play produces real audio');
	await openRewind();
	const latest = history.latestCycles;
	const checkpoint = history.checkpointCycles(1);
	await press('KeyX');
	await settle();
	require(history.mode === HistoryMode.Reviewing && runtime.machine.scheduler.currentNowCycles() === checkpoint, 'menu restores a checkpoint');
	await backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	const expectedVram = runtime.machine.gxGpu.readVramSnapshotBytes().slice();
	require(expectedVram.some(byte => byte !== 0), 'checkpoint contains real rendered pixels');
	const reviewAudio = audioFrames;
	for (let index = 0; index < 5; index += 1) await frame();
	require(audioFrames === reviewAudio, 'review must suppress abandoned and replay audio');
	for (let index = 0; index < 3; index += 1) await press('ArrowDown');
	await press('KeyX');
	await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	require(!rewind.active && runtime.machine.scheduler.currentNowCycles() >= latest, 'return rejoins live recording');
	require(audioFrames > reviewAudio, 'return resumes live audio');
	await openRewind();
	const branchEnd = history.latestCycles;
	await press('KeyX');
	await settle();
	require(runtime.machine.scheduler.currentNowCycles() === checkpoint, 'rejoining the present retains the old checkpoint');
	await backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	const actualVram = runtime.machine.gxGpu.readVramSnapshotBytes();
	require(actualVram.every((byte, index) => byte === expectedVram[index]), 'asynchronous restore preserves every VRAM byte');
	await press('ArrowDown'); await press('ArrowDown'); await press('KeyX');
	await settle();
	for (let index = 0; index < 20; index += 1) await frame();
	require(!rewind.active && history.latestCycles < branchEnd, 'resume here branches instead of returning to the future');
	await openRewind(); await press('KeyX'); await settle();
	await backend.device.queue.onSubmittedWorkDone();
	require(errors.length === 0, errors.join('\n'));
	return { backend: backend.type, hostFrames, checkpoint, latest, audioFrames, vramBytes: expectedVram.length };
}
