#ifndef BMSX_SYSTEM_MACHINE_H
#define BMSX_SYSTEM_MACHINE_H

#include "rompack/assets.h"

namespace bmsx {

const MachineManifest& defaultSystemMachineManifest();
const char* systemBootEntryPath();

} // namespace bmsx

#endif // BMSX_SYSTEM_MACHINE_H
