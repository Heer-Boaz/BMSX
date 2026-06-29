#pragma once

#include "common/primitives.h"
#include "machine/runtime/timing/constants.h"

namespace bmsx {

// Machine-model registry: the machine owns its model (echte-console-model). The
// registry is the single source of truth for the hardware profile a given model
// exposes. Region (pal/ntsc) is video-timing only; the family-level hardware is
// shared so that a different RAM/clock for one region has to be an explicit edit
// rather than a silent divergence. See docs/open_architecture_slices.md slice 24.

enum class MachineFamily { Bmsx, Bsx };
enum class MachineRegion { Pal, Ntsc };
enum class MachineModelId { BmsxPal, BmsxNtsc, BsxNtsc };

// Family-shared hardware (bmsx = MSX-like lane).
constexpr i64 BMSX_CPU_FREQ_HZ = 8000000;
constexpr i64 BMSX_IMGDEC_BYTES_PER_SEC = 26214400;
constexpr i64 BMSX_DMA_BYTES_PER_SEC_ISO = 8388608;
constexpr i64 BMSX_DMA_BYTES_PER_SEC_BULK = 26214400;
constexpr i64 BMSX_VDP_WORK_UNITS_PER_SEC = 25600;
constexpr i64 BMSX_GEO_WORK_UNITS_PER_SEC = 16384000;
constexpr i64 BMSX_RAM_BYTES = 0x00400000;
constexpr i64 BMSX_VRAM_SLOT_BYTES = 0x01000000;
constexpr i64 BMSX_VRAM_STAGING_BYTES = 0x00400000;

// Family-shared hardware (bsx = PSX-like high-end lane).
constexpr i64 BSX_CPU_FREQ_HZ = 50000000;
constexpr i64 BSX_IMGDEC_BYTES_PER_SEC = 26214400;
constexpr i64 BSX_DMA_BYTES_PER_SEC_ISO = 8388608;
constexpr i64 BSX_DMA_BYTES_PER_SEC_BULK = 26214400;
constexpr i64 BSX_VDP_WORK_UNITS_PER_SEC = 25600;
constexpr i64 BSX_GEO_WORK_UNITS_PER_SEC = 16384000;
constexpr i64 BSX_RAM_BYTES = 0x08000000;
constexpr i64 BSX_VRAM_SLOT_BYTES = 167772160;
constexpr i64 BSX_VRAM_STAGING_BYTES = 41943040;

// Per-region video timing.
constexpr i64 PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
constexpr i64 PAL_TOTAL_SCANLINES = 313;
constexpr i64 NTSC_REFRESH_UFPS_SCALED = 60 * HZ_SCALE;
constexpr i64 NTSC_TOTAL_SCANLINES = 262;

struct MachineModelProfile {
	MachineFamily family = MachineFamily::Bmsx;
	MachineRegion region = MachineRegion::Pal;
	i64 cpuFreqHz = 0;
	i64 refreshUfpsScaled = 0;
	i64 totalScanlines = 0;
	i64 imgDecBytesPerSec = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	i64 vdpWorkUnitsPerSec = 0;
	i64 geoWorkUnitsPerSec = 0;
	i64 ramBytes = 0;
	i64 slotBytes = 0;
	i64 stagingBytes = 0;
};

MachineFamily machineFamilyOfModel(MachineModelId model);
MachineModelProfile getMachineModelProfile(MachineModelId model);

} // namespace bmsx
