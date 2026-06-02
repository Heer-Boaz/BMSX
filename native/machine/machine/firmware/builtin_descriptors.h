#pragma once

#include <span>
#include <string_view>

namespace bmsx {

struct LuaBuiltinDescriptor {
	std::string_view name;
	std::string_view signature;
	std::string_view description;
};


std::span<const LuaBuiltinDescriptor> systemLuaBuiltinFunctions();
std::span<const LuaBuiltinDescriptor> systemLuaBuiltinGlobals();
std::span<const LuaBuiltinDescriptor> defaultLuaBuiltinFunctions();
std::span<const LuaBuiltinDescriptor> defaultLuaBuiltinGlobals();
const LuaBuiltinDescriptor* findDefaultLuaBuiltinDescriptor(std::string_view name);

} // namespace bmsx
