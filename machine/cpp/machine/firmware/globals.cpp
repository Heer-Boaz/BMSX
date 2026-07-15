#include "machine/runtime/runtime.h"
#include "machine/common/number_format.h"
#include "machine/firmware/boot_primitives.h"

#include <cmath>

namespace bmsx {

std::string Runtime::valueToString(const Value& value) const {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return valueToBool(value) ? "true" : "false";
	}
	if (valueIsNumber(value)) {
		double n = asNumber(value);
		if (!std::isfinite(n)) {
			return "nan";
		}
		return formatNumber(n);
	}
	if (valueIsString(value)) {
		return machine.cpu.stringPool().toString(asStringId(value));
	}
	if (valueIsTable(value)) {
		return "table";
	}
	if (valueIsNativeFunction(value) || valueIsClosure(value)) {
		return "function";
	}
	if (valueIsNativeObject(value)) {
		return "native";
	}
	return "function";
}


void Runtime::setupBuiltins() {
	CPU& cpu = machine.cpu;
	auto builtinRoots = cpu.acquireNativeLocalRoots();

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

void Runtime::clearLuaBootPrimitives() {
	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		machine.cpu.setSystemGlobalByKey(valueString(machine.cpu.stringPool().intern(primitive.name)), valueNil());
	}
}

} // namespace bmsx
