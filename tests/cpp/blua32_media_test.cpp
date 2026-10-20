#include "common/endian.h"
#include "rompack/image.h"
#include "rompack/toc.h"
#include "rompack/tooling/blua32_media.h"
#include "rompack/tooling/blua32_symbols.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/bios.h"
#include "support/blua32_test_rom.h"

#include <algorithm>
#include <iostream>
#include <memory>
#include <stdexcept>

namespace {
using namespace bmsx;

static_assert(static_cast<u32>(BiosFunction::TurnPhaseSine) == 0);
static_assert(static_cast<u32>(BiosFunction::DecodeFloat) == 1);
static_assert(static_cast<u32>(BiosFunction::SystemVramRegion) == 2);
static_assert(BIOS_FUNCTION_MODULE_PATHS[0] == "math/sin");
static_assert(BIOS_FUNCTION_MODULE_PATHS[1] == "string/float/decode");
static_assert(BIOS_FUNCTION_MODULE_PATHS[2] == "gpu/system_vram_region");

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

test::Blua32TestImage makeImage(RomImageDomain domain, bool includeSymbols) {
	test::Blua32TestImage source;
	source.text.resize(INSTRUCTION_BYTES);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::RET), 0, 1, 0);
	source.functions = {{.firstWord = 0, .wordCount = 1}};
	if (!includeSymbols) return source;

	const u32 base = domain == RomImageDomain::System ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const u32 functionAddress = test::blua32TestFunctionAddress(domain, 0);
	const auto range = std::make_shared<const SourceRange>(SourceRange{"fixture/entry.lua", {1, 1}, {1, 7}});
	const auto noInlineCalls = std::make_shared<const std::vector<Blua32InlineCallSite>>();
	Blua32SymbolsImage symbols;
	symbols.imageAddress = base + test::BLUA32_TEST_IMAGE_OFFSET;
	symbols.functionAddresses = {functionAddress};
	symbols.moduleFunctions = {{"fixture/entry.lua", functionAddress}};
	auto& metadata = symbols.metadata;
	metadata.functionIds = {"fixture.entry"};
	metadata.functionDisplayNames = {"entry"};
	metadata.functionDefinitions = {range};
	metadata.debugRanges = {range};
	metadata.debugInlineCallSiteChains = {noInlineCalls};
	metadata.debugInlineCallSiteChainIds = {0};
	metadata.statementPointsByFunction = {{{0, range, noInlineCalls}}};
	metadata.resumePointsByFunction.resize(source.functions.size());
	metadata.localSlotsByFunction.resize(source.functions.size());
	metadata.outerBindingsByFunction.resize(source.functions.size());
	metadata.upvalueBindingsByFunction.resize(source.functions.size());
	metadata.staticScopes.bindingsByFunction.resize(source.functions.size());
	source.toolingSymbols = encodeBlua32SymbolsImage(symbols);
	return source;
}

void testDirectorySourcesForBothDomains() {
	for (RomImageDomain domain : {RomImageDomain::System, RomImageDomain::Cartridge}) {
		const u32 base = domain == RomImageDomain::System ? SYSTEM_ROM_BASE : CART_ROM_BASE;
		for (bool includeSymbols : {false, true}) {
			const auto source = makeImage(domain, includeSymbols);
			auto rom = test::encodeBlua32TestRom(domain, source);
			writeLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET,
				rom.functionAddresses[0]);
			RomImage image;
			if (domain == RomImageDomain::System) image = parseSystemRomImage(rom.bytes.data(), rom.bytes.size());
			else {
				const auto package = parseCartridgePackage(rom.bytes.data(), rom.bytes.size());
				image = {package.bytes, package.header};
			}
			const auto toc = decodeRomToc(image.bytes.subspan(image.header.tocOffset, image.header.tocLength));
			const auto decoded = loadBlua32ToolingImage(image, base);
			const auto predecoded = loadBlua32ToolingImage(image, base, std::span<const RomTocEntry>(toc.entries));
			const auto empty = loadBlua32ToolingImage(image, base, std::span<const RomTocEntry>{});
			require(decoded.has_value() && predecoded.has_value() && empty.has_value(), "every directory input preserves the executable layout");
			require(decoded->symbols.has_value() == includeSymbols && predecoded->symbols.has_value() == includeSymbols,
				"omitted and supplied decoded directories agree on embedded symbol presence");
			require(!empty->symbols.has_value(), "a supplied empty directory is authoritative, even when the ROM embeds symbols");
			for (const auto* loaded : {&*decoded, &*predecoded, &*empty}) {
				const auto& layout = loaded->layout;
				require(layout.header.initFunctionAddress == rom.functionAddresses[0],
					"the public init address is decoded independently of tooling symbols and directory selection");
				require(layout.address == base + image.header.blua32ImageOffset && layout.bytes.size() == image.header.blua32ImageByteCount,
					"tooling layout uses the admitted domain base and executable range");
				require(layout.bytes.data() == image.bytes.data() + image.header.blua32ImageOffset,
					"tooling executable bytes borrow the ROM rather than the directory or a copied buffer");
				require(layout.functions.size() == source.functions.size() && layout.functions[0].address == rom.functionAddresses[0]
					&& layout.header.textAddress == rom.textAddress
					&& std::equal(layout.textBytes.begin(), layout.textBytes.end(), source.text.begin(), source.text.end()),
					"directory selection never changes decoded functions or instruction bytes");
			}
			if (includeSymbols) {
				require(encodeBlua32SymbolsImage(*decoded->symbols) == source.toolingSymbols
					&& encodeBlua32SymbolsImage(*predecoded->symbols) == source.toolingSymbols,
					"both directory paths decode the complete canonical symbol graph");
			}
		}
	}
}

void testSuppliedDirectoryIsNotRetained() {
	for (RomImageDomain domain : {RomImageDomain::System, RomImageDomain::Cartridge}) {
		const u32 base = domain == RomImageDomain::System ? SYSTEM_ROM_BASE : CART_ROM_BASE;
		const auto source = makeImage(domain, true);
		const auto rom = test::encodeBlua32TestRom(domain, source);
		const RomImage image{rom.bytes, parseCartHeader(rom.bytes.data(), rom.bytes.size())};
		std::optional<Blua32ToolingImage> loaded;
		{
			const auto toc = decodeRomToc(image.bytes.subspan(image.header.tocOffset, image.header.tocLength));
			loaded = loadBlua32ToolingImage(image, base, std::span<const RomTocEntry>(toc.entries));
		}
		require(loaded.has_value() && loaded->symbols.has_value(), "a supplied directory produces an independent decoded tooling image");
		require(loaded->layout.header.initFunctionAddress == 0, "a zero public init address means no preparation sequence");
		require(encodeBlua32SymbolsImage(*loaded->symbols) == source.toolingSymbols,
			"decoded symbols remain owned after the supplied directory has been destroyed");
		require(blua32StartupSourcePath(&*loaded, rom.boot.startupFunctionAddress) == "fixture/entry.lua",
			"source lookup retains decoded graph nodes, not directory strings");
		require(loaded->layout.textBytes.data() == rom.bytes.data() + (rom.textAddress - base),
			"executable lifetime remains tied only to retained physical ROM storage");
	}
}

void testDataOnlyRomHasNoToolingImage() {
	const auto rom = test::encodeBlua32TestDataRom();
	const auto package = parseCartridgePackage(rom.data(), rom.size());
	const RomImage image{package.bytes, package.header};
	const auto toc = decodeRomToc(image.bytes.subspan(image.header.tocOffset, image.header.tocLength));
	for (u32 base : {SYSTEM_ROM_BASE, CART_ROM_BASE}) {
		require(!loadBlua32ToolingImage(image, base).has_value()
			&& !loadBlua32ToolingImage(image, base, std::span<const RomTocEntry>(toc.entries)).has_value()
			&& !loadBlua32ToolingImage(image, base, std::span<const RomTocEntry>{}).has_value(),
			"a data-only ROM has no executable tooling image under any directory input or domain base");
	}
}
} // namespace

int main() {
	testDirectorySourcesForBothDomains();
	testSuppliedDirectoryIsNotRetained();
	testDataOnlyRomHasNoToolingImage();
	std::cout << "BLUA32-MEDIA:PASS\n";
}
