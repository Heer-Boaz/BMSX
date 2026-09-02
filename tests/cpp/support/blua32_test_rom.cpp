#include "blua32_test_rom.h"

#include "common/endian.h"
#include "common/serializer/binencoder.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/memory_map.h"
#include "rompack/toc.h"
#include "rompack/tokens.h"
#include "rompack/tooling/blua32_symbols.h"
#include "rompack/tooling/toc_encode.h"

#include <algorithm>
#include <cstring>
#include <span>
#include <type_traits>
#include <unordered_map>

namespace bmsx::test {
namespace {

auto alignOffset(u32 offset, u32 address, u32 alignment) -> u32 {
	const u32 value = address + offset;
	return ((value + alignment - 1u) & ~(alignment - 1u)) - address;
}

auto encodeManifest(const CartManifest& source) -> std::vector<u8> {
	BinObject manifest;
	if (source.title.has_value()) {
		manifest.emplace("title", *source.title);
	}
	BinArray hardware;
	hardware.reserve(source.hardware.size());
	for (const CartridgeDeviceConfig& config : source.hardware) {
		BinObject device;
		std::visit([&device](const auto& concrete) {
			using Config = std::remove_cvref_t<decltype(concrete)>;
			if constexpr (std::is_same_v<Config, CartridgeRomDeviceConfig>) {
				device.emplace("type", "rom");
			} else if constexpr (std::is_same_v<Config, CartridgeRamDeviceConfig>) {
				device.emplace("type", "ram");
				device.emplace("bytes", static_cast<i64>(concrete.bytes));
			} else {
				static_assert(std::is_same_v<Config, CartridgeMailboxDeviceConfig>);
				device.emplace("type", "mailbox");
			}
		}, config);
		hardware.emplace_back(std::move(device));
	}
	manifest.emplace("hardware", BinValue(std::move(hardware)));
	return encodeBinary(BinValue(std::move(manifest)));
}

struct StringRecord {
	u32 offset = 0;
	u32 byteCount = 0;
};

auto encodeImage(
	RomImageDomain domain,
	const Blua32TestImage& source,
	std::vector<u32>& functionAddresses
) -> std::vector<u8> {
	const u32 romBase = domain == RomImageDomain::System ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const u32 imageAddress = romBase + BLUA32_TEST_IMAGE_OFFSET;

	u32 offset = BLUA32_IMAGE_HEADER_SIZE;
	const u32 functionTableOffset = alignOffset(offset, imageAddress, BLUA32_FUNCTION_ALIGNMENT);
	offset = functionTableOffset
		+ static_cast<u32>(source.functions.size()) * BLUA32_FUNCTION_RECORD_SIZE;
	const u32 upvalueTableOffset = alignOffset(offset, imageAddress, BLUA32_UPVALUE_RECORD_SIZE);
	u32 upvalueCount = 0;
	for (const Blua32TestFunction& function : source.functions) {
		upvalueCount += static_cast<u32>(function.upvalues.size());
	}
	offset = upvalueTableOffset + upvalueCount * BLUA32_UPVALUE_RECORD_SIZE;
	const u32 constantTableOffset = alignOffset(offset, imageAddress, 4u);
	offset = constantTableOffset
		+ static_cast<u32>(source.constants.size()) * BLUA32_CONSTANT_RECORD_SIZE;
	const u32 globalNameTableOffset = alignOffset(offset, imageAddress, 4u);
	offset = globalNameTableOffset
		+ static_cast<u32>(source.globalNames.size()) * BLUA32_GLOBAL_NAME_RECORD_SIZE;
	const u32 systemGlobalNameTableOffset = alignOffset(offset, imageAddress, 4u);
	offset = systemGlobalNameTableOffset
		+ static_cast<u32>(source.systemGlobalNames.size()) * BLUA32_GLOBAL_NAME_RECORD_SIZE;

	std::vector<u8> strings;
	std::unordered_map<std::string, StringRecord> stringRecords;
	auto internString = [&](const std::string& value) -> StringRecord {
		const auto existing = stringRecords.find(value);
		if (existing != stringRecords.end()) {
			return existing->second;
		}
		const StringRecord record{
			static_cast<u32>(strings.size()),
			static_cast<u32>(value.size()),
		};
		strings.insert(strings.end(), value.begin(), value.end());
		stringRecords.emplace(value, record);
		return record;
	};
	for (const Blua32EncodedConstant& constant : source.constants) {
		if (const auto* value = std::get_if<std::string>(&constant)) {
			internString(*value);
		}
	}
	for (const std::string& name : source.globalNames) {
		internString(name);
	}
	for (const std::string& name : source.systemGlobalNames) {
		internString(name);
	}

	const u32 stringOffset = offset;
	offset += static_cast<u32>(strings.size());
	const u32 textOffset = alignOffset(offset, imageAddress, INSTRUCTION_BYTES);
	const u32 imageByteCount = textOffset + static_cast<u32>(source.text.size());
	const u32 functionTableAddress = imageAddress + functionTableOffset;
	const u32 stringAddress = imageAddress + stringOffset;
	const u32 textAddress = imageAddress + textOffset;

	functionAddresses.resize(source.functions.size());
	for (u32 index = 0; index < functionAddresses.size(); ++index) {
		functionAddresses[index] = functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE;
	}

	std::vector<u8> text = source.text;
	std::span<u8> textBytes(text);
	for (const Blua32TestClosureRelocation& relocation : source.closureRelocations) {
		const u32 word = readInstructionWord(textBytes, static_cast<int>(relocation.wordIndex));
		const u32 wideWord = readInstructionWord(textBytes, static_cast<int>(relocation.wordIndex - 1u));
		const u32 functionOperand = relocation.functionAddress >> 4u;
		writeInstruction(
			textBytes,
			static_cast<int>(relocation.wordIndex - 1u),
			static_cast<u8>(OpCode::WIDE),
			static_cast<u8>((wideWord >> 12u) & 0x3fu),
			static_cast<u8>(functionOperand >> BASE_BX_BITS),
			static_cast<u8>(wideWord & 0x3fu)
		);
		writeInstruction(
			textBytes,
			static_cast<int>(relocation.wordIndex),
			static_cast<u8>(OpCode::CLOSURE),
			static_cast<u8>((word >> 12u) & 0x3fu),
			static_cast<u8>((functionOperand >> 6u) & 0x3fu),
			static_cast<u8>(functionOperand & 0x3fu),
			static_cast<u8>(functionOperand >> MAX_BX_BITS)
		);
	}

	std::vector<u8> bytes(imageByteCount);
	writeLE32(bytes.data() + BLUA32_IMAGE_MAGIC_OFFSET, BLUA32_IMAGE_MAGIC);
	writeLE32(bytes.data() + BLUA32_IMAGE_VERSION_OFFSET, BLUA32_IMAGE_VERSION);
	writeLE32(bytes.data() + BLUA32_IMAGE_BYTE_COUNT_OFFSET, imageByteCount);
	writeLE32(bytes.data() + BLUA32_IMAGE_FLAGS_OFFSET, 0u);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET,
		functionTableAddress
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET,
		static_cast<u32>(source.functions.size())
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
		imageAddress + constantTableOffset
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
		static_cast<u32>(source.constants.size())
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
		imageAddress + globalNameTableOffset
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
		static_cast<u32>(source.globalNames.size())
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
		imageAddress + systemGlobalNameTableOffset
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
		static_cast<u32>(source.systemGlobalNames.size())
	);
	writeLE32(bytes.data() + BLUA32_IMAGE_STRING_ADDRESS_OFFSET, stringAddress);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_STRING_BYTE_COUNT_OFFSET,
		static_cast<u32>(strings.size())
	);
	writeLE32(bytes.data() + BLUA32_IMAGE_RODATA_ADDRESS_OFFSET, textAddress);
	writeLE32(bytes.data() + BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET, 0u);
	writeLE32(bytes.data() + BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET, textAddress);
	writeLE32(bytes.data() + BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET, 0u);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_DATA_ADDRESS_OFFSET,
		RAM_BASE + MIN_RAM_SIZE
	);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_BSS_ADDRESS_OFFSET,
		RAM_BASE + MIN_RAM_SIZE
	);
	writeLE32(bytes.data() + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, 0u);
	writeLE32(bytes.data() + BLUA32_IMAGE_TEXT_ADDRESS_OFFSET, textAddress);
	writeLE32(
		bytes.data() + BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET,
		static_cast<u32>(text.size())
	);

	u32 upvalueIndex = 0;
	for (u32 index = 0; index < source.functions.size(); ++index) {
		const Blua32TestFunction& function = source.functions[index];
		u8* record = bytes.data() + functionTableOffset + index * BLUA32_FUNCTION_RECORD_SIZE;
		writeLE32(
			record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
			textAddress + function.firstWord * INSTRUCTION_BYTES
		);
		writeLE32(
			record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
			function.wordCount * INSTRUCTION_BYTES
		);
		writeLE32(record + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, function.numParams);
		writeLE32(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, function.maxStack);
		writeLE32(
			record + BLUA32_FUNCTION_FLAGS_OFFSET,
			(function.isVararg ? BLUA32_FUNCTION_VARARG : 0u)
				| (function.staticClosure ? BLUA32_FUNCTION_STATIC : 0u)
		);
		writeLE32(
			record + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
			imageAddress + upvalueTableOffset + upvalueIndex * BLUA32_UPVALUE_RECORD_SIZE
		);
		writeLE32(
			record + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
			static_cast<u32>(function.upvalues.size())
		);
		for (const Blua32UpvalueRecord& upvalue : function.upvalues) {
			writeLE32(
				bytes.data() + upvalueTableOffset + upvalueIndex * BLUA32_UPVALUE_RECORD_SIZE,
				(upvalue.inStack ? BLUA32_UPVALUE_IN_STACK_MASK : 0u)
					| (upvalue.index & BLUA32_UPVALUE_INDEX_MASK)
			);
			upvalueIndex += 1u;
		}
	}

	for (u32 index = 0; index < source.constants.size(); ++index) {
		const Blua32EncodedConstant& constant = source.constants[index];
		u8* record = bytes.data() + constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		if (std::holds_alternative<std::monostate>(constant)) {
			writeLE32(
				record + BLUA32_CONSTANT_TAG_OFFSET,
				static_cast<u32>(Blua32ConstantTag::Nil)
			);
		} else if (const auto* boolean = std::get_if<bool>(&constant)) {
			writeLE32(
				record + BLUA32_CONSTANT_TAG_OFFSET,
				static_cast<u32>(*boolean ? Blua32ConstantTag::True : Blua32ConstantTag::False)
			);
		} else if (const auto* number = std::get_if<f64>(&constant)) {
			writeLE32(
				record + BLUA32_CONSTANT_TAG_OFFSET,
				static_cast<u32>(Blua32ConstantTag::Number)
			);
			writeF64LE(
				record + BLUA32_CONSTANT_PAYLOAD_OFFSET,
				*number
			);
		} else {
			const StringRecord string = stringRecords.at(std::get<std::string>(constant));
			writeLE32(
				record + BLUA32_CONSTANT_TAG_OFFSET,
				static_cast<u32>(Blua32ConstantTag::String)
			);
			writeLE32(
				record + BLUA32_CONSTANT_PAYLOAD_OFFSET,
				stringAddress + string.offset
			);
			writeLE32(
				record + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET,
				string.byteCount
			);
		}
	}

	auto writeNameTable = [&](u32 tableOffset, const std::vector<std::string>& names) {
		for (u32 index = 0; index < names.size(); ++index) {
			const StringRecord string = stringRecords.at(names[index]);
			u8* record = bytes.data() + tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			writeLE32(
				record + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET,
				stringAddress + string.offset
			);
			writeLE32(
				record + BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET,
				string.byteCount
			);
		}
	};
	writeNameTable(globalNameTableOffset, source.globalNames);
	writeNameTable(systemGlobalNameTableOffset, source.systemGlobalNames);
	std::copy(strings.begin(), strings.end(), bytes.begin() + stringOffset);
	std::copy(text.begin(), text.end(), bytes.begin() + textOffset);
	return bytes;
}

auto encodeRom(
	RomImageDomain domain,
	std::span<const u8> image,
	std::span<const u8> toolingSymbols,
	const Blua32BootHeader& boot,
	const CartManifest& manifestConfig
) -> std::vector<u8> {
	const std::vector<u8> manifest = domain == RomImageDomain::Cartridge
		? encodeManifest(manifestConfig)
		: std::vector<u8>();
	RomTocPayload tocPayload;
	if (!image.empty()) {
		const AssetToken token = hashAssetId(BLUA32_IMAGE_ID);
		RomTocEntry entry;
		entry.resid = BLUA32_IMAGE_ID;
		entry.type = AssetType::Code;
		entry.id_token_lo = token.lo;
		entry.id_token_hi = token.hi;
		entry.start = BLUA32_TEST_IMAGE_OFFSET;
		entry.end = BLUA32_TEST_IMAGE_OFFSET
			+ static_cast<u32>(image.size());
		tocPayload.entries.push_back(std::move(entry));
	}
	const u32 symbolsOffset = alignOffset(
		BLUA32_TEST_IMAGE_OFFSET + static_cast<u32>(image.size()),
		0u,
		CART_ROM_WORD_ALIGNMENT
	);
	if (!toolingSymbols.empty()) {
		const AssetToken token = hashAssetId(BLUA32_SYMBOLS_IMAGE_ID);
		RomTocEntry entry;
		entry.resid = BLUA32_SYMBOLS_IMAGE_ID;
		entry.type = AssetType::Code;
		entry.id_token_lo = token.lo;
		entry.id_token_hi = token.hi;
		entry.start = symbolsOffset;
		entry.end = symbolsOffset + static_cast<u32>(toolingSymbols.size());
		tocPayload.entries.push_back(std::move(entry));
	}
	const std::vector<u8> toc = encodeRomToc(tocPayload);
	const u32 imageEnd = image.empty()
		? CART_ROM_HEADER_SIZE + static_cast<u32>(manifest.size())
		: BLUA32_TEST_IMAGE_OFFSET + static_cast<u32>(image.size());
	const u32 payloadEnd = toolingSymbols.empty()
		? imageEnd
		: symbolsOffset + static_cast<u32>(toolingSymbols.size());
	const u32 tocOffset = alignOffset(payloadEnd, 0u, CART_ROM_WORD_ALIGNMENT);
	std::vector<u8> rom(tocOffset + toc.size());
	std::copy(manifest.begin(), manifest.end(), rom.begin() + CART_ROM_HEADER_SIZE);
	if (!image.empty()) {
		std::copy(image.begin(), image.end(), rom.begin() + BLUA32_TEST_IMAGE_OFFSET);
	}
	if (!toolingSymbols.empty()) {
		std::copy(toolingSymbols.begin(), toolingSymbols.end(), rom.begin() + symbolsOffset);
	}
	std::copy(toc.begin(), toc.end(), rom.begin() + tocOffset);

	CartRomHeader header;
	header.headerSize = CART_ROM_HEADER_SIZE;
	header.manifestOffset = CART_ROM_HEADER_SIZE;
	header.manifestLength = static_cast<u32>(manifest.size());
	header.tocOffset = tocOffset;
	header.tocLength = static_cast<u32>(toc.size());
	header.dataOffset = image.empty() ? CART_ROM_HEADER_SIZE : BLUA32_TEST_IMAGE_OFFSET;
	header.dataLength = static_cast<u32>(image.size());
	header.blua32ImageOffset = boot.imageOffset;
	header.blua32ImageByteCount = boot.imageByteCount;
	header.blua32StartupFunctionAddress = boot.startupFunctionAddress;
	header.blua32IrqFunctionAddress = boot.irqFunctionAddress;
	header.blua32ExceptionFunctionAddress = boot.exceptionFunctionAddress;
	header.blua32StaticLayoutTokenLo = boot.staticLayoutTokenLo;
	header.blua32StaticLayoutTokenHi = boot.staticLayoutTokenHi;
	writeCartRomHeader(rom.data(), header);
	return rom;
}

} // namespace

auto encodeBlua32TestRom(
	RomImageDomain domain,
	const Blua32TestImage& image
) -> Blua32TestRom {
	CartManifest manifest;
	if (domain == RomImageDomain::Cartridge) {
		manifest.hardware.emplace_back(CartridgeRomDeviceConfig{});
	}
	return encodeBlua32TestRom(domain, image, manifest);
}

auto encodeBlua32TestRom(
	RomImageDomain domain,
	const Blua32TestImage& image,
	const CartManifest& manifest
) -> Blua32TestRom {
	Blua32TestRom rom;
	const std::vector<u8> executable = encodeImage(domain, image, rom.functionAddresses);
	rom.textAddress = readLE32(executable.data() + BLUA32_IMAGE_TEXT_ADDRESS_OFFSET);
	rom.boot.imageOffset = BLUA32_TEST_IMAGE_OFFSET;
	rom.boot.imageByteCount = static_cast<u32>(executable.size());
	rom.boot.startupFunctionAddress = rom.functionAddresses[image.startupFunctionIndex];
	rom.boot.irqFunctionAddress = rom.functionAddresses[image.irqFunctionIndex];
	rom.boot.exceptionFunctionAddress = rom.functionAddresses[image.exceptionFunctionIndex];
	rom.bytes = encodeRom(
		domain,
		executable,
		image.toolingSymbols,
		rom.boot,
		manifest
	);
	return rom;
}

void programBlua32TestResetVector(Blua32TestRom& rom, u32 functionIndex) {
	rom.boot.startupFunctionAddress = rom.functionAddresses[functionIndex];
	CartRomHeader header = parseCartHeader(rom.bytes.data(), rom.bytes.size());
	header.blua32StartupFunctionAddress = rom.boot.startupFunctionAddress;
	writeCartRomHeader(rom.bytes.data(), header);
}

auto encodeBlua32TestDataRom(const CartManifest& manifest) -> std::vector<u8> {
	return encodeRom(
		RomImageDomain::Cartridge,
		{},
		{},
		{},
		manifest
	);
}

auto encodeBlua32TestDataRom() -> std::vector<u8> {
	CartManifest manifest;
	manifest.hardware.emplace_back(CartridgeRomDeviceConfig{});
	return encodeBlua32TestDataRom(manifest);
}

} // namespace bmsx::test
