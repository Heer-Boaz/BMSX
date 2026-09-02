#include "content.h"

#include "cartridge_media.h"
#include "mem_snapshot.h"
#include "spec/bmsx/model.h"

#include <exception>
#include <utility>
#if defined(__GLIBC__)
#include <malloc.h>
#endif

namespace bmsx {
namespace {

constexpr const char* kReleaseSystemRomName = "bmsx-bios.rom";

CartridgeSocketMediaPair makeCartridgeMedia(
	const std::array<std::optional<CartridgePackage>, CARTRIDGE_SLOT_COUNT>& packages
) {
	CartridgeSocketMediaPair media{};
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const std::optional<CartridgePackage>& package = packages[slotIndex];
		if (!package) continue;
		media[slotIndex] = cartridgeMediaFromPackage(*package);
	}
	return media;
}

} // namespace

LibretroContent::LibretroContent(
	MmapFile&& systemRomFile,
	RomImage loadedSystemRomImage,
	std::array<MmapFile, CARTRIDGE_SLOT_COUNT>&& cartridgePackageFiles,
	std::array<std::optional<CartridgePackage>, CARTRIDGE_SLOT_COUNT>&& loadedCartridgePackages,
	InputControllerInputSource& input
)
	: m_systemRomFile(std::move(systemRomFile))
	, m_cartridgePackageFiles(std::move(cartridgePackageFiles))
	, systemRomImage(loadedSystemRomImage)
	, cartridgePackages(std::move(loadedCartridgePackages))
	, runtime(
		RuntimeOptions{
			systemRomImage.bytes,
			makeCartridgeMedia(cartridgePackages),
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
	try {
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
		const RomImage systemRomImage = parseSystemRomImage(
			mapped.data(),
			mapped.size());
#if defined(__GLIBC__)
		malloc_trim(0);
#endif
		logging.log(
			RETRO_LOG_INFO,
			"[BMSX] System ROM loaded from: %s\n",
			path.c_str());

		std::array<MmapFile, CARTRIDGE_SLOT_COUNT> cartridgePackageFiles;
		std::array<std::optional<CartridgePackage>, CARTRIDGE_SLOT_COUNT> cartridgePackages;
		const std::string beforeLoad = memSnapshotLine("libretro:before_loadRom");
		if (!beforeLoad.empty()) logging.log(RETRO_LOG_INFO, "%s\n", beforeLoad.c_str());
		for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
			if (cartridgePaths[slotIndex].empty()) {
				continue;
			}
			if (!cartridgePackageFiles[slotIndex].open(cartridgePaths[slotIndex])) {
				logging.log(
					RETRO_LOG_ERROR,
					"Failed to map cartridge slot %u\n",
					slotIndex);
				return {};
			}
			cartridgePackages[slotIndex] = parseCartridgePackage(
				cartridgePackageFiles[slotIndex].data(),
				cartridgePackageFiles[slotIndex].size());
		}
#if defined(__GLIBC__)
		malloc_trim(0);
#endif
		const std::string afterLoad = memSnapshotLine("libretro:after_loadRom");
		if (!afterLoad.empty()) logging.log(RETRO_LOG_INFO, "%s\n", afterLoad.c_str());
		logging.log(RETRO_LOG_INFO, "Cartridge packages admitted\n");
		return std::unique_ptr<LibretroContent>(new LibretroContent(
			std::move(mapped),
			systemRomImage,
			std::move(cartridgePackageFiles),
			std::move(cartridgePackages),
			input));
	} catch (const std::exception& error) {
		logging.log(
			RETRO_LOG_ERROR,
			"[BMSX] Content admission failed: %s\n",
			error.what());
		return {};
	}
}

} // namespace bmsx
