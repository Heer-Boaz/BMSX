import assert from 'node:assert/strict';
import test from 'node:test';
import { affine2FromPose, affine2Rotation, affine2Skew } from '../../ide/common/affine2';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`affine editing availability follows the actual guest squared-norm arithmetic (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local affine<const> = require('cartlib/math/affine2')
local small_x<const> = {xx=1e-200,xy=0,yx=0,yy=1,_semantic_flags=0}
local small_y<const> = {xx=1,xy=0,yx=0,yy=1e-200,_semantic_flags=0}
return affine.rotation(small_x)==nil,affine.skew(small_x)==nil,affine.skew(small_y)==nil
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const first = {xx: 1e-200, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0};
		const second = {xx: 1, xy: 0, yx: 0, yy: 1e-200, ox: 0, oy: 0};
		assert.deepEqual(materializeCpuCompletionValues(cpu), [
			affine2Rotation(first) === undefined, affine2Skew(first) === undefined, affine2Skew(second) === undefined,
		]);
	});

	test(`zero-skew construction preserves the actual guest signed-zero operands (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local affine<const> = require('cartlib/math/affine2')
return affine.trs(0,0,-0,2,-3,0)
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const pose = affine2FromPose(0, 0, -0, 2, -3, 0);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [pose.xx, pose.xy, pose.yx, pose.yy, pose.ox, pose.oy]);
	});

	test(`implicit Object2D placement is its complete semantic identity (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
prefab.define({def_id='default',class=object_2d})
return world:spawn('default'):get_transform()
`, { optLevel, modules: WORLD_CPU_MODULES });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const pose = affine2FromPose(0, 0, 0, 1, 1, 0);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [pose.xx, pose.xy, pose.yx, pose.yy, pose.ox, pose.oy]);
	});

	test(`empty scale inputs do not reconstruct exact affine geometry (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
prefab.define({def_id='raw2',class=object_2d})
prefab.define({def_id='raw3',class=object_3d})
local transform2<const> = {xx=0,xy=0,yx=2,yy=3,ox=4,oy=5}
local transform3<const> = {xx=1,xy=0,xz=0,yx=2,yy=1,yz=0,zx=0,zy=3,zz=-1,ox=4,oy=5,oz=6}
local valid = true
for _, scale in ipairs({{}, {x=nil,y=nil,z=nil}}) do
 local two<const> = world:spawn('raw2',{transform=transform2,scale=scale})
 local three<const> = world:spawn('raw3',{transform=transform3,scale=scale})
 local xx,xy,yx,yy,ox,oy=two:get_transform()
 valid=valid and xx==0 and xy==0 and yx==2 and yy==3 and ox==4 and oy==5
 local a,b,c,d,e,f,g,h,i,x,y,z=three:get_transform()
 valid=valid and a==1 and b==0 and c==0 and d==2 and e==1 and f==0 and g==0 and h==3 and i==-1 and x==4 and y==5 and z==6
end
return valid
`, { optLevel, modules: WORLD_CPU_MODULES });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	});

}
