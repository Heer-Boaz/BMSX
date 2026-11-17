import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { parseSystemRomImage } from '../../machine/ts/rompack/image';
import { cartridgeMediaFromImages } from '../../hosts/common/cartridge_media';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { ActorRenderObservation } from '../../ide/workbench/contrib/actor_lab/render_observation';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { captureInstalledLuaSources, createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createBlua32SourceImage } from '../../ide/runtime/sources';
import { createLoadedTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { ActorRuntimeTree, findRuntimeActor, runtimeWorld } from '../../ide/workbench/contrib/actor_lab/runtime';
import { ActorRenderGeometry } from '../../ide/workbench/contrib/actor_lab/render_geometry';
import { ActorTimelineTransport } from '../../ide/workbench/contrib/actor_lab/timeline';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { readActorMethods } from '../../ide/workbench/contrib/actor_lab/methods';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { runCompletionClosure } from './cpu_test_harness';

const WORLD = `
local fsm<const> = require('cartlib/fsm/fsm_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local child<const> = {definition={is_concurrent=false},states={},state_ids={}}
local machine<const> = {localdef_id='main',states={[1]=child},state_ids={1},current_id=1.0}
local states<const> = {id='states',enabled=0,_started=true,_owner_component_index=1,_machines={machine}}
local entry<const> = {program={duration_ms=16777217},position_ms=0.25,playing=false}
local timeline<const> = {id='timelines',enabled=true,_owner_component_index=2,_entries_by_id={intro=entry}}
local parent<const> = {id='parent',active=true,_components={},_components_by_class={},wxx=1.0,wxy=0,wyx=0,wyy=1}
local actor<const> = {id=16777217,active=0,parent=parent,ox=16777217,oy=0.25,
 _components={states,timeline},_components_by_class={[fsm]={states},[timelines]={timeline}}}
states.owner=actor; timeline.owner=actor
function actor:method() return 17 end
local source<const> = {_texture={source_addr=0x80000000,stream_word_count=4,texture_word_count=8,clut_word_count=0,mode=2,word_width=4,height=6},
 source_x=1,source_y=2,width=4,height=6,offset_x=1.5,offset_y=-2}
local function visual()
 return {owner=actor,wxx=0.5,wxy=0,wyx=0,wyy=2.0,wox=16777217,woy=0.25,color=0xffffffff,width=4,height=6}
end
local rectangle<const> = visual()
local surface<const> = visual(); surface._source={_tiles={source},width=4,height=6}
local text<const> = visual()
text._layout_empty=false; text._layout_left=0; text._layout_top=0; text._layout_right=4; text._layout_bottom=6
text._layout_revision=16777217; text.glyph_line_count=1; text.line_height=6; text.center_block_width=8
text.layout_line_widths={4}; text.glyph_lines={{source,glyph_count=1,visible_count=1,x_offsets={0.25}}}
local model<const> = {owner=actor,model_id='mesh',scene_index=0,wxx=1.0,wxy=0,wxz=0,wyx=0,wyy=1,wyz=0,wzx=0,wzy=0,wzz=1,wox=16777217,woy=0.25,woz=-0.0}
local renderer<const> = {_models={components={model,model}},_visible={false,0}}
local world<const> = {_objects={parent,actor},_objects_revision=16777217,_spatial_hierarchy={_topology_revision=0},
 rectangle=rectangle,surface=surface,text=text,renderer=renderer}
function world:mutate() actor.id='changed'; entry.position_ms=2; entry.program.duration_ms=nil end
return world`;

for (const optLevel of [0, 3] as const) test(`actor32 O${optLevel}: typed borrows, copied geometry, timeline numbers and restored heap`, t => {
	const { images } = createCartlibProgramHarness("return require('cartlib/world/world')", {
		optLevel, modules: [{ path: 'cartlib/world/world', source: WORLD }],
	});
	const { runtime, sources, cpu } = eventHistoryRuntime(images);
	const registry = createLuaSourceRegistry('', '');
	registerLuaSourceRecord(registry, { resid: 'world', type: 'lua', src: WORLD, base_src: WORLD, base_update_timestamp: 0,
		source_path: 'cartlib/world/world.lua', normalized_source_path: 'cartlib/world/world.lua', module_path: 'cartlib/world/world',
		update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	sources.currentBlua32Media = { ...sources.currentBlua32Media, cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols,
		captureInstalledLuaSources(registry, images.cartSymbols!.metadata.compiledModulePaths), TEST_CARTRIDGE_CONTEXT_IDS[0]), null] };
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const guest = new SuspendedGuestSession(runtime), tree = new ActorRuntimeTree();
	t.after(() => { tree.dispose(); sources.catalog.dispose(); });
	const world = runtimeWorld(sources, guest, 0)!;
	const choices = readActorChoices(sources, guest, 0);
	const actorHash = choices[1].hashId;
	assert.equal(choices[1].label, '16777217', 'host inspection must not promote Integer to rounded Float');
	const actor = findRuntimeActor(sources, guest, 0, actorHash)!;
	assert.equal(readActorMethods(sources, guest, actor).some(method => method.name === 'method'), true);
	tree.update(sources, guest, 0, actor);
	const root = tree.roots[0], state = root.children[0].children[0].children[0], timeline = root.children[1].children[0];
	assert.equal(root.active, true, 'guest Integer zero remains truthy');
	assert.equal(state.active, true, 'Integer and Float state keys compare by guest numeric equality');
	const transport = new ActorTimelineTransport();
	transport.refresh(timeline, false, guest, true, true);
	assert.equal(transport.slider.maximum, 16777217);
	assert.equal(transport.slider.value, 0.25);
	assert.equal(transport.slider.enabled, true);

	const geometry = new ActorRenderGeometry();
	geometry.capture(guest.readStringMember(world, 'rectangle'), 'rectangle', 0, guest);
	const quad = geometry.quads.peek(0);
	assert.equal(quad.hashId, actorHash);
	assert.deepEqual([quad.ox, quad.oy, quad.ax, quad.by, quad.localX, quad.localY], [16777217, 0.25, 2, 12, 16777217, 0.25]);
	assert.equal(quad.parentHashId, choices[0].hashId);
	assert.equal(geometry.world.canvas.peek(0).appearance!.color, 0xffffffff);
	geometry.capture(guest.readStringMember(world, 'surface'), 'surface', 0, guest);
	const tile = geometry.world.canvas.peek(1).appearance!.packets[0];
	assert.deepEqual([tile.x, tile.y, tile.image!.texture.address, tile.image!.texture.bytes], [1.5, -2, 0x80000000, 16]);
	geometry.capture(guest.readStringMember(world, 'text'), 'text', 0, guest);
	const glyph = geometry.world.canvas.peek(2).appearance!.packets[0];
	assert.deepEqual([glyph.x, glyph.y, glyph.width, glyph.height], [2.25, 0, 4, 6], 'guest Nil selects layout widths without treating zero as absence');
	geometry.capture(guest.readStringMember(world, 'renderer'), 'models', 0, guest);
	assert.equal(geometry.world.models.length, 1, 'False hides, Integer zero does not');
	const model = geometry.world.models.peek(0);
	assert.deepEqual([model.world.ox, model.world.oy, model.sceneIndex, model.model.id], [16777217, 0.25, 0, 'mesh']);
	assert.ok(Object.is(model.world.oz, -0));
	const owned = new ActorRenderGeometry(); owned.copyFrom(geometry);

	const oldActor = v.asTable(actor, cpu.gc), saved = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	tree.release();
	assert.equal(root.value, null); assert.equal(root.key, v.valueNil());
	runCompletionClosure(cpu, v.asClosure(guest.readStringMember(world, 'mutate'), cpu.gc), [world]);
	tree.update(sources, guest, 0, findRuntimeActor(sources, guest, 0, actorHash));
	transport.refresh(tree.roots[0].children[1].children[0], false, guest, true, true);
	assert.equal(transport.slider.enabled, false, 'an unbuilt duration is guest Nil');
	assert.equal(tree.roots[0].label, 'changed');
	assert.equal(owned.quads.peek(0).localX, 16777217, 'draw evidence owns only copied scalar state');
	tree.release(); guest.invalidate('history-restored');
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(saved, runtime.model.ramBytes, runtime.model.gxGpuVramBytes));
	const restored = findRuntimeActor(sources, guest, 0, actorHash)!;
	assert.ok(v.asTable(restored, cpu.gc) !== oldActor, 'restore must reacquire its own heap reference');
	tree.update(sources, guest, 0, restored);
	assert.equal(tree.roots[0].label, '16777217');
	transport.refresh(tree.roots[0].children[1].children[0], false, guest, true, true);
	assert.equal(transport.slider.maximum, 16777217);
});

test('numberToHost is subtype-preserving observation, not guest Float promotion', () => {
	for (const integer of [-2147483648, -16777217, -1, 0, 16777217, 2147483647]) assert.equal(v.numberToHost(v.valueInteger(integer)), integer);
	for (const word of [0, 0x80000000, 0x3eaaaaab, 0x7f800000, 0xff800000, 0x7fc00000])
		assert.ok(Object.is(v.numberToHost(v.valueFloatBits(word)), v.asFloat(v.valueFloatBits(word))));
});

test('actor32 observes actual cartlib draw returns and command publication with compact registers', async t => {
	// This exercises the renderer observation owner, not the unrelated Studio contributions.
	const [system, cart] = await Promise.all([readFile('dist/system/bmsx-bios.debug.rom'), readFile('dist/studio_test.debug.rom')]);
	const media = await loadRomToolingMedia(system, [cart, null]);
	const sources = createLoadedTestRuntimeSourceState(media.system, media.cartridgeSlots);
	const runtime = new Runtime({ systemRomBytes: parseSystemRomImage(system).bytes,
		cartridgeSlots: cartridgeMediaFromImages([cart, null]), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const cpu = runtime.machine.cpu, gpu = runtime.machine.gxGpu;
	const guest = new SuspendedGuestSession(runtime);
	const observation = new ActorRenderObservation(cpu, sources.currentBlua32Media.cartridgeSlots[0]!, 0, guest, { value: 0 });
	cpu.setInstructionObserver(observation);
	t.after(() => { cpu.setInstructionObserver(null); sources.catalog.dispose(); });
	const backend = new HeadlessGPUBackend(256, 212, runtime.model.gxGpuVramBytes);
	for (let tick = 0; tick < 180 && !observation.pages.some(page => page.ready && page.geometry.quads.length >= 5); tick++) {
		let completed = false;
		for (let attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; attempt++) {
			if (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick();
		}
		assert.equal(completed, true);
		backend.executeGxGpuCommandDrain(gpu); gpu.retirePresentedCommands();
		runtime.machine.audioController.synchronizeOutput().clear();
		assert.equal(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0);
	}
	const page = observation.pages.find(page => page.ready && page.geometry.quads.length >= 5);
	assert.ok(page, 'real World.render return must publish geometry from all initialized rectangle draws');
	const quad = Array.from(page.geometry.quads).find(item => item.label.includes('runner'))!;
	assert.ok(quad);
	assert.deepEqual([quad.ax, quad.ay, quad.bx, quad.by], [12, 0, 0, 12]);
	assert.ok(quad.hashId > 0);
	const owned = new ActorRenderGeometry(); owned.copyFrom(page.geometry);
	page.geometry.clear();
	assert.ok(owned.quads.length >= 5);
});
