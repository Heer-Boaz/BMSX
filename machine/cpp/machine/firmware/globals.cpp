#include "machine/runtime/runtime.h"
#include "machine/common/number_format.h"

#include <array>
#include <cmath>

namespace bmsx {
namespace {
struct LuaBootPrimitive {
	std::string_view name;
	BuiltinFunctionId id;
};

constexpr std::array<LuaBootPrimitive, 12> LUA_BOOT_PRIMITIVES{{
	{ "__bmsx_next", BuiltinFunctionId::Next },
	{ "__bmsx_type", BuiltinFunctionId::Type },
	{ "__bmsx_setmetatable", BuiltinFunctionId::SetMetatable },
	{ "__bmsx_getmetatable", BuiltinFunctionId::GetMetatable },
	{ "__bmsx_rawget", BuiltinFunctionId::RawGet },
	{ "__bmsx_rawset", BuiltinFunctionId::RawSet },
	{ "__bmsx_select", BuiltinFunctionId::Select },
	{ "__bmsx_string_byte", BuiltinFunctionId::StringByte },
	{ "__bmsx_string_char", BuiltinFunctionId::StringChar },
	{ "__bmsx_error", BuiltinFunctionId::Error },
	{ "__bmsx_pcall", BuiltinFunctionId::PCall },
	{ "__bmsx_xpcall", BuiltinFunctionId::XPCall },
}};

}

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
	cpu.suspendGc();
	struct ResumeBuiltinGc {
		CPU& cpu;
		~ResumeBuiltinGc() {
			cpu.resumeGc();
		}
	} resumeBuiltinGc{ cpu };

	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		setGlobal(primitive.name, cpu.createBuiltinFunction(primitive.id));
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
		setGlobal(primitive.name, valueNil());
	}
}

} // namespace bmsx
