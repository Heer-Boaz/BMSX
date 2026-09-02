#pragma once

#include "bmsx_libretro.h"
#include "common/mmap_file.h"
#include "machine/devices/cartridge/contracts.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/runtime.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"

#include <array>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace bmsx {

class LibretroContent final {
private:
	MmapFile m_systemRomFile;
	std::array<MmapFile, CARTRIDGE_SLOT_COUNT> m_cartridgePackageFiles;

public:
	RomImage systemRomImage;
	std::array<std::optional<CartridgePackage>, CARTRIDGE_SLOT_COUNT> cartridgePackages;
	Runtime runtime;

private:
	LibretroContent(
		MmapFile&& systemRomFile,
		RomImage systemRomImage,
		std::array<MmapFile, CARTRIDGE_SLOT_COUNT>&& cartridgePackageFiles,
		std::array<std::optional<CartridgePackage>, CARTRIDGE_SLOT_COUNT>&& cartridgePackages,
		InputControllerInputSource& input);

	friend std::unique_ptr<LibretroContent> loadLibretroContent(
		std::string_view systemDirectory,
		const std::array<std::string, CARTRIDGE_SLOT_COUNT>& cartridgePaths,
		InputControllerInputSource& input,
		const retro_log_callback& logging);
};

std::unique_ptr<LibretroContent> loadLibretroContent(
	std::string_view systemDirectory,
	const std::array<std::string, CARTRIDGE_SLOT_COUNT>& cartridgePaths,
	InputControllerInputSource& input,
	const retro_log_callback& logging);

} // namespace bmsx
