#include "blua32_image.h"

#include "common/endian.h"

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
			readLE32(record),
			readLE32(record + 4)
		));
	}
	return names;
}

} // namespace

auto decodeBlua32BootHeader(std::span<const u8> bytes) -> Blua32BootHeader {
	Blua32BootHeader header;
	header.imageOffset = readLE32(bytes.data() + 32);
	header.imageByteCount = readLE32(bytes.data() + 36);
	header.startupFunctionAddress = readLE32(bytes.data() + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET);
	header.irqFunctionAddress = readLE32(bytes.data() + 44);
	header.exceptionFunctionAddress = readLE32(bytes.data() + 48);
	header.staticLayoutTokenLo = readLE32(bytes.data() + 52);
	header.staticLayoutTokenHi = readLE32(bytes.data() + 56);
	return header;
}

auto decodeBlua32Image(std::span<const u8> bytes, u32 imageAddress) -> Blua32ImageLayout {
	if (bytes.size() < BLUA32_IMAGE_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("BLua32 image is smaller than its header.");
	}
	if (readLE32(bytes.data()) != BLUA32_IMAGE_MAGIC) {
		throw BMSX_RUNTIME_ERROR("BLua32 image magic is invalid.");
	}
	if (readLE32(bytes.data() + 4) != BLUA32_IMAGE_VERSION) {
		throw BMSX_RUNTIME_ERROR("BLua32 image version is unsupported.");
	}

	Blua32ImageLayout image;
	image.address = imageAddress;
	image.bytes = bytes;
	Blua32ImageHeader& header = image.header;
	header.imageByteCount = readLE32(bytes.data() + 8);
	header.flags = readLE32(bytes.data() + 12);
	header.functionTableAddress = readLE32(bytes.data() + 16);
	header.functionCount = readLE32(bytes.data() + 20);
	header.constantTableAddress = readLE32(bytes.data() + 24);
	header.constantCount = readLE32(bytes.data() + 28);
	header.globalNameTableAddress = readLE32(bytes.data() + 32);
	header.globalNameCount = readLE32(bytes.data() + 36);
	header.systemGlobalNameTableAddress = readLE32(bytes.data() + 40);
	header.systemGlobalNameCount = readLE32(bytes.data() + 44);
	header.stringAddress = readLE32(bytes.data() + 48);
	header.stringByteCount = readLE32(bytes.data() + 52);
	header.rodataAddress = readLE32(bytes.data() + 56);
	header.rodataByteCount = readLE32(bytes.data() + 60);
	header.dataLoadAddress = readLE32(bytes.data() + 64);
	header.dataByteCount = readLE32(bytes.data() + 68);
	header.dataAddress = readLE32(bytes.data() + 72);
	header.bssAddress = readLE32(bytes.data() + 76);
	header.bssByteCount = readLE32(bytes.data() + 80);
	header.textAddress = readLE32(bytes.data() + 84);
	header.textByteCount = readLE32(bytes.data() + 88);

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
		function.codeAddress = readLE32(record);
		function.codeByteCount = readLE32(record + 4);
		function.numParams = readLE32(record + 8);
		function.maxStack = readLE32(record + 12);
		const u32 flags = readLE32(record + 16);
		function.isVararg = (flags & BLUA32_FUNCTION_VARARG) != 0u;
		function.staticClosure = (flags & BLUA32_FUNCTION_STATIC) != 0u;
		const u32 upvalueTableAddress = readLE32(record + 20);
		const u32 upvalueCount = readLE32(record + 24);
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
				(word & 0x80000000u) != 0u,
				word & 0x7fffffffu,
			});
		}
		image.functions.push_back(std::move(function));
	}

	const u32 constantTableOffset = header.constantTableAddress - imageAddress;
	image.constants.reserve(header.constantCount);
	for (u32 index = 0; index < header.constantCount; ++index) {
		const u8* record = bytes.data() + constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		switch (static_cast<Blua32ConstantTag>(readLE32(record))) {
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
				image.constants.emplace_back(std::bit_cast<f64>(readLE64(record + 4)));
				break;
			case Blua32ConstantTag::String:
				image.constants.emplace_back(decodeString(
					bytes,
					header,
					imageAddress,
					readLE32(record + 4),
					readLE32(record + 8)
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
