#pragma once

#include "cpu.h"
#include <string_view>

namespace bmsx {

class Runtime;

Value compileLoadChunk(Runtime& runtime, std::string_view source, std::string_view chunkName);

} // namespace bmsx
