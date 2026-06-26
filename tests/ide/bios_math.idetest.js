// Headless IDE test: shipped BIOS math/easing execute as guest Lua globals.
// Run: npm run ide:test -- <gameromname> tests/ide/bios_math.idetest.js

await t.waitForCart();
await t.frames(20);

const results = t.evaluateLua(`
math.randomseed(123)
local seeded_a<const> = math.random(10)
math.randomseed(123)
local seeded_b<const> = math.random(10)
local bad_upper<const> = pcall(function() return math.random(0) end)
local bad_range<const> = pcall(function() return math.random(5, 3) end)
local quarter_turn_radians<const> = (1073741824.25 * (math.pi * 2.0)) / 4294967296.0
return
	math.abs(math.sin(math.pi * 0.5) - 1.0),
	math.abs(math.sin(math.pi / 6.0) - 0.5),
	math.abs(math.cos(math.pi) + 1.0),
	math.abs(math.cos(math.pi / 3.0) - 0.5),
	math.tan(quarter_turn_radians),
	math.abs(math.sqrt(9) - 3.0),
	math.abs(math.exp(0.6931471805599453) - 2.0),
	math.exp(1000),
	math.exp(-1000),
	math.log(-1),
	math.asin(2),
	math.acos(2),
	math.min(4, 2, 9, -1, 3),
	math.max(4, 2, 9, -1, 3),
	math.ult(0, -1),
	math.ult(-1, 0),
	seeded_a == seeded_b,
	bad_upper,
	bad_range,
	easing.linear(1.2),
	easing.ease_in_quad(0.5),
	easing.ease_out_quad(0.5),
	easing.ease_in_out_quad(0.25),
	easing.smoothstep(0.5),
	easing.pingpong01(-0.25),
	easing.arc01(0.5)
`);

const assertClose = (index, expected, tolerance, label) => {
	const delta = Math.abs(results[index] - expected);
	t.assert(delta < tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${results[index]}`);
};
const assertNaN = (index, label) => {
	const value = results[index];
	t.assert(value !== value, `${label}: expected NaN, got ${value}`);
};

assertClose(0, 0, 0.0001, 'sin(pi/2)');
assertClose(1, 0, 0.0001, 'sin(pi/6)');
assertClose(2, 0, 0.0001, 'cos(pi)');
assertClose(3, 0, 0.0001, 'cos(pi/3)');
t.assert(results[4] === Infinity, `tan(pi/2) expected Infinity, got ${results[4]}`);
assertClose(5, 0, 0.0001, 'sqrt(9)');
assertClose(6, 0, 0.0001, 'exp(ln2)');
t.assert(results[7] === Infinity, `exp(1000) expected Infinity, got ${results[7]}`);
t.assert(results[8] === 0, `exp(-1000) expected 0, got ${results[8]}`);
assertNaN(9, 'log(-1)');
assertNaN(10, 'asin(2)');
assertNaN(11, 'acos(2)');
t.assert(results[12] === -1, `min expected -1, got ${results[12]}`);
t.assert(results[13] === 9, `max expected 9, got ${results[13]}`);
t.assert(results[14] === true, `ult(0, -1) expected true, got ${results[14]}`);
t.assert(results[15] === false, `ult(-1, 0) expected false, got ${results[15]}`);
t.assert(results[16] === true, 'randomseed should make math.random deterministic');
t.assert(results[17] === false, 'math.random(0) should fail under pcall');
t.assert(results[18] === false, 'math.random(5, 3) should fail under pcall');
t.assert(results[19] === 1, `easing.linear expected 1, got ${results[19]}`);
assertClose(20, 0.25, 0.000001, 'ease_in_quad');
assertClose(21, 0.75, 0.000001, 'ease_out_quad');
assertClose(22, 0.125, 0.000001, 'ease_in_out_quad');
assertClose(23, 0.5, 0.000001, 'smoothstep');
assertClose(24, 0.25, 0.000001, 'pingpong01');
t.assert(results[25] === 1, `arc01 expected 1, got ${results[25]}`);
