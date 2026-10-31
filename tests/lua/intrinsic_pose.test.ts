import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { materializeCpuCompletionValues } from './cpu_test_harness';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';

// Like Bevy's ECS lifecycle regressions, these execute the admitted owner and
// observe its geometry and lifetime, not a second host pose implementation.
// https://github.com/bevyengine/bevy/blob/main/crates/bevy_ecs/src/bundle/tests.rs
const cases = [
	{
		name: 'known zero and signed semantic channels survive origin writes and explicit complete edits',
		source: `
prefab.define({def_id='known2',class=object_2d,position={x=5,y=6},rotation=7,scale={x=0,y=-2},skew=0.2})
local node<const> = world:spawn('known2')
assert(node:get_rotation()==7 and node:get_skew()==0.2)
local sx,sy=node:get_scale(); assert(sx==0 and sy==-2)
assert(node:set_scale(3,-2) and node:get_rotation()==7 and node:get_skew()==0.2)
node:get_global_transform()
local basis<const>,origin<const> = node._basis_revision,node._origin_revision
assert(node:set_position(8,9))
node:get_global_transform()
assert(node:get_rotation()==7 and node:get_skew()==0.2 and node._basis_revision==basis and node._origin_revision==origin+1)
local origin2<const> = node._origin_revision
assert(node:set_rotation(8)); node:get_global_transform()
assert(node:get_rotation()==8 and node._origin_revision==origin2)
prefab.define({def_id='known3',class=object_3d,rotation={x=0.5,y=0.5,z=0.5,w=0.5},scale={x=0,y=-2,z=0}})
local three<const> = world:spawn('known3')
local x,y,z,w=three:get_rotation(); assert(x==0.5 and y==0.5 and z==0.5 and w==0.5)
local a,b,c=three:get_scale(); assert(a==0 and b==-2 and c==0)
assert(three:set_position(1,2,3) and three:set_scale(2,-3,4))
x,y,z,w=three:get_rotation(); assert(x==0.5 and y==0.5 and z==0.5 and w==0.5)
assert(node.owner==nil and node.spatial==nil and #node._components==0 and three.owner==nil and #three._components==0)
`,
	},
	{
		name: 'unavailable raw extraction is memoized without poisoning geometry or preventing a complete pose',
		source: `
prefab.define({def_id='raw2',class=object_2d,transform={xx=0,xy=0,yx=0,yy=0,ox=5,oy=6}})
local two<const> = world:spawn('raw2')
assert(two:get_rotation()==nil and two:get_skew()==nil)
local unavailable<const> = two._semantic_flags
for index=1,32 do assert(two:get_rotation()==nil and two:get_skew()==nil and two._semantic_flags==unavailable) end
local sx,sy=two:get_scale(); assert(sx==0 and sy==0)
local flags<const> = two._semantic_flags
assert(not two:set_rotation(1) and not two:set_scale(2,3) and not two:set_skew(0.2))
assert(two.xx==0 and two.xy==0 and two.yx==0 and two.yy==0 and two.ox==5 and two.oy==6 and two._semantic_flags==flags)
assert(two:set_pose(5,6,1,0,-2,0.3) and two:get_rotation()==1 and two:get_skew()==0.3)
prefab.define({def_id='raw3',class=object_3d,transform={xx=1,xy=2,xz=3,yx=2,yy=4,yz=6,zx=0,zy=0,zz=1,ox=1,oy=2,oz=3}})
local three<const> = world:spawn('raw3')
assert(three:get_rotation()==nil)
local oldxx<const>,oldyy<const>,oldoz<const> = three.xx,three.yy,three.oz
assert(not three:set_scale(2,3,4) and three.xx==oldxx and three.yy==oldyy and three.oz==oldoz)
-- Rotation preserves known column norms, not the unavailable old orientation.
assert(three:set_rotation(0,0,0,1) and three:get_rotation()==0)
assert(three:set_pose(1,2,3,0,0,0,1,0,0,0))
assert(three:get_rotation()==0)
local a,b,c=three:get_scale();assert(a==0 and b==0 and c==0)
assert(three:set_transform(0,1,0,-1,0,0,0,0,0,1,2,3))
assert(three:get_rotation()~=nil,'a zero third column does not make the ordered first two axes unavailable')
`,
	},
	{
		name: 'raw shear and reflection remain exact until an explicit semantic basis edit',
		source: `
prefab.define({def_id='shear2',class=object_2d,transform={xx=2,xy=0,yx=1,yy=-1,ox=4,oy=5}})
local two<const> = world:spawn('shear2')
local angle<const>,skew<const> = two:get_rotation(),two:get_skew()
local sx,sy=two:get_scale()
assert(sx==2 and sy<0 and angle==0 and skew~=nil and two.yx==1 and two.yy==-1)
-- A diagonal second axis exercises exact atan endpoints of the BIOS kernel.
assert(two:set_rotation(angle))
assert(math.abs(two.yx-1)<0.000001 and math.abs(two.yy+1)<0.000001,'2D rotation discarded preserved skew')
local affine3<const> = require('cartlib/math/affine3')
local a,b,c,d,e,f,g,h,i,px,py,pz=affine3.trs(2,3,4,0.5,0.5,0.5,0.5,2,-3,4)
prefab.define({def_id='reflection3',class=object_3d,transform={xx=a,xy=b,xz=c,yx=d,yy=e,yz=f,zx=g,zy=h,zz=i,ox=px,oy=py,oz=pz}})
local three<const> = world:spawn('reflection3')
local x,y,z=three:get_scale();assert(x==2 and y==3 and z==-4)
assert(three:get_rotation()~=nil and three.yx==d and three.yy==e and three.yz==f)
assert(three:set_scale(x,y,z))
assert(math.abs(three.xx-a)<0.000001 and math.abs(three.xy-b)<0.000001 and math.abs(three.xz-c)<0.000001
 and math.abs(three.yx-d)<0.000001 and math.abs(three.yy-e)<0.000001 and math.abs(three.yz-f)<0.000001
 and math.abs(three.zx-g)<0.000001 and math.abs(three.zy-h)<0.000001 and math.abs(three.zz-i)<0.000001)
three:set_transform(1,0,0,0.5,1,0,0,0,1,2,3,4)
three:get_rotation();three:get_scale()
assert(three.yx==0.5,'a read projected a raw sheared affine')
assert(three:set_rotation(0,0,0,1) and three.yx==0,'explicit 3D rotation did not rebuild R diagonal S')
`,
	},
	{
		name: 'construction merges scalar semantic overrides over one complete affine and preserves raw inputs',
		source: `
local received
local class<const> = setmetatable({initialize=function(self,options)
 received=options
 assert(self.ox==4 and self.oy==7 and self.yx==0.5 and self.tag==0)
end,ctor=function(self,options) assert(options==received and options==self._construction_options) end},{__index=object_2d})
prefab.define({def_id='overrides',class=class,transform={xx=1,xy=0,yx=0.5,yy=1,ox=4,oy=5},defaults={tag=3}})
local options<const> = {position={y=7},tag=0}
local owner<const> = world:spawn('overrides',options)
assert(received==options and options.position.x==nil and owner.position==nil and owner.transform==nil)
local plan<const> = {}
assert(object_3d._compile_pose(plan,nil,{transform={xx=0,xy=0,xz=0,yx=0,yy=0,yz=0,zx=0,zy=0,zz=0,ox=1,oy=2,oz=3},rotation={x=0,y=0,z=0,w=1}}))
local unavailable<const> = {}
assert(not object_3d._compile_pose(unavailable,nil,{transform={xx=0,xy=0,xz=0,yx=0,yy=0,yz=0,zx=0,zy=0,zz=0,ox=1,oy=2,oz=3},scale={x=2}}))
`,
	},
] as const;

for (const optLevel of [0, 3] as const) for (const behavior of cases) {
	test(`intrinsic Object O${optLevel}: ${behavior.name}`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `local assertion_index=0
local first_failure=0
local assert<const> = function(value) assertion_index=assertion_index+1; if not value and first_failure==0 then first_failure=assertion_index end end
` + behavior.source + '\nreturn first_failure',
			{ optLevel, modules: WORLD_CPU_MODULES });
		assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu),[0],behavior.name);
	});
}

test('intrinsic native semantic edits and tuple queries reserve no guest heap storage warm', t => {
	const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
prefab.define({def_id='warm2',class=object_2d})
prefab.define({def_id='warm3',class=object_3d})
local two<const>,three<const> = world:spawn('warm2'),world:spawn('warm3')
probe={run=function(count)
 for index=1,count do
  two:set_pose(index,-index,0.25,2,-3,0.1)
  two:set_position(index+1,-index+1)
  two:get_global_transform(); two:get_rotation(); two:get_scale(); two:get_skew()
  three:set_pose(index,-index,index,0.5,0.5,0.5,0.5,2,-3,4)
  three:get_global_transform(); three:get_rotation(); three:get_scale()
  two:set_transform(1,0,1,1,index,-index)
  two:get_rotation();two:get_scale();two:get_skew()
  three:set_transform(1,0,0,0.5,1,0,0,0,1,index,-index,index)
  three:get_rotation();three:get_scale()
 end
end}
`, { optLevel: 3, modules: WORLD_CPU_MODULES });
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const measured = profileWarmGuestKernel(cpu, probe.getStringKey(cpu.stringPool.find('run')!) as Closure, 256);
	assert.equal(measured.reservations, 0); assert.equal(measured.reservedBytes, 0);
	assert.equal(measured.retainedAfter, measured.retainedBefore);
	t.diagnostic(JSON.stringify(measured));
});
