#pragma once

#include "common/primitives.h"
#include "spec/blua32/image_format.h"

#include <optional>
#include <span>
#include <string>
#include <variant>
#include <vector>

namespace bmsx {

constexpr const char* BLUA32_IMAGE_ID = "__blua32__";

struct Blua32BootHeader {
	u32 imageOffset = 0;
	u32 imageByteCount = 0;
	u32 startupFunctionAddress = 0;
	u32 irqFunctionAddress = 0;
	u32 exceptionFunctionAddress = 0;
	u32 staticLayoutTokenLo = 0;
	u32 staticLayoutTokenHi = 0;
};

struct Blua32ImageHeader {
	u32 imageByteCount = 0;
	u32 flags = 0;
	u32 functionTableAddress = 0;
	u32 functionCount = 0;
	u32 constantTableAddress = 0;
	u32 constantCount = 0;
	u32 globalNameTableAddress = 0;
	u32 globalNameCount = 0;
	u32 systemGlobalNameTableAddress = 0;
	u32 systemGlobalNameCount = 0;
	u32 stringAddress = 0;
	u32 stringByteCount = 0;
	u32 rodataAddress = 0;
	u32 rodataByteCount = 0;
	u32 dataLoadAddress = 0;
	u32 dataByteCount = 0;
	u32 dataAddress = 0;
	u32 bssAddress = 0;
	u32 bssByteCount = 0;
	u32 textAddress = 0;
	u32 textByteCount = 0;
};

struct Blua32UpvalueRecord {
	bool inStack = false;
	u32 index = 0;
};

struct Blua32FunctionRecord {
	u32 address = 0;
	u32 codeAddress = 0;
	u32 codeByteCount = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	bool isVararg = false;
	bool staticClosure = false;
	std::vector<Blua32UpvalueRecord> upvalues;
};

using Blua32EncodedConstant = std::variant<std::monostate, bool, f64, std::string>;

struct Blua32ImageLayout {
	u32 address = 0;
	std::span<const u8> bytes;
	Blua32ImageHeader header;
	std::vector<Blua32FunctionRecord> functions;
	std::vector<Blua32EncodedConstant> constants;
	std::vector<std::string> globalNames;
	std::vector<std::string> systemGlobalNames;
	std::span<const u8> rodataBytes;
	std::span<const u8> dataLoadBytes;
	std::span<const u8> textBytes;
};

inline auto blua32FunctionIndexAtAddress(
	const Blua32ImageLayout& image,
	u32 functionAddress
) -> u32 {
	return (functionAddress - image.header.functionTableAddress) / BLUA32_FUNCTION_RECORD_SIZE;
}

auto decodeBlua32BootHeader(std::span<const u8> bytes) -> Blua32BootHeader;
auto decodeBlua32RomImage(std::span<const u8> bytes, u32 romBaseAddress) -> std::optional<Blua32ImageLayout>;
auto decodeBlua32Image(std::span<const u8> bytes, u32 imageAddress) -> Blua32ImageLayout;

} // namespace bmsx
