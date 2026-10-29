// Probe the actual address owner; do not copy its address encoding here.
#include "machine/devices/gx/gpu_local_memory.h"
#include <cassert>
#include <iostream>
#include <set>

int main() {
    unsigned checks = 0;
    // All low-coordinate residues. Higher page/block/base terms are even.
    for (bmsx::u32 base : {0u, 511u * 4096u}) {
        for (bmsx::u32 width : {0u, 16u, 63u}) {
            for (bmsx::u32 y = 0; y < 32; ++y) {
                for (bmsx::u32 x = 0; x < 64; ++x) {
                    const auto address = bmsx::gxGpuLocalMemoryAddress32(base, width, x, y);
                    assert((address & 1u) == 0u);
                    assert((address >> 1u) == (((address + 1u) & 0xfffffu) >> 1u));
                    ++checks;
                }
            }
        }
    }
    std::set<bmsx::u32> physicalReads;
    for (bmsx::u32 sample = 0; sample < 640; ++sample) {
        const bmsx::u32 x = sample * 4u;
        const auto a = bmsx::gxGpuLocalMemoryAddressGpu24(0, 16, x, 0, 0) >> 1u;
        const auto b = bmsx::gxGpuLocalMemoryAddressGpu24(0, 16, x, 0, 1) >> 1u;
        const auto c = bmsx::gxGpuLocalMemoryAddress32(0x80000u, 16, x, 0) >> 1u;
        assert(a != b && a != c && b != c);
        physicalReads.insert(a); physicalReads.insert(b); physicalReads.insert(c);
    }
    assert(checks == 12288u && physicalReads.size() == 1920u);
    std::cout << "{\"owner\":\"C++\",\"alignment_residue_checks\":" << checks
              << ",\"profile_samples\":640,\"distinct_32bit_reads\":" << physicalReads.size()
              << ",\"maximum_reads_per_profile_sample\":3}\n";
}
