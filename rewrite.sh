cat << 'H_EOF' > src/bmsx_cpp/core/rom_boot_manager.h
#ifndef BMSX_ROM_BOOT_MANAGER_H
#define BMSX_ROM_BOOT_MANAGER_H

#include "common/primitives.h"
#include "rompack/loader.h"
#include <memory>
#include <utility>

namespace bmsx {

struct RomBootPlan {
    RuntimeRomPackage systemLayer;
    std::pair<int, int> viewportSize;
};

class RomBootManager {
public:
    std::unique_ptr<RomBootPlan> buildBootPlan(const u8* systemRom, size_t systemSize, const u8* cartridge, size_t cartSize);
};

} // namespace bmsx

#endif // BMSX_ROM_BOOT_MANAGER_H
H_EOF
