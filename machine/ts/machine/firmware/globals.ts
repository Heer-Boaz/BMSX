import { createBuiltinFunction } from '../cpu/value';
import type { Runtime } from '../runtime/runtime';
import { LUA_BOOT_PRIMITIVES } from './boot_primitives';

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
