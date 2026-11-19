import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from '../helpers/cpu_test_harness';

const entrySource = `require('base')
local fields<const> = require('string/pack')
local encode<const> = require('string/float/encode')
local decode<const> = require('string/float/decode')
return function(mode, a, b, c)
 if mode == 0 then return encode(a, b) end
 if mode == 1 then return decode(a, b, c) end
 local format<const> = (c and '<' or '>') .. (b == 4 and 'f' or 'd')
 local packed<const> = fields.pack(format, a)
 local decoded<const>, position<const> = fields.unpack(format, packed)
 return decoded, position, packed
end`;
const modules = ['base', 'number/decimal', 'number/parse', 'table', 'string/base', 'string/mapped',
 'string/pack', 'string/float/encode', 'string/float/decode'].map(path => {
 const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
 return { path, source, chunk: parseLuaChunk(source, `${path}.lua`) };
});
const consoleSource = 'return { write = function() end, end_line = function() end }';
modules.push({ path: 'tty/console', source: consoleSource, chunk: parseLuaChunk(consoleSource) });

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
 test(`BIOS float words O${optLevel} ${backend}: Integer/Float encoding, raw NaNs and exact binary64 narrowing`, () => {
  const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
   { entrySource, optLevel, programDomain: 'system' });
  const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled), backend);
  cpu.installBootPrimitives();
  assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
  const closure = v.asClosure(materializeCpuCompletionValues(cpu)[0], cpu.gc);
  const call = (...args: v.Value[]) => {
   runCompletionClosure(cpu, closure, args);
   return materializeCpuCompletionValues(cpu);
  };
  const bits = new DataView(new ArrayBuffer(8));
  const floatWords = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000, 0x00800001,
   0x3f800000, 0xbf800000, 0x3fc00000, 0x3f800001, 0x4b800000, 0x4effffff,
   0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fc00000, 0xffc00000,
   0x7fa12345, 0xffa12345];
  let random = 0x12345678;
  for (let index = 0; index < 32; index++) {
   random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
   floatWords.push(random);
  }
  const values = [...[-2147483648, -16777217, -1, 0, 1, 16777217, 2147483647].map(v.valueInteger),
   ...floatWords.map(v.valueFloatBits)];
  for (const value of values) for (const byteCount of [4, 8]) {
   const floatNaN = v.valueIsFloat(value) && (v.valuePayload(value) & 0x7fffffff) > 0x7f800000;
   if (byteCount === 4) {
    if (v.valueIsFloat(value)) bits.setUint32(0, v.valuePayload(value), true);
    else bits.setFloat32(0, v.asInteger(value), true);
   } else if (floatNaN) {
    bits.setUint32(0, 0, true); bits.setUint32(4, 0x7ff80000, true);
   } else bits.setFloat64(0, (v.valueIsInteger(value) ? v.asInteger(value) : v.asFloat(value)), true);
   const low = bits.getUint32(0, true), high = bits.getUint32(4, true);
   const words = byteCount === 4 ? [low] : [high, low];
   assert.deepEqual(call(v.valueInteger(0), value, v.valueInteger(byteCount)), words.map(v.valueInteger),
    `encode ${v.valueTag(value)}:${v.valuePayload(value).toString(16)}, ${byteCount} bytes`);
   const roundtrip = byteCount === 4 ? v.valueFloatBits(low) : floatNaN ? v.valueFloatBits(0x7fc00000) : v.valueFloat((v.valueIsInteger(value) ? v.asInteger(value) : v.asFloat(value)));
   assert.deepEqual(call(v.valueInteger(1), v.valueInteger(words[0]), v.valueInteger(byteCount === 4 ? 0 : low), v.valueInteger(byteCount)), [roundtrip]);
   for (const little of [true, false]) {
    const octets = [...new Uint8Array(bits.buffer, 0, byteCount)];
    if (!little) octets.reverse();
    const [decoded, position, packed] = call(v.valueInteger(2), value, v.valueInteger(byteCount), v.valueBool(little));
    assert.deepEqual([decoded, position], [roundtrip, v.valueInteger(byteCount + 1)]);
    assert.equal(cpu.stringPool.bytes(v.asStringId(packed)), String.fromCharCode(...octets));
   }
  }
  // These are external binary64 fields, not binary64 guest Numbers. Include
  // halfway tails at every narrowing boundary, with even and odd retained bits.
  const fields: [number, number][] = [[0, 0], [0x80000000, 0], [0x7ff00000, 0],
   [0xfff00000, 0], [0x7ff00000, 1], [0xfff81234, 0x56789abc], [0x000fffff, 0xffffffff]];
  for (const exponent of [872, 873, 874, 880, 894, 895, 896, 897, 898, 1023, 1150, 1151]) {
   for (const fraction of [0, 1, 0xfffff]) for (const tail of [0, 0x10000000, 0x10000001, 0x30000000, 0xffffffff]) {
    fields.push([(exponent << 20) | fraction, tail]);
   }
  }
  for (let index = 0; index < 64; index++) {
   random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
   fields.push([((index * 31 % 2047) << 20) | (random & 0x800fffff), random]);
  }
  for (const [high, low] of fields) {
   bits.setUint32(0, low, true); bits.setUint32(4, high, true);
   const nan = (high & 0x7fffffff) > 0x7ff00000 || ((high & 0x7fffffff) === 0x7ff00000 && low !== 0);
   const expected = nan ? v.valueFloatBits(0x7fc00000) : v.valueFloat(bits.getFloat64(0, true));
   assert.deepEqual(call(v.valueInteger(1), v.valueInteger(high), v.valueInteger(low), v.valueInteger(8)), [expected],
    `narrow ${high.toString(16)}:${low.toString(16)}`);
  }
 });
}
