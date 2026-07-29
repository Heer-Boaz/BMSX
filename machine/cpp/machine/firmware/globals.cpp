#include "machine/runtime/runtime.h"
#include "spec/blua32/builtin.h"

namespace bmsx {

void Runtime::installLuaBootPrimitives() {
	CPU& cpu = machine.cpu;
	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		cpu.setSystemGlobalByKey(
			valueString(cpu.stringPool().intern(primitive.name)),
			cpu.createBuiltinFunction(primitive.id)
		);
	}
}

} // namespace bmsx
