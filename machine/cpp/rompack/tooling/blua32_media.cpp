#include "rompack/tooling/blua32_media.h"

#include "rompack/image.h"
#include "rompack/toc.h"

#include <utility>

namespace bmsx {

auto loadBlua32ToolingImage(
	const RomImage& rom,
	u32 romBaseAddress
) -> std::optional<Blua32ToolingImage> {
	std::optional<Blua32ImageLayout> layout =
		decodeBlua32RomImage(rom.bytes, romBaseAddress);
	if (!layout) {
		return std::nullopt;
	}
	std::optional<Blua32SymbolsImage> symbols;
	const RomTocPayload toc = decodeRomToc(
		rom.bytes.data() + rom.header.tocOffset,
		rom.header.tocLength
	);
	for (const RomSourceEntry& entry : toc.entries) {
		if (entry.resid == BLUA32_SYMBOLS_IMAGE_ID) {
			const size_t start = static_cast<size_t>(*entry.rom.start);
			const size_t byteCount =
				static_cast<size_t>(*entry.rom.end - *entry.rom.start);
			symbols.emplace(
				decodeBlua32SymbolsImage(rom.bytes.subspan(start, byteCount))
			);
			break;
		}
	}
	return Blua32ToolingImage{
		std::move(*layout),
		std::move(symbols),
	};
}

auto blua32ToolingImageForDomain(
	const Blua32ToolingMedia& media,
	ExecutionDomainId executionDomainId
) -> const Blua32ToolingImage* {
	if (executionDomainId < 0) {
		return media.system ? &*media.system : nullptr;
	}
	const std::optional<Blua32ToolingImage>& image =
		media.cartridgeSlots[static_cast<size_t>(executionDomainId)];
	return image ? &*image : nullptr;
}

} // namespace bmsx
