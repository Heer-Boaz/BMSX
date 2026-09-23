import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { Input } from '../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { createRuntimeDebuggerState, discardRuntimeDebuggerPlans } from '../../ide/runtime/debugger_state';
import { HotResumeService } from '../../ide/workbench/services/execution/hot_resume';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';

async function fixture(t: TestContext, init = '') {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-hot-resume-'));
	const source = `module<entry>\n${init}\nwhile true do halt_until_irq end`;
	const media = await buildScenarioMediaFixture(directory, [], {
		systemSource: 'module<entry>\ncop0.exec = mem[0x10000028]', systemModules: [], cartSource: source,
	});
	const decoded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createRuntimeSourceState(decoded.system, decoded.cartridgeSlots);
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, input);
	const runtime = target.runtime, cpu = runtime.machine.cpu;
	for (let tick = 0; tick < 100 && !cpu.isCartridgeExecutionActive(); tick++) target.advanceGame(10000);
	assert.equal(cpu.isCartridgeExecutionActive(), true);
	assert.equal(cpu.isUserMode(), true);
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	const debuggerState = createRuntimeDebuggerState(runtime, sources);
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput, target.presenter);
	const models = new EditorTextModelService();
	const service = new HotResumeService(models, sources, tooling, createRuntimeFaultState(), debuggerState,
		input, runtime, tasks, new MemoryStorage(), new Map());
	const model = models.retain({ domain: 0, path: 'entry.lua', source: { resid: 'entry', type: 'lua' } }, 'lua', source);
	// Same resource/version in a different document owner must not enter this build.
	editorTextModelService.retain(model.resource, 'lua', 'end end -- foreign workspace');
	t.after(async () => {
		await service.shutdown();
		discardRuntimeDebuggerPlans(debuggerState);
		models.clear(); editorTextModelService.clear();
		clearWorkspaceSourceCaches();
		target.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	return { service, sources, runtime, cpu, target, tasks, debuggerState, model, source };
}

test('Hot Resume captures admitted documents, not later typing; no-init installation completes explicitly', async t => {
	const f = await fixture(t);
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	void f.tasks.schedule(() => gate, assert.ifError);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- captured\n' }]);
	const captured = f.model.createSnapshot();
	const operation = f.service.resume();
	assert.equal(f.service.latestOperation, operation);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '-- later\n' }]);
	assert.equal(operation.status, 'queued');
	assert.equal(operation.result, null);
	assert.equal(operation.sourceSnapshots[0].version, captured.version);
	release();
	assert.deepEqual(await operation.admission, { status: 'accepted', mode: 'applied' });
	assert.deepEqual(await operation.completion, { status: 'completed', applied: true });
	assert.equal(operation.applied, true);
	assert.equal(f.sources.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), captured.source);
	assert.notEqual(f.model.buffer.getText(), captured.source);
	assert.equal(f.model.dirty, true, 'application is not a source save');
});

test('build rejection has a result without poisoning execution; repair can use the same queue', async t => {
	const f = await fixture(t);
	const media = f.sources.currentBlua32Media;
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\nend end\n' }]);
	const rejected = f.service.resume();
	const admission = await rejected.admission;
	const result = await rejected.completion;
	assert.equal(admission.status, 'not-admitted');
	assert.equal(result.status, 'rejected');
	if (result.status !== 'rejected') assert.fail('expected rejection');
	assert.equal(result.phase, 'build');
	assert.equal(result.applied, false);
	assert.equal(f.tasks.ready, true);
	assert.equal(f.sources.currentBlua32Media, media);
	f.model.undo();
	assert.deepEqual(await f.service.resume().completion, { status: 'completed', applied: true });
});

test('admission releases the exclusive queue while nested physical init roots remain pending', async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = 1 end');
	const depth = f.cpu.getFrameDepth();
	const first = f.service.resume();
	assert.deepEqual(await first.admission, { status: 'accepted', mode: 'applied' });
	assert.equal(first.status, 'initializing');
	assert.equal(first.result, null);
	assert.equal(first.applied, true);
	assert.equal(f.tasks.ready, true, 'guest initialization is not an exclusive task');
	const second = f.service.resume();
	assert.equal(f.service.latestOperation, second);
	await second.admission;
	assert.equal(second.status, 'initializing');
	assert.equal(f.cpu.runUntilDepth(depth + 1, 10000), RunResult.Halted);
	f.debuggerState.plans.pruneCompletedCompletionBatches();
	assert.deepEqual(await second.completion, { status: 'completed', applied: true });
	assert.equal(first.result, null, 'the older root has not returned');
	assert.equal(f.cpu.runUntilDepth(depth, 10000), RunResult.Halted);
	f.debuggerState.plans.pruneCompletedCompletionBatches();
	assert.deepEqual(await first.completion, { status: 'completed', applied: true });
});

test('fault evidence reports applied code and remains final when retained init is discarded', async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = 1 end');
	const operation = f.service.resume();
	await operation.admission;
	// Host-frame integration separately verifies the real supervisor sequence;
	// here the owner notification is driven directly to test result lifetime.
	f.debuggerState.plans.faultCompletionBatches(17);
	assert.deepEqual(await operation.completion, { status: 'faulted', applied: true, sequence: 17 });
	assert.equal(f.debuggerState.plans.mutationActive, true);
	discardRuntimeDebuggerPlans(f.debuggerState);
	assert.deepEqual(operation.result, { status: 'faulted', applied: true, sequence: 17 });
});

for (const reason of ['machine-reset', 'shutdown'] as const) test(`${reason} cancels queued admission before any media write`, async t => {
	const f = await fixture(t);
	const media = f.sources.currentBlua32Media;
	let release!: () => void;
	void f.tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), assert.ifError);
	const operation = f.service.resume();
	await setImmediate();
	let joined = false;
	const drain = reason === 'shutdown' ? f.service.shutdown().then(() => { joined = true; }) : undefined;
	if (reason === 'machine-reset') f.service.cancelPending(reason);
	assert.equal(f.service.latestOperation, null, 'retired feedback cannot reach a replacement session');
	assert.deepEqual(await operation.completion, { status: 'cancelled', applied: false, reason });
	assert.equal(joined, false, 'shutdown must still join the admitted exclusive work');
	release();
	assert.deepEqual(await operation.admission, { status: 'not-admitted', result: operation.result });
	await drain;
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(f.tasks.ready, true);
	if (reason === 'shutdown') {
		assert.equal(joined, true);
		assert.throws(() => f.service.resume(), /shutdown/);
	} else assert.deepEqual(await f.service.resume().completion, { status: 'completed', applied: true });
});

test('shutdown cancels a paused initializer without waiting for or unwinding guest execution', async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = 1 end');
	const operation = f.service.resume();
	await operation.admission;
	const depth = f.cpu.getFrameDepth();
	await f.service.shutdown();
	assert.deepEqual(await operation.completion, { status: 'cancelled', applied: true, reason: 'shutdown' });
	assert.equal(f.cpu.getFrameDepth(), depth);
	discardRuntimeDebuggerPlans(f.debuggerState);
	assert.equal(operation.result!.status, 'cancelled');
});

test('readback and host execution failures settle requests as infrastructure failures', async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = 1 end');
	const error = new Error('readback failure');
	f.target.backend.finishGxGpuReadbacks = async () => { throw error; };
	const beforeApply = f.service.resume();
	assert.equal((await beforeApply.admission).status, 'not-admitted');
	assert.deepEqual(await beforeApply.completion, { status: 'failed', applied: false, error });
	assert.equal(f.tasks.ready, false, 'unlike a source rejection, a runtime task failure holds execution');
	f.target.backend.finishGxGpuReadbacks = async () => {};
	const afterApply = f.service.resume();
	await afterApply.admission;
	f.service.failPending(error);
	assert.deepEqual(await afterApply.completion, { status: 'failed', applied: true, error });
});

test('relocation rejection preserves installed media and the real retained frame', async t => {
	const f = await fixture(t, 'local function parked() while true do halt_until_irq end end\nparked()');
	const media = f.sources.currentBlua32Media;
	const frame = f.cpu.activeThread.frames.at(-1)!;
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: 'module<entry>\nwhile true do halt_until_irq end' }]);
	const operation = f.service.resume();
	assert.equal((await operation.admission).status, 'not-admitted');
	const result = await operation.completion;
	assert.equal(result.status, 'rejected');
	if (result.status !== 'rejected') assert.fail('expected relocation rejection');
	assert.equal(result.phase, 'relocation');
	assert.equal(result.applied, false);
	assert.equal(f.tasks.ready, true);
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(f.cpu.activeThread.frames.at(-1), frame);
});
