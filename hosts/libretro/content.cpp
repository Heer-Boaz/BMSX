#include "content.h"

#include "mem_snapshot.h"
#include "spec/bmsx/model.h"

#include <utility>
#if defined(__GLIBC__)
#include <malloc.h>
#endif

namespace bmsx {
namespace {

constexpr const char* kReleaseSystemRomName = "bmsx-bios.rom";

CartridgeSlotMediaPair makeCartridgeMedia(
	const std::array<RomImage, CARTRIDGE_SLOT_COUNT>& cartridgeRomImages
) {
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

} // namespace

LibretroContent::LibretroContent(
	MmapFile&& systemRomFile,
	RomImage loadedSystemRomImage,
	std::array<MmapFile, CARTRIDGE_SLOT_COUNT>&& cartridgeRomFiles,
	std::array<RomImage, CARTRIDGE_SLOT_COUNT> loadedCartridgeRomImages,
	InputControllerInputSource& input
)
	: m_systemRomFile(std::move(systemRomFile))
	, m_cartridgeRomFiles(std::move(cartridgeRomFiles))
	, systemRomImage(loadedSystemRomImage)
	, cartridgeRomImages(loadedCartridgeRomImages)
	, runtime(
		RuntimeOptions{
			systemRomImage.bytes,
			makeCartridgeMedia(cartridgeRomImages),
			PSX_MACHINE_SPEC,
		},
		input)
{
	runtime.resetForSystemBoot();
	runtime.boot();
}

std::unique_ptr<LibretroContent> loadLibretroContent(
	std::string_view systemDirectory,
	const std::array<std::string, CARTRIDGE_SLOT_COUNT>& cartridgePaths,
	InputControllerInputSource& input,
	const retro_log_callback& logging
) {
	if (systemDirectory.empty()) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Frontend did not provide a system directory\n");
		return {};
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
		return {};
	}
	const RomImage systemRomImage = parseRomImage(
		mapped.data(),
		mapped.size(),
		RomImageDomain::System);
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	logging.log(
		RETRO_LOG_INFO,
		"[BMSX] System ROM loaded from: %s\n",
		path.c_str());

	std::array<MmapFile, CARTRIDGE_SLOT_COUNT> cartridgeRomFiles;
	std::array<RomImage, CARTRIDGE_SLOT_COUNT> cartridgeRomImages;
	const std::string beforeLoad = memSnapshotLine("libretro:before_loadRom");
	if (!beforeLoad.empty()) logging.log(RETRO_LOG_INFO, "%s\n", beforeLoad.c_str());
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (cartridgePaths[slotIndex].empty()) {
			continue;
		}
		if (!cartridgeRomFiles[slotIndex].open(cartridgePaths[slotIndex])) {
			logging.log(
				RETRO_LOG_ERROR,
				"Failed to map cartridge slot %u\n",
				slotIndex);
			return {};
		}
		cartridgeRomImages[slotIndex] = parseRomImage(
			cartridgeRomFiles[slotIndex].data(),
			cartridgeRomFiles[slotIndex].size(),
			RomImageDomain::Cartridge);
	}
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	const std::string afterLoad = memSnapshotLine("libretro:after_loadRom");
	if (!afterLoad.empty()) logging.log(RETRO_LOG_INFO, "%s\n", afterLoad.c_str());
	logging.log(RETRO_LOG_INFO, "Cartridge slot files loaded\n");
	return std::unique_ptr<LibretroContent>(new LibretroContent(
		std::move(mapped),
		systemRomImage,
		std::move(cartridgeRomFiles),
		cartridgeRomImages,
		input));
}

} // namespace bmsx
