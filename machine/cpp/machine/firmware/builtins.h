#pragma once

#include "machine/cpu/cpu.h"
#include <cstddef>

namespace bmsx {

class Runtime;

int floorIntArg(NativeArgsView args, size_t index);
void registerMathAndEasingBuiltins(Runtime& runtime);

} // namespace bmsx
