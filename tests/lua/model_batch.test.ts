import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const modules = ['cartlib/gx/gp0', 'cartlib/gx/model_batch'].map(path => ({
	path, source: readFileSync(`${path}.lua`, 'utf8'),
}));

// ROM-resident f32 XYZ and three declared index widths feed the production
// batch. The only stand-in is the packed-lane submission boundary, observed
// before DMA; the clipping/projection/order code is not recreated by the test.
const setup = `
local batches<const> = require('cartlib/gx/model_batch')
local gp0<const> = require('cartlib/gx/gp0')
rodata front_positions: f32[9] = {-1,-1,2, 0,1,2, 1,-1,2}
rodata one_behind_positions: f32[9] = {-1,-1,2, 0,1,0, 1,-1,2}
rodata two_behind_positions: f32[9] = {-1,-1,0, 0,1,2, 1,-1,0}
rodata all_behind_positions: f32[9] = {-1,-1,0, 0,1,0, 1,-1,0}
rodata on_near_positions: f32[9] = {-1,-1,1, 0,1,1, 1,-1,1}
rodata crossing_origin_positions: f32[9] = {-1,-1,2, 0,3,-2, 1,-1,2}
rodata large_positions: f32[9] = {-100,-100,2, 0,100,2, 100,-100,2}
rodata indices8: u8[3] = {0,1,2}
rodata indices16: u16[3] = {0,1,2}
rodata indices32: u32[3] = {0,1,2}
local camera<const> = {focal_length=80,center_x=160,center_y=120,width=320,height=240,near=1}
local modelview<const> = {xx=1,xy=0,xz=0,yx=0,yy=1,yz=0,zx=0,zy=0,zz=1,ox=0,oy=0,oz=0}
local primitive<const> = {asset={},positions=front_positions,position_scalar_count=9,indices=0,index_count=3,
 command_word=0x20000011,double_sided=false}
local batch<const> = batches.new()
local draw<const> = {commands={},xy0={},xy1={},xy2={},count=0,calls=0}
function draw:triangle_words_batch(commands,xy0,xy1,xy2,order,count)
 self.count=count
 self.calls=self.calls+1
 for index=1,count do
  local face<const> = order[index]
  self.commands[index]=commands[face]
  self.xy0[index],self.xy1[index],self.xy2[index]=xy0[face],xy1[face],xy2[face]
 end
end
`;

function run(source: string, optLevel: 0 | 3) {
	const { cpu } = createCartlibProgramHarness(setup + source, { optLevel, modules });
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	return { cpu, values: materializeCpuCompletionValues(cpu) };
}

const sxy = (x: number, y: number) => x | (y << 16);

for (const optLevel of [0, 3] as const) {
	test(`model batch clips near crossings before projection and preserves flat fan packets (O${optLevel})`, () => {
		const { values } = run(`
primitive.positions=one_behind_positions
batch:begin(camera)
batches.triangles(batch,primitive,modelview,7,false)
batch:submit(draw)
local one_count<const> = draw.count
local a0<const>,a1<const>,a2<const> = draw.xy0[1],draw.xy1[1],draw.xy2[1]
local b0<const>,b1<const>,b2<const> = draw.xy0[2],draw.xy1[2],draw.xy2[2]
local flat<const> = draw.commands[1]==primitive.command_word and draw.commands[2]==primitive.command_word
primitive.positions=two_behind_positions
batch:begin(camera)
batches.triangles(batch,primitive,modelview,7,false)
batch:submit(draw)
local two_count<const> = draw.count
local c0<const>,c1<const>,c2<const> = draw.xy0[1],draw.xy1[1],draw.xy2[1]
primitive.positions=all_behind_positions
batch:begin(camera)
batches.triangles(batch,primitive,modelview,7,false)
batch:submit(draw)
local all_count<const> = draw.count
primitive.positions=on_near_positions
batch:begin(camera)
batches.triangles(batch,primitive,modelview,7,false)
batch:submit(draw)
local on_count<const> = draw.count
primitive.positions=crossing_origin_positions
batch:begin(camera)
batches.triangles(batch,primitive,modelview,7,false)
batch:submit(draw)
return one_count,a0,a1,a2,b0,b1,b2,flat,two_count,c0,c1,c2,all_count,on_count,draw.count
`, optLevel);
		assert.deepEqual(values, [
			2, sxy(120, 80), sxy(200, 120), sxy(200, 80),
			sxy(120, 80), sxy(120, 120), sxy(200, 120), true,
			1, sxy(120, 120), sxy(160, 160), sxy(200, 120), 0, 1, 2,
		]);
	});

	test(`model batch clips viewport sides before signed coordinate packing (O${optLevel})`, () => {
		const { values } = run(`
primitive.positions=large_positions
batch:begin(camera)
batches.triangles(batch,primitive,modelview,1,false)
batch:submit(draw)
local inside=true
local winding=true
local corner_mask=0
for face=1,draw.count do
 for vertex=1,3 do
  local word
  if vertex==1 then word=draw.xy0[face] elseif vertex==2 then word=draw.xy1[face] else word=draw.xy2[face] end
  local x<const>,y<const> = word&0xffff,word>>16
  inside=inside and x<=320 and y<=240
  if x==0 and y==0 then corner_mask=corner_mask|1 end
  if x==320 and y==0 then corner_mask=corner_mask|2 end
  if x==0 and y==240 then corner_mask=corner_mask|4 end
  if x==320 and y==240 then corner_mask=corner_mask|8 end
 end
 winding=winding and gp0.triangle_area(draw.xy0[face],draw.xy1[face],draw.xy2[face])<0
end
return draw.count,inside,winding,corner_mask
`, optLevel);
		assert.deepEqual(values, [2, true, true, 15]);
	});

	test(`model batch retains fractional full affines, declared index widths and post-round culling (O${optLevel})`, () => {
		const { values } = run(`
modelview.xx=0.25
modelview.yx=0.125
modelview.ox=0.0625
modelview.oy=0.0125
batch:begin(camera)
primitive.indices=indices8
batches.indexed8(batch,primitive,modelview,1,false)
primitive.indices=indices16
batches.indexed16(batch,primitive,modelview,1,false)
primitive.indices=indices32
batches.indexed32(batch,primitive,modelview,1,false)
batch:submit(draw)
local widths_same<const> = draw.xy0[1]==draw.xy0[2] and draw.xy0[2]==draw.xy0[3]
 and draw.xy1[1]==draw.xy1[2] and draw.xy1[2]==draw.xy1[3]
 and draw.xy2[1]==draw.xy2[2] and draw.xy2[2]==draw.xy2[3]
local count<const>,w0<const>,w1<const>,w2<const> = draw.count,draw.xy0[1],draw.xy1[1],draw.xy2[1]
modelview.xx=-0.25
modelview.yx=-0.125
batch:begin(camera)
batches.indexed32(batch,primitive,modelview,1,true)
batch:submit(draw)
local reflected_count<const> = draw.count
batch:begin(camera)
batches.indexed32(batch,primitive,modelview,1,false)
batch:submit(draw)
local back_count<const> = draw.count
primitive.double_sided=true
batch:begin(camera)
batches.indexed32(batch,primitive,modelview,1,false)
batch:submit(draw)
local double_count<const> = draw.count
modelview.xx=0.0001
modelview.xy=0
modelview.yx=0
modelview.yy=0.0001
modelview.ox=0
modelview.oy=0
batch:begin(camera)
batches.indexed32(batch,primitive,modelview,1,false)
batch:submit(draw)
return count,widths_same,w0,w1,w2,reflected_count,back_count,double_count,draw.count
`, optLevel);
		assert.deepEqual(values, [3, true, sxy(148, 81), sxy(168, 161), sxy(168, 81), 1, 0, 1, 0]);
	});

	test(`model batch globally orders depth and retained component identity without warm heap churn (O${optLevel})`, () => {
		const { cpu, values } = run(`
probe={}
function probe.steady(iterations)
 local checksum=0
 for iteration=1,iterations do
  batch:begin(camera)
  modelview.oz=2
  primitive.command_word=0x20000022
  batches.triangles(batch,primitive,modelview,9,false)
  modelview.oz=0
  primitive.command_word=0x20000033
  batches.triangles(batch,primitive,modelview,30,false)
  primitive.command_word=0x20000011
  batches.triangles(batch,primitive,modelview,10,false)
  primitive.command_word=0x20000044
  batches.triangles(batch,primitive,modelview,10,false)
  batch:submit(draw)
  local ordered<const> = draw.commands[1]==0x20000022 and draw.commands[2]==0x20000011
   and draw.commands[3]==0x20000044 and draw.commands[4]==0x20000033
  local order<const> = batch.sorted_order
  batch:submit(draw)
  if ordered and batch.sorted_order==order and draw.count==4 then checksum=checksum+1 end
 end
 return checksum
end
function probe.clipped(iterations)
 primitive.positions=one_behind_positions
 primitive.command_word=0x20000011
 modelview.oz=0
 local checksum=0
 for iteration=1,iterations do
  batch:begin(camera)
  batches.triangles(batch,primitive,modelview,7,false)
  batch:submit(draw)
  checksum=checksum+draw.count
 end
 return checksum
end
probe.steady(2)
return draw.count,draw.commands[1],draw.commands[2],draw.commands[3],draw.commands[4],draw.calls
`, optLevel);
		assert.deepEqual(values, [4, 0x20000022, 0x20000011, 0x20000044, 0x20000033, 4]);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')) as Table;
		const steady = probe.getStringKey(cpu.stringPool.find('steady')) as Closure;
		const profile = profileWarmGuestKernel(cpu, steady, 128);
		assert.equal(profile.reservations, 0, 'warm collection, mergesort and repeated packed submission allocate no guest heap');
		assert.deepEqual(materializeCpuCompletionValues(cpu), [128]);
		const clipped = probe.getStringKey(cpu.stringPool.find('clipped')) as Closure;
		const clippedProfile = profileWarmGuestKernel(cpu, clipped, 128);
		assert.equal(clippedProfile.reservations, 0, 'warm clipped polygon generation and sorting allocate no guest heap');
		assert.deepEqual(materializeCpuCompletionValues(cpu), [256]);
	});
}
