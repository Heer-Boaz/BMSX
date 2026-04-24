#pragma once

#include "machine/cpu/cpu.h"

namespace bmsx {

class Runtime;

CpuRuntimeState captureRuntimeCpuState(const Runtime& runtime);
void applyRuntimeCpuState(Runtime& runtime, const CpuRuntimeState& state);

} // namespace bmsx
