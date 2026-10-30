import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`GX narrows a complete column-major affine only at the GTE operand boundary (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local gte<const> = require('cartlib/gx/gte')
local transform<const> = require('cartlib/gx/gte_transform')
local controls<const>: *word = gte.control
controls[gte.control_ofx] = 0x12340000
transform.write_affine(1,0.25,-0.5, -1,2,0.125, 0.5,-0.25,3, 10.5,-20.5,512.4)
local a<const>, b<const>, c<const>, d<const>, e<const> = controls[0],controls[1],controls[2],controls[3],controls[4]
local tx<const>, ty<const>, tz<const> = controls[5],controls[6],controls[7]
transform.write_origin(-3.6,4.4,700.5)
local preserves_basis<const> = controls[0]==a and controls[1]==b and controls[2]==c
 and controls[3]==d and controls[4]==e and controls[gte.control_ofx]==0x12340000
local next_x<const>, next_y<const>, next_z<const> = controls[5],controls[6],controls[7]
transform.write_affine(8.25,0,0, 0,1,0, 0,0,1, 0,0,0)
return a,b,c,d,e&0xffff,tx,ty,tz,preserves_basis,next_x,next_y,next_z,controls[0]&0xffff
`, { optLevel, modules: [
			...['cartlib/gx/gte', 'cartlib/gx/gte_transform'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
		] });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [
			0xf0001000, 0x04000800, 0xfc002000, 0x0200f800, 0x3000,
			11, 0xffffffeb, 512, true, 0xfffffffc, 4, 701, 0x8400,
		]);
	});
}
