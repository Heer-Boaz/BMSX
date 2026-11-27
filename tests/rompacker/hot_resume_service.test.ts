import { setReferenceGlobal } from '../helpers/global_bank_reference';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { TEST_CARTRIDGE_CONTEXT_IDS, createLoadedTestRuntimeSourceState } from '../helpers/runtime_sources';
import { beforeEach, afterEach } from 'node:test';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
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
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { MAPPED_BUS_INSTRUCTION_FETCH, mappedBusSignalsForCartridgeSlot } from '../../machine/ts/machine/memory/bus_signals';
import { MAPPED_PAGE_BYTE_MASK, type MappedPageBinding } from '../../machine/ts/machine/memory/mapped_page';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';

import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { createRuntimeDebuggerState, discardRuntimeDebuggerPlans, willExecuteRuntimeDebuggerPlan, didExecuteRuntimeDebuggerPlan } from '../../ide/runtime/debugger_state';
import { HotResumeService } from '../../ide/workbench/services/execution/hot_resume';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { asClosure, valueInteger, valueNil, valueTag, ValueTag, valuePayload } from '../../machine/ts/machine/cpu/value';
import { buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { identityHotResumeRevision } from '../helpers/hot_resume';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { afterTest } from '../helpers/test_cleanup';

async function fixture(t: TestContext, init = '') {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-hot-resume-'));
	const source = `module<entry>\n${init}\nwhile true do halt_until_irq end`;
	const media = await buildScenarioMediaFixture(directory, [], {
		systemSource: 'module<entry>', launchCartridge: true, systemModules: [], cartSource: source,
	});
	const decoded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(decoded.system, decoded.cartridgeSlots);
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	// Hot Resume must also replace generated bodies, so this fixture runs the JavaScript backend.
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, input, CpuExecutionBackend.JavaScript);
	const runtime = target.runtime, cpu = runtime.machine.cpu;
	// EXEC selects the cart before its startup calls have retired. Start the
	// edit at the cart's actual WAIT, not in a startup allocation.
	for (let grant = 0; grant < 100
		&& (!cpu.isCartridgeExecutionActive() || !cpu.isHaltedUntilIrq() || !runtime.admitExternalCpuMutation()); ++grant) {
		target.advanceGame(10_000);
	}
	assert.equal(cpu.isCartridgeExecutionActive(), true);
	assert.equal(cpu.isUserMode(), true);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(runtime.admitExternalCpuMutation(), true);
	const guest = new SuspendedGuestSession(runtime);
	const debuggerState = createRuntimeDebuggerState(runtime, sources);
	const audio = { muteRuntimeTask() {}, mutePause() {} } as unknown as HostAudioOutput;
	const tasks = new RuntimeTaskQueue(audio, target.presenter), execution = new HostExecutionControl(audio);
	const models = new EditorTextModelService();
	const service = new HotResumeService(models, sources, guest, createRuntimeFaultState(), debuggerState,
		input, runtime, tasks, execution, new Map());
	const model = models.retain({ contextLabel: 'fixture-source', sourceFilePath: 'entry.lua', location: { kind: 'workspace' as const, path: 'entry.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'entry.lua', source: { resid: 'entry', type: 'lua' } }, 'lua', source);
	// Same resource/version in a different document owner must not enter this build.
	editorTextModelService.retain(model.resource, 'lua', 'end end -- foreign workspace');
	afterTest(t, async () => {
		await service.shutdown();
		discardRuntimeDebuggerPlans(debuggerState);
		models.clear(); editorTextModelService.clear();
		clearWorkspaceSourceCaches();
		target.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	return { service, sources, runtime, cpu, target, tasks, execution, debuggerState, model, source };
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

test('Hot Resume retires warmed generated code and runs the edited function without rebooting its caller', async t => {
	const f = await fixture(t, `function calculate(x) return x + 3 end
retained = 0
for i = 1, 512 do retained = calculate(retained) end`);
	assert.equal(f.cpu.getGlobalByKey(f.cpu.stringPool.intern('retained')), valueInteger(1536));
	const depth = f.cpu.getFrameDepth();
	const binding: MappedPageBinding = { key: 0, cacheable: false, readBytes: null, readByteOffset: 0, writeWatches: null, writeWatchIndex: 0 };
	const compiledEntry = (pc: number) => {
		const image = f.cpu.activeThread.frameAtDepth(depth - 1).executionImage;
		f.cpu.memory.bindMappedPage((pc & ~MAPPED_PAGE_BYTE_MASK) >>> 0, mappedBusSignalsForCartridgeSlot(0) | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		return image.decodedPages.get(binding.key)?.compiledBlocks?.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	};
	let calculate = f.cpu.getGlobalByKey(f.cpu.stringPool.intern('calculate'));
	assert.equal(valueTag(calculate), ValueTag.Closure);
	const original = compiledEntry(f.cpu.captureClosureBinding(asClosure(calculate, f.cpu.gc)).codeAddress);
	assert.ok(original, 'the installed program must have generated the callable itself');
	f.cpu.beginCompletionCall(asClosure(calculate, f.cpu.gc), [valueInteger(2)]);
	assert.equal(f.cpu.runUntilDepth(depth, 10000), RunResult.Halted);
	assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(5)]);
	const parked = f.cpu.activeThread.frameAtDepth(depth - 1);
	setReferenceGlobal(f.cpu, f.cpu.stringPool.intern('retained'), valueInteger(9876));
	const source = f.model.buffer.getText(), offset = source.indexOf('x + 3');
	assert.ok(offset >= 0);
	f.model.pushEditOperations([{ offset, deleteLength: 'x + 3'.length, text: 'x + 7' }]);
	assert.deepEqual(await f.service.resume().completion, { status: 'completed', applied: true });
	assert.equal(f.cpu.getFrameDepth(), depth); assert.equal(f.cpu.activeThread.frameAtDepth(depth - 1), parked);
	assert.equal(f.cpu.isHaltedUntilIrq(), true);
	assert.equal(f.cpu.getGlobalByKey(f.cpu.stringPool.intern('retained')), valueInteger(9876), 'Hot Resume must not repeat startup or replace live globals');
	const caller = f.cpu.readFramePc(depth - 1); // Installation may relocate the parked instruction.
	calculate = f.cpu.getGlobalByKey(f.cpu.stringPool.intern('calculate'));
	assert.equal(valueTag(calculate), ValueTag.Closure);
	for (let attempt = 0; attempt < 12; ++attempt) {
		f.cpu.beginCompletionCall(asClosure(calculate, f.cpu.gc), [valueInteger(2)]);
		assert.equal(f.cpu.runUntilDepth(depth, 10000), RunResult.Halted);
		assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(9)], 'cold and regenerated bodies must use the edited instructions');
	}
	const regenerated = compiledEntry(f.cpu.captureClosureBinding(asClosure(calculate, f.cpu.gc)).codeAddress);
	assert.ok(regenerated && regenerated !== original, 'the new image must admit a new generated body for the edited callable');
	assert.equal(f.cpu.getFrameDepth(), depth); assert.equal(f.cpu.readFramePc(depth - 1), caller); assert.equal(f.cpu.isHaltedUntilIrq(), true);
});

test('Hot Resume reorders and removes literals without replacing live String values', async t => {
	const f = await fixture(t, `function describe(first)
	if first then return 'amber' end
	return 'sapphire'
end
old_label = 'bygone'`);
	const { cpu, runtime } = f;
	const depth = cpu.getFrameDepth();
	const describe = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('describe')!), cpu.gc);
	const label = cpu.stringPool.find('old_label')!;
	const retained = cpu.getGlobalByKey(label);
	function describeFirst() {
		cpu.beginCompletionCall(describe, [valueInteger(1)]);
		assert.equal(cpu.runUntilDepth(depth, 10000), RunResult.Halted);
		return runtime.readCompletionValues()[0];
	}
	const before = describeFirst();
	assert.equal(valuePayload(before), cpu.stringPool.find('amber'));
	const previous = "'amber' end\n\treturn 'sapphire'\nend\nold_label = 'bygone'";
	const offset = f.source.indexOf(previous);
	assert.notEqual(offset, -1);
	f.model.pushEditOperations([{ offset, deleteLength: previous.length,
		text: "'sapphire' end\n\treturn 'amber'\nend\nold_label = nil" }]);
	assert.deepEqual(await f.service.resume().completion, { status: 'completed', applied: true });
	assert.equal(valuePayload(describeFirst()), cpu.stringPool.find('sapphire'));
	assert.equal(cpu.getGlobalByKey(label), retained, 'live state still refers to the removed literal');
	assert.equal(valuePayload(retained), cpu.stringPool.find('bygone'));
	assert.equal(cpu.getFrameDepth(), depth);
});

test('Hot Resume rebinds retained closures without replacing their captures or identity', async t => {
	const f = await fixture(t, `local retained_value = 17
function make_retained() return function(x) return x + retained_value + 3 end end
retained_function = make_retained()`);
	const key = f.cpu.stringPool.intern('retained_function');
	const reference = f.cpu.getGlobalByKey(key);
	const retained = asClosure(reference, f.cpu.gc);
	assert.equal(valueTag(reference), ValueTag.Closure);
	assert.equal(ClosureRecord.captureCount(f.cpu.memory, retained), 1);
	const upvalue = ClosureRecord.captureAddress(f.cpu.memory, retained, 0);
	const oldCodeAddress = f.cpu.captureClosureBinding(retained).codeAddress;
	const depth = f.cpu.getFrameDepth();
	f.cpu.beginCompletionCall(retained, [valueInteger(2)]);
	assert.equal(f.cpu.runUntilDepth(depth, 10000), RunResult.Halted);
	assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(22)]);
	const source = f.model.buffer.getText();
	const offset = source.indexOf('retained_value + 3');
	const parentOffset = source.indexOf('return function(x)');
	assert.ok(offset >= 0);
	assert.ok(parentOffset >= 0);
	f.model.pushEditOperations([
		{ offset: parentOffset, deleteLength: 'return function(x)'.length,
			text: 'local y = retained_value; retained_value = y + 1; return function(x)' },
		{ offset, deleteLength: 'retained_value + 3'.length, text: 'retained_value + 7' },
	]);
	assert.deepEqual(await f.service.resume().completion, { status: 'completed', applied: true });
	assert.equal(f.cpu.getGlobalByKey(key), reference);
	assert.equal(ClosureRecord.captureAddress(f.cpu.memory, retained, 0), upvalue);
	assert.notEqual(f.cpu.captureClosureBinding(retained).codeAddress, oldCodeAddress, 'the retained closure must follow relocated code');
	f.cpu.beginCompletionCall(retained, [valueInteger(2)]);
	assert.equal(f.cpu.runUntilDepth(depth, 10000), RunResult.Halted);
	assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(26)]);
});

test('Hot Resume rejects an unmapped live closure before changing guest state', async t => {
	const f = await fixture(t, `local retained_value = 17
function make_retained() return function(x) return x + retained_value end end
retained_function = make_retained()`);
	const key = f.cpu.stringPool.intern('retained_function');
	const reference = f.cpu.getGlobalByKey(key);
	const retained = asClosure(reference, f.cpu.gc);
	const image = f.sources.currentBlua32Media.cartridgeSlots[0]!.layout;
	const revision = identityHotResumeRevision(image);
	const index = blua32FunctionIndexAtAddress(image, f.cpu.captureClosureBinding(retained).functionAddress);
	assert.notEqual(index, -1);
	revision.revision.functionAddresses[index] = 0;
	const oldCodeAddress = f.cpu.captureClosureBinding(retained).codeAddress;
	assert.throws(() => buildHotResumeRelocation(f.cpu, [null, revision, null], f.cpu.getFrameDepth()), /closure/);
	assert.equal(f.cpu.getGlobalByKey(key), reference);
	assert.equal(f.cpu.captureClosureBinding(retained).codeAddress, oldCodeAddress);
});

test('Hot Resume rebinds a closure retained only in a weak table', async t => {
	const f = await fixture(t, `weak_values = {}
weak_meta = { __mode = 'v' }
local function put_weak()
 local retained_value = 17
 weak_values[1] = function(x) return x + retained_value + 3 end
end
put_weak()`);
	const weakValues = valuePayload(f.cpu.getGlobalByKey(f.cpu.stringPool.intern('weak_values')));
	f.cpu.gc.tables.setMetatableAddress(weakValues, valuePayload(f.cpu.getGlobalByKey(f.cpu.stringPool.intern('weak_meta'))));
	const reference = f.cpu.gc.tables.getInteger(weakValues, 1);
	assert.equal(valueTag(reference), ValueTag.Closure);
	const retained = asClosure(reference, f.cpu.gc);
	let visited = false;
	f.cpu.gc.tables.setInteger(weakValues, 1, valueNil());
	f.cpu.visitReachableExecutionRecords(closure => { if (closure === retained) visited = true; });
	assert.equal(visited, false, 'the weak entry must be the only guest path to this closure');
	f.cpu.gc.tables.setInteger(weakValues, 1, reference);
	f.cpu.visitReachableExecutionRecords(closure => { if (closure === retained) visited = true; });
	assert.equal(visited, true, 'tooling traversal includes stored weak entries');
	const source = f.model.buffer.getText();
	const offset = source.indexOf('retained_value + 3');
	f.model.pushEditOperations([{ offset, deleteLength: 'retained_value + 3'.length, text: 'retained_value + 7' }]);
	assert.deepEqual(await f.service.resume().completion, { status: 'completed', applied: true });
	assert.equal(f.cpu.gc.tables.getInteger(weakValues, 1), reference);
	const depth = f.cpu.getFrameDepth();
	f.cpu.beginCompletionCall(retained, [valueInteger(2)]);
	assert.equal(f.cpu.runUntilDepth(depth, 10000), RunResult.Halted);
	assert.deepEqual(f.runtime.readCompletionValues(), [valueInteger(26)]);
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

test('Hot Resume with accepted time owes the retained IRQ to the scheduler before changing history', async t => {
	const f = await fixture(t, `function irq() mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK} end`);
	const { cpu } = f, { history, machine } = f.runtime;
	machine.memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_VBLANK);
	machine.irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.isUserMode(), false, 'this caller would otherwise request supervisor return');
	const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
	const media = f.sources.currentBlua32Media, { scheduler } = machine;
	const clock = scheduler.nowCycles;
	scheduler.acceptedCpuCycles = f.runtime.timing.cycleBudgetPerFrame;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	history.captureCheckpoint();

	const operation = f.service.resume();
	assert.equal((await operation.admission).status, 'not-admitted');
	assert.equal((await operation.completion).status, 'rejected');
	assert.equal(history.mode, HistoryMode.Recording);
	assert.equal(history.checkpointCount, 1);
	assert.equal(f.debuggerState.plans.controlActive, false);
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc);
	assert.equal(scheduler.nowCycles, clock);
});

test('Hot Resume ends review only after the build is accepted, without recording admission', async t => {
	const f = await fixture(t);
	const history = f.runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	history.captureCheckpoint();
	history.beginSeek(history.latestCycles);
	let ended = 0, resumed = 0;
	history.onWillEndReview = () => { assert.equal(history.mode, HistoryMode.Reviewing); ended++; };
	history.onWillResumeRecording = () => resumed++;
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\nend end\n' }]);
	assert.equal((await f.service.resume().completion).status, 'rejected');
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(ended, 0, 'rejected source does not end historical review');
	f.model.undo();
	assert.equal((await f.service.resume().completion).status, 'completed');
	assert.equal(history.mode, HistoryMode.Disabled);
	assert.equal(ended, 1, 'accepted installation ends review before stopping history');
	assert.equal(resumed, 0, 'installation is not recording admission');
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
	const olderPc = f.cpu.readFramePc(depth);
	const second = f.service.resume();
	assert.equal(f.service.latestOperation, second);
	assert.deepEqual(await second.admission, { status: 'accepted', mode: 'deferred' });
	for (let grant = 0; grant < 32 && second.status === 'waiting-for-user'; ++grant) {
		willExecuteRuntimeDebuggerPlan(f.debuggerState);
		f.target.advanceGame(10_000);
		didExecuteRuntimeDebuggerPlan(f.debuggerState);
		await f.tasks.join();
	}
	assert.equal(second.status, 'initializing');
	assert.equal(f.cpu.readFramePc(depth), olderPc, 'preparing backing must not run the older initializer');
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

test('workbench Hot Resume runs init to its physical return without continuing the parked game', async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = 1 end');
	const pcs = Array.from({ length: f.cpu.getFrameDepth() }, (_, index) => f.cpu.readFramePc(index));
	const first = f.service.resume('workbench');
	await first.admission;
	assert.equal(first.status, 'initializing');
	assert.equal(f.debuggerState.plans.workbenchExecutionRequested, true);
	const duplicate = f.service.resume('workbench');
	assert.equal((await duplicate.admission).status, 'not-admitted');
	assert.equal(duplicate.result!.status, 'rejected');
	assert.equal(first.result, null, 'busy admission must not replace the admitted fence');
	willExecuteRuntimeDebuggerPlan(f.debuggerState);
	f.target.advanceGame(10000);
	didExecuteRuntimeDebuggerPlan(f.debuggerState);
	assert.deepEqual(await first.completion, { status: 'completed', applied: true });
	assert.equal(f.cpu.getGlobalByKey(f.cpu.stringPool.intern('refreshed')), valueInteger(1));
	assert.deepEqual(Array.from({ length: f.cpu.getFrameDepth() }, (_, index) => f.cpu.readFramePc(index)), pcs,
		'retained caller frames and PCs have not advanced');
	assert.equal(f.debuggerState.plans.workbenchExecutionRequested, false);
	assert.equal(f.debuggerState.plans.mutationActive, false);
	assert.equal(f.execution.userPaused, true, 'a formerly running game remains paused after bounded init');
});

test('Hot Resume reserves backing for an initializer above an already-full caller', async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = (refreshed or 0) + 1 end');
	const { cpu } = f, thread = cpu.activeThread, owner = thread.address;
	const oldMedia = f.sources.currentBlua32Media;
	const image = oldMedia.cartridgeSlots[0]!.layout, entry = image.header.initFunctionAddress;
	const width = image.functions[blua32FunctionIndexAtAddress(image, entry)].maxStack;
	while (thread.frameSpaceFits(thread.stackTop + width)) cpu.beginCompletionCallInExecutionDomain(0, entry);
	const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
	const beforeValues = thread.stackRegisters.capacity(), beforeFrames = thread.frameBackingBytes;
	const key = cpu.stringPool.find('refreshed')!;
	assert.equal(cpu.getGlobalByKey(key), valueNil(), 'pending initializers have not run');
	const operation = f.service.resume('workbench');
	assert.deepEqual(await operation.admission, { status: 'accepted', mode: 'deferred' });
	assert.equal(f.sources.currentBlua32Media, oldMedia, 'preparation executes against the installed ROM');
	for (let grant = 0; grant < 32 && operation.result === null; ++grant) {
		willExecuteRuntimeDebuggerPlan(f.debuggerState);
		f.target.advanceGame(10_000);
		didExecuteRuntimeDebuggerPlan(f.debuggerState);
		await f.tasks.join();
	}
	assert.deepEqual(operation.result, { status: 'completed', applied: true });
	assert.equal(cpu.activeThread.address, owner);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc);
	assert.ok(thread.stackRegisters.capacity() > beforeValues || thread.frameBackingBytes > beforeFrames);
	assert.equal(cpu.getGlobalByKey(key), valueInteger(1), 'only the requested initializer ran');
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
	const frame = f.cpu.activeThread.currentFrame!;
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
	assert.equal(f.cpu.activeThread.currentFrame!, frame);
});

// Source-refresh operations use a real workspace owner, separate from recovery.
beforeEach(() => openWorkspaceRecords(new MemoryWorkspaceFiles()));
afterEach(() => closeWorkspaceRecords());

for (const admitted of [false, true]) test(`tool cancellation ${admitted ? 'after' : 'before'} Hot Resume admission`, async t => {
	const f = await fixture(t, 'local function refresh<init>() refreshed = 1 end');
	const request = new AbortController(), gate = Promise.withResolvers<void>();
	const media = f.sources.currentBlua32Media;
	if (!admitted) void f.tasks.schedule(() => gate.promise, assert.ifError);
	const operation = f.service.resume('game', request.signal);
	if (admitted) await operation.admission;
	request.abort(); gate.resolve();
	await operation.admission;
	assert.equal(f.tasks.ready, true);
	if (admitted) {
		assert.equal(operation.result, null, 'an admitted physical initializer stays workspace-owned');
		assert.equal(operation.status, 'initializing');
	} else {
		assert.deepEqual(operation.result, { status: 'cancelled', applied: false, reason: 'interrupted' });
		assert.equal(f.sources.currentBlua32Media, media);
	}
});
