#include "content.h"

#include "mem_snapshot.h"

#include <utility>
#if defined(__GLIBC__)
#include <malloc.h>
#endif

namespace bmsx {
namespace {

constexpr const char* kReleaseSystemRomName = "bmsx-bios.rom";

} // namespace

void LibretroContentMedia::releaseSystemRom() {
	systemRomImage = {};
	systemRomFile.close();
}

void LibretroContentMedia::releaseCartridgeSlots() {
	cartridgeRomImages = {};
	for (MmapFile& file : cartridgeRomFiles) {
		file.close();
	}
}

bool LibretroContentMedia::loadSystemRom(
	std::string_view systemDirectory,
	const retro_log_callback& logging
) {
	releaseSystemRom();
	if (systemDirectory.empty()) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Frontend did not provide a system directory\n");
		return false;
	}
	std::string path(systemDirectory);
	const char last = path.back();
	if (last != '/' && last != '\\') {
		path.push_back('/');
	}
	path.append(kReleaseSystemRomName);
	MmapFile mapped;
	if (!mapped.open(path)) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Failed to load system ROM: %s\n",
			path.c_str());
		return false;
	}
	systemRomImage = parseRomImage(
		mapped.data(),
		mapped.size(),
		RomImageDomain::System);
	systemRomFile = std::move(mapped);
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	logging.log(
		RETRO_LOG_INFO,
		"[BMSX] System ROM loaded from: %s\n",
		path.c_str());
	return true;
}

bool LibretroContentMedia::loadCartridgeSlotsFromPaths(
	const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths,
	const retro_log_callback& logging
) {
	releaseCartridgeSlots();
	const std::string beforeLoad =
		memSnapshotLine("libretro:before_loadRom");
	if (!beforeLoad.empty()) {
		logging.log(RETRO_LOG_INFO, "%s\n", beforeLoad.c_str());
	}
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (paths[slotIndex].empty()) {
			continue;
		}
		MmapFile& file = cartridgeRomFiles[slotIndex];
		if (!file.open(paths[slotIndex])) {
			logging.log(
				RETRO_LOG_ERROR,
				"Failed to map cartridge slot %u\n",
				slotIndex);
			return false;
		}
		cartridgeRomImages[slotIndex] = parseRomImage(
			file.data(),
			file.size(),
			RomImageDomain::Cartridge);
	}
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	const std::string afterLoad =
		memSnapshotLine("libretro:after_loadRom");
	if (!afterLoad.empty()) {
		logging.log(RETRO_LOG_INFO, "%s\n", afterLoad.c_str());
	}
	logging.log(RETRO_LOG_INFO, "Cartridge slot files loaded\n");
	return true;
}

CartridgeSlotMediaPair LibretroContentMedia::makeCartridgeMedia() const {
	CartridgeSlotMediaPair media{};
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const RomImage& image = cartridgeRomImages[slotIndex];
		if (!image.bytes.empty()) {
			media[slotIndex] = CartridgeSlotMedia{
				image.bytes,
				image.header.cartridgeBoardWord,
				image.header.cartridgeRamByteCount,
				true,
			};
		}
	}
	return media;
}

} // namespace bmsx
