import { allocatedObjectRecords } from '../helpers/cpu_execution';
import { asClosure, valueBool, valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IO_SYS_FRAME_MS_Q16 } from '../../machine/ts/spec/bmsx/io';
import { createCartlibCaseRom, createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES as modules, WORLD_CPU_SETUP as setup } from '../helpers/world_cpu';
import { materializeCpuCompletionValues, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

const optLevel = 3;
const rom = createCartlibCaseRom(setup, { optLevel, modules });

const initialBatches = rom.add(`
local constructed = 0
local bound = 0
local activated = 0
local delivered = 0
local peers_prepared = true
local ids<const> = {'first','second','third'}
local view<const> = world:active_definition_view('initial.actor')
local component<const> = setmetatable({}, {__index=base_component})
component.__index = component
function component:on_attach() self.owner.part = self end
function component:on_activate()
 peers_prepared = peers_prepared and constructed == 3 and bound == 3
 for index = 1, #ids do
  local peer<const> = registry:get(ids[index])
  peers_prepared = peers_prepared and peer ~= nil and peer.ready and peer._bound and peer.part._bound and peer.part.owner == peer
   and registry:get(peer.part.id) == peer.part
 end
 activated = activated + 1
 self.owner.events:emit('begun')
end
local actor<const> = setmetatable({
 ctor = function() constructed = constructed + 1 end,
 onspawn = function(self) self.ready = true end,
 bind = function(self)
  bound = bound + 1
  self.events:on({event='begun',emitter=self.peer_id,handler=function() delivered=delivered+1 end})
 end,
}, {__index=world_object})
prefab.define({def_id='initial.actor',class=actor,components={function(owner)
 return setmetatable(base_component.new(owner),component)
end}})
scenes.register('initial.pair',{objects={
 {member_id='first',definition_id='initial.actor',options={id='first',peer_id='second'}},
 {member_id='second',definition_id='initial.actor',options={id='second',peer_id='third'}},
}})
local pair<const> = scenes.instantiate('initial.pair')
local third<const> = world:spawn('initial.actor',{id='third',peer_id='first'})
if not peers_prepared or pair.members.first.active or pair.members.second.active or third.active
 or activated ~= 0 or delivered ~= 0 or #view.objects ~= 0 then return false end
world:start()
assert(peers_prepared and activated == 3 and delivered == 3 and #view.objects == 3,
 'World start lost a prepared object or a subscription bound before activation')
world:start()
assert(activated == 3 and delivered == 3, 'repeated start duplicated component activation')
return true
`);
test(`World starts only after separately constructed initial batches are addressable and bound (O${optLevel})`, () => {
	const cpu = rom.run(initialBatches);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)],
		'construction must not activate or schedule objects before the complete initial World is addressable and bound');
});

rom.test(`World start owns initial FSM entry and timeline autoplay, not construction (O${optLevel})`, `
local library<const> = require('cartlib/fsm/library')
local fsm<const> = require('cartlib/fsm/fsm_component')
local timeline<const> = require('cartlib/timeline/timeline_component')
local entered = 0
local sampled = 0
local transitioned = 0
library.register('initial.machine',{initial='idle',states={
 idle={
  entering_state=function(self)
   local peer<const> = registry:get('late-peer')
   assert(peer ~= nil and peer.ready and peer._bound, 'initial FSM entry ran before a later construction batch was ready')
   self.visual={value=0}
   entered=entered+1
  end,
  timelines={idle={def={phase='presentation',frames={1,2},frame_duration=1,playback_mode='once',
   apply=function(self,value) self.visual.value=value sampled=sampled+1 end}}},
  on={wake={emitter=false,go='/awake'}},
 },
 awake={entering_state=function() transitioned=transitioned+1 end},
}})
prefab.define({def_id='initial.machine-owner',class=world_object,components={
 function(owner) return timeline.new(owner,{clock_mode='manual'}) end,
 fsm.factory({'initial.machine'}),
}})
prefab.define({def_id='initial.peer',class=setmetatable({onspawn=function(self) self.ready=true end},
 {__index=world_object})})
local owner<const> = world:spawn('initial.machine-owner',{id='machine-owner'})
local peer<const> = world:spawn('initial.peer',{id='late-peer'})
owner.events:emit('wake')
assert(entered == 0 and sampled == 0 and transitioned == 0 and owner.visual == nil
 and not owner.state_machines._started and not owner.timelines:get('idle').playing,
 'construction entered an FSM, sampled playback or dispatched a pre-start event')
world:start()
assert(entered == 1 and sampled == 1 and owner.visual.value == 1 and owner.state_machines._started
 and owner.timelines:get('idle').playing and transitioned == 0 and peer.active,
 'World start did not enter the initial state before its first timeline sample')
world:start()
assert(entered == 1 and sampled == 1, 'repeated World start restarted FSM entry or autoplay')
owner.events:emit('wake')
assert(transitioned == 1, 'a begun FSM failed to handle its live event')
`);

rom.test(`World start drains reentrant admissions and disposal, while clear preserves the World lifetime (O${optLevel})`, `
local activated = 0
local retired = 0
local initial_pass_finished = false
local child
local victim
prefab.define({def_id='begin.actor',class=setmetatable({
 on_activate=function(self)
  activated=activated+1
  if self.role == 'first' then
   assert(victim ~= nil and victim._bound and not victim.active)
   world:start()
   child=world:spawn('begin.actor',{role='child'})
   assert(not child.active and registry:get(child.id)==nil,
    'activation recursively published a runtime spawn inside its initial pass')
   victim:mark_for_disposal()
  elseif self.role == 'last' then
   initial_pass_finished=true
  elseif self.role == 'child' then
   assert(initial_pass_finished, 'reentrant runtime activation interrupted the initial World pass')
  end
 end,
 ondespawn=function() retired=retired+1 end,
}, {__index=world_object})})
local canceled<const> = world:spawn('begin.actor',{role='canceled'})
world:clear()
assert(not canceled.active and canceled.world==nil and activated==0 and retired==1,
 'pre-start clear began gameplay or retained a prepared object')
local first<const> = world:spawn('begin.actor',{role='first'})
victim=world:spawn('begin.actor',{role='victim'})
local last<const> = world:spawn('begin.actor',{role='last'})
assert(not first.active and not victim.active and not last.active, 'pre-start clear incorrectly began the World')
world:start()
assert(activated==3 and victim.world==nil and retired==2 and child.active
 and registry:get(child.id)==child and not world._mutation_barrier_open,
 'initial activation failed to cancel a later peer or drain its runtime child')
world:clear()
assert(first.world==nil and last.world==nil and child.world==nil and retired==5)
local replacement<const> = world:spawn('begin.actor',{role='replacement'})
assert(replacement.active and activated==4, 'new_game-style replacement reset an already begun World')
world:start()
assert(activated==4, 'new_game-style replacement acquired a duplicate start')
replacement:mark_for_disposal()
`);

rom.test(`Object activation follows its components and never runs after component cancellation (O${optLevel})`, `
local begun=0
local detached=0
local component<const> = setmetatable({}, {__index=base_component})
component.__index=component
function component:on_activate()
 local owner<const> = self.owner
 owner.completed=owner.completed+1
 if owner.cancel then owner:mark_for_disposal() end
end
function component:on_detach() detached=detached+1 end
local factory<const> = function(owner) return setmetatable(base_component.new(owner),component) end
prefab.define({def_id='activation.owner',class=setmetatable({
 ctor=function(self) self.completed=0 end,
 on_activate=function(self)
  assert(self.completed==2 and self.active, 'object gameplay started before its components completed activation')
  begun=begun+1
 end,
},{__index=world_object}),components={factory,factory}})
local live<const> = world:spawn('activation.owner',{})
local canceled<const> = world:spawn('activation.owner',{cancel=true})
world:start()
assert(begun==1 and live.completed==2 and canceled.completed==1 and canceled.world==nil and detached==2,
 'component cancellation ran another component or its object activation hook')
local later<const> = world:spawn('activation.owner',{})
assert(later.active and later.completed==2 and begun==2, 'runtime admission bypassed the common object activation order')
world:start()
assert(begun==2, 'repeated World start duplicated object gameplay startup')
`);

test(`World publishes its paused schedule only after activation, and repeated starts allocate no guest objects (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')
local prefab<const> = require('cartlib/world/prefab')
local clock<const> = require('cartlib/clock')
require('cartlib/gx/display').reset_320x240()
local gameplay=0
local frames=0
local resumed=0
local system<const> = {}
function system.new(owner)
 return setmetatable({owner=owner,tick_functions={
  {group=20,priority=0,clock_source=clock.gameplay,method='gameplay',on_clock_resumed=function() resumed=resumed+1 end},
  {group=40,priority=0,clock_source=clock.frame,method='frame'},
 }},{__index=system})
end
function system:gameplay() gameplay=gameplay+1 end
function system:frame() frames=frames+1 end
function system:clear() end
world:configure({framebuffer_count=1,gameplay_interval_vblanks=1,frame_interval_vblanks=1,
 systems={system},spaces={'main'}})
assert(world.update==nil, 'configuration published a gameplay runner before World start')
world:set_gameplay_clock_running(false)
assert(world.update==nil, 'a pre-start pause published the update runner')
prefab.define({def_id='paused.actor',class=setmetatable({on_activate=function()
 assert(world.update==nil, 'an activation callback observed a prematurely published runner')
 world:set_gameplay_clock_running(true)
 world:set_gameplay_clock_running(false)
 assert(world.update==nil, 'activation-time clock changes published the runner before the barrier completed')
end},{__index=world_object})})
world:spawn('paused.actor',{})
world:start()
assert(world.update~=nil and not world.gameplay_clock_running)
world:update()
assert(gameplay==0 and frames==1 and world.gameplay_time_ms==0, 'start ignored the final paused clock selection')
world:set_gameplay_clock_running(true)
world:update()
assert(gameplay==1 and frames==2 and world.gameplay_time_ms==20 and resumed==1,
 'post-start resume selected the wrong schedule or replayed clock admission')
probe={}
function probe.repeat_start()
 for index=1,1000 do world:start() end
 assert(gameplay==1 and frames==2, 'repeated start executed scheduled work')
end
`, { optLevel, modules });
	cpu.memory.writeIoU32(IO_SYS_FRAME_MS_Q16, 20 * 0x10000);
	runGuestToHalt(cpu, 25_000_000);
	const probe = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('probe')!));
	const repeat = asClosure(cpu.gc.tables.getStringKey(probe, cpu.stringPool.find('repeat_start')!), cpu.gc);
	runCompletionClosure(cpu, repeat, []);
	const before = allocatedObjectRecords(cpu).length;
	const bytes = cpu.luaHeap.usedBytes();
	runCompletionClosure(cpu, repeat, []);
	assert.equal(allocatedObjectRecords(cpu).length, before, 'repeated start allocated guest objects');
	assert.equal(cpu.luaHeap.usedBytes(), bytes, 'repeated start allocated transient guest storage');
});
