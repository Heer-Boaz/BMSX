import { type StackTraceFrame } from '../../lua/value';
import {
	BuiltinFunctionId,
	createBuiltinFunction,
	isNativeFunction,
	isNativeObject,
	Table,
	type Value,
} from '../cpu/cpu';
import { formatNumber } from '../common/number_format';
import { buildLuaFrameRawLabel } from '../../lua/stack_frame_label';
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

function resolveLuaFunctionName(runtime: Runtime, protoIndex: number): string {
	if (!runtime.programMetadata) {
		return `proto:${protoIndex}`;
	}
	const protoId = runtime.programMetadata.protoIds[protoIndex];
	const slashIndex = protoId.lastIndexOf('/');
	const hint = slashIndex >= 0 ? protoId.slice(slashIndex + 1) : protoId;
	const colonIndex = hint.indexOf(':');
	if (colonIndex < 0) {
		return hint;
	}
	const kind = hint.slice(0, colonIndex);
	const name = hint.slice(colonIndex + 1);
	switch (kind) {
		case 'decl':
		case 'assign':
			return name;
		case 'local': {
			const hashIndex = name.indexOf('#');
			return hashIndex >= 0 ? name.slice(0, hashIndex) : name;
		}
		case 'anon':
			return 'anonymous';
		default:
			return hint;
	}
}

export function buildLuaStackFrames(runtime: Runtime): StackTraceFrame[] {
	const callStack = runtime.machine.cpu.getCallStack();
	const frames: StackTraceFrame[] = [];
	for (let index = callStack.length - 1; index >= 0; index -= 1) {
		const entry = callStack[index];
		const range = runtime.machine.cpu.getDebugRange(entry.pc);
		const source = range ? range.path : runtime.currentPath;
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		const functionName = resolveLuaFunctionName(runtime, entry.protoIndex);
		frames.push({
			origin: 'lua',
			functionName,
			source,
			line,
			column,
			raw: buildLuaFrameRawLabel(functionName, source),
		});
	}
	return frames;
}

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
