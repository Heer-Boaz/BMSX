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
#include <cstdio>
#include <utility>

namespace bmsx {
namespace {

void assertSectionRange(size_t offset, size_t length, size_t total, const char* label) {
	if (offset + length > total) {
		throw BMSX_RUNTIME_ERROR(std::string("Invalid ROM ") + label + " range.");
	}
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

std::string generateAtlasAssetId(i32 atlasId) {
	char buffer[32];
	std::snprintf(buffer, sizeof(buffer), "_atlas_%02d", atlasId);
	return std::string(buffer);
}

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

std::vector<u8> encodeCartManifest(const CartManifest& cart, const MachineManifest& machine) {
	BinObject renderSize;
	renderSize["width"] = BinValue(machine.viewportWidth);
	renderSize["height"] = BinValue(machine.viewportHeight);

	BinObject machineObject;
	machineObject["namespace"] = BinValue(machine.namespaceName);
	machineObject["vdp_class"] = BinValue(std::string("psx"));
	machineObject["render_size"] = BinValue(std::move(renderSize));

	BinObject manifest;
	if (!cart.name.empty()) manifest["name"] = BinValue(cart.name);
	if (!cart.title.empty()) manifest["title"] = BinValue(cart.title);
	if (!cart.shortName.empty()) manifest["short_name"] = BinValue(cart.shortName);
	if (!cart.romName.empty()) manifest["rom_name"] = BinValue(cart.romName);
	if (!cart.version.empty()) manifest["version"] = BinValue(cart.version);
	if (!cart.author.empty()) manifest["author"] = BinValue(cart.author);
	if (!cart.description.empty()) manifest["description"] = BinValue(cart.description);
	manifest["machine"] = BinValue(std::move(machineObject));
	return encodeBinary(BinValue(std::move(manifest)));
}

std::vector<u8> encodeProgramCartRom(const CartManifest& cart, const MachineManifest& machine, const ProgramImage& image) {
	const std::vector<u8> program = encodeProgramImage(image);
	const std::vector<u8> manifest = encodeCartManifest(cart, machine);

	CartRomHeader header{};
	header.headerSize = CART_ROM_HEADER_SIZE;
	header.manifestOffset = CART_ROM_HEADER_SIZE;
	header.manifestLength = static_cast<u32>(manifest.size());
	header.tocOffset = header.manifestOffset + header.manifestLength;
	header.dataOffset = header.tocOffset;
	header.dataLength = static_cast<u32>(program.size());
	header.programBootVersion = PROGRAM_BOOT_HEADER_VERSION;
	header.programBootFlags = 0;
	header.programEntryProtoIndex = static_cast<u32>(image.vectors.resetProtoIndex);
	header.programCodeByteCount = static_cast<u32>(image.sections.text.code.size());
	header.programConstPoolCount = static_cast<u32>(image.sections.rodata.constPool.size());
	header.programProtoCount = static_cast<u32>(image.sections.text.protos.size());
	header.programConstRelocCount = static_cast<u32>(image.link.constRelocs.size());
	header.vdpClass = machine.vdpClass;

	RomSourceEntry programEntry;
	programEntry.resid = PROGRAM_IMAGE_ID;
	programEntry.rom.type = "code";
	programEntry.rom.start = static_cast<i32>(header.dataOffset);
	programEntry.rom.end = static_cast<i32>(header.dataOffset + header.dataLength);

	const std::vector<u8> toc = encodeRomToc(RomTocPayload{{programEntry}, std::nullopt});
	header.tocLength = static_cast<u32>(toc.size());
	header.dataOffset += header.tocLength;
	programEntry.rom.start = static_cast<i32>(header.dataOffset);
	programEntry.rom.end = static_cast<i32>(header.dataOffset + header.dataLength);
	const std::vector<u8> finalToc = encodeRomToc(RomTocPayload{{programEntry}, std::nullopt});
	header.tocLength = static_cast<u32>(finalToc.size());
	return encodeCartRom(header, manifest, finalToc, program);
}

} // namespace bmsx
