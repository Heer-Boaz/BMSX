#pragma once

#include "machine/cpu/cpu.h"

#include <array>
#include <string_view>

namespace bmsx {

struct LuaBootPrimitive {
	std::string_view name;
	BuiltinFunctionId id;
};

inline constexpr std::array<LuaBootPrimitive, 12> LUA_BOOT_PRIMITIVES{{
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

} // namespace bmsx
