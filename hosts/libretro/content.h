#pragma once

#include "bmsx_libretro.h"
#include "common/mmap_file.h"
#include "machine/devices/cartridge/contracts.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"

#include <array>
#include <string>
#include <string_view>

namespace bmsx {

struct LibretroContentMedia {
	void releaseSystemRom();
	void releaseCartridgeSlots();

	bool loadSystemRom(
		std::string_view systemDirectory,
		const retro_log_callback& logging);
	bool loadCartridgeSlotsFromPaths(
		const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths,
		const retro_log_callback& logging);
	CartridgeSlotMediaPair makeCartridgeMedia() const;

	MmapFile systemRomFile;
	RomImage systemRomImage;
	std::array<MmapFile, CARTRIDGE_SLOT_COUNT> cartridgeRomFiles;
	std::array<RomImage, CARTRIDGE_SLOT_COUNT> cartridgeRomImages;
};

} // namespace bmsx
