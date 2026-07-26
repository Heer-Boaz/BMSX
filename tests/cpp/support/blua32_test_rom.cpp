#include "blua32_test_rom.h"

#include "common/endian.h"
#include "common/serializer/binencoder.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/memory/map.h"
#include "rompack/toc.h"
#include "rompack/tooling/blua32_symbols.h"

#include <algorithm>
#include <bit>
#include <cstring>
#include <span>
#include <unordered_map>

namespace bmsx::test {
namespace {

auto alignOffset(u32 offset, u32 address, u32 alignment) -> u32 {
	const u32 value = address + offset;
	return ((value + alignment - 1u) & ~(alignment - 1u)) - address;
}

auto encodeManifest() -> std::vector<u8> {
	BinObject machine;
	machine["namespace"] = BinValue("test");
	machine["vdp_class"] = BinValue("psx");
	BinObject lua;
	lua["entry_path"] = BinValue("boot");
	BinObject manifest;
	manifest["machine"] = BinValue(std::move(machine));
	manifest["lua"] = BinValue(std::move(lua));
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
	offset = upvalueTableOffset;
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
	writeLE32(bytes.data(), BLUA32_IMAGE_MAGIC);
	writeLE32(bytes.data() + 4u, BLUA32_IMAGE_VERSION);
	writeLE32(bytes.data() + 8u, imageByteCount);
	writeLE32(bytes.data() + 12u, 0u);
	writeLE32(bytes.data() + 16u, functionTableAddress);
	writeLE32(bytes.data() + 20u, static_cast<u32>(source.functions.size()));
	writeLE32(bytes.data() + 24u, imageAddress + constantTableOffset);
	writeLE32(bytes.data() + 28u, static_cast<u32>(source.constants.size()));
	writeLE32(bytes.data() + 32u, imageAddress + globalNameTableOffset);
	writeLE32(bytes.data() + 36u, static_cast<u32>(source.globalNames.size()));
	writeLE32(bytes.data() + 40u, imageAddress + systemGlobalNameTableOffset);
	writeLE32(bytes.data() + 44u, static_cast<u32>(source.systemGlobalNames.size()));
	writeLE32(bytes.data() + 48u, stringAddress);
	writeLE32(bytes.data() + 52u, static_cast<u32>(strings.size()));
	writeLE32(bytes.data() + 56u, textAddress);
	writeLE32(bytes.data() + 60u, 0u);
	writeLE32(bytes.data() + 64u, textAddress);
	writeLE32(bytes.data() + 68u, 0u);
	writeLE32(bytes.data() + 72u, RAM_BASE + MIN_RAM_SIZE);
	writeLE32(bytes.data() + 76u, RAM_BASE + MIN_RAM_SIZE);
	writeLE32(bytes.data() + 80u, 0u);
	writeLE32(bytes.data() + 84u, textAddress);
	writeLE32(bytes.data() + 88u, static_cast<u32>(text.size()));
	writeLE32(bytes.data() + 92u, 0u);

	for (u32 index = 0; index < source.functions.size(); ++index) {
		const Blua32TestFunction& function = source.functions[index];
		u8* record = bytes.data() + functionTableOffset + index * BLUA32_FUNCTION_RECORD_SIZE;
		writeLE32(record, textAddress + function.firstWord * INSTRUCTION_BYTES);
		writeLE32(record + 4u, function.wordCount * INSTRUCTION_BYTES);
		writeLE32(record + 8u, function.numParams);
		writeLE32(record + 12u, function.maxStack);
		writeLE32(
			record + 16u,
			(function.isVararg ? BLUA32_FUNCTION_VARARG : 0u)
				| (function.staticClosure ? BLUA32_FUNCTION_STATIC : 0u)
		);
		writeLE32(record + 20u, imageAddress + upvalueTableOffset);
		writeLE32(record + 24u, 0u);
		writeLE32(record + 28u, 0u);
	}

	for (u32 index = 0; index < source.constants.size(); ++index) {
		const Blua32EncodedConstant& constant = source.constants[index];
		u8* record = bytes.data() + constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		if (std::holds_alternative<std::monostate>(constant)) {
			writeLE32(record, static_cast<u32>(Blua32ConstantTag::Nil));
		} else if (const auto* boolean = std::get_if<bool>(&constant)) {
			writeLE32(
				record,
				static_cast<u32>(*boolean ? Blua32ConstantTag::True : Blua32ConstantTag::False)
			);
		} else if (const auto* number = std::get_if<f64>(&constant)) {
			writeLE32(record, static_cast<u32>(Blua32ConstantTag::Number));
			writeLE64(record + 4u, std::bit_cast<u64>(*number));
		} else {
			const StringRecord string = stringRecords.at(std::get<std::string>(constant));
			writeLE32(record, static_cast<u32>(Blua32ConstantTag::String));
			writeLE32(record + 4u, stringAddress + string.offset);
			writeLE32(record + 8u, string.byteCount);
		}
	}

	auto writeNameTable = [&](u32 tableOffset, const std::vector<std::string>& names) {
		for (u32 index = 0; index < names.size(); ++index) {
			const StringRecord string = stringRecords.at(names[index]);
			u8* record = bytes.data() + tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			writeLE32(record, stringAddress + string.offset);
			writeLE32(record + 4u, string.byteCount);
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
	u32 cartridgeBoardWord,
	u32 cartridgeRamByteCount
) -> std::vector<u8> {
	const std::vector<u8> manifest = domain == RomImageDomain::Cartridge
		? encodeManifest()
		: std::vector<u8>();
	RomTocPayload tocPayload;
	if (!image.empty()) {
		RomAssetInfo rom;
		rom.type = "code";
		rom.start = static_cast<i32>(BLUA32_TEST_IMAGE_OFFSET);
		rom.end = static_cast<i32>(BLUA32_TEST_IMAGE_OFFSET + image.size());
		tocPayload.entries.push_back(RomSourceEntry{BLUA32_IMAGE_ID, std::move(rom)});
	}
	const u32 symbolsOffset = alignOffset(
		BLUA32_TEST_IMAGE_OFFSET + static_cast<u32>(image.size()),
		0u,
		CART_ROM_WORD_ALIGNMENT
	);
	if (!toolingSymbols.empty()) {
		RomAssetInfo rom;
		rom.type = "code";
		rom.start = static_cast<i32>(symbolsOffset);
		rom.end = static_cast<i32>(symbolsOffset + toolingSymbols.size());
		tocPayload.entries.push_back(RomSourceEntry{BLUA32_SYMBOLS_IMAGE_ID, std::move(rom)});
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
	header.vdpClass = MachineVdpClass::Psx;
	header.cartridgeBoardWord = cartridgeBoardWord;
	header.cartridgeRamByteCount = cartridgeRamByteCount;
	writeCartRomHeader(rom.data(), header);
	return rom;
}

} // namespace

auto encodeBlua32TestRom(
	RomImageDomain domain,
	const Blua32TestImage& image,
	u32 cartridgeBoardWord,
	u32 cartridgeRamByteCount
) -> Blua32TestRom {
	Blua32TestRom rom;
	const std::vector<u8> executable = encodeImage(domain, image, rom.functionAddresses);
	rom.textAddress = readLE32(executable.data() + 84u);
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
		cartridgeBoardWord,
		cartridgeRamByteCount
	);
	return rom;
}

void programBlua32TestResetVector(Blua32TestRom& rom, u32 functionIndex) {
	rom.boot.startupFunctionAddress = rom.functionAddresses[functionIndex];
	CartRomHeader header = parseCartHeader(rom.bytes.data(), rom.bytes.size());
	header.blua32StartupFunctionAddress = rom.boot.startupFunctionAddress;
	writeCartRomHeader(rom.bytes.data(), header);
}

auto encodeBlua32TestDataRom(
	u32 cartridgeBoardWord,
	u32 cartridgeRamByteCount
) -> std::vector<u8> {
	return encodeRom(
		RomImageDomain::Cartridge,
		{},
		{},
		{},
		cartridgeBoardWord,
		cartridgeRamByteCount
	);
}

} // namespace bmsx::test
