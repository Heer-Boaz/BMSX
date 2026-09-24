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
	CollectGarbage = 13,
	CoroutineCreate = 14,
	CoroutineResume = 15,
	CoroutineYield = 16,
	CoroutineStatus = 17,
	CoroutineRunning = 18,
	CoroutineClose = 19,
	CoroutineIsYieldable = 20,
	GetGlobal = 21,
	SetGlobal = 22,
	FrameCount = 23,
	GetFrameRegister = 24,
	SetFrameRegister = 25,
	GetFrameUpvalue = 26,
	SetFrameUpvalue = 27,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 28u;

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
	{ "__bmsx_collect_garbage", BuiltinFunctionId::CollectGarbage },
	{ "__bmsx_coroutine_create", BuiltinFunctionId::CoroutineCreate },
	{ "__bmsx_coroutine_resume", BuiltinFunctionId::CoroutineResume },
	{ "__bmsx_coroutine_yield", BuiltinFunctionId::CoroutineYield },
	{ "__bmsx_coroutine_status", BuiltinFunctionId::CoroutineStatus },
	{ "__bmsx_coroutine_running", BuiltinFunctionId::CoroutineRunning },
	{ "__bmsx_coroutine_close", BuiltinFunctionId::CoroutineClose },
	{ "__bmsx_coroutine_isyieldable", BuiltinFunctionId::CoroutineIsYieldable },
	{ "__bmsx_getglobal", BuiltinFunctionId::GetGlobal },
	{ "__bmsx_setglobal", BuiltinFunctionId::SetGlobal },
	{ "__bmsx_frame_count", BuiltinFunctionId::FrameCount },
	{ "__bmsx_get_frame_register", BuiltinFunctionId::GetFrameRegister },
	{ "__bmsx_set_frame_register", BuiltinFunctionId::SetFrameRegister },
	{ "__bmsx_get_frame_upvalue", BuiltinFunctionId::GetFrameUpvalue },
	{ "__bmsx_set_frame_upvalue", BuiltinFunctionId::SetFrameUpvalue },
}};

} // namespace bmsx
