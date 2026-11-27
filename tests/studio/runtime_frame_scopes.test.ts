import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import assert from 'node:assert/strict';
import test from 'node:test';
import { asThread, valueBool, valueInteger, valueNil, valueString, valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { resolveFrameScopeRetirement } from '../../ide/runtime/frame_scopes';
import { readRuntimeLuaModuleExport } from '../../ide/runtime/lua_inspection';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { createTestRuntime } from '../helpers/runtime_sources';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';
import { createLiveStudioFixture } from '../helpers/live_studio';

test('firmware retirement ends escaped accessors without unwinding their thread', () => {
	const image = compileFrameEvaluationTest(`
reader = false
keeper = coroutine.create(function(value, ...)
 local index<const> = frame_count(running_thread()) - 1
 local ok, message = repl.evaluate_frame('reader = function() return value end; coroutine.yield(42); return value', '=retirement', index, 0)
 assert(ok, message)
 return value, message
end)
assert(coroutine.resume(keeper, 17))
verify = function() return pcall(reader) end
return true`, 0);
	const runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const sources = createScenarioTestSourceState([]);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports, captureInstalledLuaSources(sources.catalog.getContext(TEST_SYSTEM_CONTEXT_ID).luaSources, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	const guest = new SuspendedGuestSession(runtime);
	cpu.reset();
	// A pre-initialization source installation has no scope registry yet.
	assert.equal(resolveFrameScopeRetirement(sources, guest), undefined);
	runGuestToHalt(cpu, 30_000_000);
	const initialized = materializeCpuCompletionValues(cpu);
	assert.deepEqual(initialized, [valueBool(true), valueBool(true)], initialized.map(value => guest.formatValue(value)).join('\t'));
	const keeper = asThread(guest.global('keeper'), cpu.gc);
	const pcs = Array.from({ length: cpu.readThreadFrameDepth(keeper) }, (_, index) => cpu.readThreadFrameWord(keeper, index, FrameField.Pc));
	const reader = guest.global('reader');
	assert.deepEqual(guest.callClosure(reader), [valueInteger(17)]);
	const depth = cpu.getFrameDepth();
	cpu.beginCompletionCall(resolveFrameScopeRetirement(sources, guest)!.closure);
	cpu.runUntilDepth(depth, 30_000_000);
	assert.deepEqual(Array.from({ length: cpu.readThreadFrameDepth(keeper) }, (_, index) => cpu.readThreadFrameWord(keeper, index, FrameField.Pc)), pcs, 'retirement neither resumes nor rewrites the borrowed stack');
	assert.deepEqual(guest.callClosure(guest.global('verify')).map(value => guest.formatValue(value)),
		['false', 'Selected frame evaluation has ended.']);
});

for (const rebind of [false, true]) test(`source Hot Resume ${rebind ? 'binds operands and ' : ''}retires an open frame scope before publication`, async t => {
	const f = await createLiveStudioFixture(t, {
		ready: ide => ide.actorExecution.canExecute,
		edits: { 'cart.lua': cart => {
			const start = cart.buffer.getText().indexOf('world:start()');
			cart.pushEditOperations([{ offset: start, deleteLength: 0, text: `
held_scope = held_scope or false
function hold_scope(open)
	held_scope = open(coroutine.running(), 0)
end
function scope_probe() return 17 end
` }]);
		} },
	});
	const { ide, sources, runtime } = f, { guest } = ide, { cpu, scheduler } = runtime.machine;
	const scopes = readRuntimeLuaModuleExport(sources, guest, -1, 'debug/frame_scopes');
	assert.equal(scopes.kind, 'value');
	guest.callClosure(guest.global('hold_scope'), [guest.readStringMember(scopes.value, 'open')]);
	assert.equal(runtime.completionCallPending(), false);
	const held = guest.global('held_scope');
	assert.equal(valueTag(guest.readStringMember(held, 'thread')), ValueTag.Thread);
	const depth = cpu.getFrameDepth(), thread = cpu.activeThread.address;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const from = model.buffer.getText().indexOf('return 17 end');
	const literal = 'first published while a live frame scope is held';
	model.pushEditOperations([{ offset: from, deleteLength: 'return 17'.length,
		text: rebind ? `scope_introduced = '${literal}'; return scope_introduced` : 'return 19' }]);
	const before = sources.currentBlua32Media;
	const now = scheduler.nowCycles;
	let bindingReturned = false;
	if (rebind) {
		const readCompletion = runtime.readCompletionValues.bind(runtime);
		t.mock.method(runtime, 'readCompletionValues', () => {
			const values = readCompletion();
			if (!bindingReturned && values.length === 1 && values[0] === valueInteger(0)) {
				bindingReturned = true;
				assert.equal(sources.currentBlua32Media, before);
				assert.equal(valueTag(guest.readStringMember(held, 'thread')), ValueTag.Thread, 'scope has not retired when firmware returns from binding');
			}
			return values;
		});
	}
	const operation = ide.hotResumes.resume('workbench');
	assert.deepEqual(await operation.admission, { status: 'accepted', mode: 'deferred' });
	assert.equal(sources.currentBlua32Media, before);
	assert.equal(valueTag(guest.readStringMember(held, 'thread')), ValueTag.Thread, 'admission has not yet retired the guest scope');
	await f.until(() => operation.result !== null);
	assert.deepEqual(operation.result, { status: 'completed', applied: true });
	assert.notEqual(sources.currentBlua32Media, before);
	assert.ok(scheduler.nowCycles > now, 'retirement used ordinary guest time');
	assert.equal(guest.readStringMember(held, 'thread'), valueNil());
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.activeThread.address, thread);
	assert.equal(bindingReturned, rebind);
	if (rebind) assert.equal(guest.global('scope_introduced'), valueNil(), 'binding must not execute edited code');
	assert.deepEqual(guest.callClosure(guest.global('scope_probe')), [
		rebind ? valueString(cpu.stringPool.find(literal)!) : valueInteger(19),
	]);
});
