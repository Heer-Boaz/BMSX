#pragma once

#include "common/primitives.h"

namespace bmsx {

struct MachineManifest;

struct RuntimeRenderSize {
	i32 width = 0;
	i32 height = 0;
};

i64 resolvePositiveSafeInteger(i64 value, const char* label);
RuntimeRenderSize resolveRuntimeRenderSize(const MachineManifest& manifest);

} // namespace bmsx
