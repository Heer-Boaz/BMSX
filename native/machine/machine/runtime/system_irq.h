#pragma once

#include <cstdint>

namespace bmsx {

class Runtime;

void raiseSystemIrq(Runtime& runtime, uint32_t mask);

} // namespace bmsx
