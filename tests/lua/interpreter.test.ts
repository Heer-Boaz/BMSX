import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCompiledLua } from './cpu_test_harness';

const INTERPRETER_SEMANTICS_PATH = 'interpreter_semantics.lua';

test('computes arithmetic and numeric for loop', () => {
	const result = runCompiledLua(`
local total = 0
for i = 1, 5 do
	total = total + i
end
return total
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 1);
	assert.equal(result[0], 15);
});

test('supports recursive local functions', () => {
	const result = runCompiledLua(`
local function fib(n)
	if n < 2 then
		return n
	end
	return fib(n - 1) + fib(n - 2)
end
return fib(5)
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 1);
	assert.equal(result[0], 5);
});

test('does not expose later local declarations to earlier closures', () => {
	const result = runCompiledLua(`
local function caller()
	return later
end
local later = 41
return caller()
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 1);
	assert.equal(result[0], null);
});

test('keeps predeclared locals visible to closures after assignment', () => {
	const result = runCompiledLua(`
local later
local function caller()
	return later
end
later = 41
return caller()
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 1);
	assert.equal(result[0], 41);
});

test('handles tables, method calls, and boolean logic', () => {
	const result = runCompiledLua(`
local tracker = { total = 10 }
function tracker:add(value)
	if not self.total then
		self.total = 0
	end
	self.total = self.total + value
	return self.total
end
local current = tracker:add(5)
return tracker.total, current
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 2);
	assert.equal(result[0], 15);
	assert.equal(result[1], 15);
});

test('supports varargs without runtime library iteration', () => {
	const result = runCompiledLua(`
local function sum_first_four(a, b, ...)
	local c, d = ...
	return a + b + c + d
end
return sum_first_four(1, 2, 3, 4)
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 1);
	assert.equal(result[0], 10);
});

test('supports goto control flow', () => {
	const result = runCompiledLua(`
local i = 0
::loop::
i = i + 1
if i < 4 then
	goto loop
end
return i
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 1);
	assert.equal(result[0], 4);
});

test('supports bitwise and floor division operators', () => {
	const result = runCompiledLua('return 0xFF & 0x0F, 0x10 | 0x03, 0x7 ~ 0x4, 8 << 2, -8 >> 1, 7 // 2, ~0', INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 7);
	assert.equal(result[0], 15);
	assert.equal(result[1], 19);
	assert.equal(result[2], 3);
	assert.equal(result[3], 32);
	assert.equal(result[4], -4);
	assert.equal(result[5], 3);
	assert.equal(result[6], -1);
});

test('string ordering compares lexicographically', () => {
	const result = runCompiledLua(`
local values = { 'apple', 'banana' }
return values[1] < values[2], values[2] < values[1], values[1] <= 'apple'
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 3);
	assert.equal(result[0], true);
	assert.equal(result[1], false);
	assert.equal(result[2], true);
});

test('passes no stale arguments to zero-argument closure calls', () => {
	const result = runCompiledLua(`
local function optional(value)
	return value == nil
end
local module = { optional = optional }
return module.optional(), optional()
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 2);
	assert.equal(result[0], true);
	assert.equal(result[1], true);
});

test('open varargs do not expose stale frame top values', () => {
	const result = runCompiledLua(`
local function take(a, ...)
	return a, ...
end
local function pass(...)
	local scratch0, scratch1, scratch2 = 1, 2, 3
	local first, second, third = take(...)
	return first, second == nil, third == nil, scratch0 + scratch1 + scratch2
end
return pass(22)
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 4);
	assert.equal(result[0], 22);
	assert.equal(result[1], true);
	assert.equal(result[2], true);
	assert.equal(result[3], 6);
});

test('multi-expression returns preserve trailing open vararg nil slots', () => {
	const result = runCompiledLua(`
local function take(a, ...)
	return a, ...
end
return take(0, 11, nil, 7)
`, INTERPRETER_SEMANTICS_PATH);
	assert.equal(result.length, 4);
	assert.equal(result[0], 0);
	assert.equal(result[1], 11);
	assert.equal(result[2], null);
	assert.equal(result[3], 7);
});
