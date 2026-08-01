/*
 * format.cpp - ROM pack utilities
 */

#include "format.h"
#include "common/endian.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_header.h"

namespace bmsx {
namespace {

void assertSectionRange(size_t offset, size_t length, size_t total, const char* label) {
	if (offset > total || length > total - offset) {
		throw BMSX_RUNTIME_ERROR(std::string("Invalid ROM ") + label + " range.");
	}
}

} // namespace

void writeCartRomHeader(u8* data, const CartRomHeader& header) {
	writeLE32(data + CART_ROM_HEADER_MAGIC_OFFSET, CART_ROM_MAGIC);
	writeLE32(data + CART_ROM_HEADER_SIZE_OFFSET, header.headerSize);
	writeLE32(data + CART_ROM_HEADER_MANIFEST_OFFSET, header.manifestOffset);
	writeLE32(data + CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET, header.manifestLength);
	writeLE32(data + CART_ROM_HEADER_TOC_OFFSET, header.tocOffset);
	writeLE32(data + CART_ROM_HEADER_TOC_LENGTH_OFFSET, header.tocLength);
	writeLE32(data + CART_ROM_HEADER_DATA_OFFSET, header.dataOffset);
	writeLE32(data + CART_ROM_HEADER_DATA_LENGTH_OFFSET, header.dataLength);
	writeLE32(data + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, header.blua32ImageOffset);
	writeLE32(
		data + BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET,
		header.blua32ImageByteCount
	);
	writeLE32(
		data + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
		header.blua32StartupFunctionAddress
	);
	writeLE32(
		data + BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
		header.blua32IrqFunctionAddress
	);
	writeLE32(
		data + BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
		header.blua32ExceptionFunctionAddress
	);
	writeLE32(
		data + BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET,
		header.blua32StaticLayoutTokenLo
	);
	writeLE32(
		data + BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET,
		header.blua32StaticLayoutTokenHi
	);
	writeLE32(
		data + CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET,
		header.blua32DiagnosticDirectoryOffset
	);
	writeLE32(data + CART_ROM_HEADER_METADATA_OFFSET, header.metadataOffset);
	writeLE32(data + CART_ROM_HEADER_METADATA_LENGTH_OFFSET, header.metadataLength);
	writeLE32(data + CART_ROM_HEADER_RESERVED_1_OFFSET, 0u);
	writeLE32(data + CART_ROM_HEADER_CARTRIDGE_BOARD_OFFSET, header.cartridgeBoardWord);
	writeLE32(data + CART_ROM_HEADER_CARTRIDGE_RAM_BYTES_OFFSET, header.cartridgeRamByteCount);
}

CartRomHeader parseCartHeader(const u8* data, size_t size) {
	if (size < CART_ROM_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM payload is too small for cart header.");
	}
	if (readLE32(data + CART_ROM_HEADER_MAGIC_OFFSET) != CART_ROM_MAGIC) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM cart header.");
	}
	CartRomHeader header{};
	header.headerSize = readLE32(data + CART_ROM_HEADER_SIZE_OFFSET);
	if (header.headerSize < CART_ROM_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM header size is too small.");
	}
	if (header.headerSize > size) {
		throw BMSX_RUNTIME_ERROR("ROM header size exceeds payload length.");
	}
	header.manifestOffset = readLE32(data + CART_ROM_HEADER_MANIFEST_OFFSET);
	header.manifestLength = readLE32(data + CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET);
	header.tocOffset = readLE32(data + CART_ROM_HEADER_TOC_OFFSET);
	header.tocLength = readLE32(data + CART_ROM_HEADER_TOC_LENGTH_OFFSET);
	header.dataOffset = readLE32(data + CART_ROM_HEADER_DATA_OFFSET);
	header.dataLength = readLE32(data + CART_ROM_HEADER_DATA_LENGTH_OFFSET);
	header.blua32ImageOffset = readLE32(data + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET);
	header.blua32ImageByteCount = readLE32(
		data + BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET
	);
	header.blua32StartupFunctionAddress = readLE32(
		data + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET
	);
	header.blua32IrqFunctionAddress = readLE32(
		data + BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET
	);
	header.blua32ExceptionFunctionAddress = readLE32(
		data + BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET
	);
	header.blua32StaticLayoutTokenLo = readLE32(
		data + BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET
	);
	header.blua32StaticLayoutTokenHi = readLE32(
		data + BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET
	);
	header.blua32DiagnosticDirectoryOffset = readLE32(
		data + CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET
	);
	header.metadataOffset = readLE32(data + CART_ROM_HEADER_METADATA_OFFSET);
	header.metadataLength = readLE32(data + CART_ROM_HEADER_METADATA_LENGTH_OFFSET);
	header.cartridgeBoardWord = readLE32(data + CART_ROM_HEADER_CARTRIDGE_BOARD_OFFSET);
	header.cartridgeRamByteCount = readLE32(data + CART_ROM_HEADER_CARTRIDGE_RAM_BYTES_OFFSET);
	if (header.cartridgeRamByteCount > CART_RAM_SIZE) {
		throw BMSX_RUNTIME_ERROR("Cartridge RAM byte count exceeds the socket aperture.");
	}

	assertSectionRange(static_cast<size_t>(header.manifestOffset), static_cast<size_t>(header.manifestLength), size, "manifest");
	assertSectionRange(static_cast<size_t>(header.tocOffset), static_cast<size_t>(header.tocLength), size, "toc");
	assertSectionRange(static_cast<size_t>(header.dataOffset), static_cast<size_t>(header.dataLength), size, "data");
	if (header.metadataLength > 0) {
		assertSectionRange(static_cast<size_t>(header.metadataOffset), static_cast<size_t>(header.metadataLength), size, "metadata");
	}
	return header;
}

} // namespace bmsx
