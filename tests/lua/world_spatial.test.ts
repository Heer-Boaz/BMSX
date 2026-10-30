import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES as modules, WORLD_CPU_SETUP as setup } from '../helpers/world_cpu';

const definitions = `
prefab.define({ def_id = 'spatial.empty', class = {} })
prefab.define({ def_id = 'spatial.2d', class = {},
 spatial = { family = '2d', authority = 'affine', local_transform = { 1,0,0,1,0,0 } } })
prefab.define({ def_id = 'spatial.3d', class = {},
 spatial = { family = '3d', authority = 'affine', local_transform = { 1,0,0,0,1,0,0,0,1,0,0,0 } } })
prefab.define({ def_id = 'spatial.body', class = {},
 spatial = { family = '2d', authority = 'root_origin', local_transform = { 1,0,0,1,0,0 } } })
`;

for (const optLevel of [0, 3] as const) {
	test(`Constructor-only inputs are pinned by local slot and share one final-owner context (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local component<const> = setmetatable({}, {__index=base_component})
component.__index=component
local initialized_context
local shared<const> = { retained=true }
local input<const> = { part={value=10,other=2,shared=shared}, extra={value=11} }
local class<const> = {
 initialize=function(self,context)
  initialized_context=context
  assert(context.owner==self and context.initial.part.shared==shared,
   'initializer received an input DTO or replacement owner')
 end,
 ctor=function(self,options,_definition,context)
  assert(context==initialized_context and self.part.value==context.initial.part.value
   and self.extra.value==context.initial.extra.value and options.player_data==shared,
   'constructor/factories did not consume the same admitted context')
 end,
}
prefab.define({def_id='inputs.actor',class=class,initial=input,components={
 function(context)
  assert(context==initialized_context, 'primary construction received another request table')
  local self<const> = setmetatable(base_component.new(context),component)
  self.id_local='part'
  self.value=context.initial.part.value
  self.other=context.initial.part.other
  context.owner.part=self
  return self
 end,
 function(context)
  assert(context==initialized_context, 'additional construction received another request table')
  local self<const> = setmetatable(base_component.new(context),component)
  self.id_local='extra'
  self.value=context.initial.extra.value
  context.owner.extra=self
  return self
 end,
}})
input.part.value=90
local member_input<const> = {part={value=20}}
scenes.register('inputs.scene',{objects={
 {member_id='actor',definition_id='inputs.actor',initial=member_input,options={player_data=shared}},
}})
member_input.part.value=99
local scene<const> = scenes.instantiate('inputs.scene')
local actor<const> = scene.members.actor
assert(actor.part.value==20 and actor.part.other==2 and actor.extra.value==11
 and actor.initial==nil and actor.value==nil and actor.other==nil
 and actor._construction_initial==nil and actor.player_data==shared,
 'constructor inputs leaked onto gameplay state or shared mutable declaration records')
local procedural<const> = world:spawn('inputs.actor',{player_data=shared},nil,{part={value=30}})
assert(procedural.part.value==30 and procedural.part.other==2 and procedural.extra.value==11
 and prefab.definition('inputs.actor').initial.part.value==10,
 'procedural input admission changed prefab defaults or another component slot')
scene:dispose()
procedural:mark_for_disposal()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World installs exact spatial identities and forward authored poses before every user hook (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local constructed<const> = {}
local check<const> = function(self)
 local child<const> = self.scene.members.child
 local parent<const> = self.scene.members.parent
 assert(child.spatial.owner == child and parent.spatial.owner == parent,
  'prepared shells did not retain final component/owner identities')
 assert(child.spatial.spatial_parent == parent.spatial and child.spatial.wox == 23 and child.spatial.woy == 35,
  'forward parent or complete world pose was unavailable during construction')
 assert(child:get_component(transform2) == child.spatial,
  'spatial data and component class lookup describe different identities')
end
prefab.define({ def_id = 'spatial.ordered', class = {
 initialize = check,
 ctor = function(self) check(self); constructed[#constructed + 1] = self.scene_member_id end,
}, spatial = { family = '2d', authority = 'affine', local_transform = { 1,0,0,1,0,0 } } })
scenes.register('spatial.forward', { objects = {
 { member_id='child', definition_id='spatial.ordered', spatial={ parent_id='parent', local_transform={0,1,-1,0,4,5} }, options={} },
 { member_id='unrelated', definition_id='spatial.ordered', options={} },
 { member_id='parent', definition_id='spatial.ordered', spatial={ local_transform={2,0,1,3,10,20} }, options={} },
} })
local scene<const> = scenes.instantiate('spatial.forward')
assert(constructed[1] == 'unrelated' and constructed[2] == 'parent' and constructed[3] == 'child',
 'construction did not select the earliest authored member among ready dependencies')
local child<const> = scene.members.child
assert(registry:get(child.spatial.id) == child.spatial and #registry:entries(transform2) == 3,
 'Transform class/Registry publication lost concrete component identity')
local empty<const> = world:spawn('spatial.empty', {})
assert(empty.spatial == nil and #empty._components == 0 and empty.x == nil and empty.sx == nil,
 'nonspatial object acquired an invented pose or dimensions')
local other<const> = scenes.instantiate('spatial.forward')
assert(other.members.child.spatial.spatial_parent == other.members.parent.spatial
 and other.members.parent ~= scene.members.parent, 'Scene parent lookup crossed instance identity')
scene:dispose()
assert(other.members.child.spatial.spatial_parent == other.members.parent.spatial,
 'disposing a namesake Scene changed another instance topology')
other:dispose()
empty:mark_for_disposal()
assert(world._spatial_hierarchy._count == 0 and #registry:entries(transform2) == 0,
 'World teardown retained spatial components')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Spatial admission binds complete 2D/3D capability inputs and rejects invalid authored relationships (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local bad_parent<const> = pcall(function() scenes.register('bad.parent', { objects = {
 { member_id='a', definition_id='spatial.2d', spatial={parent_id='absent'}, options={} },
} }) end)
local nonspatial<const> = pcall(function() scenes.register('bad.nonspatial', { objects = {
 { member_id='a', definition_id='spatial.2d', spatial={parent_id='b'}, options={} },
 { member_id='b', definition_id='spatial.empty', options={} },
} }) end)
local dimension<const> = pcall(function() scenes.register('bad.dimension', { objects = {
 { member_id='a', definition_id='spatial.2d', spatial={parent_id='b'}, options={} },
 { member_id='b', definition_id='spatial.3d', options={} },
} }) end)
local cycle<const> = pcall(function() scenes.register('bad.cycle', { objects = {
 { member_id='a', definition_id='spatial.2d', spatial={parent_id='b'}, options={} },
 { member_id='b', definition_id='spatial.2d', spatial={parent_id='a'}, options={} },
} }) end)
local constrained_parent<const> = pcall(function() scenes.register('bad.body.parent', { objects = {
 { member_id='body', definition_id='spatial.body', spatial={parent_id='root'}, options={} },
 { member_id='root', definition_id='spatial.2d', options={} },
} }) end)
local constrained_basis<const> = pcall(function() scenes.register('bad.body.basis', { objects = {
 { member_id='body', definition_id='spatial.body', spatial={local_transform={2,0,0,1,0,0}}, options={} },
} }) end)
assert(not bad_parent and not nonspatial and not dimension and not cycle
 and not constrained_parent and not constrained_basis and #world._objects == 0,
 'cold graph admission accepted an invalid relationship or entered World construction')
local parent<const> = world:spawn('spatial.3d', {}, {local_transform={2,0,0,1,2,0,0,0,-4,10,20,30}})
local input<const> = {1,0,1,0,-1,0,1,0,0,2,3,4}
local child<const> = world:spawn('spatial.3d', {}, {parent=parent.spatial,local_transform=input})
input[10] = 900
local node<const> = child.spatial:resolve_world()
assert(node == child.spatial and child:get_component(transform3) == node and node.spatial_parent == parent.spatial
 and node.wox == 17 and node.woy == 26 and node.woz == 14 and node.ox == 2,
 '3D construction lost shear/reflection, concrete parenting or copied local authority')
local body<const> = world:spawn('spatial.body', {}, {local_transform={1,0,0,1,7,8}})
assert(body.spatial.set_local_affine == nil and body.spatial.set_world_affine == nil
 and body.spatial.set_local_trs == nil, 'root-origin body exposed basis writers')
assert(body.spatial:set_world_origin(9,10) and body.spatial:resolve_world().wox == 9,
 'root-origin world writer did not publish its scalar origin')
local removed<const> = pcall(function() body:remove_component(body.spatial) end)
local disabled<const> = pcall(function() body.spatial:set_enabled(false) end)
assert(not removed and not disabled and body:get_component(transform2) == body.spatial and body.spatial.enabled,
 'ordinary component mutation changed an intrinsic spatial capability')
world:clear()
assert(world._spatial_hierarchy._count == 0, 'clear retained 2D/3D component storage')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Staged Scene construction requires selected/live parents and cancels unadmitted descendants (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
scenes.register('staged', { objects = {
 {member_id='child',definition_id='spatial.2d',spatial={parent_id='parent',local_transform={1,0,0,1,3,4}},options={}},
 {member_id='parent',definition_id='spatial.2d',spatial={local_transform={1,0,0,1,10,20}},options={}},
} })
local scene<const> = scenes.create('staged')
local missing<const> = pcall(function() scene:spawn_member('child') end)
assert(not missing and #scene.objects.items == 0 and world._spatial_hierarchy._count == 0,
 'one staged child implicitly spawned or guessed an absent parent')
scene:spawn_members({'child','parent'})
assert(scene.members.child.spatial.spatial_parent == scene.members.parent.spatial
 and scene.members.child.spatial.wox == 13 and scene.members.child.spatial.woy == 24,
 'explicit parent batch was not constructed parent-first')
scene:dispose()
local separate<const> = scenes.create('staged')
local parent<const> = separate:spawn_member('parent')
local child<const> = separate:spawn_member('child')
assert(child.spatial.spatial_parent == parent.spatial, 'staged child did not bind its already-live parent')
local duplicate<const> = pcall(function() separate:spawn_member('child') end)
assert(not duplicate and #separate.objects.items == 2 and not world._mutation_barrier_open,
 'duplicate admission entered a partial structural scope')
separate:dispose()
local closed<const> = pcall(function() separate:spawn('spatial.2d',{}) end)
assert(not closed and not world._mutation_barrier_open and world._spatial_hierarchy._count == 0,
 'closed Scene rejection allocated a pending capability or left a structural scope open')
local child_constructed = 0
local parent_despawned = 0
prefab.define({ def_id='cancel.spatial', class={
 ctor=function(self)
  if self.scene_member_id == 'parent' then self:mark_for_disposal()
  else child_constructed = child_constructed + 1 end
 end,
 ondespawn=function(self)
  assert(self.scene_member_id == 'parent', 'unconstructed descendant received a constructed teardown callback')
  parent_despawned = parent_despawned + 1
 end,
}, spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}} })
scenes.register('cancel.spatial', {objects={
 {member_id='child',definition_id='cancel.spatial',spatial={parent_id='parent'},options={}},
 {member_id='parent',definition_id='cancel.spatial',options={}},
}})
local canceled<const> = scenes.instantiate('cancel.spatial')
assert(child_constructed == 0 and parent_despawned == 1 and next(canceled.members) == nil
 and #canceled.objects.items == 0 and world._spatial_hierarchy._count == 0,
 'terminal unadmitted parent published or detached an unadmitted descendant')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World serializes reparent commits and settles rejected/callback-requested operations exactly once (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local a<const> = world:spawn('spatial.2d', {})
local b<const> = world:spawn('spatial.2d', {}, {local_transform={1,0,0,1,10,20}})
local results<const> = {}
local complete<const> = function(context, result) context[#context+1] = result end
world:_open_mutation_barrier()
world:reparent(a.spatial,b.spatial,false,complete,results)
world:reparent(b.spatial,a.spatial,false,complete,results)
assert(#results == 0 and a.spatial.spatial_parent == nil, 'reparent reported queue admission as a committed result')
world:_commit_mutation_barrier()
assert(#results == 2 and results[1] == hierarchy.committed and results[2] == hierarchy.invalid_relationship
 and a.spatial.spatial_parent == b.spatial and b.spatial.spatial_parent == nil,
 'sequential requests jointly created a cycle or lost a result')
local singular<const> = world:spawn('spatial.2d', {}, {local_transform={0,0,0,0,7,8}})
world:reparent(a.spatial,singular.spatial,true,complete,results)
assert(results[3] == hierarchy.singular_parent and a.spatial.spatial_parent == b.spatial,
 'failed inverse changed topology or was reported successful')
world:reparent(a.spatial,singular.spatial,false,complete,results)
assert(results[4] == hierarchy.committed, 'Keep Local rejected a representable singular parent')
local callbacks = 0
local callback_child
local cascade
cascade = function(_context, result)
 callbacks = callbacks + 1
 assert(result == hierarchy.committed, 'completion-requested operation did not commit')
 if callbacks == 1 then
  callback_child = world:spawn('spatial.2d', {})
  assert(registry:get(callback_child.id) == nil, 'completion recursively published a half-constructed batch')
  world:reparent(callback_child.spatial,b.spatial,false,cascade)
 end
end
world:reparent(a.spatial,nil,true,cascade)
assert(callbacks == 2 and callback_child.spatial.spatial_parent == b.spatial
 and registry:get(callback_child.id) == callback_child, 'completion cascade escaped the shared ordered drain')
world:_open_mutation_barrier()
world:reparent(a.spatial,b.spatial,false,complete,results)
world:clear()
world:_commit_mutation_barrier()
assert(#results == 5 and results[5] == hierarchy.retired_target and a.world == nil and b.world == nil
 and world._spatial_hierarchy._count == 0, 'clear dropped a request or committed it against retiring targets')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Scene/Space lifetimes preserve independent surviving spatial children before all teardown hooks (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
scenes.register('ownership.a',{objects={}})
scenes.register('ownership.b',{objects={}})
local outgoing<const> = scenes.create('ownership.a')
local surviving<const> = scenes.create('ownership.b')
local retired<const> = {}
local kept<const> = {}
local hooks = 0
prefab.define({def_id='spatial.retiring',class={ondespawn=function()
 hooks = hooks + 1
 assert(retired[1].spatial._hierarchy == nil and retired[2].spatial._hierarchy == nil,
  'teardown ran before the complete captured topology retired')
 assert(kept[1].spatial.spatial_parent == nil and kept[2].spatial.spatial_parent == nil,
  'teardown ran before surviving direct children were detached')
end},spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}}})
local a<const> = outgoing:spawn('spatial.retiring',{id='same-parent'}, {local_transform={2,0,1,2,10,20}})
local s<const> = surviving:spawn('spatial.2d',{}, {parent=a.spatial,local_transform={0,1,-1,0,3,4}})
local b<const> = outgoing:spawn('spatial.retiring',{}, {parent=s.spatial,local_transform={2,0,0,3,5,6}})
local leaf<const> = surviving:spawn('spatial.2d',{}, {parent=b.spatial,local_transform={1,0,0,1,7,8}})
retired[1],retired[2] = a,b
kept[1],kept[2] = s,leaf
local old_x<const>,old_y<const> = leaf.spatial:world_origin()
local old_xx<const>,old_xy<const> = leaf.spatial.wxx,leaf.spatial.wxy
s:set_space('other')
leaf:set_space('other')
world:set_space('other')
a.spatial:set_local_origin(30,40)
leaf.spatial:resolve_world()
assert(leaf.spatial.wox == old_x+20 and leaf.spatial.woy == old_y+20,
 'inactive/cross-Space ancestor stopped contributing its retained transform')
outgoing:dispose()
leaf.spatial:resolve_world()
assert(hooks == 2 and #outgoing.objects.items == 0 and #surviving.objects.items == 2
 and leaf.spatial.wox == old_x+20 and leaf.spatial.woy == old_y+20
 and leaf.spatial.wxx == old_xx and leaf.spatial.wxy == old_xy,
 'Scene unload destroyed another ownership set or changed a surviving affine')
local replacement<const> = world:spawn('spatial.2d',{id='same-parent'})
assert(s.spatial.spatial_parent == nil and leaf.spatial.spatial_parent == nil,
 'a replacement parent rebound detached children')
local result
world:reparent(s.spatial,a.spatial,true,function(_context,value) result=value end)
assert(result == hierarchy.retired_target, 'retired concrete parent resolved to its replacement')
world:dispose_spatial_subtree(s.spatial)
assert(s.world == nil and leaf.world == world, 'explicit subtree removal crossed an unrelated spatial root')
surviving:dispose()
replacement:mark_for_disposal()
assert(world._spatial_hierarchy._count == 0, 'cross-Scene lifetime retained a spatial binding')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Transform TRS uses real firmware trigonometry without a second stored pose (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local parent<const> = world:spawn('spatial.2d',{}, {local_transform={2,0,1,2,10,20}})
local child<const> = world:spawn('spatial.2d',{}, {parent=parent.spatial})
child.spatial:set_local_trs(3,4,math.pi*0.5,2,3)
local node<const> = child.spatial:resolve_world()
assert(math.abs(node.xx) < 0.000001 and math.abs(node.xy-2) < 0.000001
 and math.abs(node.yx+3) < 0.000001 and math.abs(node.yy) < 0.000001,
 '2D TRS did not use the BIOS sine/cosine path')
assert(node.wox == 20 and node.woy == 28 and child.x == nil and node.rotation == nil and node.scale_x == nil,
 'TRS introduced a second pose or discarded the parent affine')
assert(child.spatial:set_world_trs(7,8,0,2,3))
node:resolve_world()
assert(math.abs(node.wxx-2) < 0.000001 and math.abs(node.wxy) < 0.000001
 and math.abs(node.wyx) < 0.000001 and math.abs(node.wyy-3) < 0.000001
 and node.wox == 7 and node.woy == 8, 'world TRS did not solve the complete parent inverse')
world:clear()
`, { optLevel, modules, firmwareMath: true });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World clear cancels births from its closing generation without restarting their lifecycle (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local constructed = 0
local spawned = 0
local child
local reset_child
local resets = 0
prefab.define({def_id='clear.child',class={
 ctor=function() constructed=constructed+1 end,
 onspawn=function() spawned=spawned+1 end,
 ondespawn=function() error('unconstructed closing-generation birth was despawned as a live object') end,
},spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}}})
prefab.define({def_id='clear.parent',class={ondespawn=function()
 child=world:spawn('clear.child',{})
 assert(child.marked_for_disposal and not child._constructed and registry:get(child.id)==nil,
  'clear teardown restarted construction inside its closing generation')
end}})
local reset_system<const> = {}
function reset_system.new(owner)
 return {tick_functions={},clear=function()
  resets=resets+1
  reset_child=owner:spawn('clear.child',{})
 end}
end
world._system_manager:configure({reset_system},20,20)
world:spawn('clear.parent',{})
world:clear()
assert(constructed==0 and spawned==0 and child.world==nil and #world._objects==0
 and resets==1 and reset_child.world==nil and world._spatial_hierarchy._count==0
 and not world._mutation_barrier_open and not world._clearing,
 'clear retained a teardown-requested birth or entered its ready/active lifecycle')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Generated World schedules publish update admission and retire group context on every exit (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local clock<const> = require('cartlib/clock')
local system<const> = {}
local early<const> = {group=10,priority=0,clock_source=clock.frame,method='early'}
local late<const> = {group=40,priority=0,clock_source=clock.frame,method='late'}
local expected = 0
local early_count = 0
local late_count = 0
local stop = false
function system.new(owner)
 return setmetatable({owner=owner,tick_functions={early,late}}, {__index=system})
end
function system:early()
 assert(self.owner._update_revision==expected and self.owner._executing_tick_group==10,
  'early work did not see its admitted update/group')
 early_count=early_count+1
 if stop then self.owner:set_gameplay_clock_running(false) end
end
function system:late()
 assert(self.owner._update_revision==expected and self.owner._executing_tick_group==40,
  'late work did not share its update admission or own group')
 late_count=late_count+1
end
local running<const>, paused<const> = world._system_manager:configure({system},20,20)
world._update_with_gameplay=running
world._update_without_gameplay=paused
expected=1
running()
assert(early_count==1 and late_count==1 and world._executing_tick_group==nil,
 'normal update exit retained a live group context')
expected=2
stop=true
local receipt<const> = world:request_mutation_boundary()
running()
assert(early_count==2 and late_count==1 and receipt.reached and world._executing_tick_group==nil,
 'schedule-abort exit ran late work or retained a live group context')
expected=3
stop=false
paused()
assert(early_count==3 and late_count==2 and world.gameplay_time_ms==40
 and world._update_revision==3 and world._executing_tick_group==nil,
 'frame admission while gameplay is suspended advanced the wrong clock or retained context')
local empty<const> = world._system_manager:configure({},20,20)
empty()
assert(world._update_revision==4 and world._executing_tick_group==nil,
 'empty update did not publish a distinct completed admission')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});
}
