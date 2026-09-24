import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaSource, materializeCpuCompletionValues, runCompiledLua } from './cpu_test_harness';

const cases: { name: string; source: string; expected: (number | boolean)[] }[] = [
	{
		name: 'nested type does not replace its outer layout',
		source: `struct shape
	value: word
end
local before<const> = sizeof(shape)
local nested = function(...)
	struct shape
		value: word[3]
	end
	return sizeof(shape)
end
return before, nested(), sizeof(shape)`,
		expected: [4, 12, 4],
	},
	{
		name: 'first nested use resolves fields in their declaration context',
		source: `local n<const> = 2
struct item
	values: word[n]
end
struct shape
	item: item
	last: word
end
local nested = function(...)
	local n<const> = 7
	struct item
		values: word[5]
	end
	return sizeof(shape), offsetof(shape.last), sizeof(item)
end
return nested()`,
		expected: [12, 8, 20],
	},
	{
		name: 'disjoint block types retain distinct fields and restore outer lookup',
		source: `struct item
	x: word
end
local a, b
do
	struct item
		x: word[2]
		last: word
	end
	a = sizeof(item) + offsetof(item.last)
end
do
	struct item
		x: word[4]
	end
	b = sizeof(item)
end
return a, b, sizeof(item)`,
		expected: [20, 16, 4],
	},
	{
		name: 'nested block forward types use that block rather than the outer declaration',
		source: `struct child
	x: word[7]
end
local size
do
	struct parent
		child: child
	end
	struct child
		x: word[2]
	end
	size = sizeof(parent)
end
return size, sizeof(child)`,
		expected: [8, 28],
	},
	{
		name: 'forward layout dependencies retain the defining constants',
		source: `struct parent
	child: child
end
local n<const> = 3
struct child
	x: word[n]
end
local nested = function(...)
	local n<const> = 9
	return sizeof(parent)
end
return nested(), sizeof(parent)`,
		expected: [12, 12],
	},
	{
		name: 'loop and branch type scopes do not leak into siblings',
		source: `local a, b, c = 0, 0, 0
for i = 1, 2 do
	struct record
		x: word[2]
	end
	a += sizeof(record)
end
if a == 16 then
	struct record
		x: word[3]
	end
	b = sizeof(record)
else
	struct record
		x: word[4]
	end
	b = sizeof(record)
end
repeat
	struct record
		x: word[5]
	end
	c = sizeof(record)
until c == sizeof(record)
return a, b, c`,
		expected: [16, 12, 20],
	},
	{
		name: 'array dimensions share static source constants without runtime captures',
		source: `local n<const> = (2 < 3 and 2 or 7) + 1
local label<const> = 'abc'
struct record
	x: word[n]
	y: word[#label]
end
local nested = function(...)
	local n<const> = 9
	return sizeof(record), offsetof(record.y)
end
return nested()`,
		expected: [24, 12],
	},
	{
		name: 'dimension sizeof and offsetof resolve at the type declaration',
		source: `struct item
	x: word
	y: word[2]
end
local stride<const> = sizeof(item) / 4
struct record
	x: word[stride]
	y: word[offsetof(item.y)]
end
local nested = function(...)
	struct item
		x: word[9]
		y: word
	end
	return sizeof(record), offsetof(record.y)
end
return nested()`,
		expected: [28, 12],
	},
	{
		name: 'later constant shadows cannot change an earlier field dimension',
		source: `local n<const> = 2
struct record
	x: word[n]
end
local n<const> = 7
local nested = function(...) return sizeof(record) end
return nested(), sizeof(word[n])`,
		expected: [8, 28],
	},
	{
		name: 'static array dimensions read declared outer lengths and inferred initializer counts',
		source: `bss counted: word[2][3]
data initialized: word[] = { 11, 12, 13 }
rodata frozen: word[] = { 21, 22, 23, 24 }
local n<const> = #counted + #initialized + #frozen
struct record
	x: word[n]
end
local nested = function(...)
	bss counted: word[8]
	return sizeof(record), #counted
end
return nested()`,
		expected: [36, 8],
	},
	{
		name: 'explicit nil and false constant lanes preserve short circuit values',
		source: `local absent<const> = nil
local first<const>, missing<const> = false, nil
local n<const> = (absent or 2) + (missing or 3) + (first and 99 or 4)
struct record
	x: word[n]
end
return sizeof(record)`,
		expected: [36],
	},
	{
		name: 'literal operations retain tagged constant semantics in dimensions',
		source: `local label<const> = 'é' .. 7
local n<const> = #label + ((not nil and 2 >= 2 and 'a' < 'b') and 1 or 9)
local bits<const> = ((~0 & 7) ~ 2) | 2
return sizeof(word[n]), sizeof(word[bits]), sizeof(word[(false ~= nil and 3 == 3) and 2 or 7])`,
		expected: [12, 28, 8],
	},
];

for (const optLevel of [0, 3] as const) for (const { name, source, expected } of cases) {
	test(`O${optLevel}: ${name}`, () => {
		assert.deepEqual(runCompiledLua(source, 'scoped_types', optLevel), expected);
	});
}

for (const optLevel of [0, 3] as const) for (const section of ['bss', 'data', 'rodata'] as const) {
	test(`O${optLevel}: ${section} cells use each scope's layout, not the last struct spelling`, () => {
		const source = `struct shape
	first: word
	last: word
end
${section} outer: shape${section === 'bss' ? '' : ' = { first = 11, last = 12 }'}
local nested = function(...)
	struct shape
		padding: word[3]
		last: word
	end
	${section} inner: shape${section === 'bss' ? '' : ' = { padding = { 21, 22, 23 }, last = 24 }'}
	${section === 'bss' ? 'inner.last = 24' : ''}
	return inner.last, &inner.last - inner
end
${section === 'bss' ? 'outer.first = 11; outer.last = 12' : ''}
local pointer: *shape = outer
local x, offset = nested()
return pointer.first, pointer.last, x, offset, sizeof(shape), offsetof(shape.last)`;
		assert.deepEqual(runCompiledLua(source, 'scoped_storage', optLevel), [11, 12, 24, 12, 8, 4]);
	});
}

for (const optLevel of [0, 3] as const) test(`O${optLevel}: module and global type resolution are independent of code generation order`, () => {
	const source = `local first<const> = require('a_first')
local second<const> = require('z_second')
return first.size(), second.size(), sizeof(published)`;
	const modules = [
		{ path: 'a_first', source: `module<const>
local n<const> = 2
struct record
	x: word[n]
end
local size<const> = function() return sizeof(record), sizeof(published) end
return { size = size }` },
		{ path: 'z_second', source: `module<const>
local n<const> = 3
struct record
	x: word[n]
end
struct published
	x: word[n + 1]
end
local size<const> = function() return sizeof(record) end
return { size = size }` },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path).chunk }));
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'entry').chunk, modules, {
		entrySource: source, programDomain: 'system', optLevel,
	});
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [8, 12, 16]);
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: block types are not published outside their lexical scope`, () => {
	assert.throws(() => compileLuaSource(`do
	struct private
		x: word
	end
end
return sizeof(private)`, 'private_type', optLevel), /Unknown struct type 'private'/);
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: field dimensions use imports and static exports from the declaring file`, () => {
	const source = `local types<const> = require('types')
local limits<const> = require('other_limits')
return types.size(), sizeof(published), limits.count`;
	const modules = [
		{ path: 'types', source: `module<const>
local limits<const> = require('limits')
local nested<const> = limits.nested
struct published
	x: word[nested['count']]
	y: word[#limits.cells]
end
local size<const> = function(...) return sizeof(published) end
return { size = size }` },
		{ path: 'limits', source: `module<const>
rodata cells: word[] = { 11, 12, 13, 14 }
return { nested = { count = 3 }, cells = cells }` },
		{ path: 'other_limits', source: 'module<const>\nreturn { count = 9 }' },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path).chunk }));
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'entry').chunk, modules, {
		entrySource: source, programDomain: 'system', optLevel,
	});
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [28, 28, 9]);
});

for (const initializer of [
	'local dynamic = function(...) return 2, 3 end; local n<const> = dynamic()',
	'local dynamic = function(...) return 2, 3 end; local first<const>, n<const> = dynamic()',
	'local n = 2',
	'local n<const> = 0',
	'local n<const> = 1.5',
]) test(`nonconstant or invalid dimensions are not repaired: ${initializer}`, () => {
	for (const optLevel of [0, 3] as const) {
		assert.throws(() => compileLuaSource(`${initializer}\nreturn sizeof(word[n or 7])`, 'dynamic_dimension', optLevel),
			/Struct array length must be a positive compile-time integer/);
	}
});

for (const comparison of ['1 == limits.cells', 'limits.cells == 1', '1 ~= limits.cells', 'limits.cells ~= 1']) {
	test(`relocated values are not compared as literal tags: ${comparison}`, () => {
		const source = `local limits<const> = require('limits')\nreturn sizeof(word[(${comparison}) and 2 or 3])`;
		const moduleSource = 'module<const>\nbss cells: word[2]\nreturn { cells = cells }';
		for (const optLevel of [0, 3] as const) {
			assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(source, 'entry').chunk, [{
				path: 'limits', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'limits').chunk,
			}], { entrySource: source, programDomain: 'system', optLevel }), /Struct array length must be a positive compile-time integer/);
		}
	});
}

for (const source of [
	'struct recursive\n\tx: recursive\nend\nreturn sizeof(recursive)',
	'struct recursive\n\tx: word[sizeof(recursive)]\nend\nreturn sizeof(recursive)',
]) test('recursive layouts fail through declaration identity, including sizeof in a dimension', () => {
	assert.throws(() => compileLuaSource(source, 'recursive_type'), /Recursive struct layout 'recursive'/);
});
