import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HostFrameSession } from '../../hosts/common/frame_session';
import { executeHostUpdate } from '../../hosts/common/machine_step';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import type { FrameNavigationOperation } from '../../ide/runtime/frame_navigation';
import { resetRuntimeDebuggerExecution } from '../../ide/runtime/debugger_state';
import { RuntimeDebuggerPlanResult } from '../../ide/runtime/debugger_plans';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeRuntimeToolRequest } from '../../ide/workbench/services/assistant/runtime_tool_protocol';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createFrameRuntime } from '../helpers/frame_runtime';

async function fixture(t: TestContext) {
	const runtime = createFrameRuntime();
	const f = createRuntimeInspectionFixture(runtime, createScenarioTestSourceState([]));
	const { frameNavigation: navigation, rewind, tasks, execution, presenter, audio, presentation } = f;
	const session = new HostFrameSession(runtime.timing.ufpsScaled, 0, rewind, execution);
	let restores = 0;
	runtime.onStateRestored = origin => { restores++; f.events.didRestore(origin); navigation.didRestore(origin); f.guest.invalidate('heap-replaced'); resetRuntimeDebuggerExecution(f.debuggerState); };
	runtime.history.onWillResumeRecording = branched => { if (branched) f.events.beginTimeline(); };
	runtime.onStateReset = () => { navigation.didReset(); f.guest.invalidate('heap-replaced'); resetRuntimeDebuggerExecution(f.debuggerState); };
	execution.setPauseReason(HostPauseReason.Workbench, true);
	const frame = async () => {
		navigation.beforeHostFrame();
		rewind.service(true);
		if (tasks.ready && !rewind.active && !execution.executionBlocked() && f.debuggerState.source.stop === undefined) {
			executeHostUpdate(session, runtime, presenter, audio, presentation, 30000);
		}
		presentation.presentPausedFrame(presenter, runtime, 100, 20);
		if (runtime.history.checkpointPending && tasks.ready) rewind.service(true);
		navigation.afterHostFrame();
		await tasks.join();
	};
	const settle = async (operation: FrameNavigationOperation) => {
		for (let i = 0; i < 1000 && operation.result === undefined; i++) await frame();
		assert.ok(operation.result, 'finite navigation must settle through real scheduler progress');
		return operation.completion;
	};
	t.after(() => { navigation.dispose(); presenter.dispose(); });
	await frame();
	return { ...f, navigation, frame, settle, restores: () => restores };
}

test('batched physical steps return completed positions, retain pause and make no host-time estimate', async t => {
	const f = await fixture(t), before = f.runtime.frameScheduler.lastTickSequence;
	const operation = f.navigation.step(1, 3);
	assert.equal(operation.result, undefined); assert.equal(f.inspection.canInspect, false);
	assert.throws(() => f.navigation.step(1), /not available/);
	const result = await f.settle(operation);
	assert.equal(result.status, 'completed'); assert.equal(result.completedFrames, 3);
	assert.equal(result.before.videoTick, before); assert.equal(result.after.videoTick, before + 3);
	assert.equal(result.after.cycles, f.runtime.machine.scheduler.currentNowCycles());
	assert.equal(f.execution.userPaused, true); assert.equal(f.inspection.canInspect, true);
	for (let i = 0; i < 5; i++) await f.frame();
	assert.equal(f.runtime.machine.scheduler.currentNowCycles(), result.after.cycles);
});

test('one backwards batch restores once; replay forward preserves future and only then advances live', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 12));
	const end = f.runtime.history.latestCycles;
	const back = await f.settle(f.navigation.step(-1, 4));
	assert.equal(back.status, 'completed'); assert.equal(back.after.videoTick, 8); assert.equal(back.completedFrames, 4);
	assert.equal(f.restores(), 1, 'a batch is one target reconstruction, not four complete replays');
	assert.equal(f.runtime.history.latestCycles, end);
	const forward = await f.settle(f.navigation.step(1, 6));
	assert.equal(forward.status, 'completed'); assert.equal(forward.after.videoTick, 14);
	assert.equal(f.restores(), 1, 'forward review does not re-restore the checkpoint');
	assert.equal(f.rewind.active, false); assert.equal(f.execution.userPaused, true);
});

test('seeks report boundary selection, reject expired range and stop honestly at the retained start', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8));
	const state = f.navigation.historyState();
	assert.throws(() => f.navigation.seek(state.latestCycles + 1), /outside/);
	const requested = f.runtime.history.inputJournal.cycleAt(4) + 1;
	const seek = await f.settle(f.navigation.seek(requested));
	assert.equal(seek.status, 'completed'); assert.equal(seek.request.kind, 'seek');
	assert.ok(seek.after.cycles < requested); assert.equal(f.runtime.history.latestCycles, state.latestCycles);
	const start = await f.settle(f.navigation.step(-1, 100));
	assert.equal(start.status, 'stopped'); assert.equal(start.reason, 'retained-history-start');
	assert.equal(start.after.cycles, state.earliestCycles); assert.equal(f.navigation.canStep(-1), false);
});

test('cancellation retires its advance, but never overwrites newer execution or timeline intent', async t => {
	const f = await fixture(t), lifetime = new AbortController();
	const cancelled = f.navigation.step(1, 20, lifetime.signal);
	await f.frame(); lifetime.abort();
	const result = await f.settle(cancelled);
	assert.equal(result.status, 'interrupted'); assert.equal(result.after.videoTick, 1); assert.equal(f.execution.userPaused, true);
	const replaced = f.navigation.step(1, 20);
	f.execution.requestExecution(true);
	f.navigation.cancel(replaced);
	assert.equal((await replaced.completion).reason, 'superseded');
	assert.equal(f.execution.userPaused, false, 'later user Continue retains authority');
	f.inspection.pause(); await f.settle(f.navigation.step(1, 5));
	const seek = f.navigation.step(-1);
	f.rewind.seekTo(f.runtime.history.earliestCycles);
	f.navigation.cancel(seek);
	assert.equal((await seek.completion).reason, 'superseded');
	assert.equal(f.rewind.seeking, true, 'later timeline selection remains pending');
});

test('superseding only one transport owner releases the other owned command, not the new intent', async t => {
	const f = await fixture(t); await f.settle(f.navigation.step(1, 6));
	const live = f.navigation.step(1, 20);
	f.rewind.seekTo(f.runtime.history.earliestCycles);
	f.navigation.afterHostFrame();
	assert.equal((await live.completion).reason, 'superseded');
	assert.equal(f.execution.frameStepPending, false, 'old live tick cannot leak into the next resume');
	assert.equal(f.rewind.seeking, true, 'new seek still belongs to the user');
	f.rewind.pauseSeek(); await f.frame();
	const seek = f.navigation.step(-1);
	f.execution.requestExecution(true);
	f.navigation.cancel(seek);
	assert.equal((await seek.completion).reason, 'superseded');
	assert.equal(f.rewind.seeking, false, 'old pending restore does not outlive its operation');
	assert.equal(f.execution.userPaused, false, 'new execution intent is not cleared');
});

test('cancelled queued seek cannot restore after its GPU fence, and task failures settle rather than hang', async t => {
	const f = await fixture(t); await f.settle(f.navigation.step(1, 5));
	let release!: () => void;
	const wait = new Promise<void>(resolve => { release = resolve; });
	t.mock.method(f.presenter.backend, 'finishGxGpuReadbacks', () => wait);
	const before = f.runtime.machine.scheduler.currentNowCycles(), lifetime = new AbortController();
	const seek = f.navigation.step(-1, 2, lifetime.signal);
	f.rewind.service(true); await Promise.resolve(); lifetime.abort(); release(); await f.tasks.join();
	const cancelled = await f.settle(seek);
	assert.equal(cancelled.status, 'interrupted'); assert.equal(cancelled.after.cycles, before); assert.equal(f.restores(), 0);
	const operation = f.navigation.step(1);
	await f.tasks.schedule(() => { throw new Error('navigation fixture backend failure'); }, () => {});
	f.navigation.afterHostFrame();
	assert.equal((await operation.completion).status, 'failed');
	assert.match(operation.result!.reason!, /backend failure/); assert.equal(f.execution.frameStepPending, false);
});

test('a failed queued restore retires its command before later explicit recovery admits work', async t => {
	const f = await fixture(t); await f.settle(f.navigation.step(1, 5));
	let failing = true;
	t.mock.method(f.presenter.backend, 'finishGxGpuReadbacks', () => failing
		? Promise.reject(new Error('restore fence failed')) : Promise.resolve());
	const before = f.runtime.machine.scheduler.currentNowCycles(), operation = f.navigation.step(-1, 2);
	f.rewind.service(true); await f.tasks.join(); f.navigation.afterHostFrame();
	assert.equal((await operation.completion).status, 'failed'); assert.equal(f.rewind.seeking, false);
	failing = false;
	await f.tasks.schedule(() => {}, () => assert.fail('explicit recovery should succeed'));
	await f.frame();
	assert.equal(f.restores(), 0); assert.equal(f.runtime.machine.scheduler.currentNowCycles(), before);
	assert.equal(f.execution.userPaused, true);
});

test('restore origin distinguishes owned rewind from external replacement; reset cancels pending live ticks', async t => {
	const f = await fixture(t); await f.settle(f.navigation.step(1, 5));
	const saved = captureRuntimeSaveState(f.runtime);
	const operation = f.navigation.step(-1);
	applyRuntimeSaveState(f.runtime, saved, RuntimeRestoreOrigin.ExternalLoad);
	assert.equal((await operation.completion).status, 'replaced');
	await f.frame();
	assert.equal(f.rewind.seeking, false);
	const live = f.navigation.step(1);
	f.runtime.rebootSystem();
	assert.equal((await live.completion).status, 'replaced'); assert.equal(f.execution.frameStepPending, false);
});

test('debugger stops end a batch; initialization and active guest-call authority are never bypassed', async t => {
	const f = await fixture(t);
	for (const reason of [HostPauseReason.Fullscreen, HostPauseReason.VibrationInitialization, HostPauseReason.AwaitingLaunch]) {
		f.execution.setPauseReason(reason, true); assert.equal(f.navigation.canStep(1), false); f.execution.setPauseReason(reason, false);
	}
	f.debuggerState.plans.pushControlPlan({ honorUserStops: true, executionDomainMask: 0, preMaskableInterruptDomainMask: 0,
		shouldStop: () => false, willExecute() {}, didExecute: () => RuntimeDebuggerPlanResult.Active,
		didFault: () => RuntimeDebuggerPlanResult.Active, discard() {} }, 'workbench');
	assert.equal(f.navigation.available, false);
	f.debuggerState.plans.setControlSuspended(true);
	assert.equal(f.navigation.available, false, 'suspending a guest call does not release its mutation authority');
	f.debuggerState.plans.discardAll();
	const operation = f.navigation.step(1, 10);
	f.debuggerState.source.install(f.debuggerState.sources.currentBlua32Media, [new Map([[0, 0]]), new Map(), new Map()]);
	f.debuggerState.source.shouldStop(-1, 0); f.execution.finishFrameStep(); f.navigation.afterHostFrame();
	assert.equal((await operation.completion).status, 'stopped'); assert.equal(operation.result!.reason, 'debugger');
	assert.equal(f.execution.frameStepPending, false); assert.equal(f.navigation.canStep(1), false);
});

test('a retained replay-stop flag is not the outcome of a later live step', async t => {
	const f = await fixture(t); f.rewind.stopped = true;
	assert.equal((await f.settle(f.navigation.step(1))).status, 'completed');
});

test('tool lifetime owns navigation, validates only model arguments and never accepts a foreign target', async t => {
	const f = await fixture(t), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.navigation, f.gameCapture, f.luaEvaluation, f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, f.gteHistory, f.gpuHistory, lifetime.signal);
	const args = { target: f.inspection.target, direction: 'forward', count: 3 };
	assert.throws(() => tools.execute('studio_step_frames', { ...args, target: 'test-machine' }), /not this Studio/);
	for (const count of [0, -1, 1.5, '1']) assert.throws(() => decodeRuntimeToolRequest('studio_step_frames', { ...args, count }));
	const result = tools.execute('studio_step_frames', args);
	await f.frame(); lifetime.abort();
	await f.settle(f.navigation.active!);
	const receipt = await result; assert.ok('status' in receipt.data); assert.equal(receipt.data.status, 'interrupted');
	assert.equal(f.execution.userPaused, true);
});

test('event timelines branch on live resume, not on seeking or returning to present', async t => {
	const f = await fixture(t);
	const transitions = t.mock.method(f.events, 'beginTimeline');
	await f.settle(f.navigation.step(1, 8));
	await f.settle(f.navigation.step(-1, 3));
	assert.equal(transitions.mock.callCount(), 0);
	await f.settle(f.navigation.finishReview('present'));
	assert.equal(f.rewind.active, false);
	assert.equal(transitions.mock.callCount(), 0);
	await f.settle(f.navigation.step(-1, 3));
	await f.settle(f.navigation.finishReview('here'));
	assert.equal(f.rewind.active, false);
	assert.equal(transitions.mock.callCount(), 1);
	await f.settle(f.navigation.step(1, 2));
	assert.equal(transitions.mock.callCount(), 1);
});

test('finish review returns to present or accepts the selected state without a live tick', async t => {
	const f = await fixture(t);
	assert.equal(f.navigation.canFinishReview, false);
	assert.throws(() => f.navigation.finishReview('here'), /cannot be finished/);
	const live = await f.settle(f.navigation.step(1, 8));
	const back = await f.settle(f.navigation.step(-1, 3));
	assert.equal(f.navigation.canFinishReview, true);
	const present = f.navigation.finishReview('present');
	// Seeking completion alone must not publish success before the queued Resume.
	for (let i = 0; i < 100 && f.rewind.seeking; i++) await f.frame();
	assert.equal(present.result, undefined);
	assert.equal(f.rewind.active, true);
	const returned = await f.settle(present);
	assert.equal(returned.status, 'completed'); assert.deepEqual(returned.after, live.after);
	assert.equal(returned.history.latestCycles, live.after.cycles); assert.equal(returned.history.reviewing, false);
	assert.equal(f.execution.userPaused, true); assert.equal(f.debuggerExecution.canResume('continue'), true);
	assert.deepEqual((await f.settle(f.navigation.step(-1, 3))).after, back.after);
	const accepted = await f.settle(f.navigation.finishReview('here'));
	assert.equal(accepted.status, 'completed'); assert.deepEqual(accepted.before, back.after);
	assert.deepEqual(accepted.after, back.after); assert.equal(accepted.history.latestCycles, back.after.cycles);
	assert.equal(accepted.history.reviewing, false); assert.equal(f.execution.userPaused, true);
	assert.equal(f.debuggerExecution.canResume('continue'), true);
	for (let i = 0; i < 4; i++) await f.frame();
	assert.equal(f.runtime.machine.scheduler.currentNowCycles(), accepted.after.cycles);
});

for (const destination of ['here', 'present'] as const) test(`cancelling ${destination} before host execution preserves future and newer user intent`, async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	const before = f.inspection.status(), lifetime = new AbortController();
	const operation = f.navigation.finishReview(destination, lifetime.signal);
	lifetime.abort();
	const result = await f.settle(operation);
	assert.equal(result.status, 'interrupted'); assert.equal(result.reason, 'cancelled');
	assert.equal(result.after.cycles, before.cycles); assert.equal(result.history.latestCycles, before.history.latestCycles);
	assert.equal(result.history.reviewing, true); assert.equal(f.execution.userPaused, true);
	const superseded = f.navigation.finishReview(destination);
	f.rewind.seekTo(f.runtime.history.earliestCycles);
	f.navigation.cancel(superseded);
	assert.equal((await superseded.completion).reason, 'superseded'); assert.equal(f.rewind.seeking, true);
});

test('return cancellation across the restore fence cannot leave a pending exit behind', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	const before = f.inspection.status(), lifetime = new AbortController();
	let release!: () => void;
	const wait = new Promise<void>(resolve => { release = resolve; });
	t.mock.method(f.presenter.backend, 'finishGxGpuReadbacks', () => wait);
	const operation = f.navigation.finishReview('present', lifetime.signal);
	f.rewind.service(true); await Promise.resolve(); lifetime.abort(); release(); await f.tasks.join();
	const result = await f.settle(operation);
	assert.equal(result.status, 'interrupted'); assert.equal(result.after.cycles, before.cycles);
	assert.equal(result.history.latestCycles, before.history.latestCycles);
	for (let i = 0; i < 4; i++) await f.frame();
	assert.equal(f.rewind.active, true); assert.equal(f.runtime.machine.scheduler.currentNowCycles(), before.cycles);
});

test('a newer pause retires a queued branch before the next host frame can discard future', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	const end = f.runtime.history.latestCycles, before = f.runtime.machine.scheduler.currentNowCycles();
	const operation = f.navigation.finishReview('here');
	f.execution.setPauseReason(HostPauseReason.Requested, true);
	await f.frame();
	assert.equal((await operation.completion).reason, 'superseded');
	assert.equal(f.runtime.history.latestCycles, end, 'a superseded queued branch must not consume the recorded future');
	assert.equal(f.runtime.machine.scheduler.currentNowCycles(), before); assert.equal(f.rewind.active, true);
});

test('a newer pause across the GPU restore fence prevents stale machine replacement', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	const before = f.inspection.status();
	let release!: () => void;
	const wait = new Promise<void>(resolve => { release = resolve; });
	t.mock.method(f.presenter.backend, 'finishGxGpuReadbacks', () => wait);
	const operation = f.navigation.finishReview('present');
	f.navigation.beforeHostFrame(); f.rewind.service(true); await Promise.resolve();
	f.execution.setPauseReason(HostPauseReason.Requested, true);
	release(); await f.tasks.join();
	assert.equal(f.runtime.machine.scheduler.currentNowCycles(), before.cycles, 'supersession must be checked before replacing the heap');
	assert.equal(f.runtime.frameScheduler.lastTickSequence, before.videoTick);
	const result = await f.settle(operation);
	assert.equal(result.status, 'interrupted'); assert.equal(result.reason, 'superseded');
	assert.equal(result.history.latestCycles, before.history.latestCycles); assert.equal(result.history.reviewing, true);
});

test('accepting here preserves an existing debugger stop and guest fault without executing it', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	f.debuggerState.source.install(f.debuggerState.sources.currentBlua32Media, [new Map([[0, 0]]), new Map(), new Map()]);
	f.debuggerState.source.shouldStop(-1, 0);
	f.fault.faultSnapshot = { message: 'retained fault', resource: { domain: 0, path: 'entry.lua' }, line: 1, column: 1, details: { luaStack: [] } };
	f.rewind.stopped = true;
	const stop = f.debuggerState.source.stop, fault = f.fault.faultSnapshot;
	const result = await f.settle(f.navigation.finishReview('here'));
	assert.equal(result.status, 'completed'); assert.deepEqual(result.before, result.after);
	assert.equal(result.history.reviewing, false); assert.equal(f.debuggerState.source.stop, stop);
	assert.equal(f.fault.faultSnapshot, fault); assert.equal(f.execution.userPaused, true);
});

test('a replay stop interrupts return rather than leaving a delayed commit', async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	const end = f.runtime.history.latestCycles, operation = f.navigation.finishReview('present');
	f.debuggerState.source.install(f.debuggerState.sources.currentBlua32Media, [new Map([[0, 0]]), new Map(), new Map()]);
	f.debuggerState.source.shouldStop(-1, 0);
	f.navigation.afterHostFrame();
	assert.equal((await operation.completion).status, 'stopped');
	for (let i = 0; i < 4; i++) await f.frame();
	assert.equal(f.rewind.active, true); assert.equal(f.runtime.history.latestCycles, end);
	assert.equal(f.execution.userPaused, true);
});

for (const failCapture of [false, true]) test(`branch checkpoint ${failCapture ? 'failure' : 'cancellation'} reports committed history without rollback`, async t => {
	const f = await fixture(t);
	await f.settle(f.navigation.step(1, 8)); await f.settle(f.navigation.step(-1, 3));
	const before = f.inspection.status(), lifetime = new AbortController();
	let release!: () => void;
	const wait = new Promise<void>(resolve => { release = resolve; });
	t.mock.method(f.presenter.backend, 'captureGxGpuVramSnapshot', async () => {
		await wait;
		if (failCapture) throw new Error('branch checkpoint failed');
	});
	const operation = f.navigation.finishReview('here', lifetime.signal);
	f.rewind.service(true); await Promise.resolve();
	assert.equal(f.rewind.active, false); assert.equal(f.runtime.history.latestCycles, before.cycles);
	f.navigation.afterHostFrame(); assert.equal(operation.result, undefined, 'receipt awaits the branch checkpoint');
	if (!failCapture) lifetime.abort();
	release(); await f.tasks.join();
	const result = await f.settle(operation);
	assert.equal(result.status, failCapture ? 'failed' : 'interrupted'); assert.deepEqual(result.after, result.before);
	assert.equal(result.history.reviewing, false); assert.equal(result.history.latestCycles, before.cycles);
	assert.ok(result.history.latestCycles < before.history.latestCycles); assert.equal(f.execution.userPaused, true);
});
