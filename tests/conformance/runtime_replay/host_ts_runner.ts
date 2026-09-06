import { HostExecutionControl, HostPauseReason } from '../../../hosts/common/execution_control';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const extensions = (Module as any)._extensions;
for (const extension of ['.glsl', '.wgsl']) {
	extensions[extension] = (module: any, filename: string) => {
		module._compile(`module.exports = ${JSON.stringify(readFileSync(filename, 'utf8'))}`, filename);
	};
}

async function main(): Promise<void> {
	const [systemPath, cartPath, outputDirectory] = process.argv.slice(2);
	const { initializeMachineRuntime, initializeMachineVideoPresenter } = await import('../../../hosts/common/machine_runtime');
	const { HostFrameSession, runHostFrame } = await import('../../../hosts/common/host_frame');
	const { HostOverlayMenu } = await import('../../../hosts/common/host_overlay_menu');
	const { HostRewind } = await import('../../../hosts/common/rewind');
	const { RuntimeTaskQueue } = await import('../../../hosts/common/runtime_task_queue');
	const { RenderPresentationState } = await import('../../../hosts/common/presentation_state');
	const { HostAudioOutput } = await import('../../../hosts/common/audio_output');
	const { SystemOutputLog } = await import('../../../hosts/common/system_output_log');
	const { Input } = await import('../../../hosts/common/input/manager');
	const { VirtualHeadlessClock } = await import('../../../hosts/node/headless/clock');
	const { HeadlessInputHub } = await import('../../../hosts/node/headless/input');
	const { HeadlessVideoOutput } = await import('../../../hosts/node/headless/video_output');
	const { HeadlessGPUBackend } = await import('../../../machine/ts/render/headless/backend');
	const { PSX_MACHINE_SPEC } = await import('../../../machine/ts/spec/bmsx/model');
	const { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } = await import('../../../machine/ts/spec/bmsx/io');
	const { HistoryMode } = await import('../../../machine/ts/machine/runtime/history/history');
	const { captureRuntimeSaveState } = await import('../../../machine/ts/machine/runtime/save_state');
	type Puller = import('../../../hosts/common/audio_output').AudioOutputPuller;
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'CONFORMANCE PAD', vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	const runtime = initializeMachineRuntime(readFileSync(systemPath), [readFileSync(cartPath), null], PSX_MACHINE_SPEC, input);
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	let vramCaptures = 0;
	let restores = 0;
	runtime.onStateRestored = () => { restores += 1; };
	const captureVram = backend.captureGxGpuVramSnapshot.bind(backend);
	backend.captureGxGpuVramSnapshot = gpu => { vramCaptures += 1; captureVram(gpu); };
	const video = new HeadlessVideoOutput(256, 212);
	const presenter = initializeMachineVideoPresenter(runtime, video, backend);
	presenter.crt_postprocessing_enabled = false;
	let puller: Puller | null = null;
	let audioFrames = 0;
	let audible = false;
	let suspensions = 0;
	const samples = new Int16Array(2048);
	const sink = {
		setRuntimeAudioPuller(value: Puller | null) { puller = value; },
		pumpRuntimeAudio() {
			if (!puller) return;
			const frames = puller(samples, 960, 48000);
			audioFrames += frames;
			for (let index = 0; index < frames * 2; index += 1) audible ||= samples[index] !== 0;
		},
		resume() {},
		suspend() { suspensions += 1; },
		setEmulationFrameTimeSec(_seconds: number) {},
	};
	const audioOutput = new HostAudioOutput(sink, runtime.machine.audioController, runtime.machine.audioOutput.outputRing, runtime.timing.ufpsScaled);
	const errors: string[] = [];
	const log = { log(level: number, message: string) { if (level === 3) errors.push(message); } };
	const tasks = new RuntimeTaskQueue(audioOutput, presenter);
	const presentation = new RenderPresentationState();
	const execution = new HostExecutionControl(audioOutput);
	const rewind = new HostRewind(runtime, presenter, presentation, tasks, audioOutput, log);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now(), rewind, execution);
	const menu = new HostOverlayMenu(presenter, runtime, input, rewind, execution);
	const output = new SystemOutputLog();
	const history = runtime.history;
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
			if (text === 'SEEKING' || text === 'STOPPED' || text === 'REPLAY' || text === 'PAUSED') status = text;
		}
		if (timeline) renderedTimelineStatus = status;
		publishMenu(frame);
	};
	const frame = async () => {
		renderedTimelineStatus = undefined;
		clock.advance(runtime.timing.frameDurationMs);
		runHostFrame(session, runtime, presenter, input, audioOutput, output, log, presentation, menu, clock.now());
		if (renderedTimelineStatus !== undefined) {
			const expected = rewind.stopped ? 'STOPPED' : rewind.seeking ? 'SEEKING' : rewind.playing ? 'REPLAY' : 'PAUSED';
			assert.equal(renderedTimelineStatus, expected, 'overlay reflects completion in the serviced host frame');
		}
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0, 'real cart fault');
		assert.equal(errors.length, 0, errors.join('\n'));
	};
	const settle = async () => {
		for (let count = 0; count < 4000 && (!tasks.ready || rewind.seeking); count += 1) await frame();
		assert.equal(tasks.ready, true);
		assert.notEqual(history.mode, HistoryMode.Replaying, 'seek must finish');
	};
	let pressId = 1;
	const press = async (...keys: string[]) => {
		const id = pressId++;
		for (const key of keys) input.inputButton('gamepad:0', key, true, 1, clock.now() + 1, id);
		await frame();
		for (const key of keys) input.inputButton('gamepad:0', key, false, 0, clock.now() + 1, id);
		await frame();
	};
	const clickTimeline = async (labelText: string, heldFrames = 1) => {
		menu.queueRenderCommands();
		const bar = presenter.hostOverlayQueue.consumeHostMenuFrame();
		const display = video.measureDisplay();
		let found = false;
		for (let index = 0; index < bar.commandCount; index += 1) {
			if (bar.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const label = bar.commandRefs[index] as import('../../../machine/ts/render/shared/submissions').GlyphRenderSubmission;
			if (label.items !== labelText) continue;
			found = true;
			input.inputAxis2('pointer:0', 'pointer_position',
				display.left + (label.x + label.font!.measure(labelText) / 2) * display.width / presenter.viewportSize.x,
				display.top + (label.y + label.font!.lineHeight / 2) * display.height / presenter.viewportSize.y, clock.now());
		}
		assert.ok(found, `visible transport button ${labelText}`);
		await frame();
		input.inputButton('pointer:0', 'pointer_primary', true, 1, clock.now(), pressId++);
		for (let index = 0; index < heldFrames; index += 1) await frame();
		input.inputButton('pointer:0', 'pointer_primary', false, 0, clock.now(), pressId++);
		await frame();
	};
	const openRewind = async () => {
		await press('select', 'start');
		for (let index = 0; index < 3; index += 1) await press('up');
		const id = pressId++;
		input.inputButton('gamepad:0', 'a', true, 1, clock.now() + 1, id);
		await frame();
		const heldCycles = runtime.machine.scheduler.currentNowCycles();
		for (let index = 0; index < 3; index += 1) await frame();
		assert.equal(runtime.machine.scheduler.currentNowCycles(), heldCycles, 'held accept must not activate the destination page');
		input.inputButton('gamepad:0', 'a', false, 0, clock.now() + 1, id);
		await frame();
	};
	const snapshot = (name: string) => {
		if (!outputDirectory) return;
		mkdirSync(outputDirectory, { recursive: true });
		writeFileSync(`${outputDirectory}/${name}.png`, PNG.sync.write({
			width: backend.framebufferWidth, height: backend.framebufferHeight,
			data: Buffer.from(backend.borrowPresentedPixels()),
		} as PNG));
	};
	runtime.boot();
	audioOutput.bootstrap();
	for (let count = 0; count < 1100; count += 1) await frame();
	assert.equal(history.checkpointCount, 2, 'continuous history uses the common two-slot policy');
	assert.equal(history.inputJournal.storageBytes, 1024 * 176);
	assert.ok(history.earliestCycles > runtime.timing.cpuHz * 6, 'continuous recording wraps without menu activation');
	assert.equal(runtime.machine.cpu.activeCartridgeSlot(), 0);
	assert.ok(audible && audioFrames > 48000, 'ordinary gameplay produces real audio');
	snapshot('live');
	await openRewind();
	const latest = history.latestCycles;
	const oldest = history.earliestCycles;
	const capturesBeforeSeek = vramCaptures;
	await press('lb');
	await settle();
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(vramCaptures, capturesBeforeSeek, 'restoring a checkpoint does not download discarded VRAM');
	const selected = runtime.machine.scheduler.currentNowCycles();
	assert.ok(selected <= latest - runtime.timing.cpuHz && selected > latest - runtime.timing.cpuHz * 1.03, 'LB seeks one emulated second, using input replay between checkpoints');
	assert.equal(history.latestCycles, latest, 'review retains future');
	const rewindAudioFrames = audioFrames;
	for (let index = 0; index < 5; index += 1) await frame();
	assert.equal(audioFrames, rewindAudioFrames, 'review delivers no stale or replay audio');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), selected);
	menu.queueRenderCommands();
	const bar = presenter.hostOverlayQueue.consumeHostMenuFrame();
	for (let index = 0; index < bar.commandCount; index += 1) {
		if (bar.commandKinds[index] === Host2DKind.Rect) {
			const rect = bar.commandRefs[index] as import('../../../machine/ts/render/shared/submissions').RectRenderSubmission;
			assert.ok(rect.area.top >= presenter.viewportSize.y - 38 && rect.area.bottom <= presenter.viewportSize.y - 6, 'transport leaves the game area unobstructed');
		} else {
			const label = bar.commandRefs[index] as import('../../../machine/ts/render/shared/submissions').GlyphRenderSubmission;
			assert.equal(label.font!.lineHeight, 6, 'transport uses the existing tiny font');
			assert.ok(label.x >= 6 && label.x + label.font!.measure(label.items as string) <= presenter.viewportSize.x - 6, 'every transport label fits inside the game viewport');
		}
	}
	snapshot('rewind');
	const reviewed = captureRuntimeSaveState(runtime);
	await press('rb'); await settle();
	assert.ok(runtime.machine.scheduler.currentNowCycles() > selected, 'RB seeks forward without resuming gameplay');
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(rewind.positionCycles, latest, 'LB/RB round trip preserves the selected coordinate');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), latest, 'one RB returns to the recorded end without rounding drift');
	await press('rb'); await settle();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), latest, 'timeline includes the recorded end');
	for (let roundTrip = 0; roundTrip < 2; roundTrip += 1) {
		await press('lb'); await settle();
		assert.equal(rewind.positionCycles, latest - runtime.timing.cpuHz, 'selected coordinate survives journal rounding');
		await press('rb'); await settle();
		assert.equal(runtime.machine.scheduler.currentNowCycles(), latest, 'repeated round trips have no drift');
	}
	// Holding a shoulder uses the host repeat cadence and clamps at the oldest boundary.
	input.inputButton('gamepad:0', 'lb', true, 1, clock.now() + 1, pressId++);
	for (let index = 0; index < 80; index += 1) await frame();
	input.inputButton('gamepad:0', 'lb', false, 0, clock.now() + 1, pressId++);
	await frame(); await settle();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), oldest);
	await press('lb'); await settle();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), oldest, 'holding at the range end never wraps');
	snapshot('oldest');
	// Replay uses the existing machine/journal, normal pacing, and a distinct toggle.
	const playbackEnd = history.latestCycles;
	const playbackSequence = history.inputJournal.endSequence;
	const playbackRestores = restores;
	const playbackCaptures = vramCaptures;
	const playbackAudio = audioFrames;
	audible = false;
	execution.setPauseReason(HostPauseReason.Requested, true);
	execution.setPauseReason(HostPauseReason.Fullscreen, true);
	input.inputButton('gamepad:0', 'a', true, 1, clock.now() + 1, pressId++);
	for (let index = 0; index < 3; index += 1) await frame();
	assert.ok(rewind.playing && !execution.userPaused && execution.paused, 'Play releases user pause, not independent host reasons');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), oldest);
	execution.setPauseReason(HostPauseReason.Fullscreen, false);
	for (let index = 0; index < 21; index += 1) await frame();
	assert.equal(rewind.playing, true, 'held A starts replay only once');
	assert.equal(renderedTimelineStatus, 'REPLAY', 'playback keeps the transport visible');
	const replayedCycles = runtime.machine.scheduler.currentNowCycles() - oldest;
	assert.ok(Math.abs(replayedCycles - runtime.timing.cpuHz * runtime.timing.frameDurationMs * 20 / 1000) <= runtime.timing.cycleBudgetPerFrame, 'replay obeys host/PCRTC pacing, not the fast seek budget');
	input.inputButton('gamepad:0', 'a', false, 0, clock.now() + 1, pressId++);
	await frame();
	assert.ok(audible && audioFrames > playbackAudio, 'paced replay delivers fresh nonzero emulated audio');
	snapshot('playing-before-pause');
	const playingPixels = backend.borrowPresentedPixels().slice(0, backend.framebufferWidth * (backend.framebufferHeight - 38) * 4);
	await press('a');
	assert.ok(playingPixels.every((value, index) => value === backend.borrowPresentedPixels()[index]), 'pause retains the presented game image');
	const previewPaused = runtime.machine.scheduler.currentNowCycles();
	const previewAudio = audioFrames;
	assert.ok(!rewind.playing && rewind.active && history.mode === HistoryMode.Reviewing);
	for (let index = 0; index < 8; index += 1) await frame();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), previewPaused, 'A pauses at the actual playback position');
	assert.equal(rewind.positionCycles, previewPaused, 'cursor follows actual playback, not its destination');
	assert.equal(audioFrames, previewAudio, 'paused replay drains no old audio');
	assert.equal(history.latestCycles, playbackEnd);
	assert.equal(history.inputJournal.endSequence, playbackSequence);
	assert.equal(restores, playbackRestores, 'Play/Pause never restores');
	assert.equal(vramCaptures, playbackCaptures, 'Play/Pause never captures');
	snapshot('playback-paused');
	clock.advance(600_000);
	await press('a');
	assert.ok(runtime.machine.scheduler.currentNowCycles() - previewPaused <= runtime.timing.cycleBudgetPerFrame * 2, 'Play discards paused wall time');
	for (let index = 0; index < 800 && rewind.playing; index += 1) await frame();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), playbackEnd, 'playback stops exactly at the recorded end');
	assert.ok(!rewind.playing && rewind.active, 'end of replay does not silently take live control');
	assert.equal(renderedTimelineStatus, 'PAUSED', 'recorded end keeps the paused transport visible');
	assert.equal(history.inputJournal.endSequence, playbackSequence);
	// B cancels the transport; it is not a navigation item in a second menu.
	await clickTimeline('B CANCEL'); await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	assert.equal(rewind.active, false);
	assert.equal(history.mode, HistoryMode.Recording);
	assert.ok(runtime.machine.scheduler.currentNowCycles() >= latest);
	assert.ok(audioFrames > rewindAudioFrames, 'live audio resumes after cancelling');

	await openRewind();
	await press('lb'); await settle();
	await clickTimeline('A PLAY', 5);
	assert.equal(rewind.playing, true, 'pointer activates playback');
	for (let index = 0; index < 7; index += 1) await frame();
	await clickTimeline('A PAUSE', 4);
	assert.equal(rewind.playing, false, 'pointer pauses playback');
	const branchCycles = runtime.machine.scheduler.currentNowCycles();
	const branchEnd = history.latestCycles;
	await clickTimeline('START GAME'); await settle();
	for (let index = 0; index < 3; index += 1) await frame();
	assert.equal(history.mode, HistoryMode.Recording);
	assert.equal(rewind.active, false);
	assert.ok(history.latestCycles < branchEnd, 'START branches from the selected position');
	assert.equal(history.checkpointCycles(history.checkpointCount - 1), branchCycles, 'takeover captures the exact paused playback position, not a nearby checkpoint');
	for (let index = 0; index < 20; index += 1) await frame();
	assert.ok(runtime.machine.scheduler.currentNowCycles() > branchCycles);
	snapshot('branched');

	// The transition lifecycle, not the destination keyboard, cancels a rewind session.
	await openRewind(); await press('lb'); await settle();
	const beforeKeyboard = history.latestCycles;
	await press('select', 'x'); await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	assert.equal(rewind.active, false);
	assert.ok(runtime.machine.scheduler.currentNowCycles() >= beforeKeyboard, 'rewind -> keyboard preserves the recorded future');
	await press('select', 'x');
	for (let index = 0; index < 60; index += 1) await frame();

	// START accepts the selected target even while its old GPU readback is in flight.
	await openRewind();
	let releaseResume!: () => void;
	const resumeGate = new Promise<void>(resolve => { releaseResume = resolve; });
	const finishBeforeResume = backend.finishGxGpuReadbacks.bind(backend);
	backend.finishGxGpuReadbacks = async () => { await resumeGate; finishBeforeResume(); };
	await press('lb');
	await press('a');
	assert.ok(rewind.playing && rewind.seeking, 'Play can be queued while a seek awaits a backend fence');
	await press('lb');
	assert.equal(rewind.playing, false, 'a newer seek replaces queued playback');
	const intended = rewind.positionCycles;
	const intendedSequence = history.inputJournal.endAt(intended);
	const intendedBoundary = history.inputJournal.cycleAt(intendedSequence - 1);
	assert.equal(tasks.ready, false);
	await press('start');
	assert.equal(rewind.positionCycles, intended, 'accept must not replace the pending target with the recorded end');
	releaseResume();
	await settle();
	for (let index = 0; index < 4; index += 1) await frame();
	backend.finishGxGpuReadbacks = finishBeforeResume;
	assert.equal(history.mode, HistoryMode.Recording);
	assert.equal(history.checkpointCycles(history.checkpointCount - 1), intendedBoundary, 'live takeover captures the selected target, not an intermediate replay state');

	// A delayed backend readback and a tooling mutation share one operation queue.
	// This deliberately controls completion; the normal run above uses the real software backend.
	await openRewind();
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const finish = backend.finishGxGpuReadbacks.bind(backend);
	backend.finishGxGpuReadbacks = async () => { await gate; finish(); };
	rewind.stepCheckpoint(-1);
	await frame();
	assert.equal(tasks.ready, false);
	const heldCycles = runtime.machine.scheduler.currentNowCycles();
	let mutated = false;
	const mutation = tasks.schedule(() => {
		assert.notEqual(history.mode, HistoryMode.Disabled, 'queue admission does not mutate history');
		runtime.history.stop();
		mutated = true;
	}, error => { throw error; });
	for (let index = 0; index < 4; index += 1) await frame();
	assert.equal(mutated, false, 'mutation must wait for the submitted readback');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), heldCycles);
	rewind.pauseSeek();
	release();
	await mutation;
	assert.equal(mutated, true);
	backend.finishGxGpuReadbacks = finish;
	await frame();
	assert.equal(rewind.active, false, 'mutation invalidates pending navigation');
	assert.equal(history.checkpointCount, 1, 'new revision starts a new history');
	assert.ok(suspensions >= 2, 'rewind transitions suspend audio transport');
	console.log(JSON.stringify({ host: 'ts-host-rewind', selected, latest, branchCycles, audioFrames, suspensions,
		reviewedObjects: reviewed.cpuState.snapshot.objectCount, checkpoints: history.checkpointCount }));
	console.log('RUNTIME-HOST-REWIND:PASS');
	input.dispose();
	presenter.dispose();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
