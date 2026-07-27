#include "blua32_image.h"

#include "common/endian.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/rom_header.h"

#include <bit>
#include <utility>

namespace bmsx {
namespace {

auto imageOffset(u32 address, u64 byteCount, u32 imageAddress, u32 imageByteCount) -> u32 {
	if (address < imageAddress) {
		throw BMSX_RUNTIME_ERROR("BLua32 image record points outside the executable image.");
	}
	const u32 offset = address - imageAddress;
	if (offset > imageByteCount || byteCount > imageByteCount - offset) {
		throw BMSX_RUNTIME_ERROR("BLua32 image record points outside the executable image.");
	}
	return offset;
}

auto decodeString(
	std::span<const u8> bytes,
	const Blua32ImageHeader& header,
	u32 imageAddress,
	u32 address,
	u32 byteCount
) -> std::string {
	if (address < header.stringAddress) {
		throw BMSX_RUNTIME_ERROR("BLua32 string record points outside the string table.");
	}
	const u32 relativeAddress = address - header.stringAddress;
	if (relativeAddress > header.stringByteCount
		|| byteCount > header.stringByteCount - relativeAddress) {
		throw BMSX_RUNTIME_ERROR("BLua32 string record points outside the string table.");
	}
	const u32 stringOffset = header.stringAddress - imageAddress;
	const u32 offset = stringOffset + relativeAddress;
	return std::string(
		reinterpret_cast<const char*>(bytes.data() + offset),
		static_cast<size_t>(byteCount)
	);
}

auto decodeNames(
	std::span<const u8> bytes,
	const Blua32ImageHeader& header,
	u32 imageAddress,
	u32 tableAddress,
	u32 count
) -> std::vector<std::string> {
	const u32 tableOffset = tableAddress - imageAddress;
	std::vector<std::string> names;
	names.reserve(count);
	for (u32 index = 0; index < count; ++index) {
		const u8* record = bytes.data() + tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
		names.push_back(decodeString(
			bytes,
			header,
			imageAddress,
			readLE32(record + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET),
			readLE32(record + BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET)
		));
	}
	return names;
}

} // namespace

auto decodeBlua32BootHeader(std::span<const u8> bytes) -> Blua32BootHeader {
	Blua32BootHeader header;
	header.imageOffset = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET
	);
	header.imageByteCount = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET
	);
	header.startupFunctionAddress = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET
	);
	header.irqFunctionAddress = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET
	);
	header.exceptionFunctionAddress = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET
	);
	header.staticLayoutTokenLo = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET
	);
	header.staticLayoutTokenHi = readLE32(
		bytes.data() + BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET
	);
	return header;
}

auto decodeBlua32RomImage(std::span<const u8> bytes, u32 romBaseAddress) -> std::optional<Blua32ImageLayout> {
	const Blua32BootHeader boot = decodeBlua32BootHeader(bytes);
	if (boot.imageOffset == 0u) {
		return std::nullopt;
	}
	return decodeBlua32Image(
		bytes.subspan(boot.imageOffset, boot.imageByteCount),
		romBaseAddress + boot.imageOffset
	);
}

auto decodeBlua32Image(std::span<const u8> bytes, u32 imageAddress) -> Blua32ImageLayout {
	if (bytes.size() < BLUA32_IMAGE_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("BLua32 image is smaller than its header.");
	}
	if (readLE32(bytes.data() + BLUA32_IMAGE_MAGIC_OFFSET) != BLUA32_IMAGE_MAGIC) {
		throw BMSX_RUNTIME_ERROR("BLua32 image magic is invalid.");
	}
	if (readLE32(bytes.data() + BLUA32_IMAGE_VERSION_OFFSET) != BLUA32_IMAGE_VERSION) {
		throw BMSX_RUNTIME_ERROR("BLua32 image version is unsupported.");
	}

	Blua32ImageLayout image;
	image.address = imageAddress;
	image.bytes = bytes;
	Blua32ImageHeader& header = image.header;
	header.imageByteCount = readLE32(bytes.data() + BLUA32_IMAGE_BYTE_COUNT_OFFSET);
	header.flags = readLE32(bytes.data() + BLUA32_IMAGE_FLAGS_OFFSET);
	header.functionTableAddress = readLE32(
		bytes.data() + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET
	);
	header.functionCount = readLE32(bytes.data() + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET);
	header.constantTableAddress = readLE32(
		bytes.data() + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET
	);
	header.constantCount = readLE32(bytes.data() + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET);
	header.globalNameTableAddress = readLE32(
		bytes.data() + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET
	);
	header.globalNameCount = readLE32(
		bytes.data() + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET
	);
	header.systemGlobalNameTableAddress = readLE32(
		bytes.data() + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET
	);
	header.systemGlobalNameCount = readLE32(
		bytes.data() + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET
	);
	header.stringAddress = readLE32(bytes.data() + BLUA32_IMAGE_STRING_ADDRESS_OFFSET);
	header.stringByteCount = readLE32(
		bytes.data() + BLUA32_IMAGE_STRING_BYTE_COUNT_OFFSET
	);
	header.rodataAddress = readLE32(bytes.data() + BLUA32_IMAGE_RODATA_ADDRESS_OFFSET);
	header.rodataByteCount = readLE32(
		bytes.data() + BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET
	);
	header.dataLoadAddress = readLE32(
		bytes.data() + BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET
	);
	header.dataByteCount = readLE32(bytes.data() + BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET);
	header.dataAddress = readLE32(bytes.data() + BLUA32_IMAGE_DATA_ADDRESS_OFFSET);
	header.bssAddress = readLE32(bytes.data() + BLUA32_IMAGE_BSS_ADDRESS_OFFSET);
	header.bssByteCount = readLE32(bytes.data() + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET);
	header.textAddress = readLE32(bytes.data() + BLUA32_IMAGE_TEXT_ADDRESS_OFFSET);
	header.textByteCount = readLE32(bytes.data() + BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET);

	if (header.imageByteCount != bytes.size()) {
		throw BMSX_RUNTIME_ERROR("BLua32 image byte count does not match its ROM record.");
	}
	if ((header.functionTableAddress & (BLUA32_FUNCTION_ALIGNMENT - 1u)) != 0u) {
		throw BMSX_RUNTIME_ERROR("BLua32 function table is not aligned.");
	}
	if ((header.textAddress & 3u) != 0u || (header.textByteCount & 3u) != 0u) {
		throw BMSX_RUNTIME_ERROR("BLua32 text is not word aligned.");
	}

	const u32 functionTableOffset = imageOffset(
		header.functionTableAddress,
		static_cast<u64>(header.functionCount) * BLUA32_FUNCTION_RECORD_SIZE,
		imageAddress,
		header.imageByteCount
	);
	imageOffset(header.constantTableAddress, static_cast<u64>(header.constantCount) * BLUA32_CONSTANT_RECORD_SIZE, imageAddress, header.imageByteCount);
	imageOffset(header.globalNameTableAddress, static_cast<u64>(header.globalNameCount) * BLUA32_GLOBAL_NAME_RECORD_SIZE, imageAddress, header.imageByteCount);
	imageOffset(header.systemGlobalNameTableAddress, static_cast<u64>(header.systemGlobalNameCount) * BLUA32_GLOBAL_NAME_RECORD_SIZE, imageAddress, header.imageByteCount);
	imageOffset(header.stringAddress, header.stringByteCount, imageAddress, header.imageByteCount);
	const u32 rodataOffset = imageOffset(header.rodataAddress, header.rodataByteCount, imageAddress, header.imageByteCount);
	const u32 dataLoadOffset = imageOffset(header.dataLoadAddress, header.dataByteCount, imageAddress, header.imageByteCount);
	const u32 textOffset = imageOffset(header.textAddress, header.textByteCount, imageAddress, header.imageByteCount);
	image.rodataBytes = bytes.subspan(rodataOffset, header.rodataByteCount);
	image.dataLoadBytes = bytes.subspan(dataLoadOffset, header.dataByteCount);
	image.textBytes = bytes.subspan(textOffset, header.textByteCount);

	image.functions.reserve(header.functionCount);
	for (u32 index = 0; index < header.functionCount; ++index) {
		const u8* record = bytes.data() + functionTableOffset + index * BLUA32_FUNCTION_RECORD_SIZE;
		Blua32FunctionRecord function;
		function.address = header.functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE;
		function.codeAddress = readLE32(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		function.codeByteCount = readLE32(
			record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET
		);
		function.numParams = readLE32(record + BLUA32_FUNCTION_NUM_PARAMS_OFFSET);
		function.maxStack = readLE32(record + BLUA32_FUNCTION_MAX_STACK_OFFSET);
		const u32 flags = readLE32(record + BLUA32_FUNCTION_FLAGS_OFFSET);
		function.isVararg = (flags & BLUA32_FUNCTION_VARARG) != 0u;
		function.staticClosure = (flags & BLUA32_FUNCTION_STATIC) != 0u;
		const u32 upvalueTableAddress = readLE32(
			record + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET
		);
		const u32 upvalueCount = readLE32(record + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
		if ((function.codeAddress & 3u) != 0u
			|| (function.codeByteCount & 3u) != 0u
			|| function.codeAddress < header.textAddress
			|| static_cast<u64>(function.codeAddress) + function.codeByteCount
				> static_cast<u64>(header.textAddress) + header.textByteCount) {
			throw BMSX_RUNTIME_ERROR("BLua32 function text range is invalid.");
		}
		const u32 upvalueTableOffset = imageOffset(
			upvalueTableAddress,
			static_cast<u64>(upvalueCount) * BLUA32_UPVALUE_RECORD_SIZE,
			imageAddress,
			header.imageByteCount
		);
		function.upvalues.reserve(upvalueCount);
		for (u32 upvalueIndex = 0; upvalueIndex < upvalueCount; ++upvalueIndex) {
			const u32 word = readLE32(bytes.data() + upvalueTableOffset + upvalueIndex * BLUA32_UPVALUE_RECORD_SIZE);
			function.upvalues.push_back(Blua32UpvalueRecord{
				(word & BLUA32_UPVALUE_IN_STACK_MASK) != 0u,
				word & BLUA32_UPVALUE_INDEX_MASK,
			});
		}
		image.functions.push_back(std::move(function));
	}

	const u32 constantTableOffset = header.constantTableAddress - imageAddress;
	image.constants.reserve(header.constantCount);
	for (u32 index = 0; index < header.constantCount; ++index) {
		const u8* record = bytes.data() + constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		switch (static_cast<Blua32ConstantTag>(
			readLE32(record + BLUA32_CONSTANT_TAG_OFFSET)
		)) {
			case Blua32ConstantTag::Nil:
				image.constants.emplace_back(std::monostate{});
				break;
			case Blua32ConstantTag::False:
				image.constants.emplace_back(false);
				break;
			case Blua32ConstantTag::True:
				image.constants.emplace_back(true);
				break;
			case Blua32ConstantTag::Number:
				image.constants.emplace_back(std::bit_cast<f64>(
					readLE64(record + BLUA32_CONSTANT_PAYLOAD_OFFSET)
				));
				break;
			case Blua32ConstantTag::String:
				image.constants.emplace_back(decodeString(
					bytes,
					header,
					imageAddress,
					readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET),
					readLE32(record + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET)
				));
				break;
			default:
				throw BMSX_RUNTIME_ERROR("BLua32 constant tag is invalid.");
		}
	}

	image.globalNames = decodeNames(
		bytes,
		header,
		imageAddress,
		header.globalNameTableAddress,
		header.globalNameCount
	);
	image.systemGlobalNames = decodeNames(
		bytes,
		header,
		imageAddress,
		header.systemGlobalNameTableAddress,
		header.systemGlobalNameCount
	);
	return image;
}

} // namespace bmsx
