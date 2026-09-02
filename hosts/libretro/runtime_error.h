#pragma once

#include "bmsx_libretro.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"

#include <array>
#include <optional>
#include <string_view>

namespace bmsx {

class Runtime;

void flushLibretroSystemOutput(
	Runtime& runtime,
	const retro_log_callback& logging);
void reportLibretroRuntimeError(
	Runtime& runtime,
	const RomImage& systemRom,
	const std::array<std::optional<CartridgePackage>, CARTRIDGE_SLOT_COUNT>& cartridgePackages,
	std::string_view message,
	const retro_log_callback& logging);

} // namespace bmsx
