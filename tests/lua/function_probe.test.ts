import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindFunctionProbe } from '../../ide/runtime/function_probe';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { blua32SourceRangeAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { compileLuaSource } from './cpu_test_harness';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';

for (const optLevel of [0, 3] as const) test(`function-entry observation binds original argument slots and inlined instruction sites (O${optLevel})`, () => {
	const compiled = compileLuaSource(`
local mix<const> = function(left, right)
  local shifted<const> = right << 3
  local combined<const> = left ~ shifted
  return combined + 17
end
local run<const> = function(value)
  local first<const> = mix(value, value + 3)
  return mix(first, first + 5)
end
local value = 11
for index = 1, 4 do value = run(value) end
return value`, 'observer.lua', optLevel);
	const linked = linkTestSystemBlua32(compiled), { cpu } = createTestSystemCpu(linked);
	const image = { layout: linked.image, symbols: linked.symbols };
	// The inline case observes entries without requiring optimized-away parameter copies.
	const binding = bindFunctionProbe(image, 'observer', 'mix', optLevel === 0 ? [0, 1] : []);
	assert.equal(binding.status, 'bound');
	if (optLevel === 3) assert.ok(binding.points.length > 1, 'the fixture actually includes inlined entry locations');
	const locations = new Map(binding.points.map(point => [point.pc, point.registers]));
	const seen: number[][] = [];
	cpu.setInstructionObserver({ points: [new Set(locations.keys()), new Set(), new Set()], observe(domain, pc, registers) {
		assert.equal(domain, -1);
		seen.push(locations.get(pc)!.map(slot => registers.getNumber(slot)));
	} });
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	let value = 11;
	const expected = [];
	for (let i = 0; i < 4; i++) for (const increment of [3, 5]) {
		const right = value + increment;
		expected.push([value, right]); value = (value ^ (right << 3)) + 17;
	}
	if (optLevel === 0) assert.deepEqual(seen, expected);
	else assert.equal(seen.length, expected.length);
	assert.equal(bindFunctionProbe({ layout: linked.image, symbols: null }, 'observer', 'mix', [0]).status, 'symbols-unavailable');
	assert.equal(bindFunctionProbe({ layout: linked.image, symbols: linked.symbols }, 'observer', 'absent', []).status, 'function-unavailable');
	assert.equal(bindFunctionProbe({ layout: linked.image, symbols: linked.symbols }, 'observer', 'mix', [9]).status, 'arguments-unavailable');
});

for (const optLevel of [0, 3] as const) test(`physical registration entry observation distinguishes same-id source calls (O${optLevel})`, () => {
	const source = `local scenes = {}
local definitions = {}
function scenes.register(id, definition)
  definitions[id] = definition
end
function register_first() scenes.register('same', { value = 1 }) end function register_second() scenes.register('same', { value = 2 }) end
register_first()
register_second()
return definitions`;
	const linked = linkTestSystemBlua32(compileLuaSource(source, 'registrations.lua', optLevel));
	const { cpu } = createTestSystemCpu(linked), image = { layout: linked.image, symbols: linked.symbols };
	const binding = bindFunctionProbe(image, 'registrations', 'scenes.register', [0, 1]);
	assert.ok(binding.status === 'bound');
	const locations = new Map(binding.points.map(point => [point.pc, point.registers]));
	const observed: { id: string; call: string }[] = [], lines = source.split('\n');
	cpu.setInstructionObserver({ points: [new Set(locations.keys()), new Set(), new Set()], observe(_domain, pc, registers) {
		const depth = cpu.getFrameDepth();
		const callerPc = cpu.readFrameCallSitePc(depth - 1);
		const range = blua32SourceRangeAtPc(image.symbols, image.layout.header.textAddress, callerPc);
		assert.ok(range !== null && range.path === 'registrations.lua');
		assert.equal(range.start.line, range.end.line);
		observed.push({ id: cpu.stringPool.toString(registers.getStringId(locations.get(pc)![0])),
			call: lines[range.start.line - 1].slice(range.start.column - 1, range.end.column) });
	} });
	try { assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted); }
	finally { cpu.setInstructionObserver(null); }
	assert.deepEqual(observed, [
		{ id: 'same', call: "scenes.register('same', { value = 1 })" },
		{ id: 'same', call: "scenes.register('same', { value = 2 })" },
	]);
});
