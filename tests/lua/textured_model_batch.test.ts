import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { StringValue } from '../../machine/ts/machine/cpu/value';
import { packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { prepareModelTextures } from '../../scripts/rompacker/model_textures';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { createTexturedModelFixture } from '../helpers/textured_model';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) test(`textured model binding, affine clipping and mixed depth runs retain storage (O${optLevel})`, async t => {
	const { imported } = await createTexturedModelFixture();
	imported.textures.push({ source: 0 }); imported.materials[1].baseColorTexture = 2;
	const textures = await prepareModelTextures(imported);
	const bytes = packModelAsset(imported, textures).buffer, storage = new Uint8Array((bytes.length + 3) & ~3); storage.set(bytes);
	const view = new DataView(storage.buffer), words = Array.from({ length: storage.length / 4 }, (_, index) => view.getUint32(index * 4, true));
	// Real resource binding, atlas LRU and batch. Substitute only ROM lookup,
	// residency storage/upload and the DMA packet boundary, not rendering math.
	const modules = [
		...['cartlib/gx/gp0', 'cartlib/gx/model_asset', 'cartlib/gx/static_model', 'cartlib/gx/model_batch', 'cartlib/gx/atlas'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
		{ path: 'cartlib/rom_dir', source: `rodata payload: word[${words.length}] = {${words.join(',')}}
local resource<const> = {addr=payload,len=${bytes.length}}; return {model=function() return resource end}` },
		{ path: 'cartlib/gx/vram', source: `local slot<const> = {x=0,y=256}; local occupied=false
return {allocate=function() if occupied then return nil end; occupied=true; return slot end,
 replace=function() slot.x=(slot.x+256)%512; return slot end, release=function() error('replacement fits') end}` },
		{ path: 'cartlib/gx/imgdec', source: `local uploads<const> = {count=0}
function uploads.upload() uploads.count=uploads.count+1 end; return uploads` },
		{ path: 'cartlib/gx/command_list', source: `return {submit=function(draw) draw.flushed=draw.count end}` },
	];
	const source = `
local failed
local assert<const> = function(condition,message)
 if not condition and failed==nil then failed=message or 'model assertion failed' end
end
local models<const> = require('cartlib/gx/static_model')
local batches<const> = require('cartlib/gx/model_batch')
local resource<const> = models.resolve('fixture')
local a<const>, b<const>, solid<const> = resource.parts[1].primitives[1],resource.parts[2].primitives[1],resource.parts[3].primitives[1]
assert(models.resolve('fixture')==resource and a.command_word==0x24808080 and b.command_word==0x24808040)
assert(a.texture.width==4 and b.texture.width==1 and a.texture~=b.texture and solid.texture==nil)
rodata front: f32[9] = {-1,-1,2, 0,1,2, 1,-1,2}
rodata crossing: f32[9] = {-1,-1,2, 0,1,0.5, 1,-1,2}
rodata uv: u16[3] = {0,25800,51200}
local camera<const> = {focal_length=40,center_x=80,center_y=60,width=160,height=120,near=1}
local matrix<const> = {xx=1,xy=0,xz=0,yx=0,yy=1,yz=0,zx=0,zy=0,zz=1,ox=0,oy=0,oz=0}
local batch<const> = batches.new()
local draw<const> = {count=0,commands={},u0={},u1={},u2={},modes={},runs=0,flushed=0}
function draw:textured_triangle_words_batch(commands,xy0,xy1,xy2,uv0,uv1,uv2,order,first,last,mode)
 self.runs=self.runs+1
 for index=first,last do
  local face<const> = order[index]; self.count=self.count+1
  self.commands[self.count]=commands[face]
  self.u0[self.count],self.u1[self.count],self.u2[self.count]=uv0[face],uv1[face],uv2[face]
  self.modes[self.count]=mode
 end
 self.flushed=self.count
end
function draw:triangle_words_batch(commands,xy0,xy1,xy2,order,last,first)
 self.runs=self.runs+1
 for index=first or 1,last do self.count=self.count+1; self.commands[self.count]=commands[order[index]] end
 self.flushed=self.count
end
a.positions,a.position_scalar_count,a.texcoords=crossing,9,uv
batch:begin(camera); batches.triangles(batch,a,matrix,1,false); batch:submit(draw)
assert(draw.count==2 and draw.u0[1]==0 and draw.u1[1]==0xa642 and draw.u2[1]==0xc800,
 'near clipping changed screen-affine UV interpolation')
assert(draw.u0[2]==0 and draw.u1[2]==0x2142 and draw.u2[2]==0xa642)
a.positions=front; b.positions,b.position_scalar_count=front,9; solid.positions,solid.position_scalar_count=front,9
probe={}
function probe.steady(iterations)
 for iteration=1,iterations do
  draw.count,draw.runs=0,0; batch:begin(camera)
  matrix.oz=4; batches.triangles(batch,a,matrix,1,false)
  matrix.oz=2; batches.triangles(batch,b,matrix,2,false)
  matrix.oz=1; batches.triangles(batch,a,matrix,3,false)
  matrix.oz=0; batches.triangles(batch,solid,matrix,4,false)
  batch:submit(draw)
  assert(draw.count==4 and draw.runs==4 and draw.flushed==4)
  assert(draw.commands[1]==0x24808080 and draw.commands[2]==0x24808040 and draw.commands[3]==0x24808080 and draw.commands[4]==solid.command_word,
   'material grouping changed the global painter order')
  assert(draw.modes[1]~=draw.modes[2] and draw.modes[2]~=draw.modes[3], 'admission did not publish the relocated page')
 end
 return draw.count
end
probe.steady(1)
return failed
`;
	const { cpu } = createCartlibProgramHarness(source, { optLevel, modules });
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	const [failure] = materializeCpuCompletionValues(cpu);
	assert.equal(failure, null, failure === null ? undefined : cpu.stringPool.toString((failure as StringValue).id));
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')) as Table;
	const profile = profileWarmGuestKernel(cpu, probe.getStringKey(cpu.stringPool.find('steady')) as Closure, 128);
	assert.equal(profile.reservations, 0, 'warm clipping/order/residency paths allocate no guest heap');
	assert.deepEqual(materializeCpuCompletionValues(cpu), [4]);
	t.diagnostic(JSON.stringify(profile));
});
