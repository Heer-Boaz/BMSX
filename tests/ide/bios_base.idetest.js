// Headless IDE test: BIOS base library functions execute as guest Lua.

const okValues = t.evaluateLua(`
return assert(0, 'kept', nil, 7)
`);
t.assert(okValues.length === 4, `assert should return all success values, got length ${okValues.length}`);
t.assert(okValues[0] === 0, `assert should return the truthy condition, got ${okValues[0]}`);
t.assert(okValues[1] === 'kept', `assert should return the second argument, got ${okValues[1]}`);
t.assert(okValues[2] === null, `assert should preserve nil vararg slots, got ${okValues[2]}`);
t.assert(okValues[3] === 7, `assert should return later varargs after nil, got ${okValues[3]}`);

const failure = t.evaluateLua(`
local ok<const>, message<const> = pcall(function() assert(false, 'bios assert failed') end)
return ok, message
`);
t.assert(failure[0] === false, 'assert(false, message) should fail under pcall');
t.assert(failure[1] === 'bios assert failed', `assert failure message mismatch: ${failure[1]}`);

const rawEqualValues = t.evaluateLua(`
local shared<const> = {}
return rawequal(shared, shared), rawequal({}, {}), rawequal(12, 12), rawequal('x', 'x'), rawequal(nil, false)
`);
t.assert(rawEqualValues[0] === true, 'rawequal should accept identical table references');
t.assert(rawEqualValues[1] === false, 'rawequal should reject distinct tables');
t.assert(rawEqualValues[2] === true, 'rawequal should compare equal numbers');
t.assert(rawEqualValues[3] === true, 'rawequal should compare equal interned strings');
t.assert(rawEqualValues[4] === false, 'rawequal should reject nil/false');

const textValues = t.evaluateLua(`
local target<const> = {}
return tostring(nil), tostring(true), tostring(false), tostring(12.5), tostring('abc'), tostring(target), tostring(function() end)
`);
t.assert(textValues[0] === 'nil', `tostring nil mismatch: ${textValues[0]}`);
t.assert(textValues[1] === 'true', `tostring true mismatch: ${textValues[1]}`);
t.assert(textValues[2] === 'false', `tostring false mismatch: ${textValues[2]}`);
t.assert(textValues[3] === '12.5', `tostring number mismatch: ${textValues[3]}`);
t.assert(textValues[4] === 'abc', `tostring string mismatch: ${textValues[4]}`);
t.assert(textValues[5] === 'table', `tostring table mismatch: ${textValues[5]}`);
t.assert(textValues[6] === 'function', `tostring function mismatch: ${textValues[6]}`);

const numberValues = t.evaluateLua(`
local number_with_base_ok<const> = pcall(function() return tonumber(12, 10) end)
local fractional_base_ok<const> = pcall(function() return tonumber('10', 2.5) end)
local out_of_range_base_ok<const> = pcall(function() return tonumber('10', 37) end)
return tonumber(12.5), tonumber('  -12.5e1  '), tonumber('.25'), tonumber('ff', 16), tonumber('-101', 2), tonumber('0x10'), tonumber('-0Xf'), tonumber('12x'), tonumber(''), tonumber(true), number_with_base_ok, fractional_base_ok, out_of_range_base_ok
`);
t.assert(numberValues[0] === 12.5, `tonumber should return numeric values unchanged: ${numberValues[0]}`);
t.assert(numberValues[1] === -125, `tonumber decimal/exponent parse mismatch: ${numberValues[1]}`);
t.assert(numberValues[2] === 0.25, `tonumber fractional parse mismatch: ${numberValues[2]}`);
t.assert(numberValues[3] === 255, `tonumber base-16 parse mismatch: ${numberValues[3]}`);
t.assert(numberValues[4] === -5, `tonumber base-2 parse mismatch: ${numberValues[4]}`);
t.assert(numberValues[5] === 16, `tonumber hex-prefix parse mismatch: ${numberValues[5]}`);
t.assert(numberValues[6] === -15, `tonumber signed hex-prefix parse mismatch: ${numberValues[6]}`);
t.assert(numberValues[7] === null, `tonumber should reject trailing junk: ${numberValues[7]}`);
t.assert(numberValues[8] === null, `tonumber should reject an empty string: ${numberValues[8]}`);
t.assert(numberValues[9] === null, `tonumber should reject non-number/non-string values: ${numberValues[9]}`);
t.assert(numberValues[10] === false, 'tonumber with explicit base should require a string input');
t.assert(numberValues[11] === false, 'tonumber should reject fractional bases');
t.assert(numberValues[12] === false, 'tonumber should reject bases outside 2..36');

const runtime = bmsx.ide.getRuntime();
const printStart = runtime.luaOutputLines.length;
t.evaluateLua("print('bios', nil, 7)");
const printed = runtime.luaOutputLines.slice(printStart);
t.assert(printed[0] === 'bios\tnil\t7', `print should format through BIOS Lua and publish one host line, got ${printed[0]}`);
t.evaluateLua("print('é')");
t.assert(runtime.luaOutputLines[printStart + 1] === 'é', `print should preserve non-ASCII codepoints through MMIO, got ${runtime.luaOutputLines[printStart + 1]}`);

const ipairsValues = t.evaluateLua(`
local values<const> = { 'first', 'second', nil, 'ignored' }
local seen<const> = {}
for index, value in ipairs(values) do
	seen[#seen + 1] = index .. ':' .. value
end
return seen[1], seen[2], seen[3]
`);
t.assert(ipairsValues[0] === '1:first', `ipairs first entry mismatch: ${ipairsValues[0]}`);
t.assert(ipairsValues[1] === '2:second', `ipairs second entry mismatch: ${ipairsValues[1]}`);
t.assert(ipairsValues[2] === null, `ipairs should stop at the first nil slot, got ${ipairsValues[2]}`);

const pairsValues = t.evaluateLua(`
local values<const> = { [1] = 11, [true] = 22, [false] = 33 }
local count = 0
local sum = 0
for key, value in pairs(values) do
	count = count + 1
	sum = sum + value
end
local invalid_ok<const> = pcall(function()
	for key in pairs(7) do
		return key
	end
end)
return count, sum, invalid_ok
`);
t.assert(pairsValues[0] === 3, `pairs should visit all keys, got count ${pairsValues[0]}`);
t.assert(pairsValues[1] === 66, `pairs value sum mismatch: ${pairsValues[1]}`);
t.assert(pairsValues[2] === false, 'pairs should reject non-table/non-native values when iterated');

const nextValues = t.evaluateLua(`
local values<const> = { 41 }
local ok<const>, key<const>, value<const> = pcall(next, values, nil)
return type(next), ok, key, value, rawequal(next, pairs(values))
`);
t.assert(nextValues[0] === 'function', `next should be a first-class function, got ${nextValues[0]}`);
t.assert(nextValues[1] === true, 'pcall(next, table) should execute through the BIOS base function');
t.assert(nextValues[2] === 1, `next key mismatch: ${nextValues[2]}`);
t.assert(nextValues[3] === 41, `next value mismatch: ${nextValues[3]}`);
t.assert(nextValues[4] === true, 'pairs should return the global BIOS next function');

const devtoolsGlobal = runtime.machine.cpu.getGlobalByKey(runtime.internString('devtools'));
const cartProjectRootPathGlobal = runtime.machine.cpu.getGlobalByKey(runtime.internString('cart_project_root_path'));
t.assert(devtoolsGlobal === null, 'devtools must not be a guest CPU global');
t.assert(cartProjectRootPathGlobal === null, 'host project paths must not be guest CPU globals');

const primitiveValues = t.evaluateLua(`
local target<const> = {}
local meta<const> = { tag = 'meta' }
local set_result<const> = setmetatable(target, meta)
rawset(target, 'x', 42)
local select_a<const>, select_b<const> = select(2, 'drop', 'keep', 'tail')
local xpcall_ok<const>, xpcall_value<const> = xpcall(function() error('xerr') end, function(message) return 'handled:' .. message end)
local error_ok<const>, error_value<const> = pcall(error, 'vm-error')
return type(type), type(rawget), type(rawset), type(setmetatable), type(getmetatable), type(select), type(error),
	rawequal(set_result, target), rawequal(getmetatable(target), meta), rawget(target, 'x'), select('#', 1, nil, 3), select_a, select_b
	, xpcall_ok, xpcall_value, error_ok, error_value
`);
t.assert(primitiveValues[0] === 'function', `type should be a BIOS base function, got ${primitiveValues[0]}`);
t.assert(primitiveValues[1] === 'function', `rawget should be a BIOS base function, got ${primitiveValues[1]}`);
t.assert(primitiveValues[2] === 'function', `rawset should be a BIOS base function, got ${primitiveValues[2]}`);
t.assert(primitiveValues[3] === 'function', `setmetatable should be a BIOS base function, got ${primitiveValues[3]}`);
t.assert(primitiveValues[4] === 'function', `getmetatable should be a BIOS base function, got ${primitiveValues[4]}`);
t.assert(primitiveValues[5] === 'function', `select should be a BIOS base function, got ${primitiveValues[5]}`);
t.assert(primitiveValues[6] === 'function', `error should be a BIOS base function, got ${primitiveValues[6]}`);
t.assert(primitiveValues[7] === true, 'setmetatable should return the target table');
t.assert(primitiveValues[8] === true, 'getmetatable should return the assigned metatable');
t.assert(primitiveValues[9] === 42, `rawget/rawset mismatch: ${primitiveValues[9]}`);
t.assert(primitiveValues[10] === 3, `select('#', ...) should count varargs, got ${primitiveValues[10]}`);
t.assert(primitiveValues[11] === 'keep', `select(2, ...) first result mismatch: ${primitiveValues[11]}`);
t.assert(primitiveValues[12] === 'tail', `select(2, ...) second result mismatch: ${primitiveValues[12]}`);
t.assert(primitiveValues[13] === false, 'xpcall should report the protected call failure');
t.assert(primitiveValues[14] === 'handled:xerr', `xpcall should run the message handler, got ${primitiveValues[14]}`);
t.assert(primitiveValues[15] === false, 'pcall(error, message) should fail through the BIOS base function');
t.assert(primitiveValues[16] === 'vm-error', `pcall(error, message) should preserve the thrown value, got ${primitiveValues[16]}`);

[
	['__bmsx_next', 'must be cleared after BIOS boot'],
	['__bmsx_type', 'must be cleared after BIOS boot'],
	['__bmsx_string_byte', 'must be cleared after BIOS boot'],
	['__bmsx_error', 'must be cleared after BIOS boot'],
	['require', 'must not be a guest Lua global'],
	['load', 'must not be a guest Lua global'],
	['loadstring', 'must not be a guest Lua global'],
	['cart_manifest', 'must not be a guest CPU global'],
	['machine_manifest', 'must not be a guest CPU global'],
	['sys_boot_cart', 'must not be a guest CPU global'],
	['sys_vdp_screen_wh', 'must not be a guest CPU global'],
	['sys_img_ctrl', 'must not be a guest CPU global'],
	['img_ctrl_start', 'must not be a guest CPU global'],
].forEach(([name, expectation]) => {
	const value = runtime.machine.cpu.getGlobalByKey(runtime.internString(name));
	t.assert(value === null, `${name} ${expectation}`);
});

const rawMachineValues = t.evaluateLua(`
local screen_wh<const> = mem[0x08000088]
return mem[0x08000084],
	screen_wh & 0xffff,
	screen_wh >> 16
`);
t.assert(rawMachineValues[0] === 2, `bare_metal_cart should boot VDP mode 2, got ${rawMachineValues[0]}`);
t.assert(rawMachineValues[1] === 320, `sys_vdp_screen_wh width should derive from mode 2, got ${rawMachineValues[1]}`);
t.assert(rawMachineValues[2] === 240, `sys_vdp_screen_wh height should derive from mode 2, got ${rawMachineValues[2]}`);
