import { createFrameRuntime } from '../helpers/frame_runtime';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostExecutionControl, HostPauseReason } from '../../hosts/common/execution_control';
import { executeHostLogicalTick, executeHostUpdate, HostFrameAction, HostFrameSession, prepareHostUpdate } from '../../hosts/common/host_frame';
import { HostMenuInput } from '../../hosts/common/host_overlay_menu';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

test('frame advance bypasses inspection pause but keeps initialization blockers and audio muted', () => {
	let muted = false;
	const execution = new HostExecutionControl({ mutePause(value: boolean) { muted = value; } } as HostAudioOutput);
	execution.setPauseReason(HostPauseReason.Workbench, true);
	execution.requestFrameStep();
	assert.equal(execution.executionBlocked(), false);
	assert.equal(execution.userPaused, true);
	assert.equal(muted, true);
	for (const reason of [HostPauseReason.AwaitingLaunch, HostPauseReason.Fullscreen, HostPauseReason.VibrationInitialization]) {
		execution.setPauseReason(reason, true);
		assert.equal(execution.executionBlocked(), true);
		execution.setPauseReason(reason, false);
	}
	execution.finishFrameStep();
	assert.equal(execution.executionBlocked(), true);
	execution.setPauseReason(HostPauseReason.Workbench, false);
	assert.equal(execution.executionBlocked(), true, 'closing Studio must retain requested pause');
	assert.equal(muted, true);
});

test('continue and source-step replace pending frame advance instead of leaking a later step', () => {
	const execution = new HostExecutionControl({ mutePause() {} } as HostAudioOutput);
	for (const resume of [false, true]) {
		execution.requestFrameStep();
		execution.requestExecution(resume);
		assert.equal(execution.frameStepPending, false);
		assert.equal(execution.userPaused, !resume);
		assert.equal(execution.consumeElapsedTime(10_000), 0);
	}
	execution.requestFrameStep();
	execution.setPauseReason(HostPauseReason.Requested, false);
	assert.equal(execution.frameStepPending, false);
});


test('host frame advance reaches exactly one physical video boundary, independent of wall time', () => {
	const runtime = createFrameRuntime();
	const audio = { mutePause() {}, muteSystem() {}, syncTiming() {} } as HostAudioOutput;
	const input = { setFrameDurationMs() {} } as Input;
	const presenter = {} as VideoPresenter;
	const screen = { syncAfterRuntimeUpdate() {} } as RenderPresentationState;
	const execution = new HostExecutionControl(audio);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, 0, {} as HostRewind, execution);
	execution.setPauseReason(HostPauseReason.Workbench, true);
	for (let step = 1; step <= 3; step += 1) {
		execution.requestFrameStep();
		assert.equal(prepareHostUpdate(session, runtime, true, HostMenuInput.Inactive), HostFrameAction.Execute);
		executeHostUpdate(session, runtime, presenter, input, audio, screen, 20_000);
		assert.equal(runtime.frameScheduler.lastTickSequence, step);
		assert.equal(execution.frameStepPending, false);
		assert.equal(execution.userPaused, true);
		const heldCycles = runtime.machine.scheduler.currentNowCycles();
		for (let idle = 0; idle < 5; idle += 1) {
			assert.equal(prepareHostUpdate(session, runtime, true, HostMenuInput.Inactive), HostFrameAction.PresentPaused);
		}
		assert.equal(runtime.machine.scheduler.currentNowCycles(), heldCycles);
	}
});

test('previous and next frame replay retained history without discarding the future or restoring each forward step', async () => {
	const runtime = createFrameRuntime();
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const presenter = { backend } as VideoPresenter;
	const audio = { mutePause() {}, muteSystem() {}, muteRewind() {}, muteRuntimeTask() {}, syncTiming() {} } as HostAudioOutput;
	const input = { setFrameDurationMs() {} } as Input;
	const screen = new RenderPresentationState();
	const tasks = new RuntimeTaskQueue(audio, presenter);
	const errors: string[] = [];
	const rewind = new HostRewind(runtime, presenter, screen, tasks, audio, { log(_level, text) { errors.push(text); } });
	const execution = new HostExecutionControl(audio);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, 0, rewind, execution);
	let restores = 0;
	runtime.onStateRestored = () => { restores += 1; };
	const settle = async () => {
		for (let tries = 0; tries < 1000; tries += 1) {
			rewind.service(true);
			await new Promise<void>(resolve => setImmediate(resolve));
			if (tasks.ready && !rewind.seeking) break;
		}
		assert.deepEqual(errors, []);
		assert.equal(tasks.ready, true);
		assert.equal(rewind.seeking, false);
	};
	await settle();
	const boundaries = [runtime.machine.scheduler.currentNowCycles()];
	for (let frame = 1; frame <= 12; frame += 1) {
		assert.equal(executeHostLogicalTick(session, runtime, presenter, input, audio, screen), true);
		boundaries.push(runtime.machine.scheduler.currentNowCycles());
	}
	const history = runtime.history;
	const recordedEnd = history.latestCycles;
	for (let frame = 11; frame >= 9; frame -= 1) {
		rewind.stepFrame(-1);
		await settle();
		assert.equal(runtime.frameScheduler.lastTickSequence, frame);
		assert.equal(runtime.machine.scheduler.currentNowCycles(), boundaries[frame]);
		assert.equal(history.latestCycles, recordedEnd);
	}
	const backwardsRestores = restores;
	for (let frame = 10; frame <= 12; frame += 1) {
		rewind.stepFrame(1);
		await settle();
		assert.equal(runtime.frameScheduler.lastTickSequence, frame);
		assert.equal(runtime.machine.scheduler.currentNowCycles(), boundaries[frame]);
		assert.equal(history.mode, HistoryMode.Reviewing);
		assert.equal(history.latestCycles, recordedEnd);
		assert.equal(restores, backwardsRestores, 'forward review must not reconstruct already inspected frames');
		for (let idle = 0; idle < 10; idle += 1) rewind.service(true);
		assert.equal(runtime.frameScheduler.lastTickSequence, frame, 'frame review remains paused');
	}
	rewind.resumeHere();
	await settle();
	assert.equal(history.mode, HistoryMode.Recording);
	assert.equal(rewind.active, false);
	execution.requestFrameStep();
	executeHostUpdate(session, runtime, presenter, input, audio, screen, 30_000);
	assert.equal(runtime.frameScheduler.lastTickSequence, 13);
	assert.equal(execution.userPaused, true);
});
