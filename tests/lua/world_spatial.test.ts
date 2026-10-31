import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES as modules, WORLD_CPU_SETUP as setup } from '../helpers/world_cpu';

const definitions = `
prefab.define({def_id='spatial.empty',
 class=world_object})
prefab.define({def_id='spatial.2d',
 class=object_2d})
prefab.define({def_id='spatial.3d',
 class=object_3d})
prefab.define({def_id='spatial.body',
 class=object_2d})
`;

for (const optLevel of [0, 3] as const) {
	test(`Spatial declarations default to identity without sharing mutable instance state (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
for _, family in ipairs({'2d','3d'}) do
  local id<const> = family
  prefab.define({def_id=id,class=family=='2d' and object_2d or object_3d})
  local first<const>, second<const> = world:spawn(id,{}),world:spawn(id,{})
  local pose<const> = hierarchy.resolve(first)
  assert(pose.xx==1 and pose.xy==0 and pose.yx==0 and pose.yy==1 and pose.ox==0 and pose.oy==0,
   'omitted spatial default did not supply an identity basis and zero origin')
  if family=='3d' then
   assert(pose.xz==0 and pose.yz==0 and pose.zx==0 and pose.zy==0 and pose.zz==1 and pose.oz==0)
   pose:set_global_position(8,12,16)
  else
   pose:set_global_position(8,12)
  end
  local other<const> = hierarchy.resolve(second)
  local later<const> = hierarchy.resolve(world:spawn(id,{}))
  assert(other.wox==0 and other.woy==0 and later.wox==0 and later.woy==0,
   'one instance changed another instance or the admitted identity default')
  if family=='3d' then assert(other.woz==0 and later.woz==0) end
end
local authored<const> = {xx=2,xy=0,yx=1,yy=3,ox=4,oy=5}
prefab.define({def_id='spatial.explicit-default',
 class=object_2d,
 transform=authored})
authored.ox=99
local supplied<const> = hierarchy.resolve(world:spawn('spatial.explicit-default',{}))
assert(supplied.wxx==2 and supplied.wyx==1 and supplied.wyy==3 and supplied.wox==4 and supplied.woy==5,
 'default identity displaced or failed to snapshot an authored nonidentity affine')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Construction hooks share the final owner and raw options before Scene and procedural admission (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local component<const> = setmetatable({}, {__index=base_component})
component.__index=component
local shared<const> = {retained=true}
local initialized<const> = {}
local class<const> = {
 initialize=function(self,options)
  initialized[self]=options
  assert(self.value==20 and self.other==2 and self.shared==shared and self.flag==false,
   'effective gameplay defaults/options were unavailable before component construction')
 end,
 ctor=function(self,options)
  assert(initialized[self]==options and self.part.owner==self and self.part.value==self.value,
   'construction replaced the final owner or raw options identity')
 end,
}
prefab.define({def_id='inputs.actor',
 class=setmetatable(class, {__index=world_object}),
 defaults={value=10,other=2,shared=shared,flag=true},
 components={
 function(owner)
  assert(initialized[owner]~=nil and owner.value==20 and owner.flag==false)
  local part<const> = setmetatable(base_component.new(owner),component)
  part.id_local='part'
  part.value=owner.value
  owner.part=part
  return part
 end,
}})
scenes.register('inputs.scene',{objects={
 {member_id='actor',definition_id='inputs.actor',options={value=20,flag=false}},
}})
local scene<const> = scenes.instantiate('inputs.scene')
local actor<const> = scene.members.actor
local options<const> = {value=20,flag=false}
local procedural<const> = world:spawn('inputs.actor',options)
assert(initialized[procedural]==options and options.other==nil and options.shared==nil,
 'construction mutated or replaced caller-owned raw options')
assert(actor.part.owner==actor and procedural.part.owner==procedural and actor.part~=procedural.part
 and actor.other==2 and procedural.other==2 and actor.shared==shared and procedural.shared==shared,
 'Scene and procedural construction disagree about actual owner state')
assert(prefab.definition('inputs.actor').defaults.value==10 and prefab.definition('inputs.actor').defaults.flag==true)
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
 assert(child.owner == nil and parent.owner == nil and child._hierarchy==world._spatial_hierarchy,
  'prepared shells did not retain final component/owner identities')
 assert(child.parent == parent and child.wox == 23 and child.woy == 35,
  'forward parent or complete world pose was unavailable during construction')
 assert(#child._components==0 and child:get_component(base_component)==nil,
  'intrinsic object placement allocated a Transform component')
end
prefab.define({def_id='spatial.ordered',
 class=setmetatable({
 initialize = check,
 ctor = function(self) check(self); constructed[#constructed + 1] = self.scene_member_id end,
}, {__index=object_2d})})
scenes.register('spatial.forward', { objects = {
 { member_id='child', definition_id='spatial.ordered', parent='parent',transform={xx=0,xy=1,yx=-1,yy=0,ox=4,oy=5}, options={} },
 { member_id='unrelated', definition_id='spatial.ordered', options={} },
 { member_id='parent', definition_id='spatial.ordered', transform={xx=2,xy=0,yx=1,yy=3,ox=10,oy=20}, options={} },
} })
local scene<const> = scenes.instantiate('spatial.forward')
assert(constructed[1] == 'unrelated' and constructed[2] == 'parent' and constructed[3] == 'child',
 'construction did not select the earliest authored member among ready dependencies')
local child<const> = scene.members.child
assert(registry:get(child.id) == child and child._world_object_index~=nil and #child._components==0,
 'Transform class/Registry publication lost concrete component identity')
local empty<const> = world:spawn('spatial.empty', {})
assert(empty._hierarchy == nil and #empty._components == 0 and empty.ox == nil and empty.sx == nil,
 'nonspatial object acquired an invented pose or dimensions')
local other<const> = scenes.instantiate('spatial.forward')
assert(other.members.child.parent == other.members.parent
 and other.members.parent ~= scene.members.parent, 'Scene parent lookup crossed instance identity')
scene:dispose()
assert(other.members.child.parent == other.members.parent,
 'disposing a namesake Scene changed another instance topology')
other:dispose()
empty:mark_for_disposal()
assert(world._spatial_hierarchy._count == 0 and registry:get(child.id)==nil,
 'World teardown retained spatial components')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Spatial admission binds actual 2D/3D objects and rejects invalid authored relationships (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local bad_parent<const> = pcall(function() scenes.register('bad.parent', { objects = {
 { member_id='a', definition_id='spatial.2d', parent='absent', options={} },
} }) end)
local nonspatial<const> = pcall(function() scenes.register('bad.nonspatial', { objects = {
 { member_id='a', definition_id='spatial.2d', parent='b', options={} },
 { member_id='b', definition_id='spatial.empty', options={} },
} }) end)
local dimension<const> = pcall(function() scenes.register('bad.dimension', { objects = {
 { member_id='a', definition_id='spatial.2d', parent='b', options={} },
 { member_id='b', definition_id='spatial.3d', options={} },
} }) end)
local cycle<const> = pcall(function() scenes.register('bad.cycle', { objects = {
 { member_id='a', definition_id='spatial.2d', parent='b', options={} },
 { member_id='b', definition_id='spatial.2d', parent='a', options={} },
} }) end)
assert(not bad_parent and not nonspatial and not dimension and not cycle and #world._objects==0,
 'cold graph admission accepted an invalid relationship or entered World construction')
local parent<const> = world:spawn('spatial.3d',{transform={xx=2,xy=0,xz=0,yx=1,yy=2,yz=0,zx=0,zy=0,zz=-4,ox=10,oy=20,oz=30}})
local input<const> = {xx=1,xy=0,xz=1,yx=0,yy=-1,yz=0,zx=1,zy=0,zz=0,ox=2,oy=3,oz=4}
local child<const> = world:spawn('spatial.3d',{parent=parent,transform=input})
input.ox = 900
local node<const> = hierarchy.resolve(child)
assert(node == child and #child._components==0 and node.parent == parent
 and node.wox == 17 and node.woy == 26 and node.woz == 14 and node.ox == 2,
 '3D construction lost shear/reflection, concrete parenting or copied local authority')
local body<const> = world:spawn('spatial.body',{transform={xx=1,xy=0,yx=0,yy=1,ox=7,oy=8}})
assert(body:set_transform(2,0,1,3,7,8) and body:set_global_position(9,10)
 and hierarchy.resolve(body).wox==9 and #body._components==0,
 'Object2D writers or intrinsic identity were replaced by a restricted Transform component')
world:clear()
assert(world._spatial_hierarchy._count == 0, 'clear retained 2D/3D component storage')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Staged Scene construction requires selected/live parents and cancels unadmitted descendants (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
scenes.register('staged', { objects = {
 {member_id='child',definition_id='spatial.2d',parent='parent',position={x=3,y=4},options={}},
 {member_id='parent',definition_id='spatial.2d',position={x=10,y=20},options={}},
} })
local scene<const> = scenes.create('staged')
local missing<const> = pcall(function() scene:spawn_member('child') end)
assert(not missing and #scene.objects.items == 0 and world._spatial_hierarchy._count == 0,
 'one staged child implicitly spawned or guessed an absent parent')
local repeated<const> = pcall(function() scene:spawn_members({'child','child'}) end)
assert(not repeated and #scene.objects.items == 0 and world._spatial_hierarchy._count == 0,
 'duplicate selected member entered World construction')
scene:spawn_members({'child','parent'})
assert(scene.members.child.parent == scene.members.parent
 and scene.members.child.wox == 13 and scene.members.child.woy == 24,
 'explicit parent batch was not constructed parent-first')
scene:dispose()
local separate<const> = scenes.create('staged')
local parent<const> = separate:spawn_member('parent')
separate:spawn_members({'child'})
local child<const> = separate.members.child
assert(child.parent == parent, 'staged child did not bind its already-live parent')
local duplicate<const> = pcall(function() separate:spawn_member('child') end)
assert(not duplicate and #separate.objects.items == 2 and not world._mutation_barrier_open,
 'duplicate admission entered a partial structural scope')
separate:dispose()
local closed<const> = pcall(function() separate:spawn('spatial.2d',{}) end)
assert(not closed and not world._mutation_barrier_open and world._spatial_hierarchy._count == 0,
 'closed Scene rejection allocated a pending capability or left a structural scope open')
local child_constructed = 0
local parent_despawned = 0
prefab.define({def_id='cancel',
 class=setmetatable({
 ctor=function(self)
  if self.scene_member_id == 'parent' then self:mark_for_disposal()
  else child_constructed = child_constructed + 1 end
 end,
 ondespawn=function(self)
  assert(self.scene_member_id == 'parent', 'unconstructed descendant received a constructed teardown callback')
  parent_despawned = parent_despawned + 1
 end,
}, {__index=object_2d})})
scenes.register('cancel', {objects={
 {member_id='child',definition_id='cancel',parent='parent',options={}},
 {member_id='parent',definition_id='cancel',options={}},
}})
local canceled<const> = scenes.instantiate('cancel')
assert(child_constructed == 0 and parent_despawned == 1 and next(canceled.members) == nil
 and #canceled.objects.items == 0 and world._spatial_hierarchy._count == 0,
 'terminal unadmitted parent published or detached an unadmitted descendant')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World serializes reparent commits and settles rejected/callback-requested operations exactly once (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local a<const> = world:spawn('spatial.2d', {})
local b<const> = world:spawn('spatial.2d',{transform={xx=1,xy=0,yx=0,yy=1,ox=10,oy=20}})
local results<const> = {}
local complete<const> = function(context, result) context[#context+1] = result end
world:_open_mutation_barrier()
world:reparent(a,b,false,complete,results)
world:reparent(b,a,false,complete,results)
assert(#results == 0 and a.parent == nil, 'reparent reported queue admission as a committed result')
world:_commit_mutation_barrier()
assert(#results == 2 and results[1] == hierarchy.committed and results[2] == hierarchy.invalid_relationship
 and a.parent == b and b.parent == nil,
 'sequential requests jointly created a cycle or lost a result')
local singular<const> = world:spawn('spatial.2d',{transform={xx=0,xy=0,yx=0,yy=0,ox=7,oy=8}})
world:reparent(a,singular,true,complete,results)
assert(results[3] == hierarchy.singular_parent and a.parent == b,
 'failed inverse changed topology or was reported successful')
world:reparent(a,singular,false,complete,results)
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
  world:reparent(callback_child,b,false,cascade)
 end
end
world:reparent(a,nil,true,cascade)
assert(callbacks == 2 and callback_child.parent == b
 and registry:get(callback_child.id) == callback_child, 'completion cascade escaped the shared ordered drain')
world:_open_mutation_barrier()
world:reparent(a,b,false,complete,results)
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
prefab.define({def_id='spatial.retiring',
 class=setmetatable({ondespawn=function()
 hooks = hooks + 1
 assert(retired[1]._hierarchy == nil and retired[2]._hierarchy == nil,
  'teardown ran before the complete captured topology retired')
 assert(kept[1].parent == nil and kept[2].parent == nil,
  'teardown ran before surviving direct children were detached')
end}, {__index=object_2d})})
local a<const> = outgoing:spawn('spatial.retiring',{id='same-parent',transform={xx=2,xy=0,yx=1,yy=2,ox=10,oy=20}})
local s<const> = surviving:spawn('spatial.2d',{parent=a,transform={xx=0,xy=1,yx=-1,yy=0,ox=3,oy=4}})
local b<const> = outgoing:spawn('spatial.retiring',{parent=s,transform={xx=2,xy=0,yx=0,yy=3,ox=5,oy=6}})
local leaf<const> = surviving:spawn('spatial.2d',{parent=b,transform={xx=1,xy=0,yx=0,yy=1,ox=7,oy=8}})
retired[1],retired[2] = a,b
kept[1],kept[2] = s,leaf
local pose<const> = hierarchy.resolve(leaf)
local old_x<const>,old_y<const> = pose.wox,pose.woy
local old_xx<const>,old_xy<const> = pose.wxx,pose.wxy
s:set_space('other')
leaf:set_space('other')
world:set_space('other')
a:set_position(30,40)
hierarchy.resolve(leaf)
assert(leaf.wox == old_x+20 and leaf.woy == old_y+20,
 'inactive/cross-Space ancestor stopped contributing its retained transform')
outgoing:dispose()
hierarchy.resolve(leaf)
assert(hooks == 2 and #outgoing.objects.items == 0 and #surviving.objects.items == 2
 and leaf.wox == old_x+20 and leaf.woy == old_y+20
 and leaf.wxx == old_xx and leaf.wxy == old_xy,
 'Scene unload destroyed another ownership set or changed a surviving affine')
local replacement<const> = world:spawn('spatial.2d',{id='same-parent'})
assert(s.parent == nil and leaf.parent == nil,
 'a replacement parent rebound detached children')
local result
world:reparent(s,a,true,function(_context,value) result=value end)
assert(result == hierarchy.retired_target, 'retired concrete parent resolved to its replacement')
world:dispose_spatial_subtree(s)
assert(s.world == nil and leaf.world == world, 'explicit subtree removal crossed an unrelated spatial root')
surviving:dispose()
replacement:mark_for_disposal()
assert(world._spatial_hierarchy._count == 0, 'cross-Scene lifetime retained a spatial binding')
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Transform TRS uses real firmware trigonometry without a second stored pose (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local parent<const> = world:spawn('spatial.2d',{transform={xx=2,xy=0,yx=1,yy=2,ox=10,oy=20}})
local child<const> = world:spawn('spatial.2d',{parent=parent})
child:set_pose(3,4,math.pi*0.5,2,3)
local node<const> = hierarchy.resolve(child)
assert(math.abs(node.xx) < 0.000001 and math.abs(node.xy-2) < 0.000001
 and math.abs(node.yx+3) < 0.000001 and math.abs(node.yy) < 0.000001,
 '2D TRS did not use the BIOS sine/cosine path')
assert(node.wox == 20 and node.woy == 28 and child.x == nil and node.rotation == nil and node.scale_x == nil,
 'TRS introduced a second pose or discarded the parent affine')
assert(child:set_global_pose(7,8,0,2,3))
hierarchy.resolve(node)
assert(math.abs(node.wxx-2) < 0.000001 and math.abs(node.wxy) < 0.000001
 and math.abs(node.wyx) < 0.000001 and math.abs(node.wyy-3) < 0.000001
 and node.wox == 7 and node.woy == 8, 'world TRS did not solve the complete parent inverse')
world:clear()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`World clear cancels births from its closing generation without restarting their lifecycle (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + definitions + `
local constructed = 0
local spawned = 0
local child
local reset_child
local resets = 0
prefab.define({def_id='clear.child',
 class=setmetatable({
 ctor=function() constructed=constructed+1 end,
 onspawn=function() spawned=spawned+1 end,
 ondespawn=function() error('unconstructed closing-generation birth was despawned as a live object') end,
}, {__index=object_2d})})
prefab.define({def_id='clear.parent',
 class=setmetatable({ondespawn=function()
 child=world:spawn('clear.child',{})
 assert(child.marked_for_disposal and not child._constructed and registry:get(child.id)==nil,
  'clear teardown restarted construction inside its closing generation')
end}, {__index=world_object})})
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

for (const optLevel of [0, 3] as const) {
	test(`Intrinsic World admits constructor children under their actual pending parent (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local spawned=0
local actor<const> = setmetatable({}, {__index=object_2d})
function actor:ctor(options)
 assert(options==self._construction_options and self.owner==nil and self.spatial==nil)
 if self.make_child then
  self.child=world:spawn('pending.actor',{parent=self,position={x=7,y=8}})
  assert(self.child.parent==self and registry:get(self.id)==nil and registry:get(self.child.id)==nil)
  if self.cancel then self:mark_for_disposal() end
 end
end
function actor:onspawn() spawned=spawned+1 end
prefab.define({def_id='pending.actor',class=actor,scale={x=2,y=2}})
local options<const> = {position={x=10,y=20},make_child=true}
local parent<const> = world:spawn('pending.actor',options)
local child<const> = parent.child
local x,y=child:get_global_position()
assert(x==24 and y==36 and #parent._components==0 and parent.position==nil and child.owner==nil)
assert(registry:get(parent.id)==parent and registry:get(child.id)==child and spawned==2)
world:reparent(child,nil,true)
x,y=child:get_global_position();assert(x==24 and y==36 and child.parent==nil)
world:reparent(child,parent,true)
x,y=child:get_global_position();assert(x==24 and y==36 and child.parent==parent)
local canceled<const> = world:spawn('pending.actor',{make_child=true,cancel=true})
assert(canceled.world==nil and canceled.child.world==nil and spawned==2
 and registry:get(canceled.id)==nil and registry:get(canceled.child.id)==nil)
world:clear()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Unrepresentable partial semantic admission publishes no object or Scene batch and leaves no open barrier (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local constructed=0
local actor<const> = setmetatable({ctor=function() constructed=constructed+1 end},{__index=object_2d})
prefab.define({def_id='admission.good',class=actor})
prefab.define({def_id='admission.raw',class=actor,transform={xx=0,xy=0,yx=0,yy=1,ox=0,oy=0}})
local accepted<const> = pcall(function() world:spawn('admission.raw',{scale={x=2,y=3}}) end)
assert(not accepted and not world._mutation_barrier_open and world._pending_admission_count==0
 and world._spatial_hierarchy._count==0 and #world._objects==0 and constructed==0)
local live<const> = world:spawn('admission.good')
assert(registry:get(live.id)==live and live.active and constructed==1)
scenes.register('admission.batch',{objects={
 {member_id='good',definition_id='admission.good'},
 {member_id='raw',definition_id='admission.raw'},
}})
local scene<const> = scenes.create('admission.batch')
local batch<const> = pcall(function() scene:spawn_all({raw={scale={x=2,y=3}}}) end)
assert(not batch and not world._mutation_barrier_open and world._pending_admission_count==0
 and #scene.objects.items==0 and next(scene.members)==nil and world._spatial_hierarchy._count==1
 and #world._objects==1 and constructed==1)
scene:spawn_member('good')
assert(registry:get(scene.members.good.id)==scene.members.good and constructed==2)
world:clear()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Retiring ancestors and descendants publish clean final world poses before any ondespawn getter (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local reads<const> = {}
local actor<const> = setmetatable({ondespawn=function(self)
 local x,y=self:get_global_position()
 reads[self.id]=x
 assert(y==0 and self._hierarchy==nil and self.parent==nil)
end},{__index=object_2d})
prefab.define({def_id='retire.actual',class=actor})
local a<const> = world:spawn('retire.actual',{id='retire.a',position={x=10}})
local survivor<const> = world:spawn('retire.actual',{id='retire.s',parent=a,position={x=2}})
local b<const> = world:spawn('retire.actual',{id='retire.b',parent=survivor,position={x=3}})
world:_open_mutation_barrier()
a:mark_for_disposal(); b:mark_for_disposal()
world:_commit_mutation_barrier()
assert(reads['retire.a']==10 and reads['retire.b']==15 and b.ox==15 and b.oy==0)
local x,y=survivor:get_global_position()
assert(x==12 and y==0 and survivor.parent==nil and survivor.world==world and survivor.ox==12)
assert(a:get_global_position()==10 and b:get_global_position()==15)
world:clear()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});
}

for (const optLevel of [0, 3] as const) test(`Keep World to the already committed parent preserves known singular semantic channels and completes once (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(setup + `
local completed=0
local done<const> = function(_,result) assert(result==world.reparent_result.committed); completed=completed+1 end
prefab.define({def_id='same2',class=object_2d,rotation=7,scale={x=0,y=-2},skew=0.25})
prefab.define({def_id='same3',class=object_3d,rotation={x=0.5,y=0.5,z=0.5,w=0.5},scale={x=0,y=-2,z=0}})
prefab.define({def_id='singular2',class=object_2d,transform={xx=0,xy=0,yx=0,yy=1,ox=0,oy=0}})
prefab.define({def_id='singular3',class=object_3d,transform={xx=0,xy=0,xz=0,yx=0,yy=1,yz=0,zx=0,zy=0,zz=1,ox=0,oy=0,oz=0}})
for dimension=2,3 do
 local id<const> = dimension==2 and 'same2' or 'same3'
 local root<const> = world:spawn(id)
 root:get_global_transform()
 local flags<const>,basis<const>,origin<const> = root._semantic_flags,root._basis_revision,root._origin_revision
 world:reparent(root,nil,true,done)
 assert(root._semantic_flags==flags and root._basis_revision==basis and root._origin_revision==origin)
 local parent<const> = world:spawn(dimension==2 and 'singular2' or 'singular3')
 local child<const> = world:spawn(id,{parent=parent})
 child:get_global_transform()
 local old_flags<const>,old_basis<const>,old_origin<const> = child._semantic_flags,child._basis_revision,child._origin_revision
 world:reparent(child,parent,true,done)
 assert(child.parent==parent and child._semantic_flags==old_flags and child._basis_revision==old_basis and child._origin_revision==old_origin)
 if dimension==2 then
  assert(root:get_rotation()==7 and child:get_rotation()==7 and root:get_skew()==0.25 and child:get_skew()==0.25)
  local sx,sy=child:get_scale();assert(sx==0 and sy==-2)
 else
  local qx,qy,qz,qw=child:get_rotation();assert(qx==0.5 and qy==0.5 and qz==0.5 and qw==0.5)
  local sx,sy,sz=child:get_scale();assert(sx==0 and sy==-2 and sz==0)
 end
end
assert(completed==4)
world:clear()
`, { optLevel, modules });
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
});
