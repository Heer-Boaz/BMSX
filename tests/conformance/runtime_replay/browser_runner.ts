import { testWebGpuReadbackLifetime } from './browser_gpu_readbacks';
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
	const { Host2DKind } = await import('../../../machine/ts/render/host_overlay/commands');
	let renderedTimelineStatus: string | undefined;
	const publishMenu = presenter.hostOverlayQueue.publishHostMenuFrame.bind(presenter.hostOverlayQueue);
	presenter.hostOverlayQueue.publishHostMenuFrame = frame => {
		// Observe the submitted view; do not queue a second draw after service.
		let timeline = false;
		let status = '';
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const text = (frame.commandRefs[index] as import('../../../machine/ts/render/shared/submissions').GlyphRenderSubmission).items as string;
			timeline ||= text.startsWith('REWIND ');
			if (text === 'SEEKING' || text === 'STOPPED') status = text;
		}
		if (timeline) renderedTimelineStatus = status;
		publishMenu(frame);
	};
	const frame = async () => {
		renderedTimelineStatus = undefined;
		clock.advance(runtime.timing.frameDurationMs);
		runHostFrame(session, runtime, presenter, input, audioOutput, output, log, presentation, menu, clock.now());
		if (renderedTimelineStatus !== undefined) {
			const expected = rewind.stopped ? 'STOPPED' : rewind.seeking ? 'SEEKING' : '';
			require(renderedTimelineStatus === expected, 'overlay reflects completion in the serviced host frame');
		}
		hostFrames += 1;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		require(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 0, 'real cart fault');
		require(errors.length === 0, errors.join('\n'));
	};
	const settle = async () => {
		for (let count = 0; count < 8000 && (!tasks.ready || rewind.seeking); count += 1) await frame();
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
	const checkpoint = history.earliestCycles;
	await press('ShiftLeft'); await settle();
	const selected = runtime.machine.scheduler.currentNowCycles();
	require(history.mode === HistoryMode.Reviewing && selected < latest, 'LB keyboard binding previews recorded time');
	await press('ShiftRight'); await settle();
	require(runtime.machine.scheduler.currentNowCycles() === latest && rewind.positionCycles === latest, 'LB/RB round trip returns exactly to the recorded end');
	// The slider uses screen-space pointer input, not a test-only seek command.
	const clickTimeline = async (viewportX: number) => {
		const bounds = canvas.getBoundingClientRect();
		const x = bounds.left + viewportX * bounds.width / presenter.viewportSize.x;
		const y = bounds.top + (presenter.viewportSize.y - 23) * bounds.height / presenter.viewportSize.y;
		const pointerId = input.getPlayerInput(1).inputHandlers.pointer!.deviceId;
		input.inputAxis2(pointerId, 'pointer_position', x, y, clock.now());
		input.inputButton(pointerId, 'pointer_primary', true, 1, clock.now(), pressId++);
		await frame();
		input.inputButton(pointerId, 'pointer_primary', false, 0, clock.now(), pressId++);
		await frame(); await settle();
	};
	await clickTimeline(presenter.viewportSize.x - 12);
	require(runtime.machine.scheduler.currentNowCycles() === latest, 'the right track endpoint is clickable and reaches the recorded end');
	await clickTimeline(12);
	require(runtime.machine.scheduler.currentNowCycles() === checkpoint, 'pointer selects the oldest timeline boundary');
	await backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	const expectedVram = runtime.machine.gxGpu.readVramSnapshotBytes().slice();
	require(expectedVram.some(byte => byte !== 0), 'checkpoint contains real rendered pixels');
	const reviewAudio = audioFrames;
	for (let index = 0; index < 5; index += 1) await frame();
	require(audioFrames === reviewAudio, 'review must suppress abandoned and replay audio');
	await press('KeyC'); await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	require(!rewind.active && runtime.machine.scheduler.currentNowCycles() >= latest, 'B cancels and rejoins live recording');
	require(audioFrames > reviewAudio, 'return resumes live audio');
	await openRewind();
	const branchEnd = history.latestCycles;
	await clickTimeline(12);
	require(runtime.machine.scheduler.currentNowCycles() === checkpoint, 'cancelling retains the old checkpoint');
	await backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	const actualVram = runtime.machine.gxGpu.readVramSnapshotBytes();
	require(actualVram.every((byte, index) => byte === expectedVram[index]), 'asynchronous restore preserves every VRAM byte');
	await press('AltRight'); await settle();
	for (let index = 0; index < 20; index += 1) await frame();
	require(!rewind.active && history.latestCycles < branchEnd, 'START branches instead of returning to the future');
	// Leave a representative multi-second transport preview for visual inspection.
	const previewEnd = history.latestCycles + runtime.timing.cpuHz * 7;
	for (let count = 0; count < 4000 && history.latestCycles < previewEnd; count += 1) await frame();
	await openRewind(); await press('ShiftLeft'); await settle();
	await testWebGpuReadbackLifetime(runtime, backend);
	await backend.device.queue.onSubmittedWorkDone();
	require(errors.length === 0, errors.join('\n'));
	return { backend: backend.type, hostFrames, checkpoint, latest, audioFrames, vramBytes: expectedVram.length };
}
