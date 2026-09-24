import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
import { HostExecutionControl, HostPauseReason } from '../../hosts/common/execution_control';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createRuntimeSourceState, forkRuntimeSourceState } from '../../ide/runtime/sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { BootService } from '../../ide/workbench/services/execution/boot';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-boot-'));
	const source = 'module<entry>\nwhile true do halt_until_irq end';
	const media = await buildScenarioMediaFixture(directory, [], {
		systemSource: 'module<entry>\ncop0.exec = mem[0x10000028]', systemModules: [], cartSource: source,
	});
	const decoded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createRuntimeSourceState(decoded.system, decoded.cartridgeSlots);
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, input);
	const runtime = target.runtime, cpu = runtime.machine.cpu;
	const audio = { muteRuntimeTask() {}, mutePause() {}, muteSystem() {}, restart() {} } as unknown as HostAudioOutput;
	const execution = new HostExecutionControl(audio);
	const tasks = new RuntimeTaskQueue(audio, target.presenter);
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	const models = new EditorTextModelService();
	const service = new BootService(models, sources, tooling, createRuntimeFaultState(), runtime,
		tasks, execution, audio, new MemoryStorage(), new Map());
	let resets = 0;
	runtime.onStateReset = () => { resets++; service.didReplaceMachine(); };
	const model = models.retain({ domain: 0, path: 'entry.lua', source: { resid: 'entry', type: 'lua' } }, 'lua', source);
	// Same resource/version in a different document owner must not enter this build.
	editorTextModelService.retain(model.resource, 'lua', 'end end -- foreign workspace');
	t.after(async () => {
		await service.shutdown();
		models.clear(); editorTextModelService.clear();
		clearWorkspaceSourceCaches();
		target.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	return { service, sources, runtime, cpu, target, tasks, execution, audio, models, model, source, resets: () => resets };
}

test('rebuilt cart source layers support direct Scenario Lab forks as well as reload from bytes', async t => {
	const f = await fixture(t), registry = f.sources.systemLuaSources;
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- rebuilt source\n' }]);
	assert.equal((await f.service.reboot().completion).status, 'reset');
	const fork = forkRuntimeSourceState(f.sources);
	assert.notEqual(fork.systemRom, f.sources.systemRom);
	assert.equal(fork.systemRom.bytes, f.sources.systemRom.bytes, 'forking does not duplicate ROM backing bytes');
	assert.equal(fork.cartridgeSlots[0]!.rom.bytes, f.sources.cartridgeSlots[0]!.rom.bytes);
	const decoded = await loadRomToolingMedia(f.sources.systemRom.bytes, [f.sources.cartridgeSlots[0]!.rom.bytes, null]);
	const reopened = createRuntimeSourceState(decoded.system, decoded.cartridgeSlots);
	for (const state of [fork, reopened]) {
		assert.deepEqual(state.systemInstalledBlua32Sources, f.sources.systemInstalledBlua32Sources);
		assert.deepEqual(state.cartridgeSlots[0]!.installedBlua32Sources, f.sources.cartridgeSlots[0]!.installedBlua32Sources);
		assert.notEqual(state.systemLuaSources.records[0], registry.records[0]);
	}
	for (const layer of [f.sources.systemRom, f.sources.cartridgeSlots[0]!.rom]) {
		assert.ok(layer.index.entries.every(entry => entry.payload_id === layer.id), 'each derived entry names its owning ROM bytes');
	}
	const capturedBytes = fork.cartridgeSlots[0]!.rom.bytes, capturedIndex = fork.cartridgeSlots[0]!.rom.index;
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '-- later authoring install\n' }]);
	assert.equal((await f.service.reboot().completion).status, 'reset');
	assert.notEqual(f.sources.cartridgeSlots[0]!.rom.bytes, capturedBytes);
	assert.equal(fork.cartridgeSlots[0]!.rom.bytes, capturedBytes, 'an in-flight test build retains its admitted ROM backing');
	assert.equal(fork.cartridgeSlots[0]!.rom.index, capturedIndex);
});

test('startup installs captured sources and performs one physical reset without executing guest code', async t => {
	const f = await fixture(t);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- startup edit\n' }]);
	const operation = f.service.start();
	assert.equal(operation.kind, 'startup');
	assert.deepEqual(await operation.completion, { status: 'reset', installed: true, reset: true });
	assert.equal(f.service.latestOperation, operation, 'the operation owns its synchronous reset notification');
	assert.equal(f.resets(), 1, 'successful startup does not reset packed media and then reset again');
	assert.equal(f.execution.launchPending, false);
	assert.equal(f.cpu.isCartridgeExecutionActive(), false);
	assert.equal(f.runtime.machine.scheduler.currentNowCycles(), 0);
	assert.equal(f.sources.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), operation.sourceSnapshots[0].source);
});

test('rejected startup keeps an independent launch hold, including Continue and frame-step requests', async t => {
	const f = await fixture(t);
	const media = f.sources.currentBlua32Media;
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\nend end\n' }]);
	const operation = f.service.start();
	const result = await operation.completion;
	assert.equal(result.status, 'rejected');
	assert.equal(result.installed, false);
	assert.equal(result.reset, true, 'packed hardware is initialized for inspection, not execution');
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(f.execution.launchPending, true);
	f.execution.requestExecution(true);
	assert.equal(f.execution.executionBlocked(), true);
	f.execution.requestFrameStep();
	assert.equal(f.execution.executionBlocked(true), true);
	assert.equal(f.resets(), 1);
	f.model.undo();
	assert.equal((await f.service.reboot().completion).status, 'reset');
	assert.equal(f.execution.launchPending, false, 'only accepted source boot releases startup hold');
});

test('Reboot captures entry and text at admission, resets through the exclusive queue and does not save or resume', async t => {
	const f = await fixture(t);
	f.execution.setPauseReason(HostPauseReason.Requested, true);
	let release!: () => void;
	void f.tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), assert.ifError);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- captured\n' }]);
	const captured = f.model.createSnapshot();
	const entry = { domain: 0 as const, sourcePath: 'entry.lua' };
	const operation = f.service.reboot(entry);
	entry.sourcePath = 'missing.lua';
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: 'end end' }]);
	await setImmediate();
	assert.equal(operation.status, 'queued');
	assert.equal(operation.result, null);
	assert.equal(f.resets(), 0);
	release();
	assert.deepEqual(await operation.completion, { status: 'reset', installed: true, reset: true });
	await f.tasks.join();
	assert.deepEqual(operation.entry, { domain: 0, sourcePath: 'entry.lua' });
	assert.equal(operation.sourceSnapshots[0].version, captured.version);
	assert.equal(f.sources.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), captured.source);
	assert.equal(f.model.dirty, true);
	assert.equal(f.execution.userPaused, true, 'playback is an explicit command policy, not reset completion');
	assert.equal(f.tasks.ready, true);
});

test('preparation rejection preserves the installed execution and does not poison the queue', async t => {
	const f = await fixture(t);
	const media = f.sources.currentBlua32Media, frame = f.cpu.activeThread.frames.at(-1);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\nend end\n' }]);
	const result = await f.service.reboot().completion;
	assert.equal(result.status, 'rejected');
	assert.equal(result.reset, false);
	assert.equal(result.installed, false);
	await f.tasks.join();
	assert.equal(f.tasks.ready, true);
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(f.cpu.activeThread.frames.at(-1), frame);
	assert.equal(f.resets(), 0);
	f.model.undo();
	assert.deepEqual(await f.service.reboot().completion, { status: 'reset', reset: true, installed: true });
});

test('a newer Reboot supersedes queued preparation without installing the older source', async t => {
	const f = await fixture(t);
	let release!: () => void;
	void f.tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), assert.ifError);
	const first = f.service.reboot();
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- latest\n' }]);
	const second = f.service.reboot();
	assert.deepEqual(await first.completion, { status: 'cancelled', reason: 'superseded', reset: false, installed: false });
	await setImmediate();
	release();
	assert.equal((await second.completion).status, 'reset');
	assert.equal(f.service.latestOperation, second);
	assert.equal(f.resets(), 1);
	assert.equal(f.sources.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), second.sourceSnapshots[0].source);
});

test('pre-cancelled Reboot cannot supersede an already accepted operation', async t => {
	const f = await fixture(t), pending = f.service.reboot();
	assert.throws(() => f.service.reboot(undefined, AbortSignal.abort()), { name: 'AbortError' });
	assert.equal(f.service.latestOperation, pending);
	assert.equal((await pending.completion).status, 'reset');
	assert.equal(f.resets(), 1);
});

test('cancelling queued Reboot prevents installation and cannot affect its replacement', async t => {
	const f = await fixture(t), gate = Promise.withResolvers<void>(), signal = new AbortController();
	void f.tasks.schedule(() => gate.promise, assert.ifError);
	const media = f.sources.currentBlua32Media, operation = f.service.reboot(undefined, signal.signal);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- replacement\n' }]);
	signal.abort();
	assert.deepEqual(await operation.completion, { status: 'cancelled', reason: 'interrupted', installed: false, reset: false });
	assert.equal(f.service.latestOperation, operation, 'the historical outcome is available to ordinary and tool observers');
	assert.equal(f.resets(), 0); assert.equal(f.sources.currentBlua32Media, media);
	const next = f.service.reboot();
	assert.notEqual(operation.id, next.id);
	gate.resolve();
	assert.equal((await next.completion).status, 'reset');
	assert.equal(f.resets(), 1);
	assert.equal(f.sources.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), next.sourceSnapshots[0].source);
});

test('late cancellation preserves completed physical effects and a newer pending Reboot', async t => {
	const f = await fixture(t), signal = new AbortController();
	const completed = f.service.reboot(undefined, signal.signal), result = await completed.completion;
	const next = f.service.reboot();
	signal.abort();
	assert.equal(completed.result, result); assert.equal(result.status, 'reset');
	assert.equal(f.service.latestOperation, next);
	assert.equal((await next.completion).status, 'reset'); assert.equal(f.resets(), 2);
});

for (const reason of ['machine-reset', 'shutdown'] as const) test(`${reason} retires queued Reboot and prevents late installation`, async t => {
	const f = await fixture(t);
	const media = f.sources.currentBlua32Media;
	let release!: () => void;
	void f.tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), assert.ifError);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- must not install\n' }]);
	const operation = f.service.reboot();
	await setImmediate();
	let joined = false;
	const drain = reason === 'shutdown' ? f.service.shutdown().then(() => { joined = true; }) : undefined;
	if (reason === 'machine-reset') f.runtime.rebootSystem();
	assert.deepEqual(await operation.completion, { status: 'cancelled', reason, reset: false, installed: false });
	assert.equal(f.service.latestOperation, null);
	assert.equal(joined, false);
	release();
	await f.tasks.join();
	await drain;
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(f.resets(), reason === 'machine-reset' ? 1 : 0);
	if (reason === 'shutdown') {
		assert.equal(joined, true);
		assert.throws(() => f.service.reboot(), /shutdown/);
	} else assert.equal((await f.service.reboot().completion).status, 'reset');
});

test('readback failure is an infrastructure result, not build rejection or reset acknowledgement', async t => {
	const f = await fixture(t);
	const error = new Error('readback failure');
	f.target.backend.finishGxGpuReadbacks = async () => { throw error; };
	assert.deepEqual(await f.service.reboot().completion,
		{ status: 'failed', phase: 'queued', reset: false, installed: false, error });
	await f.tasks.join();
	assert.equal(f.tasks.ready, false);
	assert.equal(f.resets(), 0);
});

test('host transport failure after reset preserves actual effects rather than rolling back or reporting success', async t => {
	const f = await fixture(t);
	const error = new Error('audio restart failure');
	f.audio.restart = () => { throw error; };
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n-- installed\n' }]);
	assert.deepEqual(await f.service.reboot().completion,
		{ status: 'failed', phase: 'resetting', reset: true, installed: true, error });
	await f.tasks.join();
	assert.equal(f.tasks.ready, false);
	assert.equal(f.execution.launchPending, true);
	assert.equal(f.resets(), 1);
	assert.equal(f.sources.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), f.model.buffer.getText());
});

test('entry selection rejects an impossible second-socket launch before mutating the machine', async t => {
	const f = await fixture(t);
	const result = await f.service.reboot({ domain: 1 }).completion;
	if (result.status !== 'rejected') assert.fail('expected entry rejection');
	assert.match(String(result.error), /CART 0 first/);
	assert.equal(result.reset, false);
	assert.equal(result.installed, false);
	assert.equal(f.resets(), 0);
});

test('boot operations do not own editor views, feedback or workspace-session composition', async () => {
	const source = await readFile('ide/workbench/services/execution/boot.ts', 'utf8');
	assert.doesNotMatch(source, /from ['"][^'"]*(?:cart_editor|feedback_state|runtime_error|workspace\/storage|commands\/|contrib\/)/);
});
