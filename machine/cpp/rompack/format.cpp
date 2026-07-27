/*
 * format.cpp - ROM pack utilities
 */

#include "format.h"
#include "common/endian.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_header.h"
#include <algorithm>
#include <cstring>

namespace bmsx {
namespace {

void assertSectionRange(size_t offset, size_t length, size_t total, const char* label) {
	if (offset > total || length > total - offset) {
		throw BMSX_RUNTIME_ERROR(std::string("Invalid ROM ") + label + " range.");
	}
}

} // namespace

void writeCartRomHeader(u8* data, const CartRomHeader& header) {
	std::copy(CART_ROM_MAGIC_BYTES.begin(), CART_ROM_MAGIC_BYTES.end(), data);
	writeLE32(data + 4, header.headerSize);
	writeLE32(data + 8, header.manifestOffset);
	writeLE32(data + 12, header.manifestLength);
	writeLE32(data + 16, header.tocOffset);
	writeLE32(data + 20, header.tocLength);
	writeLE32(data + 24, header.dataOffset);
	writeLE32(data + 28, header.dataLength);
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
	writeLE32(data + 60, 0u);
	writeLE32(data + 64, header.metadataOffset);
	writeLE32(data + 68, header.metadataLength);
	switch (header.vdpClass) {
	case MachineVdpClass::Psx:
		writeLE32(data + 72, CART_VDP_CLASS_PSX);
		break;
	}
	writeLE32(data + 76, header.cartridgeBoardWord);
	writeLE32(data + 80, header.cartridgeRamByteCount);
}

CartRomHeader parseCartHeader(const u8* data, size_t size) {
	if (size < CART_ROM_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM payload is too small for cart header.");
	}
	if (std::memcmp(data, CART_ROM_MAGIC_BYTES.data(), CART_ROM_MAGIC_BYTES.size()) != 0) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM cart header.");
	}
	CartRomHeader header{};
	header.headerSize = readLE32(data + 4);
	if (header.headerSize < CART_ROM_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM header size is too small.");
	}
	if (header.headerSize > size) {
		throw BMSX_RUNTIME_ERROR("ROM header size exceeds payload length.");
	}
	header.manifestOffset = readLE32(data + 8);
	header.manifestLength = readLE32(data + 12);
	header.tocOffset = readLE32(data + 16);
	header.tocLength = readLE32(data + 20);
	header.dataOffset = readLE32(data + 24);
	header.dataLength = readLE32(data + 28);
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
	header.metadataOffset = readLE32(data + 64);
	header.metadataLength = readLE32(data + 68);
	const u32 vdpClassWord = readLE32(data + 72);
	if (vdpClassWord != CART_VDP_CLASS_PSX) {
		throw BMSX_RUNTIME_ERROR("Unsupported ROM VDP class marker.");
	}
	header.vdpClass = MachineVdpClass::Psx;
	header.cartridgeBoardWord = readLE32(data + 76);
	header.cartridgeRamByteCount = readLE32(data + 80);
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
