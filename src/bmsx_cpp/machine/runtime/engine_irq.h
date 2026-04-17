#pragma once

#include <cstdint>

namespace bmsx {

class Runtime;

void raiseEngineIrq(Runtime& runtime, uint32_t mask);

} // namespace bmsx
