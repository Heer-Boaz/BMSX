import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const MODULE_FILES = [
	['stdlib/common/numeric', 'machine/firmware/stdlib/common/numeric.lua'],
	['stdlib/common/endian', 'machine/firmware/stdlib/common/endian.lua'],
	['stdlib/util/sincos_turn32', 'machine/firmware/stdlib/util/sincos_turn32.lua'],
	['stdlib/math', 'machine/firmware/stdlib/math.lua'],
	['cartlib/dma', 'cartlib/dma.lua'],
	['cartlib/apu', 'cartlib/apu.lua'],
	['cartlib/aem_biquad', 'cartlib/aem_biquad.lua'],
] as const;

test('AEM biquad design emits the exact packed Q14 APU register words', () => {
	const entrySource = `
local biquad<const> = require('cartlib/aem_biquad')
local numeric<const> = require('stdlib/common/numeric')
local control<const>, b0_b1<const>, b2_a1<const>, a2<const> = biquad.design({
	type = 'lowpass',
	frequency = 1000,
	q = 0.707,
	gain = 0,
})
return control, b0_b1, b2_a1, a2, numeric.encode_signed_q14(-3), numeric.encode_signed_q14(3)
`;
	const modules = MODULE_FILES.map(([path, file]) => {
		const source = readFileSync(file, 'utf8');
		return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
	});
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'), modules, { entrySource, optLevel: 3 });
	const cpu = runCompiledTestSystem(compiled, 100000);
	assert.deepEqual(materializeCpuCompletionValues(cpu).map(value => (value as number) >>> 0), [
		0x00000001,
		0x0097004c,
		0x8cdc004c,
		0x00003452,
		0x00008000,
		0x00007fff,
	]);
});
