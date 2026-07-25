import {
	createBuiltinFunction,
	asStringId,
	type StringValue,
	type Value,
	ValueTag,
	valueTag,
} from '../cpu/cpu';
import { formatNumber } from '../common/number_format';
import type { StringPool } from '../cpu/string_pool';
import type { Runtime } from '../runtime/runtime';
import { LUA_BOOT_PRIMITIVES } from './boot_primitives';


// start repeated-sequence-acceptable -- Lua tostring semantics live in firmware; disassembler formatting is intentionally separate.
export function valueToString(value: Value, stringPool: StringPool): string {
	switch (valueTag(value)) {
		case ValueTag.Nil:
			return 'nil';
		case ValueTag.False:
			return 'false';
		case ValueTag.True:
			return 'true';
		case ValueTag.Number: {
			const numberValue = value as number;
			if (numberValue - numberValue !== 0) {
				return numberValue !== numberValue ? 'nan' : (numberValue < 0 ? '-inf' : 'inf');
			}
			// Parity with C++ runtime string output (Lua tostring semantics).
			// Slower than V8's native formatting; avoid tight-loop conversions.
			return formatNumber(numberValue);
		}
		case ValueTag.String:
			return stringPool.toString(asStringId(value as StringValue));
		case ValueTag.Table:
			return 'table';
		case ValueTag.NativeObject:
			return 'native';
		case ValueTag.Closure:
		case ValueTag.BuiltinFunction:
		case ValueTag.NativeFunction:
			return 'function';
	}
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
