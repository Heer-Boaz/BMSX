import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { IO_APU_SAMPLE_SEQUENCE, IO_SYS_TIME_MS } from '../../machine/ts/spec/bmsx/io';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { valueString, type StringValue } from '../../machine/ts/machine/cpu/value';
import { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

const modules = [...WORLD_CPU_MODULES, ...['cartlib/apu', 'cartlib/world/base_system', 'cartlib/timeline/timeline_system'].map(path => ({
	path, source: readFileSync(`${path}.lua`, 'utf8'),
}))];
const setup = WORLD_CPU_SETUP + `
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local program<const> = require('cartlib/timeline/program')
local visual2<const> = require('cartlib/component/visual_2d_component')
local manual_factory<const> = function(owner)
	return timeline_component.new(owner,{clock_mode='manual'})
end
prefab.define({def_id='timeline.pose2',class={},spatial={family='2d',authority='affine',
	local_transform={1,0,0,1,3,7}},components={manual_factory}})
prefab.define({def_id='timeline.pose3',class={},spatial={family='3d',authority='affine',
	local_transform={1,0,0,0,1,0,0,0,1,3,7,11}},components={manual_factory}})
`;

for (const optLevel of [0, 3] as const) {
	test(`FSM state-created timeline receivers are admitted after entry and replaced on reentry (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local fsm<const> = require('cartlib/fsm/fsm_component')
local library<const> = require('cartlib/fsm/library')
return pcall(function()
library.register('timeline.entry_binding', { initial='hidden', states={
 hidden={}, shown={
  entering_state=function(self) self.panel={value=0} end,
  exiting_state=function(self) self.panel=nil end,
  timelines={ sample={def={duration_ms=100,tracks={
   {kind='value',path={'panel','value'},interpolation='linear',
    keys={{time_ms=0,value=2},{time_ms=100,value=12}}},
  }}}},
 },
} })
prefab.define({def_id='timeline.state_receiver',class={},components={manual_factory,
 fsm.factory({'timeline.entry_binding'})}})
local owner<const> = world:spawn('timeline.state_receiver',{})
assert(owner.panel==nil,'inactive state fabricated its entry-owned recipient')
owner.state_machines:transition_to('/shown')
local first<const> = owner.panel
local entry<const> = owner.timelines:get('sample')
local program<const> = entry.program
assert(first.value==2 and entry.playing,'autoplay ran before entry constructed the recipient')
owner.timelines:seek_time('sample',50)
assert(first.value==7)
owner.state_machines:transition_to('/hidden')
assert(owner.panel==nil and not entry.playing,'exited state retained scheduled playback')
owner.state_machines:transition_to('/shown')
local second<const> = owner.panel
assert(second~=first and second.value==2 and first.value==7
 and owner.timelines:get('sample')==entry and entry.program==program,
 'reentry sampled a retired recipient or rebuilt its transport/program identity')
owner.timelines:seek_time('sample',100)
assert(second.value==12 and first.value==7,'new playback wrote the previous state lifetime')
world:clear()
return true
end)
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const result = materializeCpuCompletionValues(cpu);
		assert.equal(result[0], true, result[0] ? undefined : cpu.stringPool.toString((result[1] as StringValue).id));
		assert.equal(result[1], true);
	});

	test(`FSM timeline admission uses the constructor-published component before autoplay (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local fsm<const> = require('cartlib/fsm/fsm_component')
local library<const> = require('cartlib/fsm/library')
return pcall(function()
library.register('timeline.component_binding', { initial='active', states={ active={ timelines={
 bound={target_path={'sample'},def={phase='presentation',duration_ms=100,tracks={
  {kind='spatial',operation='presentation_origin2',channels={
   ox={interpolation='linear',keys={{time_ms=0,value=3},{time_ms=100,value=13}}},oy=7}},
 } }},
} } } })
local actor<const> = {}
function actor:ctor()
 self.sample=self:get_component(visual2)
end
prefab.define({def_id='timeline.constructor_alias',class=actor,
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,40,50}},
 components={manual_factory,function(owner) return visual2.new(owner,nil,'sample') end,
 fsm.factory({'timeline.component_binding'})}})
local owner<const> = world:spawn('timeline.constructor_alias',{})
local visual<const> = owner.sample
local entry<const> = owner.timelines:get('bound')
assert(entry.playing and entry.primary_binding==visual
 and entry.channel_writers[1]==visual2.set_presentation_origin
 and visual.presentation_ox==3 and visual.presentation_oy==7,
 'autoplay admitted the WorldObject in place of its constructor-published visual')
local physical_revision<const> = owner.spatial._origin_revision
owner.timelines:seek_time('bound',50)
assert(visual.presentation_ox==8 and visual.presentation_oy==7
 and owner.spatial.ox==40 and owner.spatial.oy==50
 and owner.spatial._origin_revision==physical_revision,
 'targeted presentation sampling changed the physical owner')
world:clear()
return true
end)
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const result = materializeCpuCompletionValues(cpu);
		assert.equal(result[0], true, result[0] ? undefined : cpu.stringPool.toString((result[1] as StringValue).id));
		assert.equal(result[1], true);
	});

	test(`grouped spatial sampling preserves real identities, interpolation and query boundaries (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local owner<const> = world:spawn('timeline.pose2',{})
local pose<const> = owner.spatial
local seen = 0
owner.timelines:define('move',{phase='physical',bindings={'pose'},duration_ms=100,tracks={
	{kind='spatial',binding='pose',operation='local_origin2',channels={ox={interpolation='linear',keys={
		{time_ms=0,value=0},{time_ms=50,value=10},{time_ms=100,value=30}}}}},
	{kind='sample',binding='pose',apply=function(target)
		target:resolve_world()
		assert(target==pose and target.wox==target.ox, 'query observed an uncommitted spatial group')
		seen=seen+1
	end},
	{kind='spatial',binding='pose',operation='local_affine2',channels={xx=2,xy=0,yx=1,yy=3}},
}}, {pose=pose})
owner.timelines:seek_time('move',75)
assert(pose.ox==20 and pose.oy==7 and pose.xx==2 and pose.yx==1 and pose.yy==3 and seen==1,
	'grouped affine writer lost omitted origin or numeric interpolation')
owner.timelines:seek_time('move',25)
assert(pose.ox==5 and pose.oy==7 and seen==2, 'reverse seek retained a stale scalar segment')
local other<const> = world:spawn('timeline.pose3',{})
other.timelines:define('move',{phase='physical',bindings={'pose'},duration_ms=100,tracks={
	{kind='spatial',binding='pose',operation='local_origin3',channels={
		ox={interpolation='step',keys={{time_ms=0,value=2},{time_ms=50,value=9},{time_ms=100,value=12}}},
		oy={interpolation='cubic',keys={{time_ms=0,value=0,arrive_tangent=0,leave_tangent=0},
			{time_ms=100,value=10,arrive_tangent=0,leave_tangent=0}}},oz=30}},
}}, {pose=other.spatial})
other.timelines:seek_time('move',50)
assert(other.spatial.ox==9 and other.spatial.oy==5 and other.spatial.oz==30,
	'3D grouped writer did not consume numeric step/cubic coefficients')
local second<const> = world:spawn('timeline.pose2',{})
local receivers<const> = {pose=pose}
owner.timelines:define('bound',{phase='physical',bindings={'pose'},duration_ms=100,tracks={{kind='spatial',
	binding='pose',operation='local_origin2',channels={ox={interpolation='linear',keys={{time_ms=0,value=0},{time_ms=100,value=20}}}}}}},receivers)
receivers.pose=second.spatial
owner.timelines:seek_time('bound',50)
assert(pose.ox==10 and second.spatial.ox==3, 'mutating caller binding map retargeted seek after definition admission')
owner.timelines:play('bound')
assert(pose.ox==0 and second.spatial.ox==3, 'play implicitly reread a mutated caller binding map')
owner.timelines:play('bound',{bindings={pose=second.spatial}})
owner.timelines:seek_time('bound',50)
assert(pose.ox==0 and second.spatial.ox==10, 'explicit play binding override was not admitted')
owner.timelines:play('bound')
assert(pose.ox==0 and second.spatial.ox==10, 'explicit play override replaced the retained definition receivers')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`nested mixed-domain groups retain unsampled frame coefficients while time channels advance (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local range<const> = require('cartlib/timeline/timeline').range
local owner<const> = world:spawn('timeline.pose2',{})
local pose<const> = owner.spatial
owner.timelines:define('mixed',{phase='physical',bindings={'pose'},duration_ms=30,subsequences={{
	duration_ms=30,sequence={phase='physical',bindings={'pose'},frames=range(3),frame_duration=10,tracks={{
		kind='spatial',binding='pose',operation='local_origin2',channels={
			ox={interpolation='linear',keys={{frame=0,value=0},{frame=1,value=10},{frame=2,value=20}}},
			oy={interpolation='linear',keys={{time_ms=0,value=0},{time_ms=100,value=20}}},
		},
	}}},
}}}, {pose=pose})
owner.timelines:play('mixed')
pose:set_local_origin(7,pose.oy)
owner.timelines:tick_gameplay(5)
observed={pose.ox,pose.oy}
owner.timelines:tick_gameplay(5)
observed[3]=pose.ox
observed[4]=pose.oy
pose:set_local_origin(17,pose.oy)
owner.timelines:tick_gameplay(5)
observed[5]=pose.ox
observed[6]=pose.oy
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const observed = cpu.getGlobalByKey(cpu.stringPool.find('observed')!) as Table;
		assert.deepEqual(Array.from({ length: 6 }, (_, index) => observed.getInteger(index + 1)),
			[7, 1, 10, 2, 17, 3]);
	});

	test(`cold writer admission protects every generic lowering and retains exact leaf receivers (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local owner<const> = world:spawn('timeline.pose2',{})
local pose<const> = owner.spatial
local bad<const> = {
	{target=pose,frames={{ox=99}},apply=true},
	{target=pose,tracks={{kind='value',interpolation='step',path={'ox'},keys={{time_ms=0,value=99}}}}},
	{target=pose,tracks={{kind='value',interpolation='linear',path={'ox'},keys={{time_ms=0,value=99}}}}},
	{target=pose,tracks={{kind='wave',path={'ox'},base=0,amp=10,period=1,wave='pingpong'}}},
}
for index=1,#bad do
	local admitted<const> = pcall(function() owner.timelines:define('bad',bad[index]) end)
	assert(not admitted and pose.ox==3, 'generic output bypassed protected spatial storage')
end
local reference<const> = pcall(function()
	owner.timelines:define('replace',{tracks={{kind='value',interpolation='step',path={'spatial'},keys={{time_ms=0,value=pose}}}}})
end)
assert(not reference and owner.spatial==pose, 'generic output replaced the fixed spatial capability reference')
local presentation<const> = pcall(function()
	program.compile({phase='presentation',tracks={{kind='spatial',operation='local_origin2',channels={ox=1}}}})
end)
assert(not presentation, 'presentation program admitted a physical writer')
local callback<const> = pcall(function() program.compile({frames={1},apply=function() end}) end)
assert(not callback, 'opaque callback program omitted its execution phase')
local root<const> = transform2.root_origin.new(hierarchy.new(),{}, {1,0,0,1,0,0})
local forbidden<const> = pcall(function()
	owner.timelines:define('root',{phase='physical',target=root,tracks={{kind='spatial',operation='local_affine2',channels={xx=2}}}})
end)
assert(not forbidden, 'root-origin binding admitted an affine writer')
local leaf<const> = {ox=-1}
local target<const> = {leaf=leaf}
owner.timelines:define('leaf',{target=target,duration_ms=100,tracks={{kind='value',path={'leaf','ox'},
	interpolation='linear',keys={{time_ms=0,value=0},{time_ms=100,value=20}}}}})
target.leaf=pose
owner.timelines:seek_time('leaf',50)
assert(leaf.ox==10 and pose.ox==3, 'mutable intermediate path redirected an admitted raw writer')
local rebound<const> = pcall(function() owner.timelines:play('leaf') end)
assert(not rebound, 'explicit rebind admitted a newly protected receiver')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`visual groups and scalar property channels invoke their owning invalidation writers (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local owner<const> = world:spawn('timeline.pose2',{})
local visual<const> = visual2.new(owner,nil,'sprite')
visual:set_draw_function(function() end)
owner:add_component(visual)
local revision<const> = world._visual_revision
owner.timelines:define('visual',{phase='presentation',bindings={'visual'},duration_ms=100,tracks={
	{kind='spatial',binding='visual',operation='presentation_origin2',channels={ox=12,oy=5}},
	{kind='spatial',binding='visual',operation='attachment_basis2',channels={xx=2,xy=0,yx=0,yy=3}},
	{kind='value',binding='visual',property='order',interpolation='linear',keys={{time_ms=0,value=2}}},
	{kind='value',binding='visual',property='presentation_order',interpolation='step',keys={{time_ms=0,value=4}}},
}}, {visual=visual})
owner.timelines:seek_time('visual',50)
visual:resolve_pose()
assert(owner.spatial.ox==3 and owner.spatial.oy==7, 'presentation animation moved the physical pose')
assert(visual.presentation_ox==12 and visual.presentation_oy==5 and visual.wox==27 and visual.woy==22,
	'visual group skipped prefixed state or pose invalidation')
assert(visual.order==2 and visual.presentation_order==4 and world._visual_revision>revision,
	'property writers bypassed visual sorting invalidation')
local denied<const> = pcall(function()
	owner.timelines:define('rawvisual',{target=visual,tracks={{kind='value',interpolation='linear',path={'order'},keys={{time_ms=0,value=99}}}}})
end)
assert(not denied and visual.order==2, 'raw visual order write bypassed its owner')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`whole-program phase scheduling precedes physics and delays cross-phase reentrant playback (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local timeline_system<const> = require('cartlib/timeline/timeline_system')
local manager<const> = require('cartlib/world/system_manager')
local clock<const> = require('cartlib/clock')
local physics_observed = 0
local late_value = 0
local system<const> = {}
function system.new() return setmetatable({tick_functions={{group=30,priority=0,clock_source=clock.gameplay,method='update'}}},{__index=system}) end
function system:update()
	physics_observed=physics_observed+1
	assert(actor.spatial.ox==20 and late_value==0, 'physical clip ran after physics or presentation ran before physics')
end
prefab.define({def_id='scheduled',class={},spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}},components={timeline_component.new}})
actor=world:spawn('scheduled',{})
actor.timelines:define('late',{phase='presentation',duration_ms=100,tracks={{kind='value',interpolation='linear',
	apply=function(_,value) late_value=value end,keys={{time_ms=0,value=0},{time_ms=100,value=100}}}}})
actor.timelines:define('early',{phase='physical',duration_ms=20,bindings={'pose'},tracks={{kind='spatial',binding='pose',
	operation='local_origin2',channels={ox={interpolation='linear',keys={{time_ms=0,value=0},{time_ms=20,value=20}}}}}}}, {pose=actor.spatial})
actor.timelines:play('early',nil,function(owner)
	owner.timelines:play('late',{snap_to_start=false})
end)
local update<const> = manager.new(world):configure({timeline_system,system},20,20)
update()
assert(physics_observed==1 and actor.timelines:get('early').position_ms==20 and actor.timelines:get('late').position_ms==0
	and late_value==0, 'reentrant presentation consumed the delta that completed its physical predecessor')
update()
assert(actor.timelines:get('late').position_ms==20 and late_value==20, 'next clock update did not admit queued presentation')
local mixed<const> = pcall(function()
	require('cartlib/timeline/program').compile({phase='presentation',subsequences={{duration_ms=20,
		sequence={phase='physical',duration_ms=20}}}})
end)
assert(not mixed, 'nested sequence acquired a second incompatible execution phase')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});
	test(`manual clock transport remains exclusive when attached to an updating World (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local timeline_system<const> = require('cartlib/timeline/timeline_system')
prefab.define({def_id='timeline.world',class={},components={timeline_component.new}})
local manual<const> = world:spawn('timeline.pose2',{})
local automatic<const> = world:spawn('timeline.world',{})
for _, phase in ipairs({'physical','presentation'}) do
	local definition<const> = {phase=phase,duration_ms=100,tracks={{kind='value',path={phase},
		interpolation='linear',keys={{time_ms=0,value=0},{time_ms=100,value=100}}}}}
	manual.timelines:define(phase,definition)
	manual.timelines:play(phase)
	automatic.timelines:define(phase,definition)
	automatic.timelines:play(phase)
end
manual.timelines:tick_gameplay(20)
local update<const> = world._system_manager:configure({timeline_system},20,20)
update()
observed={manual.physical,manual.presentation,automatic.physical,automatic.presentation}
for _, phase in ipairs({'physical','presentation'}) do
	manual.timelines:stop(phase)
	manual.timelines:play(phase)
end
observed[5]=manual.timelines._tick_clocks
update()
observed[6]=manual.physical
observed[7]=manual.presentation
observed[8]=automatic.physical
observed[9]=automatic.presentation
manual.timelines:tick_gameplay(20)
observed[10]=manual.physical
observed[11]=manual.presentation
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const observed = cpu.getGlobalByKey(cpu.stringPool.find('observed')!) as Table;
		assert.deepEqual(Array.from({ length: 11 }, (_, index) => observed.getInteger(index + 1)),
			[20, 20, 20, 20, 0, 0, 0, 40, 40, 20, 20],
			'manual playback must retain its explicit driver without joining World clock views');
	});
	test(`external-clock phases retain unconsumed elapsed time across a schedule abort and freeze inactive Spaces (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local timeline_system<const> = require('cartlib/timeline/timeline_system')
local source<const> = require('cartlib/timeline/clock_source')
local clock<const> = require('cartlib/clock')
local abort_now = false
local abort_system<const> = {}
function abort_system.new(owner)
	return setmetatable({owner=owner,tick_functions={{group=30,priority=0,clock_source=clock.frame,method='update'}}},{__index=abort_system})
end
function abort_system:update()
	if abort_now then self.owner:set_gameplay_clock_running(false) end
end
prefab.define({def_id='external.actor',class={},components={timeline_component.new}})
local actor<const> = world:spawn('external.actor',{})
for _, phase in ipairs({'physical','presentation'}) do
	for _, domain in ipairs({'platform','audio'}) do
		local field<const> = phase..'_'..domain
		actor[field]=0
		actor.timelines:define(field,{phase=phase,clock_source=source[domain],continuous=true,tracks={{
			kind='value',interpolation='linear',path={field},keys={{time_ms=0,value=0},{time_ms=10000,value=10000}},
		}}})
		actor.timelines:play(field)
	end
end
local running<const>, paused<const> = world._system_manager:configure({timeline_system,abort_system},20,20)
world._update_with_gameplay=running
world._update_without_gameplay=paused
world.update=running
probe={
	step=function(stop)
		abort_now=stop
		world:update()
		return actor.physical_platform,actor.presentation_platform,actor.physical_audio,actor.presentation_audio,actor.fresh
	end,
	space=function(id) world:set_space(id) end,
	restart=function()
		for _, phase in ipairs({'physical','presentation'}) do
			for _, domain in ipairs({'platform','audio'}) do actor.timelines:stop(phase..'_'..domain) end
		end
		actor.fresh=0
		actor.timelines:define('fresh',{phase='presentation',clock_source=source.platform,continuous=true,tracks={{
			kind='value',interpolation='linear',path={'fresh'},keys={{time_ms=0,value=0},{time_ms=10000,value=10000}},
		}}})
		actor.timelines:define('trigger',{phase='physical',clock_source=source.frame,duration_ms=20})
		actor.timelines:play('trigger',nil,function(owner) owner.timelines:play('fresh',{snap_to_start=false}) end)
	end,
}
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const step = probe.getStringKey(cpu.stringPool.find('step')!) as Closure;
		const space = probe.getStringKey(cpu.stringPool.find('space')!) as Closure;
		const restart = probe.getStringKey(cpu.stringPool.find('restart')!) as Closure;
		// This CPU fixture drives the published clock words directly; it tests
		// timeline consumption, not peripheral service timing or audio playback.
		const advance = (milliseconds: number, samples: number, abort: boolean, expected: readonly number[]) => {
			cpu.memory.writeIoU32(IO_SYS_TIME_MS, milliseconds);
			cpu.memory.writeIoU32(IO_APU_SAMPLE_SEQUENCE, samples);
			runCompletionClosure(cpu, step, [abort]);
			const actual = materializeCpuCompletionValues(cpu) as number[];
			for (let index = 0; index < expected.length; index += 1) assert.ok(Math.abs(actual[index] - expected[index]) < 1e-9, JSON.stringify({ milliseconds, actual, expected, index }));
		};
		advance(0, 0, false, [0, 0, 0, 0]);
		advance(20, 882, true, [20, 0, 20, 0]);
		advance(40, 1764, false, [40, 40, 40, 40]);
		runCompletionClosure(cpu, space, [valueString(cpu.stringPool.intern('other'))]);
		advance(1000, 44100, false, [40, 40, 40, 40]);
		runCompletionClosure(cpu, space, [valueString(cpu.stringPool.intern('main'))]);
		advance(1010, 44541, false, [40, 40, 40, 40]);
		advance(1020, 44982, false, [50, 50, 50, 50]);
		runCompletionClosure(cpu, restart, []);
		advance(2000, 88200, false, [50, 50, 50, 50, 0]);
		advance(2010, 88641, false, [50, 50, 50, 50, 0]);
		advance(2020, 89082, false, [50, 50, 50, 50, 10]);
	});

}

test('warmed grouped curve sampling makes no guest heap reservations', t => {
	const { cpu } = createCartlibProgramHarness(setup + `
local owner<const> = world:spawn('timeline.pose2',{})
owner.timelines:define('loop',{phase='physical',duration_ms=1000,playback_mode='loop',bindings={'pose'},tracks={{kind='spatial',
	binding='pose',operation='local_origin2',channels={ox={interpolation='linear',keys={
		{time_ms=0,value=0},{time_ms=250,value=10},{time_ms=500,value=20},{time_ms=1000,value=40}}},oy=7}}}}, {pose=owner.spatial})
owner.timelines:play('loop')
probe={run=function(count) for index=1,count do owner.timelines:tick_gameplay(1) end end}
`, { optLevel: 3, modules });
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const run = probe.getStringKey(cpu.stringPool.find('run')!) as Closure;
	runCompletionClosure(cpu, run, [64]);
	const heap = cpu.luaHeap;
	const before = cpu.collectTrackedHeapBytes();
	const reserve = heap.reserve;
	let reservations = 0;
	heap.reserve = function (...args) { reservations += 1; reserve.apply(heap, args); };
	let cycles: number;
	try { cycles = runCompletionClosure(cpu, run, [2048]); } finally { heap.reserve = reserve; }
	assert.equal(reservations, 0);
	assert.equal(heap.usedBytes(), before);
	t.diagnostic(JSON.stringify({ iterations: 2048, cycles, reservations }));
});
