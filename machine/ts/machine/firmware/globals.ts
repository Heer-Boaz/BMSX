import { ValueTag } from '../cpu/value';
import type { Runtime } from '../runtime/runtime';
import { LUA_BOOT_PRIMITIVES } from '../../spec/blua32/builtin';

export function installLuaBootPrimitives(runtime: Runtime): void {
	const cpu = runtime.machine.cpu;
	for (let index = 0; index < LUA_BOOT_PRIMITIVES.length; index += 1) {
		const primitive = LUA_BOOT_PRIMITIVES[index];
		cpu.setSystemGlobalByKey(
			cpu.stringPool.intern(primitive.name),
			ValueTag.BuiltinFunction,
			primitive.id,
			null,
		);
	}
}
