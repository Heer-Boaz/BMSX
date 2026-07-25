#pragma once

#include "common/primitives.h"

#include <span>
#include <string>
#include <variant>
#include <vector>

namespace bmsx {

constexpr const char* BLUA32_IMAGE_ID = "__blua32__";
constexpr const char* BLUA32_SYMBOLS_IMAGE_ID = "__blua32_symbols__";

constexpr u32 BLUA32_IMAGE_MAGIC = 0x32334c42u;
constexpr u32 BLUA32_BOOT_HEADER_SIZE = 60u;
constexpr u32 BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET = 40u;
constexpr u32 BLUA32_IMAGE_VERSION = 1u;
constexpr u32 BLUA32_IMAGE_HEADER_SIZE = 96u;
constexpr u32 BLUA32_FUNCTION_RECORD_SIZE = 32u;
constexpr u32 BLUA32_FUNCTION_ALIGNMENT = 16u;
constexpr u32 BLUA32_UPVALUE_RECORD_SIZE = 4u;
constexpr u32 BLUA32_CONSTANT_RECORD_SIZE = 16u;
constexpr u32 BLUA32_GLOBAL_NAME_RECORD_SIZE = 8u;

constexpr u32 BLUA32_FUNCTION_VARARG = 1u << 0u;
constexpr u32 BLUA32_FUNCTION_STATIC = 1u << 1u;

struct Blua32BootHeader {
	u32 imageOffset = 0;
	u32 imageByteCount = 0;
	u32 startupFunctionAddress = 0;
	u32 irqFunctionAddress = 0;
	u32 exceptionFunctionAddress = 0;
	u32 staticLayoutTokenLo = 0;
	u32 staticLayoutTokenHi = 0;
};

enum class Blua32ConstantTag : u32 {
	Nil,
	False,
	True,
	Number,
	String,
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

struct Blua32MediaImage {
	Blua32ImageLayout layout;
	Blua32BootHeader boot;
	int cartridgeSlot = -1;
};

auto decodeBlua32BootHeader(std::span<const u8> bytes) -> Blua32BootHeader;
auto decodeBlua32Image(std::span<const u8> bytes, u32 imageAddress) -> Blua32ImageLayout;

} // namespace bmsx
