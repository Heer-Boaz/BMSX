import { createHostFrameFixture } from '../helpers/host_frame';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { executeHostLogicalTick, executeHostUpdate, HostFrameAction, prepareHostUpdate } from '../../hosts/common/host_frame';
import { HostMenuInput } from '../../hosts/common/host_overlay_menu';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';

test('frame advance bypasses inspection pause but keeps initialization blockers and audio muted', t => {
	const { execution, sink, audio } = createHostFrameFixture();
	audio.bootstrap();
	const suspend = t.mock.method(sink, 'suspend');
	const resume = t.mock.method(sink, 'resume');
	execution.setPauseReason(HostPauseReason.Workbench, true);
	execution.requestFrameStep();
	assert.equal(execution.executionBlocked(), false);
	assert.equal(execution.userPaused, true);
	assert.equal(suspend.mock.callCount(), 1);
	assert.equal(resume.mock.callCount(), 0);
	for (const reason of [HostPauseReason.AwaitingLaunch, HostPauseReason.Fullscreen, HostPauseReason.VibrationInitialization]) {
		execution.setPauseReason(reason, true);
		assert.equal(execution.executionBlocked(), true);
		execution.setPauseReason(reason, false);
	}
	execution.finishFrameStep();
	assert.equal(execution.executionBlocked(), true);
	execution.setPauseReason(HostPauseReason.Workbench, false);
	assert.equal(execution.executionBlocked(), true, 'closing Studio must retain requested pause');
	assert.equal(suspend.mock.callCount(), 1);
	assert.equal(resume.mock.callCount(), 0);
});

test('continue and source-step replace pending frame advance instead of leaking a later step', () => {
	const { execution } = createHostFrameFixture();
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
	const { runtime, audio, input, presenter, screen, execution, session } = createHostFrameFixture();
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
	const { runtime, audio, input, presenter, screen, tasks, errors, rewind, execution, session } = createHostFrameFixture();
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
