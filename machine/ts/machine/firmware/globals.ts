import {
	BuiltinFunctionId,
	createBuiltinFunction,
	isNativeFunction,
	isNativeObject,
	Table,
	type Value,
} from '../cpu/cpu';
import { formatNumber } from '../common/number_format';
import { asStringId, valueIsString } from '../cpu/cpu';
import type { StringPool } from '../cpu/string_pool';
import type { Runtime } from '../runtime/runtime';

const LUA_BOOT_PRIMITIVES: ReadonlyArray<{ name: string; id: BuiltinFunctionId }> = [
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


// start repeated-sequence-acceptable -- Lua tostring semantics live in firmware; disassembler formatting is intentionally separate.
export function valueToString(value: Value, stringPool: StringPool): string {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			return Number.isNaN(value) ? 'nan' : (value < 0 ? '-inf' : 'inf');
		}
		// Parity with C++ runtime string output (Lua tostring semantics).
		// Slower than V8's native formatting; avoid tight-loop conversions.
		return formatNumber(value);
	}
	if (valueIsString(value)) {
		return stringPool.toString(asStringId(value));
	}
	if (value instanceof Table) {
		return 'table';
	}
	if (isNativeFunction(value)) {
		return 'function';
	}
	if (isNativeObject(value)) {
		return 'native';
	}
	return 'function';
}
// end repeated-sequence-acceptable

export function seedLuaGlobals(runtime: Runtime): void {
	for (let index = 0; index < LUA_BOOT_PRIMITIVES.length; index += 1) {
		const primitive = LUA_BOOT_PRIMITIVES[index];
		runtime.setGlobal(primitive.name, createBuiltinFunction(primitive.id));
	}

	const stringTable = runtime.machine.cpu.createTable(0, 0);
	runtime.machine.cpu.stringIndexTable = stringTable;
	runtime.setGlobal('string', stringTable);

	const tableLibrary = runtime.machine.cpu.createTable(0, 0);
	runtime.setGlobal('table', tableLibrary);

	const osTable = runtime.machine.cpu.createTable(0, 0);
	runtime.setGlobal('os', osTable);
}

export function clearLuaBootPrimitives(runtime: Runtime): void {
	for (let index = 0; index < LUA_BOOT_PRIMITIVES.length; index += 1) {
		runtime.setGlobal(LUA_BOOT_PRIMITIVES[index].name, null);
	}
}
