#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace bmsx {

enum class BuiltinFunctionId : uint8_t {
	Next = 0,
	Type = 1,
	SetMetatable = 2,
	GetMetatable = 3,
	RawGet = 4,
	RawSet = 5,
	Select = 6,
	StringByte = 7,
	StringChar = 8,
	Error = 9,
	PCall = 10,
	XPCall = 11,
	SetStringIndex = 12,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 13u;

struct LuaBootPrimitive {
	std::string_view name;
	BuiltinFunctionId id;
};

inline constexpr std::array<LuaBootPrimitive, BUILTIN_FUNCTION_COUNT> LUA_BOOT_PRIMITIVES{{
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
	{ "__bmsx_set_string_index", BuiltinFunctionId::SetStringIndex },
}};

} // namespace bmsx
