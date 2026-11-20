import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

import { HostExecutionControl, HostPauseReason } from '../../../hosts/common/execution_control';
import { initializeMachineRuntime, initializeMachineVideoPresenter } from '../../../hosts/common/machine_runtime';
import { runHostFrame } from '../../../hosts/common/host_frame';
import { HostFrameSession } from '../../../hosts/common/frame_session';
import { HostOverlayMenu, HostMenuExecution } from '../../../hosts/common/host_overlay_menu';
import { HostOnScreenKeyboard } from '../../../hosts/common/host_on_screen_keyboard';
import { HostKeyboardInteraction } from '../../../hosts/common/input/host_keyboard_interaction';
import { OnScreenKeyboard } from '../../../hosts/common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES } from '../../../hosts/common/input/on_screen_keyboard_keys';
import { HostRewind } from '../../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../../hosts/common/runtime_task_queue';
import { RenderPresentationState } from '../../../hosts/common/presentation_state';
import { HostAudioOutput, type AudioOutputPuller as Puller } from '../../../hosts/common/audio_output';
import { HostAudioDevice } from '../../../hosts/common/audio_device';
import { SystemOutputLog } from '../../../hosts/common/system_output_log';
import { Input } from '../../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { OffscreenVideoOutput } from '../../../hosts/common/offscreen_video_output';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { IO_APU_ACTIVE_MASK, IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { HistoryMode } from '../../../machine/ts/machine/runtime/history/history';
import { observeReplay } from './observation';
import { Host2DKind } from '../../../machine/ts/render/host_overlay/commands';

async function main(): Promise<void> {
	const [systemPath, cartPath, outputDirectory] = process.argv.slice(2);
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
	const video = new OffscreenVideoOutput(256, 212);
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
	const audioOutput = new HostAudioOutput(new HostAudioDevice(sink), runtime.machine.audioController, runtime.timing.ufpsScaled);
	const errors: string[] = [];
	const log = { log(level: number, message: string) { if (level === 3) errors.push(message); } };
	const tasks = new RuntimeTaskQueue(audioOutput, presenter);
	const presentation = new RenderPresentationState();
	const execution = new HostExecutionControl(audioOutput);
	const rewind = new HostRewind(runtime, presenter, presentation, tasks, audioOutput, log);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, clock.now(), rewind, execution);
	const keyboardModel = new OnScreenKeyboard(input, NATIVE_KEYBOARD_PAGES);
	const keyboardView = new HostOnScreenKeyboard(presenter, keyboardModel);
	const keyboardInteraction = new HostKeyboardInteraction(input, keyboardModel, presenter, keyboardView);
	const menu = new HostOverlayMenu(presenter, runtime, input, rewind, execution, keyboardInteraction);
	const output = new SystemOutputLog();
	const history = runtime.history;
	const frame = async () => {
		const publishedSequence = presenter.gameFrameSequence;
		clock.advance(runtime.timing.frameDurationMs);
		runHostFrame(session, runtime, presenter, input, audioOutput, output, log, presentation, menu, clock.now());
		await new Promise<void>(resolve => setImmediate(resolve));
		if (rewind.seeking && !rewind.playing) assert.equal(presenter.gameFrameSequence, publishedSequence, 'seek reconstruction must retain the published game image');
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
	const holdMenuChord = async () => {
		const id = pressId++;
		const initialMode = menu.executionMode;
		for (const key of ['select', 'start']) input.inputButton('gamepad:0', key, true, 1, clock.now() + 1, id);
		await frame();
		const deadline = clock.now() + 500;
		assert.equal(menu.executionMode, initialMode, 'host chord down never opens the menu or commits rewind');
		while (clock.now() < deadline) {
			await frame();
			if (clock.now() < deadline) assert.equal(menu.executionMode, initialMode, 'short action remains deferred while the chord is held');
		}
		assert.equal(menu.executionMode, HostMenuExecution.Rewind, 'holding SELECT+START opens rewind, never the options page');
		const heldCycles = runtime.machine.scheduler.currentNowCycles();
		for (let count = 0; count < 5; count += 1) await frame();
		assert.equal(runtime.machine.scheduler.currentNowCycles(), heldCycles, 'held opening START neither retriggers nor commits');
		for (const key of ['select', 'start']) input.inputButton('gamepad:0', key, false, 0, clock.now() + 1, id);
		await frame();
		assert.equal(menu.executionMode, HostMenuExecution.Rewind, 'releasing a long chord does not open the menu or take over');
	};
	const clickTimeline = async (labelText: string, heldFrames = 1) => {
		const display = video.measureDisplay();
		input.inputAxis2('pointer:0', 'pointer_position', display.left + 1, display.top + 1, clock.now());
		await frame();
		menu.queueRenderCommands();
		const bar = presenter.hostOverlayQueue.consumeHostMenuFrame();
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
	const assertOptionsPause = async () => {
		await press('select', 'start');
		assert.equal(puller, null, 'quick menu suspends the audio transport');
		const pausedState = observeReplay(runtime);
		const pausedAudio = audioFrames;
		const pausedCaptures = vramCaptures;
		for (let index = 0; index < 10; index += 1) await frame();
		assert.deepEqual(observeReplay(runtime), pausedState, 'quick menu holds the machine boundary');
		assert.equal(audioFrames, pausedAudio, 'quick menu does not consume queued guest audio');
		assert.equal(vramCaptures, pausedCaptures, 'quick menu does not service history checkpoints');
		execution.setPauseReason(HostPauseReason.Fullscreen, true);
		await press('b');
		assert.equal(puller, null, 'closing the menu retains an independent host mute');
		execution.setPauseReason(HostPauseReason.Fullscreen, false);
		await frame();
		await settle();
		assert.notEqual(puller, null, 'live audio reconnects after all pause owners release it');
	};
	runtime.boot();
	audioOutput.device.select(audioOutput);
	await assertOptionsPause();
	for (let count = 0; count < 75 && runtime.machine.memory.readIoU32(IO_APU_ACTIVE_MASK) === 0; count += 1) await frame();
	assert.equal(runtime.machine.memory.readIoU32(IO_APU_ACTIVE_MASK), 1 << 4);
	// Host transport needs a usable timeline, not a second retention stress test.
	history.stop();
	history.start({ checkpointCapacity: 4, inputCapacity: 192, checkpointIntervalCycles: runtime.timing.cpuHz });
	const recordedUntil = history.latestCycles + runtime.timing.cpuHz * 3;
	for (let count = 0; count < 201 && history.latestCycles < recordedUntil; count += 1) await frame();
	assert.ok(history.latestCycles >= recordedUntil && history.checkpointCount >= 3);
	assert.ok(audible && audioFrames > 48000, 'the guest voice produced real audio');
	snapshot('live');
	await press('select', 'x');
	assert.equal(menu.executionMode, HostMenuExecution.Live, 'keyboard is a live host view');
	await holdMenuChord();
	await holdMenuChord();
	await press('a');
	assert.equal(menu.executionMode, HostMenuExecution.Rewind, 'south alone never takes over rewind');
	await press('b'); await settle();
	assert.equal(menu.executionMode, HostMenuExecution.Live, 'east cancels rewind to ordinary live execution');
	await assertOptionsPause();
	await openRewind();
	const latest = history.latestCycles;
	const oldest = history.earliestCycles;
	const lastVideoTick = runtime.frameScheduler.lastTickSequence;
	const journalEnd = history.inputJournal.endSequence;
	for (let index = 0; index < 3; index += 1) {
		await press('lb'); await settle();
		assert.equal(runtime.frameScheduler.lastTickSequence, lastVideoTick - 1);
		const beforeForward = restores;
		await press('rb'); await settle();
		assert.equal(runtime.frameScheduler.lastTickSequence, lastVideoTick);
		assert.equal(runtime.machine.scheduler.currentNowCycles(), latest);
		assert.equal(restores, beforeForward, 'forward frame playback does not restore a checkpoint');
		assert.equal(history.inputJournal.endSequence, journalEnd);
		assert.equal(history.latestCycles, latest, 'frame stepping preserves the recorded future');
	}
	const capturesBeforeSeek = vramCaptures;
	await press('left');
	await settle();
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(vramCaptures, capturesBeforeSeek, 'restoring a checkpoint does not download discarded VRAM');
	const selected = runtime.machine.scheduler.currentNowCycles();
	assert.ok(selected <= latest - runtime.timing.cpuHz && selected > latest - runtime.timing.cpuHz * 1.03, 'Left seeks one emulated second, using input replay between checkpoints');
	assert.equal(history.latestCycles, latest, 'review retains future');
	const rewindAudioFrames = audioFrames;
	for (let index = 0; index < 5; index += 1) await frame();
	assert.equal(audioFrames, rewindAudioFrames, 'review delivers no stale or replay audio');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), selected);
	snapshot('rewind');
	await press('right'); await settle();
	assert.ok(runtime.machine.scheduler.currentNowCycles() > selected, 'Right seeks forward without resuming gameplay');
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(rewind.positionCycles, latest, 'Left/Right round trip preserves the selected coordinate');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), latest, 'one Right returns to the recorded end without rounding drift');
	await press('right'); await settle();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), latest, 'timeline includes the recorded end');
	for (let roundTrip = 0; roundTrip < 2; roundTrip += 1) {
		await press('left'); await settle();
		assert.equal(rewind.positionCycles, latest - runtime.timing.cpuHz, 'selected coordinate survives journal rounding');
		await press('right'); await settle();
		assert.equal(runtime.machine.scheduler.currentNowCycles(), latest, 'repeated round trips have no drift');
	}
	// Holding a direction uses the host repeat cadence and clamps at the oldest boundary.
	input.inputButton('gamepad:0', 'left', true, 1, clock.now() + 1, pressId++);
	for (let index = 0; index < 150 && rewind.positionCycles !== oldest; index += 1) await frame();
	input.inputButton('gamepad:0', 'left', false, 0, clock.now() + 1, pressId++);
	await frame(); await settle();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), oldest);
	await press('left'); await settle();
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
	input.inputButton('gamepad:0', 'x', true, 1, clock.now() + 1, pressId++);
	for (let index = 0; index < 3; index += 1) await frame();
	assert.ok(rewind.playing && !execution.userPaused && execution.paused, 'Play releases user pause, not independent host reasons');
	assert.equal(runtime.machine.scheduler.currentNowCycles(), oldest);
	execution.setPauseReason(HostPauseReason.Fullscreen, false);
	for (let index = 0; index < 21; index += 1) await frame();
	assert.equal(rewind.playing, true, 'held preview starts replay only once');
	const replayedCycles = runtime.machine.scheduler.currentNowCycles() - oldest;
	assert.ok(Math.abs(replayedCycles - runtime.timing.cpuHz * runtime.timing.frameDurationMs * 20 / 1000) <= runtime.timing.cycleBudgetPerFrame, 'replay obeys host/PCRTC pacing, not the fast seek budget');
	input.inputButton('gamepad:0', 'x', false, 0, clock.now() + 1, pressId++);
	await frame();
	assert.ok(audible && audioFrames > playbackAudio, 'paced replay delivers fresh nonzero emulated audio');
	snapshot('playing-before-pause');
	const playingPixels = backend.borrowPresentedPixels().slice(0, backend.framebufferWidth * (backend.framebufferHeight - 38) * 4);
	await press('x');
	assert.ok(playingPixels.every((value, index) => value === backend.borrowPresentedPixels()[index]), 'pause retains the presented game image');
	const previewPaused = runtime.machine.scheduler.currentNowCycles();
	const previewAudio = audioFrames;
	assert.ok(!rewind.playing && rewind.active && history.mode === HistoryMode.Reviewing);
	for (let index = 0; index < 8; index += 1) await frame();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), previewPaused, 'preview pauses at the actual playback position');
	assert.equal(rewind.positionCycles, previewPaused, 'cursor follows actual playback, not its destination');
	assert.equal(audioFrames, previewAudio, 'paused replay drains no old audio');
	assert.equal(history.latestCycles, playbackEnd);
	assert.equal(history.inputJournal.endSequence, playbackSequence);
	assert.equal(restores, playbackRestores, 'Play/Pause never restores');
	assert.equal(vramCaptures, playbackCaptures, 'Play/Pause never captures');
	snapshot('playback-paused');
	clock.advance(600_000);
	await press('x');
	assert.ok(runtime.machine.scheduler.currentNowCycles() - previewPaused <= runtime.timing.cycleBudgetPerFrame * 2, 'Play discards paused wall time');
	for (let index = 0; index < 4000 && rewind.playing; index += 1) await frame();
	assert.equal(runtime.machine.scheduler.currentNowCycles(), playbackEnd, 'playback stops exactly at the recorded end');
	assert.ok(!rewind.playing && rewind.active, 'end of replay does not silently take live control');
	assert.equal(history.inputJournal.endSequence, playbackSequence);
	// B cancels the transport; it is not a navigation item in a second menu.
	await clickTimeline('BACK'); await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	assert.equal(rewind.active, false);
	assert.equal(history.mode, HistoryMode.Recording);
	assert.ok(runtime.machine.scheduler.currentNowCycles() >= latest);
	assert.ok(audioFrames > rewindAudioFrames, 'live audio resumes after cancelling');

	await openRewind();
	await press('left'); await settle();
	await press('x');
	assert.equal(rewind.playing, true, 'preview activates recorded playback');
	for (let index = 0; index < 7; index += 1) await frame();
	await press('x');
	assert.equal(rewind.playing, false, 'preview pauses without accepting');
	const branchCycles = runtime.machine.scheduler.currentNowCycles();
	const branchEnd = history.latestCycles;
	await clickTimeline('OK', 5); await settle();
	for (let index = 0; index < 3; index += 1) await frame();
	assert.equal(history.mode, HistoryMode.Recording);
	assert.equal(rewind.active, false);
	assert.ok(history.latestCycles < branchEnd, 'accept branches from the selected position');
	assert.equal(history.checkpointCycles(history.checkpointCount - 1), branchCycles, 'takeover captures the exact paused playback position, not a nearby checkpoint');
	for (let index = 0; index < 20; index += 1) await frame();
	assert.ok(runtime.machine.scheduler.currentNowCycles() > branchCycles);
	snapshot('branched');

	// The transition lifecycle, not the destination keyboard, cancels a rewind session.
	await openRewind(); await press('left'); await settle();
	const beforeKeyboard = history.latestCycles;
	await press('select', 'x'); await settle();
	for (let index = 0; index < 12; index += 1) await frame();
	assert.equal(rewind.active, false);
	assert.ok(runtime.machine.scheduler.currentNowCycles() >= beforeKeyboard, 'rewind -> keyboard preserves the recorded future');
	await press('select', 'x');
	for (let index = 0; index < 60; index += 1) await frame();

	// Accept retains the selected target even while its old GPU readback is in flight.
	await openRewind();
	let releaseResume!: () => void;
	const resumeGate = new Promise<void>(resolve => { releaseResume = resolve; });
	const finishBeforeResume = backend.finishGxGpuReadbacks.bind(backend);
	backend.finishGxGpuReadbacks = async () => { await resumeGate; finishBeforeResume(); };
	await press('left');
	await press('x');
	assert.ok(rewind.playing && rewind.seeking, 'Play can be queued while a seek awaits a backend fence');
	await press('left');
	assert.equal(rewind.playing, false, 'a newer seek replaces queued playback');
	const intended = rewind.positionCycles;
	const intendedSequence = history.inputJournal.endAt(intended);
	const intendedBoundary = history.inputJournal.cycleAt(intendedSequence - 1);
	assert.equal(tasks.ready, false);
	await press('a');
	assert.ok(rewind.active, 'south is normal menu confirm, not rewind commit');
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
	console.log('RUNTIME-HOST-REWIND:PASS');
	input.dispose();
	presenter.dispose();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
