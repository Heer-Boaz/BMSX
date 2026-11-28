import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { WORLD_ACTOR_FIXTURE } from '../helpers/world_actor_fixture';
import { TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { captureRuntimeMachineState, applyRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { valueFloat, valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { SuspendedValuePresentation } from '../../ide/runtime/value_presentation';
import { createBlua32SourceImage, createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import { LuaProgramRuntimeProjection, readProgramInstances } from '../../ide/workbench/contrib/lua_program/runtime';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { cartridgeSlots } from '../helpers/cartridge';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';
import { afterTest } from '../helpers/test_cleanup';

const ENTRY = `local progression<const> = require('cartlib/progression')
local events<const> = require('cartlib/event_emitter')
local program<const> = progression.compile_program({
 rules = {
  {id = 1, on = 'first', set = {{key = 'heard', value = true}}, apply_once = true},
  {id = '1', on = 'second', apply_once = true},
  {id = 'repeat', on = 'second', apply_once = false},
 }, filters = {}, handlers = {},
})
progression.mount(1, program)
progression.mount('1', program)
progression.set(1, 'heard', true)
function first() events:emit('first', nil, {}) end
function second() events:emit('second', nil, {}) end
function unmount() progression.unmount(1) end
`;

function fixture(t: TestContext, optLevel: 0 | 3, source = ENTRY, extraModules: readonly { path: string; source: string }[] = []) {
	const { images } = createCartlibProgramHarness(source, { optLevel, modules: [...['cartlib/progression', 'cartlib/event_matcher', 'cartlib/event_matcher_syntax']
		.map(path => ({path, source: readFileSync(`${path}.lua`, 'utf8')})), ...extraModules] });
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC },
		{sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() {return false;}, applyInputControllerVibrationEffect() {}});
	const registry = (): LuaSourceRegistry => ({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: 'test', can_boot_from_source: false, revision: 0 });
	const sources = createTestRuntimeSourceState(registry(), [registry(), null], 0);
	afterTest(t, () => sources.catalog.dispose());
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(images.systemImage, images.systemSymbols, images.systemBiosImports, captureInstalledLuaSources(sources.catalog.getContext(TEST_SYSTEM_CONTEXT_ID).luaSources, images.systemSymbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID),
		cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols, captureInstalledLuaSources(sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, images.cartSymbols!.metadata.compiledModulePaths), TEST_CARTRIDGE_CONTEXT_IDS[0]), null] };
	runtime.machine.cpu.reset();
	const guest = new SuspendedGuestSession(runtime);
	assert.deepEqual(readProgramInstances(sources, guest, 0, 'progression'), [], 'image metadata does not prove its module initializer ran');
	runGuestToHalt(runtime.machine.cpu, 10_000_000);
	const model = new EditorTextModel({ contextLabel: 'fixture-source', sourceFilePath: 'entry.lua', location: { kind: 'workspace' as const, path: 'entry.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'entry.lua', source: {type: 'lua', resid: 'entry'} }, 'lua', source);
	const input = new LuaProgramInput(model, 'progression', {start: 0, end: source.length}, guest);
	afterTest(t, () => input.dispose());
	const transport = new RuntimeTransport(runtime, null!, null!, null!, () => true);
	input.inspectRuntime(transport);
	input.runtimeDomain = 0; input.runtimeImage = sources.currentBlua32Media.cartridgeSlots[0]!;
	const choices = readProgramInstances(sources, guest, 0, 'progression');
	input.instance = choices.find(item => item.identity.tag === ValueTag.Integer)!.identity;
	const projection = new LuaProgramRuntimeProjection(sources, guest);
	projection.refresh(input);
	const invoke = (name: string) => { guest.invalidate(); runCompletionClosure(runtime.machine.cpu, asClosure(guest.global(name), nativeHeapReference(guest.cpu).gc), []); projection.refresh(input); };
	return {runtime, sources, guest, input, projection, choices, invoke, transport};
}

for (const optLevel of [3] as const) {
test(`progression projection reads real contexts and once-only receipts without guest execution (O${optLevel})`, t => {
	const f = fixture(t, optLevel);
	assert.deepEqual(f.choices.map(item => item.identity.tag).sort(), [ValueTag.Integer, ValueTag.String]);
	assert.deepEqual(f.choices.map(item => item.description).sort(), ['Mounted number context', 'Mounted string context']);
	assert.deepEqual(f.input.live.roots.map(row => row.element.label), ['heard', '1 / first', '1 / second', 'repeat / second']);
	assert.equal(f.input.live.roots[0].element.value, 'true');
	assert.equal(f.input.stateRevision, 1);
	const roots = f.input.live.roots.slice(), revision = f.input.stateRevision;
	const values = roots.map(row => row.element.value);
	let traversals = 0;
	const visit = f.guest.visitTableEntries.bind(f.guest);
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof visit>) => {traversals++; return visit(...args);});
	let valueReads = 0;
	const read = f.guest.readStringMember.bind(f.guest);
	t.mock.method(f.guest, 'readStringMember', (value, name) => { if (name === 'values') valueReads++; return read(value, name); });
	f.projection.refresh(f.input);
	assert.equal(traversals, 0, 'clean projection performs no traversal');
	f.invoke('first');
	assert.equal(f.input.stateRevision, revision, 'once-only receipt can change without a value revision');
	assert.equal(valueReads, 0, 'unchanged state does not reread its values table while receipts are refreshed');
	assert.ok(f.input.live.roots.every((row, i) => row === roots[i]), 'ordinary execution retains the projection topology');
	assert.equal(roots.filter((row, i) => row.element.value !== values[i]).length, 1, 'only the first typed rule receipt changes');
	const before = [f.runtime.machine.scheduler.currentNowCycles(), nativeHeapReference(f.runtime.machine.cpu).luaHeap.usedBytes()];
	f.input.liveDirty = true; f.projection.refresh(f.input);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), nativeHeapReference(f.runtime.machine.cpu).luaHeap.usedBytes()], before);
	const previous = roots.map(row => row.element.value);
	f.input.live.textDirty = false; f.invoke('second');
	assert.equal(f.input.stateRevision, revision);
	assert.equal(roots.filter((row, i) => row.element.value !== previous[i]).length, 1, 'the string rule ID has an independent receipt');
	assert.equal(f.input.live.textDirty, true);
});

test(`numeric rule receipts follow logical table-key equality across Integer and Float IDs (O${optLevel})`, t => {
	const f = fixture(t, optLevel, ENTRY.replace('id = 1,', 'id = 1.0,').replace("id = '1',", 'id = 1,'));
	const rules = f.input.live.roots.slice(1, 3);
	assert.deepEqual(rules.map(row => row.element.value), ['apply_once: pending', 'apply_once: pending']);
	f.invoke('first');
	assert.deepEqual(rules.map(row => row.element.value), ['apply_once: done', 'apply_once: done'],
		'1.0 and 1 address the same actual apply_done slot, even across different events');
});

test(`progression slots preserve Integer magnitude, Float values, Nil and wrapping revisions (O${optLevel})`, t => {
	const f = fixture(t, optLevel, ENTRY + `
local rt<const> = progression.mount(false, program)
function large() progression.set(1, 'heard', 16777217) end
function fraction() progression.set(1, 'heard', 0.25) end
function unset() progression.set(1, 'heard', nil) end
function zero() progression.set(1, 'heard', 0) end
function wrap_revision() rt.state.revision = 0x7fffffff; progression.set(false, 'heard', 0.25) end
`);
	const root = f.input.live.roots[0];
	for (const [name, text] of [['large', '16777217'], ['fraction', '0.25'], ['unset', 'nil'], ['zero', '0']]) {
		f.invoke(name); assert.equal(f.input.live.roots[0], root); assert.equal(root.element.value, text);
	}
	const context = readProgramInstances(f.sources, f.guest, 0, 'progression').find(item => item.identity.tag === ValueTag.False)!;
	assert.ok(context, 'false is a real mounted context, not absence');
	f.input.instance = context.identity; f.projection.resolve(f.input);
	f.invoke('wrap_revision');
	assert.equal(f.input.stateRevision, -2147483648);
	assert.equal(f.input.live.roots[0].element.value, '0.25');
	assert.ok(f.input.status.includes('state revision -2147483648'));
});

test(`progression rebind rebuilds topology while retaining real state and logical receipts (O${optLevel})`, t => {
	const f = fixture(t, optLevel, ENTRY + `
function rebind_program()
 local replacement<const> = progression.compile_program({rules={
  {id=1.0,on='rebuilt',set={{key='next',value=0.25},{key='heard',value=false}},apply_once=true},
 },filters={},handlers={}})
 progression.rebind(1,replacement)
end
`);
	f.invoke('first');
	const previous = f.input.live.roots.slice(), stateId = f.input.stateHashId, programId = f.input.programHashId;
	f.invoke('rebind_program');
	assert.equal(f.input.stateHashId, stateId, 'rebind preserves the actual game-owned state');
	assert.notEqual(f.input.programHashId, programId);
	assert.ok(f.input.live.roots.every(row => !previous.includes(row)));
	const values = new Map(f.input.live.roots.map(row => [row.element.label, row.element.value]));
	assert.equal(values.get('heard'), 'true'); assert.equal(values.get('next'), 'nil');
	assert.equal(values.get(`${f.guest.formatValue(valueFloat(1))} / rebuilt`), 'apply_once: done');
});

test(`program attachment replacement retires the old selection without guessing a new instance (O${optLevel})`, t => {
	const f = fixture(t, optLevel);
	const image = f.sources.currentBlua32Media.cartridgeSlots[0]!;
	f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media, cartridgeSlots: [{ ...image }, null] };
	f.projection.resolve(f.input);
	assert.equal(f.input.instance, undefined); assert.equal(f.input.live.roots.length, 0);
});

test(`input projection reads real component construction and empty-program activation without guest execution (O${optLevel})`, t => {
	// Empty bindings need no input device reads. The ordinary helper's input
	// dependency is unused; component construction and compilation are real.
	const modules = ['cartlib/input/actioneffect/actioneffect_component', 'cartlib/input/actioneffect/compiler',
		'cartlib/input/actioneffect/evaluation_program', 'cartlib/input/actioneffect/evaluation_program_syntax',
		'cartlib/actioneffects/actioneffect_component'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') }));
	const f = fixture(t, optLevel, ENTRY + `
local input_type<const> = require('cartlib/input/actioneffect/actioneffect_component')
${WORLD_ACTOR_FIXTURE}
local owner
local specification<const> = {bindings={},exact=16777217,fraction=0.25,flag=false}
local component
local create<const> = function()
 owner=fixture_spawn('input.player', {id='player',player_index=0}, {
  function(target)
   component=input_type.new(target,{program=specification})
   component.id=0
   return component
  end,
 })
end
create()
function activate_input() component:on_activate(); compiled_input_evaluate=component.program.evaluate end
function replace_input() owner:mark_for_disposal(); create() end
`, modules);
	const choices = readProgramInstances(f.sources, f.guest, 0, 'input');
	assert.equal(choices.length, 1); assert.equal(choices[0].label, '0'); assert.equal(choices[0].detail, 'Owner player');
	const input = new LuaProgramInput(f.input.workingCopy, 'input', { start: 0, end: f.input.workingCopy.buffer.getText().length }, f.guest);
	afterTest(t, () => input.dispose());
	input.instance = choices[0].identity; input.runtimeDomain = 0; input.runtimeImage = f.input.runtimeImage;
	input.inspectRuntime(f.transport);
	const projection = new LuaProgramRuntimeProjection(f.sources, f.guest), cpu = f.runtime.machine.cpu;
	const before = [nativeHeapReference(cpu).luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles(), cpu.instructionBudgetRemaining];
	projection.refresh(input);
	assert.deepEqual([nativeHeapReference(cpu).luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles(), cpu.instructionBudgetRemaining], before);
	assert.deepEqual(input.live.roots.map(row => row.element.label), ['clock_source', 'source_program', 'program', 'binding_latch', 'last_frame', 'custom_matches', 'queued_command_count', 'queued_event_count']);
	const source = input.live.roots[1], program = input.live.roots[2];
	assert.equal(input.live.roots[0].element.value, '1'); assert.equal(program.element.value, 'nil');
	source.collapsed = false; projection.resolve(input);
	const properties = new Map(source.children.map(row => [row.element.label, row.element.value]));
	assert.equal(properties.get('exact'), '16777217'); assert.equal(properties.get('fraction'), '0.25'); assert.equal(properties.get('flag'), 'false');
	f.invoke('activate_input');
	const initialized = [nativeHeapReference(cpu).luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles(), cpu.instructionBudgetRemaining];
	projection.refresh(input);
	assert.equal(input.live.roots[2], program); assert.equal(program.expandable, true);
	program.collapsed = false; projection.resolve(input);
	const evaluate = f.guest.global('compiled_input_evaluate');
	assert.equal(valueTag(evaluate), ValueTag.Closure);
	assert.equal(program.children.find(row => row.element.label === 'evaluate')!.element.value, f.guest.formatValue(evaluate));
	assert.deepEqual([nativeHeapReference(cpu).luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles(), cpu.instructionBudgetRemaining], initialized);
	assert.equal(program.children.find(row => row.element.label === 'queued_command_capacity')!.element.value, '0');
	f.invoke('replace_input'); projection.refresh(input);
	assert.equal(readProgramInstances(f.sources, f.guest, 0, 'input').length, 1);
	assert.equal(input.instance, undefined); assert.equal(input.live.roots.length, 0, 'same displayed component ID does not resurrect an old selection');
});

test(`mounted table contexts use central typed identity summaries without reading their contents (O${optLevel})`, t => {
	const f = fixture(t, optLevel, ENTRY + `
context_a = { name = 'not a display identity', nested = {} }
context_b = { name = 'not a display identity', nested = {} }
progression.mount(context_a, program)
progression.mount(context_b, program)
`);
	const choices = f.choices.filter(item => item.identity.tag === ValueTag.Table);
	assert.equal(choices.length, 2);
	const contexts = [f.guest.global('context_a'), f.guest.global('context_b')];
	const summary = new SuspendedValuePresentation(f.guest, 'summary');
	for (const context of contexts) {
		const choice = choices.find(item => f.guest.matchesIdentity(context, item.identity));
		assert.ok(choice, 'each mounted context can be selected by its runtime identity');
		assert.equal(choice.label, summary.update(context), 'choice uses the shared typed summary, not the bookmark token');
	}
	assert.notEqual(choices[0].label, choices[1].label);
	const visit = f.guest.visitTableEntries.bind(f.guest);
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof visit>) => {
		assert.ok(choices.every(choice => !f.guest.matchesIdentity(args[0], choice.identity)), 'context labels enumerated object contents');
		return visit(...args);
	});
	assert.deepEqual(readProgramInstances(f.sources, f.guest, 0, 'progression').map(item => item.label), f.choices.map(item => item.label));
});

test(`rule identities lead shared-event labels while complete event identity remains available (O${optLevel})`, t => {
	const f = fixture(t, optLevel, ENTRY.replace("{id = 1, on = 'first'", "{id = 'dash', on = 'shared.long.event'")
		.replace("{id = '1', on = 'second'", "{id = 'twin', on = 'shared.long.event'")
		.replace("{id = 'repeat', on = 'second'", "{id = 'complete', on = 'shared.long.event'"));
	assert.deepEqual(f.input.live.roots.slice(1).map(row => row.element.label),
		['dash / shared.long.event', 'twin / shared.long.event', 'complete / shared.long.event']);
});

test(`history restore reacquires the typed context bookmark and restored state (O${optLevel})`, t => {
	const f = fixture(t, optLevel);
	const bookmark = f.input.instance!, snapshot = captureRuntimeMachineState(f.runtime), oldRoots = f.input.live.roots.slice();
	f.invoke('first'); f.invoke('second');
	f.guest.invalidate('history-restored'); applyRuntimeMachineState(f.runtime, snapshot);
	assert.strictEqual(f.input.instance, bookmark);
	assert.equal(f.input.live.roots.length, 0);
	f.projection.refresh(f.input);
	assert.notStrictEqual(f.input.live.roots[0], oldRoots[0]);
	assert.equal(f.input.stateRevision, 1);
	f.invoke('unmount');
	assert.equal(f.input.instance, undefined);
	assert.equal(f.input.live.roots.length, 0);
	f.input.instance = bookmark; f.guest.invalidate('heap-replaced');
	assert.equal(f.input.instance, undefined);
});
}


test('Lua program mode changes publish their owned target before observers and never recover follow intent implicitly', t => {
	const f = fixture(t, 0);
	const input = f.input, observations: Array<[boolean, RuntimeTransport | null, boolean]> = [];
	afterTest(t, input.interaction.onDidChange(() => observations.push([input.liveVisible, input.interaction.transport, input.interaction.running])));
	input.interaction.running = true;
	input.showAuthoring();
	assert.equal(input.liveVisible, false);
	assert.equal(input.interaction.transport, null);
	assert.equal(input.interaction.running, false);
	input.inspectRuntime(f.transport);
	assert.deepEqual(observations, [[true, f.transport, true], [false, null, false], [true, f.transport, false]]);
	input.interaction.running = true;
	f.guest.invalidate('heap-replaced');
	assert.equal(input.interaction.running, false);
	assert.equal(input.interaction.transport, f.transport);
	input.dispose();
	assert.equal(input.interaction.transport, null);
});
