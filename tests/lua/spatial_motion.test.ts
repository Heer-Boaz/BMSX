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
	'cartlib/component/transform_2d_component',
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
local t<const> = require('cartlib/component/transform_2d_component')
local rational<const> = require('cartlib/physics/velocity_component')
local fixed<const> = require('cartlib/physics/fixed_point_velocity_component')
local ballistic<const> = require('cartlib/physics/ballistic_movement_component')
local motor<const> = require('cartlib/physics/kinematic_movement_component')
local velocity_system<const> = require('cartlib/physics/velocity_system')
local boundary_capture<const> = require('cartlib/physics/screen_boundary_capture_system')
local boundary_system<const> = require('cartlib/physics/screen_boundary_system')
local prohibit<const> = require('cartlib/physics/prohibit_leaving_screen_component')
local event_emitter<const> = require('cartlib/event_emitter')
local graph<const> = h.new()
local actor<const> = { id = 'rational', x = 991, y = 992 }
actor.spatial = t.root_origin.new(graph,actor,{1,0,0,1,10,20})
local r<const> = rational.new({owner=actor,initial={velocity={speed_x_num=3,speed_y_num=-3,speed_den=2}}})
r:on_attach()
assert(r:move() and actor.spatial:resolve_world().wox == 11 and actor.spatial.woy == 19)
assert(r.speed_accum_x == 1 and r.speed_accum_y == -1 and actor.x == 991 and actor.y == 992)
assert(r:move() and actor.spatial.wox == 13 and actor.spatial.woy == 17)
local singular<const> = t.new(graph,{}, {1,0,0,0,0,0})
local rejected_owner<const> = {}
rejected_owner.spatial = t.new(graph,rejected_owner,{1,0,0,1,5,0})
h.reparent(rejected_owner.spatial,singular,false)
local reject<const> = rational.new({owner=rejected_owner,initial={velocity={speed_x_num=1,speed_den=2,speed_accum_x=1}}})
reject:on_attach()
assert(not reject:move() and not reject.motion_committed and reject.speed_accum_x == 1)
local f<const> = fixed.new({owner=actor,initial={fixed_velocity={velocity_x=128,velocity_y=384}}})
f:on_attach()
local bowner<const> = {}
bowner.spatial=t.root_origin.new(graph,bowner,{1,0,0,1,0,0})
local b<const> = ballistic.new({owner=bowner,initial={fixed_velocity={velocity_x=256,acceleration_x=256}}})
b:on_attach()
local q<const> = fixed.new({owner=rejected_owner,initial={fixed_velocity={velocity_x=384,fraction_x=1}}})
q:on_attach()
local system<const> = {_fixed_point_component_view={components={f,b,q}},_ballistic_component_view={components={b}}}
velocity_system.update_fixed_point(system)
assert(actor.spatial.wox == 13 and actor.spatial.woy == 18 and f.fraction_x == 128 and f.fraction_y == 128)
assert(bowner.spatial:resolve_world().wox == 1 and b.velocity_x == 512)
assert(not q.motion_committed and q.fraction_x == 1)
velocity_system.update_fixed_point(system)
assert(actor.spatial.wox == 14 and actor.spatial.woy == 20 and bowner.spatial.wox == 3 and b.velocity_x == 768)
local mover<const> = {}
mover.spatial=t.root_origin.new(graph,mover,{1,0,0,1,0,0})
local m<const> = motor.new({owner=mover,initial={}},{
 local_left=0,local_top=0,local_right=4,local_bottom=4,
 world_left=0,world_top=0,world_right=100,world_bottom=100,
 collision_mask=1,include_elevators=false})
m:on_attach()
m:set_collision_world({tile_size=8,tile_origin_x=0,tile_origin_y=0,
 collision_flags_at_tile=function(_,x,y) return x == 2 and y <= 2 and 1 or 0 end})
mover.spatial:resolve_world()
local revision<const> = mover.spatial._origin_revision
local candidate_x<const>,candidate_y<const>,candidate_contacts<const> = m:test_motion(0,24,12,0)
assert(candidate_x == 12 and candidate_y == 24 and candidate_contacts == 0,
 'an authored candidate axis was silently replaced by a vertical tile sweep')
local swept_x<const>,swept_y<const>,swept_contacts<const> = m:test_motion(0,0,12,12)
assert(swept_x == 4 and swept_y == 12 and swept_contacts == motor.contact_right)
assert(mover.spatial.ox == 0 and mover.spatial.oy == 0
 and mover.spatial._origin_revision == revision and m.contacts == 0,
 'candidate sweep published live pose/contact state')
local contacts<const> = m:move(12,12)
assert(contacts == motor.contact_right and mover.spatial.wox == 4 and mover.spatial.woy == 12)
assert(mover.spatial._origin_revision == revision + 1)
m:set_collision_world({tile_size=8,tile_origin_x=0,tile_origin_y=0,collision_flags_at_tile=function() return 0 end})
m:set_local_bounds(1,2,5,8)
m:move(-1000,-1000)
assert(mover.spatial.wox == -1 and mover.spatial.woy == -2)
m:move(1000,1000)
assert(mover.spatial.wox == 95 and mover.spatial.woy == 92)
local edge_actor<const> = {id='boundary'}
edge_actor.spatial=t.new(graph,edge_actor,{1,0,0,1,5,5})
edge_actor.events=event_emitter.events_of(edge_actor)
local edge<const> = prohibit.new({owner=edge_actor,initial={boundary={left=0,top=0,right=100,bottom=100,
 local_left=0,local_top=0,local_right=10,local_bottom=10}}})
edge:on_attach()
local view<const> = {components={edge}}
local capture<const> = {_component_view=view}
local edges<const> = {_component_view=view,_event_payload={}}
local events = 0
edge_actor.events:on({event='screen.leaving',handler=function(_,_,_,payload)
 events=events+1
 if payload.direction == 'left' then
  assert(edge_actor.spatial:resolve_world().wox == 0 and edge_actor.spatial.woy == 95 and payload.correction_committed)
  edge_actor.spatial:set_world_origin(0,20)
 else
  assert(payload.direction == 'right' and edge_actor.spatial:resolve_world().wox == 40)
 end
end})
boundary_capture.update(capture)
edge_actor.spatial:set_world_origin(-1,95)
boundary_system.update(edges)
assert(events == 1 and edge_actor.spatial:resolve_world().woy == 20)
edge_actor.spatial:set_local_affine(1,0,0,1,50,50)
boundary_capture.update(capture)
edge_actor.spatial:set_local_affine(6,0,0,1,50,50)
boundary_system.update(edges)
assert(events == 2 and edge_actor.spatial:resolve_world().wox == 40)
edge_actor.spatial:set_local_affine(1,0,0,1,40,40)
boundary_capture.update(capture)

local failed_actor<const> = {id='failed_boundary'}
failed_actor.spatial=t.new(graph,failed_actor,{1,0,0,1,5,0})
h.reparent(failed_actor.spatial,singular,false)
failed_actor.events=event_emitter.events_of(failed_actor)
local failed_edge<const> = prohibit.new({owner=failed_actor,initial={boundary={
 left=0,top=0,right=100,bottom=100,local_left=0,local_top=0,local_right=10,local_bottom=10}}})
failed_edge:on_attach()
local failed_view<const> = {components={failed_edge}}
local failed_events = 0
failed_actor.events:on({event='screen.leaving',handler=function(_,_,_,payload)
 failed_events=failed_events+1
 assert(payload.direction == 'left' and not payload.correction_committed
  and not failed_edge.correction_committed and failed_actor.spatial:resolve_world().wox == -1,
  'inverse rejection pretended to correct the boundary pose')
end})
boundary_capture.update({_component_view=failed_view})
failed_actor.spatial:set_local_origin(-1,0)
boundary_system.update({_component_view=failed_view,_event_payload={}})
assert(failed_events == 1 and failed_actor.spatial.ox == -1,
 'rejected screen correction changed local authority')
local terminal_actor<const> = {id='terminal_boundary'}
terminal_actor.spatial=t.root_origin.new(graph,terminal_actor,{1,0,0,1,5,5})
terminal_actor.events=event_emitter.events_of(terminal_actor)
local terminal_edge<const> = prohibit.new({owner=terminal_actor,initial={boundary={
 left=0,top=0,right=100,bottom=100,local_left=0,local_top=0,local_right=10,local_bottom=10}}})
terminal_edge:on_attach()
local terminal_view<const> = {components={terminal_edge}}
local terminal_events = 0
terminal_actor.events:on({event='screen.leaving',handler=function(_,_,_,payload)
 terminal_events=terminal_events+1
 assert(payload.direction == 'left', 'terminal owner received a later directional callback')
 terminal_actor.marked_for_disposal=true
end})
boundary_capture.update({_component_view=terminal_view})
terminal_actor.spatial:set_world_origin(-1,95)
boundary_system.update({_component_view=terminal_view,_event_payload={}})
assert(terminal_events == 1, 'terminal boundary dispatch continued into another axis')

probe={run_candidates=function(count)
 local before_x<const>,before_y<const> = mover.spatial.ox,mover.spatial.oy
 local before_revision<const>,before_contacts<const> = mover.spatial._origin_revision,m.contacts
 for index=1,count do
  local x<const>,y<const>,contacts<const> = m:test_motion(12,24,index & 7,0)
  assert(x==12+(index & 7) and y==24 and contacts==0)
 end
 assert(mover.spatial.ox==before_x and mover.spatial.oy==before_y
  and mover.spatial._origin_revision==before_revision and m.contacts==before_contacts)
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
  edge_actor.spatial:set_world_origin(5,5)
  boundary_capture.update(capture)
  edge_actor.spatial:set_world_origin(-1,95)
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
