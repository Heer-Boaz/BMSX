/*
 * format.cpp - ROM pack utilities
 */

#include "format.h"
#include "common/endian.h"
#include "common/serializer/binencoder.h"
#include "machine/program/loader.h"
#include "rompack/toc.h"
#include <algorithm>
#include <cstring>
#include <utility>

namespace bmsx {
namespace {

void assertSectionRange(size_t offset, size_t length, size_t total, const char* label) {
	if (offset + length > total) {
		throw BMSX_RUNTIME_ERROR(std::string("Invalid ROM ") + label + " range.");
	}
}

constexpr u32 alignCartRomWordSection(u32 offset) {
	return (offset + static_cast<u32>(CART_ROM_WORD_ALIGNMENT - 1u))
		& ~static_cast<u32>(CART_ROM_WORD_ALIGNMENT - 1u);
}

void writeCartRomHeader(u8* data, const CartRomHeader& header) {
	std::copy(CART_ROM_MAGIC_BYTES.begin(), CART_ROM_MAGIC_BYTES.end(), data);
	writeLE32(data + 4, header.headerSize);
	writeLE32(data + 8, header.manifestOffset);
	writeLE32(data + 12, header.manifestLength);
	writeLE32(data + 16, header.tocOffset);
	writeLE32(data + 20, header.tocLength);
	writeLE32(data + 24, header.dataOffset);
	writeLE32(data + 28, header.dataLength);
	writeLE32(data + 32, header.programBootVersion);
	writeLE32(data + 36, header.programBootFlags);
	writeLE32(data + 40, header.programEntryProtoIndex);
	writeLE32(data + 44, header.programCodeByteCount);
	writeLE32(data + 48, header.programConstPoolCount);
	writeLE32(data + 52, header.programProtoCount);
	writeLE32(data + 56, header.programReserved0);
	writeLE32(data + 60, header.programConstRelocCount);
	writeLE32(data + 64, header.metadataOffset);
	writeLE32(data + 68, header.metadataLength);
	switch (header.vdpClass) {
	case MachineVdpClass::Psx:
		writeLE32(data + 72, CART_VDP_CLASS_PSX);
		break;
	}
}

std::vector<u8> encodeCartRom(const CartRomHeader& header,
	std::span<const u8> manifest,
	std::span<const u8> toc,
	std::span<const u8> data) {
	const size_t size = std::max({
		static_cast<size_t>(header.manifestOffset) + manifest.size(),
		static_cast<size_t>(header.tocOffset) + toc.size(),
		static_cast<size_t>(header.dataOffset) + data.size(),
	});
	std::vector<u8> rom(size);
	writeCartRomHeader(rom.data(), header);
	std::copy(manifest.begin(), manifest.end(), rom.begin() + header.manifestOffset);
	std::copy(toc.begin(), toc.end(), rom.begin() + header.tocOffset);
	std::copy(data.begin(), data.end(), rom.begin() + header.dataOffset);
	return rom;
}

} // namespace

bool hasCartHeader(const u8* data, size_t size) {
	if (size < CART_ROM_BASE_HEADER_SIZE) {
		return false;
	}
	if (std::memcmp(data, CART_ROM_MAGIC_BYTES.data(), CART_ROM_MAGIC_BYTES.size()) != 0) {
		return false;
	}
	const u32 headerSize = readLE32(data + 4);
	return headerSize >= CART_ROM_BASE_HEADER_SIZE && headerSize <= size;
}

CartRomHeader parseCartHeader(const u8* data, size_t size) {
	if (size < CART_ROM_BASE_HEADER_SIZE) {
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
	header.programBootVersion = readLE32(data + 32);
	header.programBootFlags = readLE32(data + 36);
	header.programEntryProtoIndex = readLE32(data + 40);
	header.programCodeByteCount = readLE32(data + 44);
	header.programConstPoolCount = readLE32(data + 48);
	header.programProtoCount = readLE32(data + 52);
	header.programReserved0 = readLE32(data + 56);
	header.programConstRelocCount = readLE32(data + 60);
	header.metadataOffset = readLE32(data + 64);
	header.metadataLength = readLE32(data + 68);
	const u32 vdpClassWord = readLE32(data + 72);
	if (vdpClassWord != CART_VDP_CLASS_PSX) {
		throw BMSX_RUNTIME_ERROR("Unsupported ROM VDP class marker.");
	}
	header.vdpClass = MachineVdpClass::Psx;

	assertSectionRange(static_cast<size_t>(header.manifestOffset), static_cast<size_t>(header.manifestLength), size, "manifest");
	assertSectionRange(static_cast<size_t>(header.tocOffset), static_cast<size_t>(header.tocLength), size, "toc");
	assertSectionRange(static_cast<size_t>(header.dataOffset), static_cast<size_t>(header.dataLength), size, "data");
	if (header.metadataLength > 0) {
		assertSectionRange(static_cast<size_t>(header.metadataOffset), static_cast<size_t>(header.metadataLength), size, "metadata");
	}
	return header;
}

std::vector<u8> encodeCartManifest(const CartManifest& cart) {
	BinObject machineObject;
	machineObject["namespace"] = BinValue(cart.machine.namespaceName);
	machineObject["vdp_class"] = BinValue(std::string("psx"));
	BinObject luaObject;
	luaObject["entry_path"] = BinValue(cart.entryPath);

	BinObject manifest;
	if (cart.title) manifest["title"] = BinValue(*cart.title);
	if (cart.shortName) manifest["short_name"] = BinValue(*cart.shortName);
	if (cart.romName) manifest["rom_name"] = BinValue(*cart.romName);
	manifest["machine"] = BinValue(std::move(machineObject));
	manifest["lua"] = BinValue(std::move(luaObject));
	return encodeBinary(BinValue(std::move(manifest)));
}

std::vector<u8> encodeProgramCartRom(const CartManifest& cart, const ProgramImage& image) {
	const EncodedProgramImage encodedProgram = encodeProgramImage(image);
	const size_t sectionByteCount = encodedProgram.sections.size();
	const std::vector<u8> manifest = encodeCartManifest(cart);

	CartRomHeader header{};
	header.headerSize = CART_ROM_HEADER_SIZE;
	header.manifestOffset = CART_ROM_HEADER_SIZE;
	header.manifestLength = static_cast<u32>(manifest.size());
	header.dataOffset = alignCartRomWordSection(header.manifestOffset + header.manifestLength);
	const size_t descriptorOffset = alignCartRomWordSection(static_cast<u32>(sectionByteCount));
	header.dataLength = static_cast<u32>(descriptorOffset + encodedProgram.descriptor.size());
	header.programBootVersion = PROGRAM_BOOT_HEADER_VERSION;
	header.programBootFlags = 0;
	header.programEntryProtoIndex = static_cast<u32>(image.vectors.resetProtoIndex);
	header.programCodeByteCount = static_cast<u32>(image.sections.text.code.size());
	header.programConstPoolCount = static_cast<u32>(image.sections.rodata.constPool.size());
	header.programProtoCount = static_cast<u32>(image.sections.text.protos.size());
	header.programConstRelocCount = 0;
	header.vdpClass = cart.machine.vdpClass;

	RomSourceEntry programEntry;
	programEntry.resid = PROGRAM_IMAGE_ID;
	programEntry.rom.type = "code";
	programEntry.rom.start = static_cast<i32>(header.dataOffset);
	programEntry.rom.end = static_cast<i32>(header.dataOffset + sectionByteCount);
	programEntry.rom.compiledStart = static_cast<i32>(header.dataOffset + descriptorOffset);
	programEntry.rom.compiledEnd = static_cast<i32>(header.dataOffset + header.dataLength);

	std::vector<u8> program(header.dataLength);
	std::copy(encodedProgram.sections.begin(), encodedProgram.sections.end(), program.begin());
	std::copy(encodedProgram.descriptor.begin(), encodedProgram.descriptor.end(), program.begin() + descriptorOffset);
	header.tocOffset = alignCartRomWordSection(header.dataOffset + header.dataLength);
	const std::vector<u8> toc = encodeRomToc(RomTocPayload{{programEntry}, std::nullopt});
	header.tocLength = static_cast<u32>(toc.size());
	return encodeCartRom(header, manifest, toc, program);
}

} // namespace bmsx
