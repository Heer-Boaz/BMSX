import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLuaInterpreter, LuaInterpreter } from '../../src/bmsx/lua/runtime.ts';

function run(source: string): ReturnType<LuaInterpreter['execute']> {
	const interpreter = createLuaInterpreter();
	return interpreter.execute(source, 'chunk');
}

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

test('handles tables, method calls, and boolean logic', () => {
	const interpreter = createLuaInterpreter();
	const result = interpreter.execute(`
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
`, 'chunk');
	assert.equal(result.length, 2);
	assert.equal(result[0], 15);
	assert.equal(result[1], 15);
	const trackerTable = interpreter.getGlobalEnvironment().get('tracker');
	assert.equal(trackerTable, null);
});

test('supports varargs and ipairs iteration', () => {
	const result = run(`
local function sum_and_count(...)
	local args = {...}
	local total = 0
	local count = 0
	for _, value in ipairs(args) do
		total = total + value
		count = count + 1
	end
	return total, count
end
return sum_and_count(1, 2, 3, 4)
`);
	assert.equal(result.length, 2);
	assert.equal(result[0], 10);
	assert.equal(result[1], 4);
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

test('honours metatable length metamethod', () => {
	const result = run(`
local meta = { __len = function(self) return 42 end }
local values = {}
setmetatable(values, meta)
return #values
`);
	assert.equal(result.length, 1);
	assert.equal(result[0], 42);
});

test('math and string standard libraries', () => {
	const result = run(`
math.randomseed(1)
local r1 = math.random()
local r2 = math.random(5)
local r3 = math.random(2, 6)
local upper = string.upper('lua')
local slice = string.sub('abcdef', 2, 4)
local findStart, findEnd = string.find('bmsxlua', 'lua')
return r1, r2, r3, upper, slice, findStart, findEnd
`);
	assert.equal(result.length, 7);
	assert.ok(typeof result[0] === 'number');
	assert.ok(result[0] > 0 && result[0] < 1);
	assert.equal(result[1], 2);
	assert.equal(result[2], 4);
	assert.equal(result[3], 'LUA');
	assert.equal(result[4], 'bcd');
	assert.equal(result[5], 5);
	assert.equal(result[6], 7);
});

test('serialize and deserialize round trip', () => {
	const result = run(`
local data = { value = 12 }
local payload = serialize(data)
local restored = deserialize(payload)
return data.value, restored.value
`);
	assert.equal(result.length, 2);
	assert.equal(result[0], 12);
	assert.equal(result[1], 12);
});
