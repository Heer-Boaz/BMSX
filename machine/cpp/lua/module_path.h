#pragma once

#include <string>
#include <string_view>

namespace bmsx {

std::string stripLuaExtension(std::string_view candidate);
std::string toLuaModulePath(std::string_view sourcePath);

} // namespace bmsx
