export const enum BuiltinFunctionId {
	Next = 0,
	Type = 1,
	SetMetatable = 2,
	GetMetatable = 3,
	RawGet = 4,
	RawSet = 5,
	Select = 6,
	StringByte = 7,
	StringChar = 8,
	Error = 9,
	PCall = 10,
	XPCall = 11,
	SetStringIndex = 12,
	CollectGarbage = 13,
	CoroutineCreate = 14,
	CoroutineResume = 15,
	CoroutineYield = 16,
	CoroutineStatus = 17,
	CoroutineRunning = 18,
	CoroutineClose = 19,
	CoroutineIsYieldable = 20,
}

export const BUILTIN_FUNCTION_COUNT = 21;

export interface LuaBootPrimitive {
	readonly name: string;
	readonly id: BuiltinFunctionId;
}

export const LUA_BOOT_PRIMITIVES: ReadonlyArray<LuaBootPrimitive> = [
	{ name: '__bmsx_next', id: BuiltinFunctionId.Next },
	{ name: '__bmsx_type', id: BuiltinFunctionId.Type },
	{ name: '__bmsx_setmetatable', id: BuiltinFunctionId.SetMetatable },
	{ name: '__bmsx_getmetatable', id: BuiltinFunctionId.GetMetatable },
	{ name: '__bmsx_rawget', id: BuiltinFunctionId.RawGet },
	{ name: '__bmsx_rawset', id: BuiltinFunctionId.RawSet },
	{ name: '__bmsx_select', id: BuiltinFunctionId.Select },
	{ name: '__bmsx_string_byte', id: BuiltinFunctionId.StringByte },
	{ name: '__bmsx_string_char', id: BuiltinFunctionId.StringChar },
	{ name: '__bmsx_error', id: BuiltinFunctionId.Error },
	{ name: '__bmsx_pcall', id: BuiltinFunctionId.PCall },
	{ name: '__bmsx_xpcall', id: BuiltinFunctionId.XPCall },
	{ name: '__bmsx_set_string_index', id: BuiltinFunctionId.SetStringIndex },
	{ name: '__bmsx_collect_garbage', id: BuiltinFunctionId.CollectGarbage },
	{ name: '__bmsx_coroutine_create', id: BuiltinFunctionId.CoroutineCreate },
	{ name: '__bmsx_coroutine_resume', id: BuiltinFunctionId.CoroutineResume },
	{ name: '__bmsx_coroutine_yield', id: BuiltinFunctionId.CoroutineYield },
	{ name: '__bmsx_coroutine_status', id: BuiltinFunctionId.CoroutineStatus },
	{ name: '__bmsx_coroutine_running', id: BuiltinFunctionId.CoroutineRunning },
	{ name: '__bmsx_coroutine_close', id: BuiltinFunctionId.CoroutineClose },
	{ name: '__bmsx_coroutine_isyieldable', id: BuiltinFunctionId.CoroutineIsYieldable },
];
