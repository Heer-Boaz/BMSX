import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

const model: GLTFModel = { name: 'fixture', meshes: [{ primitives: [{
	positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
	indices: new Uint16Array([0, 1, 2]), indexComponentType: 5123,
}] }, { primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), materialIndex: 0 }] }],
	materials: [{ baseColorTexture: 0 }], textures: [{}],
	nodes: [{ mesh: 0, translation: [0.25, 0, 0] }, { mesh: 1 }], scenes: [{ nodes: [0] }, { nodes: [1] }], scene: 0 };
const bytes = packModelAsset(model).buffer;
const aligned = new Uint8Array((bytes.length + 3) & ~3);
aligned.set(bytes);
const view = new DataView(aligned.buffer);
const words = Array.from({ length: aligned.length / 4 }, (_, index) => view.getUint32(index * 4, true));
// Only the directory lookup is substituted: the production packer, guest
// geometry reader, static-resource admission, World and draw pass are real.
const directory = `rodata model_payload: word[${words.length}] = {${words.join(',')}}
local record<const> = {addr=model_payload,len=${bytes.length}}
return {model=function(id) return record end}`;
const modules = [
	...WORLD_CPU_MODULES,
	...['cartlib/gx/model_asset', 'cartlib/gx/static_model', 'cartlib/gx/model_batch',
		'cartlib/component/static_model_component', 'cartlib/component/model_renderer_component'].map(path => ({
		path, source: readFileSync(`${path}.lua`, 'utf8'),
	})),
	{ path: 'cartlib/rom_dir', source: directory },
];

const source = WORLD_CPU_SETUP + `
local model_component<const> = require('cartlib/component/static_model_component')
local renderer<const> = require('cartlib/component/model_renderer_component')
local static_model<const> = require('cartlib/gx/static_model')
local resource<const> = static_model.resolve('fixture')
local primitive<const> = resource.parts[1].primitives[1]
local original_queue<const> = primitive.queue
local queued = 0
primitive.queue = function(batch,geometry,matrix,id,reflected)
 queued=queued+1
 original_queue(batch,geometry,matrix,id,reflected)
end
prefab.define({def_id='model.fixture',class={},spatial={family='3d',authority='affine'},
 components={model_component.factory({model_id='fixture'})}})
prefab.define({def_id='camera.fixture',class={},spatial={family='3d',authority='affine'},
 components={renderer.factory({width=64,height=64,focal_length=32,near=0.25})}})
local first<const> = world:spawn('model.fixture',{})
local second<const> = world:spawn('model.fixture',{})
second.spatial:set_local_origin(2,0,1)
local camera_object<const> = world:spawn('camera.fixture',{})
camera_object.spatial:set_local_origin(0,0,8)
local camera<const> = camera_object:get_component(renderer)
local a<const>,b<const> = first:get_component(model_component),second:get_component(model_component)
local draw<const> = {count=0,commands={},xy0={},xy1={},xy2={},triangle_words_batch=function(self,commands,xy0,xy1,xy2,order,count)
 self.count=count
 for index=1,count do
  local face<const> = order[index]
  self.commands[index],self.xy0[index],self.xy1[index],self.xy2[index] = commands[face],xy0[face],xy1[face],xy2[face]
 end
end}
local render<const> = function() draw.count=0; camera:draw_models(draw) end
probe = {
 check=function()
  local admitted<const> = pcall(static_model.resolve,'fixture',1)
  assert(not admitted)
  assert(a._source==b._source and a.id~=b.id)
  world:_rebuild_render_visuals()
  assert(world._render_visual_count==1 and world._render_visuals[1]==camera)
  render()
  assert(draw.count==2 and queued==2)
  assert(draw.commands[1]==0x20ffffff and draw.commands[2]==0x20ffffff)
  render(); assert(draw.count==2 and queued==2)
  a:set_presentation_origin(1,0,0)
  render(); assert(draw.count==2 and queued==4)
  first.visible=false
  render(); assert(draw.count==1 and queued==5)
  camera_object.spatial:set_local_origin(0,0,9)
  render(); assert(draw.count==1 and queued==6)
  second:set_space('other')
  render(); assert(draw.count==0 and queued==6)
  first.visible=true; second:set_space('main')
  render(); assert(draw.count==2 and queued==8)
  a:set_enabled(false)
  render(); assert(draw.count==1 and queued==9)
  a:set_enabled(true)
  render(); assert(draw.count==2 and queued==11)
  camera:set_projection(64,64,24,0.25)
  render(); assert(draw.count==2 and queued==13)
  render(); assert(draw.count==2 and queued==13)
  return true
 end,
 steady=function(count)
  local before<const> = queued
  for index=1,count do render() end
  return queued-before,draw.count
 end,
 moving=function(count)
  for index=1,count do a:set_presentation_origin(index % 2,0,0); render() end
  return draw.count
 end,
 pose=function()
  first.spatial:set_local_affine(1,0,0,0.5,1,0,0,0,1,0,0,0)
  a:set_attachment_affine(2,0,0,0,1,0,0,0,-1,1,2,3)
  a:set_presentation_origin(0,4,5)
  a:resolve_pose()
  return a.wxx,a.wxy,a.wxz,a.wyx,a.wyy,a.wyz,a.wzx,a.wzy,a.wzz,a.wox,a.woy,a.woz
 end,
 packet=function()
  first.visible=false
  render()
  return draw.count,draw.xy0[1],draw.xy1[1],draw.xy2[1]
 end,
 renew=function()
  require('cartlib/rom_dir').renew()
  return b:set_model('fixture')
 end,
}
`;

for (const optLevel of [0, 3] as const) test(`static model pass consumes World membership and retained affine/resource generations (O${optLevel})`, t => {
	const { cpu } = createCartlibProgramHarness(source, { optLevel, modules });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')) as Table;
	const method = (name: string) => probe.getStringKey(cpu.stringPool.find(name)) as Closure;
	runCompletionClosure(cpu, method('check'), []);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	const steady = profileWarmGuestKernel(cpu, method('steady'), 256);
	assert.equal(steady.reservations, 0, 'a clean camera/model pass neither rebuilds geometry nor allocates');
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0, 2]);
	const moving = profileWarmGuestKernel(cpu, method('moving'), 256);
	assert.equal(moving.reservations, 0, 'moving full-affine models reuse their projection/clip/sort lanes');
	assert.deepEqual(materializeCpuCompletionValues(cpu), [2]);
	t.diagnostic(`guest instruction budget used per frame: static=${steady.cycles / 256}, moving=${moving.cycles / 256}`);
	runCompletionClosure(cpu, method('pose'), []);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [2, 0, 0, 0.5, 1, 0, 0, 0, -1, 4, 6, -2]);
});

for (const optLevel of [0, 3] as const) test(`replacement geometry at the same address belongs to a new model generation (O${optLevel})`, () => {
	// A stable mapped allocation is republished as a new resource generation.
	// Retaining the same address/count/pose must not retain the old projection.
	const address = RAM_BASE + 0x00200000;
	const ramDirectory = `local record = {addr=${address},len=${bytes.length}}
return {model=function(id) return record end,
 renew=function() record={addr=${address},len=${bytes.length}} end}`;
	const { cpu } = createCartlibProgramHarness(source, { optLevel,
		modules: [...modules, { path: 'cartlib/rom_dir', source: ramDirectory }] });
	cpu.memory.writeBytes(address, bytes);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')) as Table;
	const packet = probe.getStringKey(cpu.stringPool.find('packet')) as Closure;
	runCompletionClosure(cpu, packet, []);
	const before = materializeCpuCompletionValues(cpu);
	const changed: GLTFModel = { ...model, meshes: model.meshes.map((mesh, index) => index !== 0 ? mesh : {
		...mesh, primitives: mesh.primitives.map(primitive => ({ ...primitive,
			positions: new Float32Array([0.5, 0, 0, 1, 0, 0, 0, 1, 0]),
		})),
	}) };
	const replacement = packModelAsset(changed).buffer;
	assert.equal(replacement.length, bytes.length);
	cpu.memory.writeBytes(address, replacement);
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('renew')) as Closure, []);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	runCompletionClosure(cpu, packet, []);
	const after = materializeCpuCompletionValues(cpu);
	assert.equal(before[0], 1);
	assert.equal(after[0], 1);
	assert.notDeepEqual(after, before, 'admitting a new resource cannot replay a projection from its predecessor');
});
