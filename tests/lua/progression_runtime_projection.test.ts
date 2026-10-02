import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { captureRuntimeMachineState, applyRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createBlua32SourceImage, createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import { LuaProgramRuntimeProjection, readProgramInstances } from '../../ide/workbench/contrib/lua_program/runtime';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { cartridgeSlots } from '../helpers/cartridge';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { runCompletionClosure } from './cpu_test_harness';

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

function fixture(optLevel: 0 | 3) {
	const { images } = createCartlibProgramHarness(ENTRY, { optLevel, modules: ['cartlib/progression', 'cartlib/event_matcher', 'cartlib/event_matcher_syntax']
		.map(path => ({path, source: readFileSync(`${path}.lua`, 'utf8')})) });
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC },
		{sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() {return false;}, applyInputControllerVibrationEffect() {}});
	const registry = (): LuaSourceRegistry => ({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: 'test', can_boot_from_source: false, revision: 0 });
	const sources = createTestRuntimeSourceState(registry(), [registry(), null], 0);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(images.systemImage, images.systemSymbols, images.systemBiosImports),
		cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols), null] };
	runtime.machine.cpu.reset(); runtime.machine.cpu.installBootPrimitives();
	runtime.machine.cpu.runUntilDepth(0, 1_000_000);
	const guest = new SuspendedGuestSession(runtime);
	const model = new EditorTextModel({ domain: 0, path: 'entry.lua', source: {type: 'lua', resid: 'entry'} }, 'lua', ENTRY);
	const input = new LuaProgramInput(model, 'progression', {start: 0, end: ENTRY.length}, guest);
	input.liveVisible = true;
	const choices = readProgramInstances(sources, guest, 0, 'progression');
	input.instance = choices.find(item => item.identity.tag === ValueTag.Number)!.identity;
	const projection = new LuaProgramRuntimeProjection(sources, guest);
	projection.refresh(input);
	const invoke = (name: string) => { guest.invalidate(); runCompletionClosure(runtime.machine.cpu, guest.global(name) as Closure, []); projection.refresh(input); };
	return {runtime, guest, input, projection, choices, invoke};
}

for (const optLevel of [0, 3] as const) {
test(`progression projection reads real contexts and once-only receipts without guest execution (O${optLevel})`, t => {
	const f = fixture(optLevel); t.after(() => f.input.dispose());
	assert.deepEqual(f.choices.map(item => item.identity.tag).sort(), [ValueTag.Number, ValueTag.String]);
	const roots = f.input.live.roots.slice(), revision = f.input.stateRevision;
	const values = roots.map(row => row.element.value);
	let traversals = 0;
	const visit = f.guest.visitTableEntries.bind(f.guest);
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof visit>) => {traversals++; return visit(...args);});
	f.projection.refresh(f.input);
	assert.equal(traversals, 0, 'clean projection performs no traversal');
	f.invoke('first');
	assert.equal(f.input.stateRevision, revision, 'once-only receipt can change without a value revision');
	assert.ok(f.input.live.roots.every((row, i) => row === roots[i]), 'ordinary execution retains the projection topology');
	assert.equal(roots.filter((row, i) => row.element.value !== values[i]).length, 1, 'only the first typed rule receipt changes');
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	f.input.liveDirty = true; f.projection.refresh(f.input);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	const previous = roots.map(row => row.element.value);
	f.input.live.textDirty = false; f.invoke('second');
	assert.equal(f.input.stateRevision, revision);
	assert.equal(roots.filter((row, i) => row.element.value !== previous[i]).length, 1, 'the string rule ID has an independent receipt');
	assert.equal(f.input.live.textDirty, true);
});

test(`history restore reacquires the typed context bookmark and restored state (O${optLevel})`, t => {
	const f = fixture(optLevel); t.after(() => f.input.dispose());
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
