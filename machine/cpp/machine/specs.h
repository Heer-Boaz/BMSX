#pragma once

#include "common/primitives.h"

namespace bmsx {

struct MachineManifest;

bool resolveCpuHz(const MachineManifest& manifest, i64& outHz);
bool resolveUfpsScaled(const MachineManifest& manifest, i64& outUfpsScaled);
i64 requirePositiveManifestValue(const std::optional<i64>& value, const char* missingMessage, const char* invalidMessage);
i64 resolvePositiveManifestValue(const std::optional<i64>& value, i64 defaultValue, const char* invalidMessage);
i64 requireManifestValueAbove(const std::optional<i64>& value, i64 minimumExclusive, const char* missingMessage, const char* invalidMessage);
i64 resolveCpuHz(const MachineManifest& manifest);
i64 resolveUfpsScaled(const MachineManifest& manifest);

} // namespace bmsx
