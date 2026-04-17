#pragma once

#include "core/types.h"

namespace bmsx {

struct MachineManifest;

bool tryResolveCpuHz(const MachineManifest& manifest, i64& outHz);
bool tryResolveUfpsScaled(const MachineManifest& manifest, i64& outUfpsScaled);
i64 resolveCpuHz(const MachineManifest& manifest);
i64 resolveImgDecBytesPerSec(const MachineManifest& manifest);
i64 resolveDmaBytesPerSecIso(const MachineManifest& manifest);
i64 resolveDmaBytesPerSecBulk(const MachineManifest& manifest);
i64 resolveVdpWorkUnitsPerSec(const MachineManifest& manifest);
i64 resolveGeoWorkUnitsPerSec(const MachineManifest& manifest);
i64 resolveUfpsScaled(const MachineManifest& manifest);

} // namespace bmsx
