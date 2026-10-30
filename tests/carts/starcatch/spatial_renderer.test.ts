import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GxGte } from '../../../machine/ts/machine/devices/gx/gte';
import { DeviceScheduler } from '../../../machine/ts/machine/scheduler/device';
import { createCartlibProgramHarness } from '../../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../../helpers/world_cpu';
import { materializeCpuCompletionValues } from '../../lua/cpu_test_harness';

const modules = [
	...WORLD_CPU_MODULES,
	...['cartlib/gx/gte', 'cartlib/gx/gte_transform', 'cartlib/gx/affine_batch']
		.map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
	...['scene_renderer', 'scene_meshes']
		.map(path => ({ path, source: readFileSync(`carts/starcatch/${path}.lua`, 'utf8') })),
];

const fixture = WORLD_CPU_SETUP + `
local renderer<const> = require('scene_renderer')
local meshes<const> = require('scene_meshes')
local gte<const> = require('cartlib/gx/gte')
local gp0<const> = require('cartlib/gx/gp0')
local data<const>: *word = gte.data
local command<const>: *word = gte.command
local cycles<const>: *word = gte.cycles
prefab.define({def_id='starcatch.renderer.fixture',class={},spatial={family='3d',authority='affine'}})
local parent<const> = world:spawn('starcatch.renderer.fixture',{},
 {local_transform={1,.25,0, .5,1,.25, .25,0,1, 160,120,512}})
local ship<const> = world:spawn('starcatch.renderer.fixture',
 {visible=true,spin=0,bank=0,bob=3,recoil=2,hit_flash=0,dash_shield=0},
 {parent=parent.spatial,local_transform={1,0,0, 0,1,0, 0,0,1, 3,4,5}})
local game<const> = {player=ship,phase='title',frame=0,
 scene={definition={}},player_bolts={},enemy_bolts={}}
local component<const> = {owner={game=game}}
local body_commands<const>, head_commands<const> = {},{}
for index=1,#meshes.palettes[meshes.cyan] do
 body_commands[gp0.draw_triangle | gp0.argb_to_rgb(meshes.palettes[meshes.cyan][index])]=true
end
for index=1,#meshes.palettes[meshes.gold] do
 head_commands[gp0.draw_triangle | gp0.argb_to_rgb(meshes.palettes[meshes.gold][index])]=true
end
-- Only the draw sink is replaced. The shipped meshes, renderer, hierarchy,
-- affine encoder and hardware RTPS/NCLIP datapaths execute normally.
local draw<const> = {body=0,head=0,reflected=false,rect=function() end,line=function() end,
 triangle_words=function(self,color,a,b,c)
  data[gte.data_sxy0],data[gte.data_sxy1],data[gte.data_sxy2]=a,b,c
  *command=gte.opcode_nclip
  while (*cycles & 0x80000000)~=0 do end
  local area<const> = data[gte.data_mac0]
  assert(area~=0 and ((area & 0x80000000)~=0)==self.reflected,
   'renderer emitted a back face or dropped reflected winding compensation')
  if body_commands[color] then self.body=self.body+1
  elseif head_commands[color] then self.head=self.head+1
  else error('renderer emitted an unrelated model palette') end
 end}
renderer.setup()
renderer.draw(component,draw)
local normal_body<const>, normal_head<const> = draw.body,draw.head
assert(normal_body>0 and normal_head>0,'sheared hierarchy lost body or articulated head geometry')
parent.spatial:set_local_affine(-1,-.25,0, .5,1,.25, .25,0,1, 160,120,512)
draw.body,draw.head,draw.reflected=0,0,true
renderer.draw(component,draw)
assert(draw.body>0 and draw.head>0,'reflected hierarchy culled the body or articulated head')
return #meshes.definitions[meshes.ship].vertices,#meshes.definitions[meshes.head].vertices
`;

for (const optLevel of [0, 3] as const) {
	test(`Starcatch emits parented sheared/reflected models and articulated head operands (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(fixture, { modules, optLevel, firmwareMath: true });
		const gte = new GxGte(cpu.memory, cpu, new DeviceScheduler(cpu));
		const projections: number[][] = [];
		gte.setCommandObserver({
			before(command, _signals, _data, controls) {
				if (command === 0x00080001) projections.push(Array.from(controls).slice(0, 8));
			},
			after() {},
		});
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const [bodyVertices, headVertices] = materializeCpuCompletionValues(cpu) as number[];
		const vertexCount = bodyVertices + headVertices;
		assert.equal(projections.length, vertexCount * 2);
		// Exact register operands for the authored shear and its X reflection.
		// Child origin (3,4,5) composes through its parent; the articulated head
		// adds local (0,2,-4) before the central GTE encoder rounds translation.
		const bases = [
			[0x08001000, 0x04000400, 0x00001000, 0x04000000, 0x00001000],
			[0x0800f000, 0xfc000400, 0x00001000, 0x04000000, 0x00001000],
		];
		const bodyOrigins = [[6, 5, 518], [0, 3, 518]];
		const headOrigins = [[6, 7, 515], [0, 5, 515]];
		for (let pass = 0; pass < 2; pass++) {
			for (let vertex = 0; vertex < vertexCount; vertex++) {
				assert.deepEqual(projections[pass * vertexCount + vertex], [
					...bases[pass], ...(vertex < bodyVertices ? bodyOrigins[pass] : headOrigins[pass]),
				], `model ${pass}, projected vertex ${vertex} lost its complete affine or articulated origin`);
			}
		}
	});
}
