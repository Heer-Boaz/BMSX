import type { LuaBuiltinDescriptor } from './semantic_contracts';

const LUA_BUILTIN_DESCRIPTOR_LOOKUPS = new WeakMap<
	readonly LuaBuiltinDescriptor[],
	ReadonlyMap<string, LuaBuiltinDescriptor>
>();

export function getLuaBuiltinDescriptorLookup(
	descriptors: readonly LuaBuiltinDescriptor[],
): ReadonlyMap<string, LuaBuiltinDescriptor> {
	const retained = LUA_BUILTIN_DESCRIPTOR_LOOKUPS.get(descriptors);
	if (retained) {
		return retained;
	}
	const lookup = new Map<string, LuaBuiltinDescriptor>();
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		lookup.set(descriptor.name, descriptor);
	}
	LUA_BUILTIN_DESCRIPTOR_LOOKUPS.set(descriptors, lookup);
	return lookup;
}

export const LUA_BUILTIN_TABLE_ITERATOR_ARGUMENTS: Readonly<Record<string, number | undefined>> = {
	ipairs: 0,
	pairs: 0,
};

export const DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<LuaBuiltinDescriptor> = [
	{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
	{ name: 'collectgarbage', params: ['option?'], signature: 'collectgarbage([option])' },
	{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
	{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
	{ name: 'getglobal', params: ['name'], signature: 'getglobal(name)', description: 'Reads a live ordinary global register by name, not a Terminal variable or system register.' },
	{ name: 'setglobal', params: ['name', 'value'], signature: 'setglobal(name, value)', description: 'Writes a live ordinary global register by name. Mutations are not rolled back on error.' },
	{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
	{ name: 'load', params: ['chunk', 'chunkname?', 'mode?', 'env?'], signature: 'load(chunk [, chunkname [, mode [, env]]])', description: 'Compiles supported Lua source into an executable BLua32 closure in RAM.' },
	{ name: 'lua_compiler.compile_syntax', params: ['chunk', 'chunkname', 'env?'], signature: 'lua_compiler.compile_syntax(chunk, chunkname [, env])', description: 'Compiles a canonical firmware syntax tree into an executable BLua32 closure.' },
	{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
	{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
	{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
	{ name: 'print', params: ['...'], signature: 'print(...)' },
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
	{ name: 'coroutine.create', params: ['func'], signature: 'coroutine.create(func)' },
	{ name: 'coroutine.resume', params: ['thread', '...'], signature: 'coroutine.resume(thread, ...)' },
	{ name: 'coroutine.yield', params: ['...'], signature: 'coroutine.yield(...)' },
	{ name: 'coroutine.status', params: ['thread'], signature: 'coroutine.status(thread)' },
	{ name: 'coroutine.running', params: [], signature: 'coroutine.running()' },
	{ name: 'coroutine.close', params: ['thread'], signature: 'coroutine.close(thread)' },
	{ name: 'coroutine.isyieldable', params: ['thread?'], signature: 'coroutine.isyieldable([thread])' },
	{ name: 'coroutine.wrap', params: ['func'], signature: 'coroutine.wrap(func)' },
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
	{ name: 'string.byte', params: ['s', 'i?'], signature: 'string.byte(s [, i])' },
	{ name: 'string.char', params: ['...'], signature: 'string.char(...)' },
	{ name: 'string.from_bytes', params: ['address', 'byte_count'], signature: 'string.from_bytes(address, byte_count)' },
	{ name: 'utf8.char', params: ['...'], signature: 'utf8.char(...)' },
	{ name: 'utf8.count', params: ['s'], signature: 'utf8.count(s)' },
	{ name: 'utf8.read', params: ['s', 'position', 'last'], signature: 'utf8.read(s, position, last)' },
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
	{ name: 'blua32.closure', params: ['function_address'], signature: 'blua32.closure(function_address)', description: 'Binds a function-record address through firmware. It is not a first-class Lua function.' },
	{ name: 'blua32.code_function', params: ['startup_symbol'], signature: 'blua32.code_function(startup_symbol)', description: 'Links a callable System startup symbol as an immutable function value without runtime binding.' },
	{ name: 'blua32.argument_count', params: [], signature: 'blua32.argument_count()', description: 'Reads the exact number of arguments supplied to this function, including explicitly supplied nil values. Emits ARGC; not a function value.' },
	{ name: 'blua32.argument_suffix', params: ['start'], signature: 'return blua32.argument_suffix(start)', description: 'Returns the extra arguments starting at a zero-based Integer offset without copying them into a separate register window. Must be the only expression in return.' },
	{ name: 'blua32.svc', params: ['value'], signature: 'blua32.svc(value)', description: 'Raises a supervisor exception with the supplied value. Emits SVC as a statement, not a function value.' },
	{ name: 'blua32.rfe', params: [], signature: 'blua32.rfe()', description: 'Returns from an exception using the saved CPU state and EPC. Emits RFE as a statement, not a function value.' },
	{ name: 'blua32.float_bits', params: ['value'], signature: 'blua32.float_bits(value)', description: 'Reinterprets a Float word as an Integer. Emits MOV kind 1; not a function value.' },
	{ name: 'blua32.float_from_bits', params: ['word'], signature: 'blua32.float_from_bits(word)', description: 'Reinterprets an Integer word as a Float. Emits MOV kind 2; not a function value.' },
	{ name: 'blua32.payload', params: ['value'], signature: 'blua32.payload(value)', description: 'Reads the unchanged payload word of a register as an Integer. Does not read memory or change the source tag.' },
	{ name: 'blua32.trace', params: ['subject', 'channel', '...'], signature: 'blua32.trace(subject, channel, ...)', description: 'Source instrumentation statement. Unselected channels are erased; selected channels send values to a subject/channel guest sink.' },
	{ name: 'blua32.trace_sink', params: ['subject', 'channel', 'sink'], signature: 'blua32.trace_sink(subject, channel, sink)', description: 'Binds or clears one subject/channel guest sink. Erased when that channel is unselected.' },
	{ name: 'mem', params: ['addr'], signature: 'mem[addr]', description: 'Reserved memory-mapped 32-bit word space for direct `mem[addr]` reads/writes. Not a first-class Lua value. Invalid or read-only writes raise a fault.' },
	{ name: 'mem8', params: ['addr'], signature: 'mem8[addr]', description: 'Reserved memory-mapped byte space for direct `mem8[addr]` reads/writes. Not a first-class Lua value.' },
	{ name: 'mem16le', params: ['addr'], signature: 'mem16le[addr]', description: 'Reserved memory-mapped little-endian 16-bit space for direct `mem16le[addr]` reads/writes. Not a first-class Lua value.' },
	{ name: 'mem32le', params: ['addr'], signature: 'mem32le[addr]', description: 'Reserved memory-mapped little-endian 32-bit space for direct `mem32le[addr]` reads/writes. Not a first-class Lua value.' },
	{ name: 'memf32le', params: ['addr'], signature: 'memf32le[addr]', description: 'Reserved memory-mapped little-endian 32-bit float space for direct `memf32le[addr]` reads/writes. Not a first-class Lua value. Invalid or read-only writes raise a fault.' },
	{ name: 'memf64le', params: ['addr'], signature: 'memf64le[addr]', description: 'Reserved memory-mapped little-endian 64-bit float space for direct `memf64le[addr]` reads/writes. Not a first-class Lua value. Invalid or read-only writes raise a fault.' },
	{ name: 'cop0.ram_end', params: [], signature: 'cop0.ram_end', description: 'Write the end of the ordinary RAM aperture from System ROM.' },
	{ name: 'cop0.status', params: [], signature: 'cop0.status', description: 'Raw CPU STATUS control register. Supervisor code may read and write it.' },
	{ name: 'cop0.cause', params: [], signature: 'cop0.cause', description: 'Raw read-only CPU CAUSE control register.' },
	{ name: 'cop0.context', params: [], signature: 'cop0.context', description: 'In the reset bank, reads the previous admitted root context address. Writing admits a prepared context.' },
	{ name: 'cop0.current', params: [], signature: 'cop0.current', description: 'Physical address of the executing context. An ordinary System ROM supervisor instruction can select another prepared context.' },
	{ name: 'cop0.previous_active', params: [], signature: 'cop0.previous_active', description: 'Read-only raw physical address of the executing context preserved at reset, until another context is admitted.' },
	{ name: 'cop0.system_vector', params: [], signature: 'cop0.system_vector', description: 'System exception Function address, writable only while executing immutable System ROM in supervisor mode.' },
	{ name: 'cop0.exception_target', params: [], signature: 'cop0.exception_target', description: 'Replace the active exception vector by another Function without a second exception entry.' },
	{ name: 'cop0.irq_vector', params: [], signature: 'cop0.irq_vector', description: 'Install a System maskable interrupt vector that enters the fixed register bank.' },
	{ name: 'cop0.table_lookup_key', params: [], signature: 'cop0.table_lookup_key', description: 'Raw String identity used for a Table lookup after an own-entry miss.' },
	{ name: 'cop0.table_assign_key', params: [], signature: 'cop0.table_assign_key', description: 'Raw String identity used for a Table assignment after an own-entry miss.' },
	{ name: 'cop0.table_length_key', params: [], signature: 'cop0.table_length_key', description: 'Raw String identity used to select a Table length override.' },
	{ name: 'cop0.string_index_table', params: [], signature: 'cop0.string_index_table', description: 'Raw Table address used when reading a String receiver.' },
	{ name: 'cop0.epc', params: [], signature: 'cop0.epc', description: 'Raw CPU exception program counter. Supervisor code may read and write it.' },
	{ name: 'cop0.bad_address', params: [], signature: 'cop0.bad_address', description: 'Raw read-only CPU bad-address latch.' },
];

const DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS = [
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
