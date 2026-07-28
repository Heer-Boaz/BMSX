#include "machine/runtime/runtime.h"
#include "spec/blua32/builtin.h"

namespace bmsx {

void Runtime::setupBuiltins() {
	CPU& cpu = machine.cpu;
	auto builtinRoots = cpu.acquireLocalRoots();

	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		cpu.setSystemGlobalByKey(valueString(cpu.stringPool().intern(primitive.name)), cpu.createBuiltinFunction(primitive.id));
	}
	auto* stringTable = cpu.createTable();

	machine.cpu.setStringIndexTable(stringTable);
	setGlobal("string", valueTable(stringTable));

	auto* tableLib = cpu.createTable();
	setGlobal("table", valueTable(tableLib));

	auto* osTable = cpu.createTable();
	setGlobal("os", valueTable(osTable));
}

} // namespace bmsx
