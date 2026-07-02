import type { LuaBuiltinDescriptor } from '../../lua/semantic_contracts';

export const DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<LuaBuiltinDescriptor> = [
	{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
	{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
	{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
	{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
	{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
	{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
	{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
	{ name: 'print', params: ['...'], signature: 'print(...)' },
	{ name: 'clock_now', params: [], signature: 'clock_now()', description: 'Returns elapsed BMSX machine time in milliseconds.' },
	{ name: 'rawequal', params: ['v1', 'v2'], signature: 'rawequal(v1, v2)' },
	{ name: 'rawget', params: ['table', 'index'], signature: 'rawget(table, index)' },
	{ name: 'rawset', params: ['table', 'index', 'value'], signature: 'rawset(table, index, value)' },
	{ name: 'select', params: ['index', '...'], signature: 'select(index, ...)' },
	{ name: 'setmetatable', params: ['table', 'metatable'], signature: 'setmetatable(table, metatable)' },
	{ name: 'tonumber', params: ['value', 'base?'], signature: 'tonumber(value [, base])' },
	{ name: 'tostring', params: ['value'], signature: 'tostring(value)' },
	{ name: 'type', params: ['value'], signature: 'type(value)' },
	{ name: 'xpcall', params: ['func', 'msgh', 'arg...'], signature: 'xpcall(f, msgh, ...)' },
	{ name: 'require', params: ['moduleName'], signature: 'require(moduleName)', description: 'Compile-time module import form; not a guest runtime global.' },
	{ name: 'table.concat', params: ['list', 'separator?', 'start?', 'end?'], signature: 'table.concat(list [, sep [, i [, j]]])' },
	{ name: 'table.insert', params: ['list', 'pos?', 'value'], signature: 'table.insert(list [, pos], value)' },
	{ name: 'table.pack', params: ['...'], signature: 'table.pack(...)' },
	{ name: 'table.remove', params: ['list', 'pos?'], signature: 'table.remove(list [, pos])' },
	{ name: 'table.sort', params: ['list', 'comp?'], signature: 'table.sort(list [, comp])' },
	{ name: 'table.unpack', params: ['list', 'i?', 'j?'], signature: 'table.unpack(list [, i [, j]])' },
	{ name: 'math.abs', params: ['x'], signature: 'math.abs(x)' },
	{ name: 'math.acos', params: ['x'], signature: 'math.acos(x)' },
	{ name: 'math.asin', params: ['x'], signature: 'math.asin(x)' },
	{ name: 'math.atan', params: ['y', 'x?'], signature: 'math.atan(y [, x])' },
	{ name: 'math.ceil', params: ['x'], signature: 'math.ceil(x)' },
	{ name: 'math.cos', params: ['x'], signature: 'math.cos(x)' },
	{ name: 'math.deg', params: ['x'], signature: 'math.deg(x)' },
	{ name: 'math.exp', params: ['x'], signature: 'math.exp(x)' },
	{ name: 'math.floor', params: ['x'], signature: 'math.floor(x)' },
	{ name: 'math.fmod', params: ['x', 'y'], signature: 'math.fmod(x, y)' },
	{ name: 'math.log', params: ['x', 'base?'], signature: 'math.log(x [, base])' },
	{ name: 'math.max', params: ['x', '...'], signature: 'math.max(x, ...)' },
	{ name: 'math.min', params: ['x', '...'], signature: 'math.min(x, ...)' },
	{ name: 'math.modf', params: ['x'], signature: 'math.modf(x)' },
	{ name: 'math.sin', params: ['x'], signature: 'math.sin(x)' },
	{ name: 'math.sign', params: ['x'], signature: 'math.sign(x)' },
	{ name: 'math.random', params: ['m?', 'n?'], signature: 'math.random([m [, n]])' },
	{ name: 'math.randomseed', params: ['seed?'], signature: 'math.randomseed([seed])' },
	{ name: 'math.sqrt', params: ['x'], signature: 'math.sqrt(x)' },
	{ name: 'math.rad', params: ['x'], signature: 'math.rad(x)' },
	{ name: 'math.tan', params: ['x'], signature: 'math.tan(x)' },
	{ name: 'math.tointeger', params: ['x'], signature: 'math.tointeger(x)' },
	{ name: 'math.type', params: ['x'], signature: 'math.type(x)' },
	{ name: 'math.ult', params: ['m', 'n'], signature: 'math.ult(m, n)' },
	{ name: 'math.huge', params: [], signature: 'math.huge' },
	{ name: 'math.maxinteger', params: [], signature: 'math.maxinteger' },
	{ name: 'math.mininteger', params: [], signature: 'math.mininteger' },
	{ name: 'easing.linear', params: ['t'], signature: 'easing.linear(t)' },
	{ name: 'easing.ease_in_quad', params: ['t'], signature: 'easing.ease_in_quad(t)' },
	{ name: 'easing.ease_out_quad', params: ['t'], signature: 'easing.ease_out_quad(t)' },
	{ name: 'easing.ease_in_out_quad', params: ['t'], signature: 'easing.ease_in_out_quad(t)' },
	{ name: 'easing.ease_out_back', params: ['t'], signature: 'easing.ease_out_back(t)' },
	{ name: 'easing.smoothstep', params: ['t'], signature: 'easing.smoothstep(t)' },
	{ name: 'easing.pingpong01', params: ['t'], signature: 'easing.pingpong01(t)' },
	{ name: 'easing.arc01', params: ['t'], signature: 'easing.arc01(t)' },
	{ name: 'string.byte', params: ['s', 'i?'], signature: 'string.byte(s [, i])' },
	{ name: 'string.char', params: ['...'], signature: 'string.char(...)' },
	{ name: 'string.find', params: ['s', 'pattern', 'init?'], signature: 'string.find(s, pattern [, init])' },
	{ name: 'string.match', params: ['s', 'pattern', 'init?'], signature: 'string.match(s, pattern [, init])' },
	{ name: 'string.gsub', params: ['s', 'pattern', 'repl', 'n?'], signature: 'string.gsub(s, pattern, repl [, n])' },
	{ name: 'string.gmatch', params: ['s', 'pattern'], signature: 'string.gmatch(s, pattern)' },
	{ name: 'string.format', params: ['format', '...'], signature: 'string.format(format, ...)' },
	{ name: 'string.pack', params: ['format', '...'], signature: 'string.pack(format, ...)' },
	{ name: 'string.packsize', params: ['format'], signature: 'string.packsize(format)' },
	{ name: 'string.unpack', params: ['format', 's', 'pos?'], signature: 'string.unpack(format, s [, pos])' },
	{ name: 'string.len', params: ['s'], signature: 'string.len(s)' },
	{ name: 'string.lower', params: ['s'], signature: 'string.lower(s)' },
	{ name: 'string.rep', params: ['s', 'n?', 'sep?'], signature: 'string.rep(s [, n [, sep]])' },
	{ name: 'string.reverse', params: ['s'], signature: 'string.reverse(s)' },
	{ name: 'string.sub', params: ['s', 'i', 'j?'], signature: 'string.sub(s, i [, j])' },
	{ name: 'string.upper', params: ['s'], signature: 'string.upper(s)' },
	{ name: 'os.clock', params: [], signature: 'os.clock()', description: 'Returns elapsed BMSX machine time in seconds.' },
	{ name: 'os.date', params: ['format?', 'time?'], signature: 'os.date([format [, time]])', description: 'Formats the supplied timestamp, or elapsed BMSX machine time when omitted, using BMSX civil time.' },
	{ name: 'os.difftime', params: ['t2', 't1'], signature: 'os.difftime(t2, t1)' },
	{ name: 'os.time', params: ['table?'], signature: 'os.time([table])', description: 'Converts a BMSX civil-time date table, or returns elapsed BMSX machine time in seconds when omitted.' },
	{ name: 'mem', params: ['addr'], signature: 'mem[addr]', description: 'Reserved memory-mapped 32-bit word space for direct `mem[addr]` reads/writes. Not a first-class Lua value. Invalid or read-only writes raise a fault.' },
	{ name: 'mem8', params: ['addr'], signature: 'mem8[addr]', description: 'Reserved memory-mapped byte space for direct `mem8[addr]` reads/writes. Not a first-class Lua value.' },
	{ name: 'mem16le', params: ['addr'], signature: 'mem16le[addr]', description: 'Reserved memory-mapped little-endian 16-bit space for direct `mem16le[addr]` reads/writes. Not a first-class Lua value.' },
	{ name: 'mem32le', params: ['addr'], signature: 'mem32le[addr]', description: 'Reserved memory-mapped little-endian 32-bit space for direct `mem32le[addr]` reads/writes. Not a first-class Lua value.' },
	{ name: 'memf32le', params: ['addr'], signature: 'memf32le[addr]', description: 'Reserved memory-mapped little-endian 32-bit float space for direct `memf32le[addr]` reads/writes. Not a first-class Lua value. Invalid or read-only writes raise a fault.' },
	{ name: 'memf64le', params: ['addr'], signature: 'memf64le[addr]', description: 'Reserved memory-mapped little-endian 64-bit float space for direct `memf64le[addr]` reads/writes. Not a first-class Lua value. Invalid or read-only writes raise a fault.' },
];

const DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS = [
	'package',
	'math.pi',
];

export const DEFAULT_LUA_BUILTIN_NAMES: ReadonlyArray<string> = (() => {
	const names = new Set<string>();
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = DEFAULT_LUA_BUILTIN_FUNCTIONS[index].name;
		names.add(name);
		const dot = name.indexOf('.');
		if (dot !== -1) {
			names.add(name.slice(0, dot));
		}
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS.length; index += 1) {
		names.add(DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS[index]);
	}
	return Array.from(names);
})();
