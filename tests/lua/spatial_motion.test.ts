import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';

// Synthetic real-component owners exercise the actual motion and boundary
// kernels, not ordinary carts or a second host-side physics implementation.
const modules = [
	'cartlib/math/affine2',
	'cartlib/math/affine3',
	'cartlib/world/spatial_hierarchy',
	'cartlib/world/object_2d',
	'cartlib/world/base_system',
	'cartlib/world/tick_group',
	'cartlib/velocity',
	'cartlib/util/div_toward_zero',
	'cartlib/physics/ballistic_movement_component',
	'cartlib/physics/bouncing_movement_component',
	'cartlib/physics/fixed_point_velocity_component',
	'cartlib/physics/kinematic_movement_component',
	'cartlib/physics/prohibit_leaving_screen_component',
	'cartlib/physics/screen_boundary_capture_system',
	'cartlib/physics/screen_boundary_component',
	'cartlib/physics/screen_boundary_system',
	'cartlib/physics/velocity_component',
	'cartlib/physics/velocity_system'
].map(path => ({
	path, source: readFileSync(`${path}.lua`, 'utf8'),
}));

const source = `
local h<const> = require('cartlib/world/spatial_hierarchy')
local object2<const> = require('cartlib/world/object_2d')
local rational<const> = require('cartlib/physics/velocity_component')
local fixed<const> = require('cartlib/physics/fixed_point_velocity_component')
local ballistic<const> = require('cartlib/physics/ballistic_movement_component')
local motor<const> = require('cartlib/physics/kinematic_movement_component')
local bouncing<const> = require('cartlib/physics/bouncing_movement_component')
local velocity_system<const> = require('cartlib/physics/velocity_system')
local boundary_capture<const> = require('cartlib/physics/screen_boundary_capture_system')
local boundary_system<const> = require('cartlib/physics/screen_boundary_system')
local prohibit<const> = require('cartlib/physics/prohibit_leaving_screen_component')
local event_emitter<const> = require('cartlib/event_emitter')
local hierarchy<const> = h
local graph<const> = h.new()
local admit<const> = function(node,transform)
 setmetatable(node,object2)
 assert(object2._compile_pose(node,nil,{transform=transform}))
 h.initialize2(graph,node)
 return node
end
local actor<const> = { id = 'rational', x = 991, y = 992 }
admit(actor,{xx=1,xy=0,yx=0,yy=1,ox=10,oy=20})
local r<const> = rational.new(actor,{speed_x_num=3,speed_y_num=-3,speed_den=2})
r:on_attach()
assert(r:move() and hierarchy.resolve(actor).wox == 11 and actor.woy == 19)
assert(r.speed_accum_x == 1 and r.speed_accum_y == -1 and actor.x == 991 and actor.y == 992)
assert(r:move() and actor.wox == 13 and actor.woy == 17)
local singular<const> = admit({},{xx=1,xy=0,yx=0,yy=0,ox=0,oy=0})
local rejected_owner<const> = {}
admit(rejected_owner,{xx=1,xy=0,yx=0,yy=1,ox=5,oy=0})
h.reparent(rejected_owner,singular,false)
local reject<const> = rational.new(rejected_owner,{speed_x_num=1,speed_den=2,speed_accum_x=1})
reject:on_attach()
assert(not reject:move() and not reject.motion_committed and reject.speed_accum_x == 1)
local f<const> = fixed.new(actor,{velocity_x=128,velocity_y=384})
f:on_attach()
local bowner<const> = {}
admit(bowner,{xx=1,xy=0,yx=0,yy=1,ox=0,oy=0})
local b<const> = ballistic.new(bowner,{velocity_x=256,acceleration_x=256})
b:on_attach()
local q<const> = fixed.new(rejected_owner,{velocity_x=384,fraction_x=1})
q:on_attach()
local system<const> = {_fixed_point_component_view={components={f,b,q}},_ballistic_component_view={components={b}}}
velocity_system.update_fixed_point(system)
assert(actor.wox == 13 and actor.woy == 18 and f.fraction_x == 128 and f.fraction_y == 128)
assert(hierarchy.resolve(bowner).wox == 1 and b.velocity_x == 512)
assert(not q.motion_committed and q.fraction_x == 1)
velocity_system.update_fixed_point(system)
assert(actor.wox == 14 and actor.woy == 20 and bowner.wox == 3 and b.velocity_x == 768)
local mover<const> = {}
admit(mover,{xx=1,xy=0,yx=0,yy=1,ox=0,oy=0})
local m<const> = motor.new(mover,{
 footprint_left=0,footprint_top=0,footprint_right=4,footprint_bottom=4,
 world_left=0,world_top=0,world_right=100,world_bottom=100,
 collision_mask=1,include_elevators=false})
m:on_attach()
m:set_collision_world({tile_size=8,tile_origin_x=0,tile_origin_y=0,
 collision_flags_at_tile=function(_,x,y) return x == 2 and y <= 2 and 1 or 0 end})
hierarchy.resolve(mover)
local revision<const> = mover._origin_revision
local candidate_x<const>,candidate_y<const>,candidate_contacts<const> = m:test_motion(0,24,12,0)
assert(candidate_x == 12 and candidate_y == 24 and candidate_contacts == 0,
 'an authored candidate axis was silently replaced by a vertical tile sweep')
local swept_x<const>,swept_y<const>,swept_contacts<const> = m:test_motion(0,0,12,12)
assert(swept_x == 4 and swept_y == 12 and swept_contacts == motor.contact_right)
assert(mover.ox == 0 and mover.oy == 0
 and mover._origin_revision == revision and m.contacts == 0,
 'candidate sweep published live pose/contact state')
local committed<const>, contacts<const> = m:move(12,12)
assert(committed and contacts == motor.contact_right and mover.wox == 4 and mover.woy == 12)
assert(mover._origin_revision == revision + 1)
m:set_collision_world({tile_size=8,tile_origin_x=0,tile_origin_y=0,collision_flags_at_tile=function() return 0 end})
m:set_footprint(1,2,5,8)
m:move(-1000,-1000)
assert(mover.wox == -1 and mover.woy == -2)
m:move(1000,1000)
assert(mover.wox == 95 and mover.woy == 92)
local edge_actor<const> = {id='boundary'}
admit(edge_actor,{xx=1,xy=0,yx=0,yy=1,ox=5,oy=5})
edge_actor.events=event_emitter.events_of(edge_actor)
local edge<const> = prohibit.new(edge_actor,{left=0,top=0,right=100,bottom=100,
 local_left=0,local_top=0,local_right=10,local_bottom=10})
edge:on_attach()
local view<const> = {components={edge}}
local capture<const> = {_component_view=view}
local edges<const> = {_component_view=view,_event_payload={}}
local events = 0
edge_actor.events:on({event='screen.leaving',handler=function(_,_,_,payload)
 events=events+1
 if payload.direction == 'left' then
  assert(hierarchy.resolve(edge_actor).wox == 0 and edge_actor.woy == 95 and payload.correction_committed)
  edge_actor:set_global_position(0,20)
 else
  assert(payload.direction == 'right' and hierarchy.resolve(edge_actor).wox == 40)
 end
end})
boundary_capture.update(capture)
edge_actor:set_global_position(-1,95)
boundary_system.update(edges)
assert(events == 1 and hierarchy.resolve(edge_actor).woy == 20)
edge_actor:set_transform(1,0,0,1,50,50)
boundary_capture.update(capture)
edge_actor:set_transform(6,0,0,1,50,50)
boundary_system.update(edges)
assert(events == 2 and hierarchy.resolve(edge_actor).wox == 40)
edge_actor:set_transform(1,0,0,1,40,40)
boundary_capture.update(capture)

local failed_actor<const> = {id='failed_boundary'}
admit(failed_actor,{xx=1,xy=0,yx=0,yy=1,ox=5,oy=0})
h.reparent(failed_actor,singular,false)
failed_actor.events=event_emitter.events_of(failed_actor)
local failed_edge<const> = prohibit.new(failed_actor,{
 left=0,top=0,right=100,bottom=100,local_left=0,local_top=0,local_right=10,local_bottom=10})
failed_edge:on_attach()
local failed_view<const> = {components={failed_edge}}
local failed_events = 0
failed_actor.events:on({event='screen.leaving',handler=function(_,_,_,payload)
 failed_events=failed_events+1
 assert(payload.direction == 'left' and not payload.correction_committed
  and not failed_edge.correction_committed and hierarchy.resolve(failed_actor).wox == -1,
  'inverse rejection pretended to correct the boundary pose')
end})
boundary_capture.update({_component_view=failed_view})
failed_actor:set_position(-1,0)
boundary_system.update({_component_view=failed_view,_event_payload={}})
assert(failed_events == 1 and failed_actor.ox == -1,
 'rejected screen correction changed local authority')
local terminal_actor<const> = {id='terminal_boundary'}
admit(terminal_actor,{xx=1,xy=0,yx=0,yy=1,ox=5,oy=5})
terminal_actor.events=event_emitter.events_of(terminal_actor)
local terminal_edge<const> = prohibit.new(terminal_actor,{
 left=0,top=0,right=100,bottom=100,local_left=0,local_top=0,local_right=10,local_bottom=10})
terminal_edge:on_attach()
local terminal_view<const> = {components={terminal_edge}}
local terminal_events = 0
terminal_actor.events:on({event='screen.leaving',handler=function(_,_,_,payload)
 terminal_events=terminal_events+1
 assert(payload.direction == 'left', 'terminal owner received a later directional callback')
 terminal_actor.marked_for_disposal=true
end})
boundary_capture.update({_component_view=terminal_view})
terminal_actor:set_global_position(-1,95)
boundary_system.update({_component_view=terminal_view,_event_payload={}})
assert(terminal_events == 1, 'terminal boundary dispatch continued into another axis')

-- The motor footprint is world-axis geometry, independent of the owner's basis.
mover:set_transform(2,0,1,3,10,20)
local moved<const>,hit<const> = m:move(1000,0)
assert(moved and hit==motor.contact_right and mover.wox==95 and mover.woy==20
 and mover.xx==2 and mover.yx==1 and mover.yy==3)
assert(h.reparent(mover,singular,false)==h.committed)
h.resolve(mover)
local local_x<const>,local_y<const> = mover.ox,mover.oy
m.contacts=motor.contact_left
local accepted<const>,fake_contacts<const> = m:move_x(-10)
assert(not accepted and fake_contacts==nil and m.contacts==motor.contact_left
 and mover.ox==local_x and mover.oy==local_y,
 'failed inverse movement published coordinates or a contact latch')
local bounce<const> = bouncing.new(mover,{footprint_left=1,footprint_top=2,footprint_right=5,footprint_bottom=8,
 world_left=0,world_top=0,world_right=100,world_bottom=100,collision_mask=1,include_elevators=false,
 speed_x_num=-2000,speed_y_num=0,collision_world={tile_size=8,tile_origin_x=0,tile_origin_y=0,
 collision_flags_at_tile=function() return 0 end}})
bounce:on_attach()
bounce.contacts=motor.contact_left
local bounce_system<const> = {_bouncing_component_view={components={bounce}},_rational_component_view={components={}}}
velocity_system.update(bounce_system)
assert(bounce.speed_x_num==-2000 and bounce.contacts==motor.contact_left,
 'bouncing velocity reflected contacts from a failed pose publication')
assert(h.reparent(mover,nil,true)==h.committed)
velocity_system.update(bounce_system)
assert(bounce.speed_x_num==2000 and bounce.contacts==motor.contact_left and mover.wox==-1,
 'successful motor publication did not commit contacts before velocity reflection')

probe={run_candidates=function(count)
 local before_x<const>,before_y<const> = mover.ox,mover.oy
 local before_revision<const>,before_contacts<const> = mover._origin_revision,m.contacts
 for index=1,count do
  local x<const>,y<const>,contacts<const> = m:test_motion(12,24,index & 7,0)
  assert(x==12+(index & 7) and y==24 and contacts==0)
 end
 assert(mover.ox==before_x and mover.oy==before_y
  and mover._origin_revision==before_revision and m.contacts==before_contacts)
end,run=function(count)
 for index=1,count do
  r:move()
  velocity_system.update_fixed_point(system)
  m:move((index & 1) == 0 and 1 or -1,0)
  boundary_capture.update(capture)
  boundary_system.update(edges)
 end
end,run_callbacks=function(count)
 for index=1,count do
  edge_actor:set_global_position(5,5)
  boundary_capture.update(capture)
  edge_actor:set_global_position(-1,95)
  boundary_system.update(edges)
 end
end}
`;

for (const optLevel of [0, 3] as const) {
	test(`spatial motion O${optLevel}: owned integration, tile sweeps and synchronous footprint boundaries`, t => {
		const { cpu } = createCartlibProgramHarness(source, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		if (optLevel === 3) {
			const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
			for (const lane of ['run_candidates', 'run', 'run_callbacks']) {
				const run = probe.getStringKey(cpu.stringPool.find(lane)!) as Closure;
				const profile = profileWarmGuestKernel(cpu, run, 512);
				assert.equal(profile.reservations, 0);
				assert.equal(profile.reservedBytes, 0);
				assert.equal(profile.retainedAfter, profile.retainedBefore);
				t.diagnostic(JSON.stringify({ lane, ...profile }));
			}
		}
	});
}
