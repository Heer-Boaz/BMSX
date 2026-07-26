#pragma once

#include "machine/cpu/blua32_image.h"
#include "machine/devices/cartridge/contracts.h"
#include "rompack/tooling/blua32_symbols.h"

#include <array>
#include <optional>

namespace bmsx {

struct RomImage;

struct Blua32ToolingImage {
	Blua32ImageLayout layout;
	std::optional<Blua32SymbolsImage> symbols;
};

struct Blua32ToolingMedia {
	std::optional<Blua32ToolingImage> system;
	std::array<std::optional<Blua32ToolingImage>, CARTRIDGE_SLOT_COUNT> cartridgeSlots;
};

auto loadBlua32ToolingImage(
	const RomImage& rom,
	u32 romBaseAddress
) -> std::optional<Blua32ToolingImage>;

auto blua32ToolingImageForDomain(
	const Blua32ToolingMedia& media,
	int executionDomainId
) -> const Blua32ToolingImage*;

} // namespace bmsx
