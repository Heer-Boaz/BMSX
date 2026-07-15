import {
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
import { LUA_BOOT_PRIMITIVES } from './boot_primitives';


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
		runtime.machine.cpu.setSystemGlobalByKey(runtime.internString(primitive.name), createBuiltinFunction(primitive.id));
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
		runtime.machine.cpu.setSystemGlobalByKey(runtime.internString(LUA_BOOT_PRIMITIVES[index].name), null);
	}
}
