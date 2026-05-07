import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCompiledLua } from './cpu_test_harness';

function run(source: string) { return runCompiledLua(source, 'interpreter_semantics.lua'); }

test('computes arithmetic and numeric for loop', () => {
	const result = run(`
local total = 0
for i = 1, 5 do
	total = total + i
end
return total
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], 15);
});

test('supports recursive local functions', () => {
	const result = run(`
local function fib(n)
	if n < 2 then
		return n
	end
	return fib(n - 1) + fib(n - 2)
end
return fib(5)
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], 5);
});

test('does not expose later local declarations to earlier closures', () => {
	const result = run(`
local function caller()
	return later
end
local later = 41
return caller()
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], null);
});

test('keeps predeclared locals visible to closures after assignment', () => {
	const result = run(`
local later
local function caller()
	return later
end
later = 41
return caller()
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], 41);
});

test('handles tables, method calls, and boolean logic', () => {
	const result = run(`
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
`);
	assert.equal(result.length, 2);
	assert.equal(result[0], 15);
	assert.equal(result[1], 15);
});

test('supports varargs without runtime library iteration', () => {
	const result = run(`
local function sum_first_four(a, b, ...)
	local c, d = ...
	return a + b + c + d
end
return sum_first_four(1, 2, 3, 4)
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], 10);
});

test('supports goto control flow', () => {
	const result = run(`
local i = 0
::loop::
i = i + 1
if i < 4 then
	goto loop
end
return i
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], 4);
});

test('supports bitwise and floor division operators', () => {
	const result = run('return 0xFF & 0x0F, 0x10 | 0x03, 0x7 ~ 0x4, 8 << 2, -8 >> 1, 7 // 2, ~0');
	assert.equal(result.length, 7);
	assert.equal(result[0], 15);
	assert.equal(result[1], 19);
	assert.equal(result[2], 3);
	assert.equal(result[3], 32);
	assert.equal(result[4], -4);
	assert.equal(result[5], 3);
	assert.equal(result[6], -1);
});
