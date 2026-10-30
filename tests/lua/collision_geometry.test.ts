import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const collisionModules = [
 ...WORLD_CPU_MODULES,
 ...['cartlib/collision/geometry_pool','cartlib/collision/shape_geometry',
  'cartlib/collision/collision_shape','cartlib/collision/sprite_shape',
  'cartlib/collision/collider_2d_component','cartlib/component/sprite_component',
  'cartlib/component/sprite_animation_component','cartlib/component/tile_strip_component',
  'cartlib/collision/tile_strip_collider_2d_component','cartlib/gx/affine_batch',
 ].map(path => ({path,source:readFileSync(`${path}.lua`,'utf8')})),
 {path:'fixture_shapes',source:`
rodata rectangle: word[16] = {0x32443247,2,32,32,32,32,0,0, 1,4,16,16,0,0,0x40000000,0x3f800000}
rodata compound: word[32] = {0x32443247,2,32,32,32,32,0,0,
 4,2,32,16,0,0,0x40a00000,0x3f800000,
 1,4,32,32,1,4,32,32,0,0,0x40000000,0x3f800000,0x40400000,0,0x40a00000,0x3f800000}
local images<const> = {small={collision_addr=rectangle},wide={collision_addr=compound}}
return {rectangle=rectangle,compound=compound,image=function(id) return images[id] end}`},
 {path:'cartlib/rom_dir',source:"return {image=require('fixture_shapes').image}"},
 // Image packet production is not under test here. Actual Sprite/animation
 // owners still supply concrete geometry identities and the admitted frame set.
 {path:'cartlib/gx/image',source:`local images<const> = {small={width=2,height=1},wide={width=5,height=1}}
 return {resolve=function(id) return images[id] end}`},
];

for (const optLevel of [0,3] as const) {
 test(`Repeated area publication retains translation-only geometry (O${optLevel})`, t => {
  const {cpu} = createCartlibProgramHarness(WORLD_CPU_SETUP+`
local pool<const> = require('cartlib/collision/geometry_pool')
local collider<const> = require('cartlib/collision/collider_2d_component')
bss cache: word[16]
local storage<const> = pool.new(cache,64,1)
prefab.define({def_id='collision.moving_area',class={},
 spatial={family='2d',authority='root_origin',local_transform={1,0,0,1,0,0}},
 initial={collider={geometry_pool=storage,local_area={left=0,top=0,right=8,bottom=2}}},
 components={collider.new}})
local actor<const> = world:spawn('collision.moving_area',{})
local body<const> = actor:get_component(collider)
body:resolve_shape()
local geometry_revision<const> = body._geometry_revision
kernel=function(count)
 for index=1,count do
  actor.spatial:set_local_origin(index,index*2)
  body:set_local_area(0,0,8,2)
  assert(body:resolve_shape()==cache and body.wox==index and body.woy==index*2)
 end
 assert(body._geometry_revision==geometry_revision,
  'unchanged local area invalidated the retained geometry on every position update')
end
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
  const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
  const profile = profileWarmGuestKernel(cpu,kernel,256);
  assert.equal(profile.reservations,0);
  assert.equal(profile.reservedBytes,0);
  assert.equal(profile.retainedAfter,profile.retainedBefore);
  t.diagnostic(JSON.stringify({optLevel,...profile}));
 });

 test(`Collision basis encoding preserves exact F32 bounds, reflection and disjoint pieces (O${optLevel})`, () => {
  const {cpu} = createCartlibProgramHarness(`
local geometry<const> = require('cartlib/collision/shape_geometry')
local pool<const> = require('cartlib/collision/geometry_pool')
local assets<const> = require('fixture_shapes')
bss output: word[64]
local words<const>: *word = output
local values<const>: *f32 = output
assert(geometry.measure(assets.rectangle+32)==64 and geometry.measure(assets.compound+32)==160,
 'source admission did not measure actual transformed primitives/pieces')
geometry.write(assets.rectangle+32,output,2,1,1,3)
assert(words[0]==3 and words[1]==4 and words[2]==32 and words[3]==16
 and values[4]==0 and values[5]==0 and values[6]==5 and values[7]==5
 and values[8]==0 and values[9]==0 and values[10]==4 and values[11]==2
 and values[12]==5 and values[13]==5 and values[14]==1 and values[15]==3,
 'AABB affine was approximated by its broadphase bounds')
geometry.write(assets.rectangle+32,output,-1,0,0,1)
assert(values[4]==-2 and values[5]==0 and values[6]==0 and values[7]==1
 and values[8]==0 and values[9]==0 and values[10]==0 and values[11]==1
 and values[12]==-2 and values[13]==1 and values[14]==-2 and values[15]==0,
 'reflection lost the producer winding convention')
geometry.write(assets.rectangle+32,output,0,0,0,0)
for index=4,15 do assert(values[index]==0,'degenerate geometry was inflated or repaired') end
geometry.write(assets.compound+32,output,-1,0,0,1)
assert(words[0]==4 and words[1]==2 and values[4]==-5 and values[6]==0,
 'compound lost its actual pieces or encoded bounds')
geometry.write_area(output,1,0,2,1,16777217,0,0,1)
assert(values[4]==values[8] and values[6]==values[10] and values[4]==16777216 and values[6]==33554432,
 'bounds were reduced from unrounded Numbers rather than encoded F32 geometry')
geometry.write_strip(output,0,1,4,0,0,0,2,1,1,0,0,1,false)
assert(words[0]==4 and words[1]==2 and words[8]==3 and words[12]==3,
 'axis-aligned gaps were filled by one approximate AABB')
local storage<const> = pool.new(output,64,2)
local a<const>, b<const> = pool.acquire(storage),pool.acquire(storage)
assert(a==output and b==output+64,'fixed geometry slots were relocated')
local ok<const> = pcall(pool.acquire,storage)
assert(not ok,'fixed geometry pool silently grew past its cart-owned capacity')
pool.release(storage,a)
assert(pool.acquire(storage)==a,'retired geometry slot did not reuse its intrusive free link')
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
 });

 test(`Collider source admission reserves animation bounds and separates physical geometry from presentation (O${optLevel})`, t => {
  const {cpu} = createCartlibProgramHarness(WORLD_CPU_SETUP+`
local pool<const> = require('cartlib/collision/geometry_pool')
local collider<const> = require('cartlib/collision/collider_2d_component')
local sprite<const> = require('cartlib/component/sprite_component')
local animation<const> = require('cartlib/component/sprite_animation_component')
local images<const> = require('cartlib/gx/image')
local assets<const> = require('fixture_shapes')
bss caches: word[128]
local storage<const> = pool.new(caches,256,2)
prefab.define({def_id='collision.actor',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,10,20}},
 initial={collider={geometry_pool=storage,sprite_id_local='sprite'}},
 components={animation.factory({frames={'small','wide'},frame_duration_ms=20,loop=true}),
 collider.new_for_sprite}})
local actor<const> = world:spawn('collision.actor',{})
local body<const> = actor:get_component(collider)
local visual<const> = actor:get_component(sprite)
assert(body._sprite_required_bytes==160 and body._geometry_address==caches,
 'animation admission sized only the first current frame')
assert(body:resolve_shape()==assets.rectangle+32 and body.wox==10 and body.woy==20,
 'translation-only collider copied geometry or lost physical origin')
actor.spatial:set_local_affine(0,2,-3,0,10,20)
local shape<const> = body:resolve_shape()
assert(shape==caches,'affine collider cached a pass scratch pointer instead of its owned slot')
local words<const>: *word = shape
local vertices<const>: *f32 = shape
assert(vertices[4]==-3 and vertices[5]==0 and vertices[6]==0 and vertices[7]==4,
 'physical object basis did not transform exact collision geometry')
local basis<const> = body._geometry_basis_revision
local encoded<const> = words[6]
visual:set_presentation_affine(0,7,8,0,100,200)
visual:set_attachment_origin(400,500)
body:resolve_shape()
assert(body._geometry_basis_revision==basis and words[6]==encoded and body.wox==10 and body.woy==20,
 'sprite presentation/attachment mutated independent physical collision placement')
visual:_set_resolved_imgid('wide',images.resolve('wide'))
assert(body:resolve_shape()==shape and words[0]==4 and words[1]==2,
 'admitted later frame grew storage or retained the first frame source')
local same<const> = shape
kernel=function(count)
 for index=1,count do
  actor.spatial:set_local_origin(index,index*2)
  assert(body:resolve_shape()==same and body._geometry_basis_revision==basis,
   'translation-only motion rebuilt or relocated transformed geometry')
 end
end
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
  const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
  const profile = profileWarmGuestKernel(cpu,kernel,256);
  assert.equal(profile.reservations,0);
  assert.equal(profile.reservedBytes,0);
  assert.equal(profile.retainedAfter,profile.retainedBefore);
  t.diagnostic(JSON.stringify({optLevel,storageBytes:512,...profile}));
 });

 test(`Canceled collider factory releases constructor-owned geometry without an attach callback (O${optLevel})`, () => {
  const {cpu} = createCartlibProgramHarness(WORLD_CPU_SETUP+`
local pool<const> = require('cartlib/collision/geometry_pool')
local collider<const> = require('cartlib/collision/collider_2d_component')
bss canceled_storage: word[16]
local storage<const> = pool.new(canceled_storage,64,1)
local returned_component
prefab.define({def_id='collision.canceled',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}},
 initial={collider={geometry_pool=storage,local_area={left=0,top=0,right=2,bottom=1}}},
 components={function(context)
  local part<const> = collider.new(context)
  returned_component=part
  context.owner.scene:dispose()
  return part
 end}})
scenes.register('collision.canceled.scene',{objects={{member_id='actor',definition_id='collision.canceled'}}})
local scene<const> = scenes.instantiate('collision.canceled.scene')
assert(scene.closed and #scene.objects.items==0 and not returned_component._attach_notified
 and returned_component._geometry_address==nil,
 'canceled factory did not retire its constructed geometry binding')
assert(pool.acquire(storage)==canceled_storage,'unattached canceled collider leaked its only geometry slot')
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
 });

 test(`Tile-strip source admission precedes publication and empty geometry stays absent (O${optLevel})`, t => {
  const {cpu} = createCartlibProgramHarness(WORLD_CPU_SETUP+`
local pool<const> = require('cartlib/collision/geometry_pool')
local collider<const> = require('cartlib/collision/collider_2d_component')
local strip_component<const> = require('cartlib/component/tile_strip_component')
local strip_collider<const> = require('cartlib/collision/tile_strip_collider_2d_component')
bss strip_geometry: word[128]
local storage<const> = pool.new(strip_geometry,256,2)
prefab.define({def_id='collision.strip',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,10,20}},
 initial={collider={geometry_pool=storage}},
 components={strip_component.factory({imgid='small',first_tile=0,step_x=4,step_y=0,maximum_tiles=3}),
 strip_collider.factory({})}})
local actor<const> = world:spawn('collision.strip',{})
local strip<const> = actor:get_component(strip_component)
local body<const> = actor:get_component(collider)
local channels<const> = require('cartlib/timeline/channel_binding')
local raw_source_write<const> = pcall(channels.resolve,{primary_binding=strip,
 program={output_paths={{binding_index=1,path={'first_tile'}}},writer_outputs={}}})
assert(not raw_source_write,'raw timeline path bypassed complete strip source admission')
assert(body:resolve_shape()==nil and body._local_flags==3 and body._strip_revision==nil,
 'empty source resolved a pose or fabricated geometry')
strip:set_range(0,2)
local address<const> = body:resolve_shape()
local words<const>: *word = address
assert(address==strip_geometry and words[0]==4 and words[1]==3,
 'gapped range did not retain exact admitted pieces')
strip:set_range(1,1)
assert(body:resolve_shape()==address and words[1]==1,'source shrink retained stale pieces')
strip:set_range(1,0)
assert(body:resolve_shape()==nil,'empty source retained its previous geometry')
strip:set_range(0,2)
assert(body:resolve_shape()==address and words[1]==3,'source re-expansion lost its retained slot')
local too_many<const> = pcall(strip.set_range,strip,7,10)
assert(not too_many and strip.first_tile==0 and strip.last_tile==2,
 'range overflow published a source outside its admitted capacity')
local duplicate<const> = pcall(strip_collider.factory({}),{owner=actor,initial={}})
assert(not duplicate and strip._collider==body and storage._next_slot==1,
 'second binding replaced source ownership or acquired geometry before composition admission')
kernel=function(count)
 for index=1,count do
  strip:set_range(0,2)
  assert(body:resolve_shape()==address and words[1]==3)
  strip:set_range(1,1)
  assert(body:resolve_shape()==address and words[1]==1)
  strip:set_range(1,0)
  assert(body:resolve_shape()==nil)
 end
end
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
  const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
  const profile = profileWarmGuestKernel(cpu,kernel,128);
  assert.equal(profile.reservations,0);
  assert.equal(profile.reservedBytes,0);
  assert.equal(profile.retainedAfter,profile.retainedBefore);
  t.diagnostic(JSON.stringify({optLevel,sourceMutations:384,...profile}));
 });

 test(`Tile-strip candidate step and area overflow leave the admitted source unchanged (O${optLevel})`, () => {
  const {cpu} = createCartlibProgramHarness(WORLD_CPU_SETUP+`
local pool<const> = require('cartlib/collision/geometry_pool')
local collider<const> = require('cartlib/collision/collider_2d_component')
local strip_component<const> = require('cartlib/component/tile_strip_component')
local strip_collider<const> = require('cartlib/collision/tile_strip_collider_2d_component')
bss strip_geometry: word[16]
local storage<const> = pool.new(strip_geometry,64,1)
prefab.define({def_id='collision.contiguous_strip',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}},
 initial={collider={geometry_pool=storage}},
 components={strip_component.factory({imgid='small',first_tile=0,step_x=2,step_y=0,maximum_tiles=3}),
 strip_collider.factory({})}})
local actor<const> = world:spawn('collision.contiguous_strip',{})
local strip<const> = actor:get_component(strip_component)
local body<const> = actor:get_component(collider)
strip:set_range(0,2)
body:resolve_shape()
local revision<const> = strip._source_revision
local basis<const> = body._geometry_basis_revision
local geometry_revision<const> = body._geometry_revision
local step_ok<const> = pcall(strip.set_step,strip,3,0)
assert(not step_ok and strip.step_x==2 and strip.step_y==0 and strip._source_revision==revision
 and body._strip_collapsed and body._geometry_basis_revision==basis,
 'failed candidate step changed the current source or its cache')
local area_ok<const> = pcall(body.set_local_area,body,0,0,1,1)
assert(not area_ok and body.local_right==2 and body._geometry_revision==geometry_revision
 and body._strip_collapsed and body._geometry_basis_revision==basis,
 'failed candidate area changed physical geometry before capacity admission')
strip:set_step(0,1)
assert(strip.step_x==0 and strip.step_y==1 and body:resolve_shape()==strip_geometry,
 'admitted contiguous candidate did not publish')
world:clear()
assert(strip._collider==nil and pool.acquire(storage)==strip_geometry,
 'retired source binding did not release its cart-owned slot')
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
 });

 test(`Canceled strip collider factory releases its concrete source binding (O${optLevel})`, () => {
  const {cpu} = createCartlibProgramHarness(WORLD_CPU_SETUP+`
local pool<const> = require('cartlib/collision/geometry_pool')
local strip_component<const> = require('cartlib/component/tile_strip_component')
local strip_collider<const> = require('cartlib/collision/tile_strip_collider_2d_component')
bss strip_geometry: word[16]
local storage<const> = pool.new(strip_geometry,64,1)
local construct_collider<const> = strip_collider.factory({})
local returned_collider
local returned_strip
prefab.define({def_id='collision.canceled_strip',class={},
 spatial={family='2d',authority='affine',local_transform={1,0,0,1,0,0}},
 initial={collider={geometry_pool=storage}},
 components={strip_component.factory({imgid='small',first_tile=0,step_x=2,step_y=0,maximum_tiles=3}),
 function(context)
  returned_strip=context.owner:get_component(strip_component)
  returned_collider=construct_collider(context)
  context.owner.scene:dispose()
  return returned_collider
 end}})
scenes.register('collision.canceled_strip.scene',{objects={{member_id='actor',definition_id='collision.canceled_strip'}}})
local scene<const> = scenes.instantiate('collision.canceled_strip.scene')
assert(scene.closed and returned_strip._collider==nil and returned_collider._geometry_address==nil
 and not returned_collider._attach_notified and pool.acquire(storage)==strip_geometry,
 'pre-attachment cancellation retained a concrete source binding or its geometry slot')
return true
`,{optLevel,modules:collisionModules});
  assert.equal(cpu.runUntilDepth(0,20_000_000),RunResult.Halted);
  assert.deepEqual(materializeCpuCompletionValues(cpu),[true]);
 });
}
