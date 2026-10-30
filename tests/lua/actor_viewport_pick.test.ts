import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { captureInstalledLuaSources, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { ActorViewportPicker } from '../../ide/workbench/contrib/actor_lab/viewport_pick';
import { runtimeWorld } from '../../ide/workbench/contrib/actor_lab/runtime';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createTestRuntime, createTestSystemImageRuntimeSourceState, TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

// Exact compiled guest layout/function identities, no cart or Workbench UI
// dependency. Full cartlib construction is tested by the World/visual suites.
function fixture(t: TestContext, entry: string, worldSource: string, extraModules: readonly { path: string; source: string }[]) {
	const modules = [{ path: 'cartlib/world/world', source: worldSource }, ...extraModules]
		.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const chunk = parseLuaChunk(entry, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: entry, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports, captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	runtime.machine.cpu.reset();
	runtime.machine.cpu.runUntilDepth(0, 100_000);
	const f = createRuntimeInspectionFixture(runtime, sources);
	f.inspection.pause();
	const stop = f.inspection.open(), picker = new ActorViewportPicker(sources, f.guest);
	const unsubscribe = f.guest.onDidInvalidate(reason => picker.invalidate(reason));
	t.after(() => { unsubscribe(); stop.dispose(); });
	return { ...f, picker };
}
test('viewport picking follows render order and cropped negative scale, using cached typed guest identities', t => {
	const f = fixture(t, `local world<const> = require('cartlib/world/world')
function rename_pick() world._objects[1].id = 'renamed' end
function hide_pick() world._render_visuals[2].visible = false end`, `
local sprite<const> = require('cartlib/component/sprite_component')
local front<const> = { id = 1, definition_id = 'front', visible = true,
 spatial={xx=1,xy=0,yx=0,yy=1,ox=20,oy=10} }
local back<const> = { id = '1', visible = 0,
 spatial={xx=1,xy=0,yx=0,yy=1,ox=0,oy=0} }
local background<const> = { owner = back, draw = sprite.draw_visual, visible = true,
 spatial=back.spatial, attachment_xx=1,attachment_xy=0,attachment_yx=0,attachment_yy=1,attachment_ox=0,attachment_oy=0,
 presentation_xx=1,presentation_xy=0,presentation_yx=0,presentation_yy=1,presentation_ox=0,presentation_oy=0,
 source_width=32,source_height=24 }
local foreground<const> = { owner = front, draw = sprite.draw_region_visual, visible = true,
 spatial=front.spatial, attachment_xx=-2,attachment_xy=0,attachment_yx=0,attachment_yy=0.75,attachment_ox=-4,attachment_oy=-2,
 presentation_xx=1,presentation_xy=0,presentation_yx=0,presentation_yy=0.5,presentation_ox=0,presentation_oy=0,
 source_width=99,source_height=99,region_width=6,region_height=8 }
local custom<const> = { owner = front, draw = sprite.custom, visible = true }
return { _objects = { front, back }, _render_visuals = { background, foreground, custom }, _render_visual_count = 3 }`, [{
		path: 'cartlib/component/sprite_component', source: `local sprite<const> = {}
function sprite.draw_visual() end
function sprite.draw_region_visual() end
function sprite.custom() end
return sprite`,
	}]);
	const picker = f.picker, cpu = f.runtime.machine.cpu;
	const world = runtimeWorld(f.sources, f.guest, -1)!, objects = f.guest.readStringMember(world, '_objects') as Table;
	const front = (objects.getInteger(1) as Table).hashId, back = (objects.getInteger(2) as Table).hashId;
	const before = [f.runtime.machine.scheduler.currentNowCycles(), cpu.luaHeap.usedBytes()];
	const hit = picker.pick(-1, 8, 9)!;
	assert.equal(hit.hashId, front);
	assert.deepEqual([hit.left, hit.top, hit.right, hit.bottom], [4, 8, 16, 11]);
	const read = t.mock.method(f.guest, 'readStringMember'), format = t.mock.method(f.guest, 'formatValue');
	for (let frame = 0; frame < 1000; frame++) assert.equal(picker.pick(-1, 8, 9), hit);
	assert.equal(read.mock.callCount(), 0);
	assert.equal(picker.pick(-1, 128, 128), undefined);
	assert.equal(picker.pick(-1, 8, 9)!.hashId, front);
	assert.equal(format.mock.callCount(), 0, 'crossing empty space does not allocate the same label again');
	assert.equal(picker.pick(-1, 0, 9)!.hashId, back, 'cropping, not full-source extent; numeric zero remains guest-truthy');
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), cpu.luaHeap.usedBytes()], before);
	const original = picker.pick(-1, 8, 9)!.label;
	f.guest.invalidate(); runCompletionClosure(cpu, f.guest.global('rename_pick') as Closure, []);
	assert.notEqual(picker.pick(-1, 8, 9)!.label, original, 'renaming retains identity but refreshes presentation');
	f.guest.invalidate(); runCompletionClosure(cpu, f.guest.global('hide_pick') as Closure, []);
	assert.equal(picker.pick(-1, 8, 9)!.hashId, back);
});

test('picking composes borrowed local hierarchy once, rejects empty affine corners and never refreshes guest caches', t => {
	const f = fixture(t, `local world<const> = require('cartlib/world/world')
function move_parent() world._objects[1].spatial.spatial_parent.ox = 50 end
function flatten_parent()
 local parent<const> = world._objects[1].spatial.spatial_parent
 parent.xx=0 parent.xy=0 parent.yx=0 parent.yy=0
end`, `
local sprite<const> = require('cartlib/component/sprite_component')
local parent<const> = {xx=0,xy=1,yx=-1,yy=0,ox=40,oy=10}
local spatial<const> = {xx=1,xy=0,yx=1,yy=1,ox=4,oy=6,spatial_parent=parent,
 wxx=99,wxy=99,wyx=99,wyy=99,wox=-900,woy=-900}
local actor<const> = {id='child',visible=true,spatial=spatial}
local visual<const> = {owner=actor,spatial=spatial,visible=true,draw=sprite.draw_visual,
 attachment_xx=1,attachment_xy=0,attachment_yx=0,attachment_yy=1,attachment_ox=2,attachment_oy=0,
 presentation_xx=1,presentation_xy=0,presentation_yx=0.5,presentation_yy=1,presentation_ox=0,presentation_oy=1,
 source_width=4,source_height=4}
local distant<const> = {owner=actor,spatial=spatial,visible=true,draw=sprite.draw_visual,
 attachment_xx=1,attachment_xy=0,attachment_yx=0,attachment_yy=1,attachment_ox=100,attachment_oy=0,
 presentation_xx=1,presentation_xy=0,presentation_yx=0,presentation_yy=1,presentation_ox=0,presentation_oy=0,
 source_width=4,source_height=4}
return {_objects={actor},_render_visuals={visual,distant},_render_visual_count=2}
`, [{ path: 'cartlib/component/sprite_component', source: `return {draw_visual=function() end,draw_region_visual=function() end}` }]);
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	const read = t.mock.method(f.guest, 'readStringMember');
	const hit = f.picker.pick(-1, 31, 22)!;
	assert.ok(hit !== undefined);
	// The bounds are the focused affine picking algorithm's output, not UI layout.
	assert.deepEqual([hit.left, hit.top, hit.right, hit.bottom], [29, 17, 33, 27]);
	assert.equal(read.mock.calls.filter(call => call.arguments[1] === 'xx').length, 2,
		'two visuals share their concrete ancestor observation, not two hierarchy walks');
	// Force new observations, not the picker's identical-pointer shortcut. This
	// component performance contract forbids reallocating warm identity caches.
	const clear = t.mock.method(Map.prototype, 'clear'), admit = t.mock.method(WeakMap.prototype, 'set');
	for (let observation = 0; observation < 32; observation++) {
		assert.equal(f.picker.pick(-1, 31 + (observation % 2) * 0.25, 22), hit);
	}
	assert.equal(clear.mock.callCount(), 0);
	assert.equal(admit.mock.callCount(), 0);
	clear.mock.restore(); admit.mock.restore();
	assert.equal(f.picker.pick(-1, 29.2, 17.2), undefined, 'an AABB corner is not inside the sheared sprite');
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	const world = runtimeWorld(f.sources, f.guest, -1)!, actor = (f.guest.readStringMember(world, '_objects') as Table).getInteger(1);
	const spatial = f.guest.readStringMember(actor, 'spatial');
	assert.equal(f.guest.readStringMember(spatial, 'wox'), -900, 'observation cannot populate a guest cache');
	f.guest.invalidate(); runCompletionClosure(f.runtime.machine.cpu, f.guest.global('move_parent') as Closure, []);
	assert.equal(f.picker.pick(-1, 31, 22), undefined);
	assert.ok(f.picker.pick(-1, 41, 22) !== undefined, 'the next observation consumes the new parent source');
	f.guest.invalidate(); runCompletionClosure(f.runtime.machine.cpu, f.guest.global('flatten_parent') as Closure, []);
	assert.equal(f.picker.pick(-1, 41, 22), undefined, 'a singular plane does not manufacture an interior');
});

test('picking preserves the visual owner\'s Number association before world composition', t => {
	const f = fixture(t, `require('cartlib/world/world')`, `
local sprite<const> = require('cartlib/component/sprite_component')
local spatial<const> = {xx=1e16,xy=0,yx=0,yy=1,ox=1,oy=0}
local actor<const> = {id='rounding',visible=true,spatial=spatial}
local visual<const> = {owner=actor,spatial=spatial,visible=true,draw=sprite.draw_visual,
 attachment_xx=1,attachment_xy=0,attachment_yx=0,attachment_yy=1,attachment_ox=1,attachment_oy=0,
 presentation_xx=1,presentation_xy=0,presentation_yx=0,presentation_yy=1,presentation_ox=-1,presentation_oy=0,
 source_width=1,source_height=1}
return {_objects={actor},_render_visuals={visual},_render_visual_count=1}
`, [{ path: 'cartlib/component/sprite_component', source: `return {draw_visual=function() end,draw_region_visual=function() end}` }]);
	// World*(attachment*presentation) starts at 1. Reassociating to
	// (world*attachment)*presentation rounds that origin to 0 instead.
	assert.equal(f.picker.pick(-1, 0.5, 0.5), undefined);
	assert.ok(f.picker.pick(-1, 1, 0.5) !== undefined);
});
