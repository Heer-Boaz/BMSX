#include "program_cart_fixture.h"

#include "common/endian.h"
#include "common/serializer/binencoder.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/program/loader.h"
#include "machine/runtime/timing/constants.h"
#include "rompack/format.h"
#include "rompack/toc.h"
#include "rompack/tokens.h"

#include <algorithm>
#include <string_view>
#include <utility>

namespace bmsx::test {
namespace {

ProgramImage makeMinimalProgramImage() {
	ProgramImage image;
	image.entryProtoIndex = 0;
	image.sections.text.code.resize(INSTRUCTION_BYTES);
	writeInstruction(image.sections.text.code, 0, static_cast<u8>(OpCode::RET), 0, 0, 0);

	Proto proto;
	proto.entryPC = 0;
	proto.maxStack = 1;
	image.sections.text.protos.push_back(proto);
	return image;
}

BinValue encodeProto(const Proto& proto) {
	BinObject object;
	object["maxStack"] = BinValue(proto.maxStack);
	object["numParams"] = BinValue(proto.numParams);
	object["entryPC"] = BinValue(proto.entryPC);
	object["isVararg"] = BinValue(proto.isVararg);
	object["staticClosure"] = BinValue(proto.staticClosure);
	object["upvalueDescs"] = BinValue(BinArray{});
	return BinValue(std::move(object));
}

std::vector<u8> encodeProgramImage(const ProgramImage& image) {
	BinArray protos;
	protos.reserve(image.sections.text.protos.size());
	for (const Proto& proto : image.sections.text.protos) {
		protos.push_back(encodeProto(proto));
	}

	BinObject text;
	text["code"] = BinValue(BinBinary(image.sections.text.code.begin(), image.sections.text.code.end()));
	text["protos"] = BinValue(std::move(protos));

	BinObject rodata;
	rodata["constPool"] = BinValue(BinArray{});
	rodata["moduleProtos"] = BinValue(BinArray{});
	rodata["staticModulePaths"] = BinValue(BinArray{});

	BinObject data;
	data["bytes"] = BinValue(BinBinary{});

	BinObject bss;
	bss["byteCount"] = BinValue(static_cast<i64>(image.sections.bss.byteCount));

	BinObject sections;
	sections["text"] = BinValue(std::move(text));
	sections["rodata"] = BinValue(std::move(rodata));
	sections["data"] = BinValue(std::move(data));
	sections["bss"] = BinValue(std::move(bss));

	BinObject link;
	link["constRelocs"] = BinValue(BinArray{});

	BinObject root;
	root["entryProtoIndex"] = BinValue(image.entryProtoIndex);
	root["sections"] = BinValue(std::move(sections));
	root["link"] = BinValue(std::move(link));
	return encodeBinary(BinValue(std::move(root)));
}

std::vector<u8> encodeCartManifest() {
	BinObject cpu;
	cpu["cpu_freq_hz"] = BinValue(static_cast<i64>(1'000'000));
	cpu["imgdec_bytes_per_sec"] = BinValue(static_cast<i64>(26'214'400));

	BinObject dma;
	dma["dma_bytes_per_sec_iso"] = BinValue(static_cast<i64>(8'388'608));
	dma["dma_bytes_per_sec_bulk"] = BinValue(static_cast<i64>(26'214'400));

	BinObject specs;
	specs["cpu"] = BinValue(std::move(cpu));
	specs["dma"] = BinValue(std::move(dma));

	BinObject renderSize;
	renderSize["width"] = BinValue(256);
	renderSize["height"] = BinValue(212);

	BinObject machine;
	machine["namespace"] = BinValue("libretro_save_state_test");
	machine["ufps"] = BinValue(static_cast<i64>(DEFAULT_UFPS_SCALED));
	machine["specs"] = BinValue(std::move(specs));
	machine["render_size"] = BinValue(std::move(renderSize));

	BinObject manifest;
	manifest["name"] = BinValue("libretro_save_state_test");
	manifest["machine"] = BinValue(std::move(machine));
	return encodeBinary(BinValue(std::move(manifest)));
}

std::pair<u32, u32> appendString(std::vector<u8>& table, std::string_view text) {
	const u32 offset = static_cast<u32>(table.size());
	for (char value : text) {
		table.push_back(static_cast<u8>(value));
	}
	return {offset, static_cast<u32>(text.size())};
}

std::vector<u8> makeProgramToc(u32 payloadStart, u32 payloadEnd) {
	std::vector<u8> stringTable;
	const auto residRef = appendString(stringTable, PROGRAM_IMAGE_ID);

	std::vector<u8> toc(ROM_TOC_HEADER_SIZE + ROM_TOC_ENTRY_SIZE + stringTable.size());
	writeLE32(toc.data() + 0, ROM_TOC_MAGIC);
	writeLE32(toc.data() + 4, ROM_TOC_HEADER_SIZE);
	writeLE32(toc.data() + 8, ROM_TOC_ENTRY_SIZE);
	writeLE32(toc.data() + 12, 1u);
	writeLE32(toc.data() + 16, ROM_TOC_HEADER_SIZE);
	writeLE32(toc.data() + 20, ROM_TOC_HEADER_SIZE + ROM_TOC_ENTRY_SIZE);
	writeLE32(toc.data() + 24, static_cast<u32>(stringTable.size()));
	writeLE32(toc.data() + 28, ROM_TOC_INVALID_U32);
	writeLE32(toc.data() + 32, 0u);

	const size_t entryBase = ROM_TOC_HEADER_SIZE;
	const AssetTokenParts token = splitAssetToken(hashAssetToken(PROGRAM_IMAGE_ID));
	writeLE32(toc.data() + entryBase + 0, token.lo);
	writeLE32(toc.data() + entryBase + 4, token.hi);
	writeLE32(toc.data() + entryBase + 8, ROM_TOC_ASSET_TYPE_CODE);
	writeLE32(toc.data() + entryBase + 12, ROM_TOC_OP_NONE);
	writeLE32(toc.data() + entryBase + 16, residRef.first);
	writeLE32(toc.data() + entryBase + 20, residRef.second);
	writeLE32(toc.data() + entryBase + 24, ROM_TOC_INVALID_U32);
	writeLE32(toc.data() + entryBase + 28, 0u);
	writeLE32(toc.data() + entryBase + 32, ROM_TOC_INVALID_U32);
	writeLE32(toc.data() + entryBase + 36, 0u);
	writeLE32(toc.data() + entryBase + 40, payloadStart);
	writeLE32(toc.data() + entryBase + 44, payloadEnd);
	for (size_t offset = 48; offset < 80; offset += 4) {
		writeLE32(toc.data() + entryBase + offset, ROM_TOC_INVALID_U32);
	}
	writeLE32(toc.data() + entryBase + 80, 0u);
	writeLE32(toc.data() + entryBase + 84, 0u);
	std::copy(stringTable.begin(), stringTable.end(), toc.begin() + ROM_TOC_HEADER_SIZE + ROM_TOC_ENTRY_SIZE);
	return toc;
}

} // namespace

std::vector<u8> makeMinimalProgramCartRom() {
	ProgramImage image = makeMinimalProgramImage();
	const ProgramBootHeader bootHeader = buildProgramBootHeader(image);
	const std::vector<u8> program = encodeProgramImage(image);
	const std::vector<u8> manifest = encodeCartManifest();
	const u32 manifestOffset = static_cast<u32>(CART_ROM_HEADER_SIZE);
	const u32 tocLength = ROM_TOC_HEADER_SIZE + ROM_TOC_ENTRY_SIZE + static_cast<u32>(std::string_view(PROGRAM_IMAGE_ID).size());
	const u32 tocOffset = manifestOffset + static_cast<u32>(manifest.size());
	const u32 dataOffset = tocOffset + tocLength;
	const std::vector<u8> toc = makeProgramToc(dataOffset, dataOffset + static_cast<u32>(program.size()));

	std::vector<u8> rom(dataOffset + program.size());
	std::copy(CART_ROM_MAGIC_BYTES.begin(), CART_ROM_MAGIC_BYTES.end(), rom.begin());
	writeLE32(rom.data() + 4, CART_ROM_HEADER_SIZE);
	writeLE32(rom.data() + 8, manifestOffset);
	writeLE32(rom.data() + 12, static_cast<u32>(manifest.size()));
	writeLE32(rom.data() + 16, tocOffset);
	writeLE32(rom.data() + 20, static_cast<u32>(toc.size()));
	writeLE32(rom.data() + 24, dataOffset);
	writeLE32(rom.data() + 28, static_cast<u32>(program.size()));
	writeLE32(rom.data() + 32, bootHeader.version);
	writeLE32(rom.data() + 36, bootHeader.flags);
	writeLE32(rom.data() + 40, static_cast<u32>(bootHeader.entryProtoIndex));
	writeLE32(rom.data() + 44, static_cast<u32>(bootHeader.codeByteCount));
	writeLE32(rom.data() + 48, static_cast<u32>(bootHeader.constPoolCount));
	writeLE32(rom.data() + 52, static_cast<u32>(bootHeader.protoCount));
	writeLE32(rom.data() + 56, 0u);
	writeLE32(rom.data() + 60, static_cast<u32>(bootHeader.constRelocCount));
	writeLE32(rom.data() + 64, 0u);
	writeLE32(rom.data() + 68, 0u);
	std::copy(manifest.begin(), manifest.end(), rom.begin() + manifestOffset);
	std::copy(toc.begin(), toc.end(), rom.begin() + tocOffset);
	std::copy(program.begin(), program.end(), rom.begin() + dataOffset);
	return rom;
}

} // namespace bmsx::test
