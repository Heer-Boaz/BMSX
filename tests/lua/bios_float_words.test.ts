import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { StringValue } from '../../machine/ts/machine/cpu/value';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`BIOS float words retain subnormals, signed zero and nearest-even rounding at O${optLevel}`, () => {
		const entrySource = `require('base')
local fields<const> = require('string/pack')
local encode<const> = require('string/float/encode')
local decode<const> = require('string/float/decode')
return function(value, byte_count) return encode(value, byte_count) end,
function(high, low, byte_count) return decode(high, low, byte_count) end,
function(value, byte_count, little)
 local format<const> = (little and '<' or '>') .. (byte_count == 4 and 'f' or 'd')
 local packed<const> = fields.pack(format, value)
 local decoded<const>, position<const> = fields.unpack(format, packed)
 return decoded, position, packed
end`;
		const modules = ['base', 'table', 'string/base', 'string/utf8', 'string/pack', 'string/float/encode', 'string/float/decode'].map(path => {
			const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
			return { path, source, chunk: parseLuaChunk(source, `${path}.lua`) };
		});
		const consoleSource = 'return { write = function() end, end_line = function() end }';
		modules.push({ path: 'tty/console', source: consoleSource, chunk: parseLuaChunk(consoleSource) });
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
			{ entrySource, optLevel, programDomain: 'system' });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
		const [encode, decode, pack] = materializeCpuCompletionValues(cpu) as Closure[];
		const vectors = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
			Infinity, -Infinity, 2 ** -150, -(2 ** -150), 2 ** -149, 3 * 2 ** -150,
			(2 ** 23 - 1) * 2 ** -149, (2 ** 23 - 0.5) * 2 ** -149, 2 ** -126,
			2 ** -1022 - Number.MIN_VALUE, 2 ** -1022, 1, -1, 1 + 2 ** -24,
			1 + 3 * 2 ** -24, 2 - 2 ** -24, 1.5 + 2 ** -52, 2 - 2 ** -52,
			(2 - 2 ** -23) * 2 ** 127, (2 - 2 ** -24) * 2 ** 127];
		const bits = new DataView(new ArrayBuffer(8));
		let random = 0x12345678;
		for (let index = 0; index < 64; index++) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
			bits.setUint32(0, random, true);
			bits.setUint32(4, ((index * 31 % 2047) << 20) | (random & 0x800fffff), true);
			vectors.push(bits.getFloat64(0, true));
		}
		for (const value of vectors) for (const byteCount of [4, 8]) {
			if (byteCount === 4) bits.setFloat32(0, value, true);
			else bits.setFloat64(0, value, true);
			const low = bits.getUint32(0, true), high = bits.getUint32(4, true);
			const words = byteCount === 4 ? [low] : [high, low];
			runCompletionClosure(cpu, encode, [value, byteCount]);
			assert.deepEqual(materializeCpuCompletionValues(cpu), words, `${value}, ${byteCount} bytes`);
			runCompletionClosure(cpu, decode, byteCount === 4 ? [low, 0, 4] : [high, low, 8]);
			const decoded = byteCount === 4 ? bits.getFloat32(0, true) : value;
			assert.deepEqual(materializeCpuCompletionValues(cpu), [decoded]);
			for (const little of [true, false]) {
				const octets = [...new Uint8Array(bits.buffer, 0, byteCount)];
				if (!little) octets.reverse();
				runCompletionClosure(cpu, pack, [value, byteCount, little]);
				const [roundtrip, position, packed] = materializeCpuCompletionValues(cpu);
				assert.deepEqual([roundtrip, position], [decoded, byteCount + 1]);
				assert.equal(cpu.stringPool.toString((packed as StringValue).id), String.fromCharCode(...octets));
			}
		}
		runCompletionClosure(cpu, encode, [NaN, 4]);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [0x7f800001]);
		runCompletionClosure(cpu, encode, [NaN, 8]);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [0x7ff00000, 1]);
	});
}
