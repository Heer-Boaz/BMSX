import { BuiltinFunctionId } from '../cpu/cpu';

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
];
