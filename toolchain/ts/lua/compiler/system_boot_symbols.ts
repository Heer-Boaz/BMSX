import { BuiltinFunctionId } from '../../../../machine/ts/spec/blua32/builtin';

export type ProgramCompileDomain = 'cart' | 'system';

export interface LuaBootPrimitive {
	readonly name: string;
	readonly id: BuiltinFunctionId;
}

export const LUA_BOOT_PRIMITIVES: ReadonlyArray<LuaBootPrimitive> = [
	{ name: '__bmsx_next', id: BuiltinFunctionId.Next },
	{ name: '__bmsx_getmetatable', id: BuiltinFunctionId.GetMetatable },
	{ name: '__bmsx_rawget', id: BuiltinFunctionId.RawGet },
	{ name: '__bmsx_string_byte', id: BuiltinFunctionId.StringByte },
	{ name: '__bmsx_error', id: BuiltinFunctionId.Error },
	{ name: '__bmsx_coroutine_status', id: BuiltinFunctionId.CoroutineStatus },
	{ name: '__bmsx_coroutine_running', id: BuiltinFunctionId.CoroutineRunning },
	{ name: '__bmsx_getglobal', id: BuiltinFunctionId.GetGlobal },
	{ name: '__bmsx_frame_count', id: BuiltinFunctionId.FrameCount },
	{ name: '__bmsx_get_frame_register', id: BuiltinFunctionId.GetFrameRegister },
	{ name: '__bmsx_set_frame_register', id: BuiltinFunctionId.SetFrameRegister },
	{ name: '__bmsx_get_frame_upvalue', id: BuiltinFunctionId.GetFrameUpvalue },
	{ name: '__bmsx_frame_header', id: BuiltinFunctionId.FrameHeader },
	{ name: '__bmsx_tointeger', id: BuiltinFunctionId.ToInteger },
];

export const SYSTEM_ROM_BUILTIN_BY_NAME = new Map(LUA_BOOT_PRIMITIVES.map(({ name, id }) => [name, id]));
const SYSTEM_ROM_BOOT_PRIMITIVE_NAMES: ReadonlyArray<string> = LUA_BOOT_PRIMITIVES.map(primitive => primitive.name);

/** Ambient immutable ROM bindings, not globals in the guest namespace. */
export const PROGRAM_BOOT_GLOBAL_NAMES: Readonly<Record<ProgramCompileDomain, readonly string[]>> = {
	system: SYSTEM_ROM_BOOT_PRIMITIVE_NAMES,
	cart: [],
};

export const SYSTEM_ROM_VECTOR_HANDLER_NAME_SET: ReadonlySet<string> = new Set([
	'irq',
	'exception',
]);
