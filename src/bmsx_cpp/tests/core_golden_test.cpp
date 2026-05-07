#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/opcode_info.h"
#include "machine/firmware/builtin_descriptors.h"
#include "render/3d/camera.h"
#include "render/3d/light.h"
#include "render/shared/camera_state.h"
#include "render/shared/hardware/camera.h"
#include "rompack/metadata.h"
#include "rompack/source.h"
#include "rompack/toc.h"
#include "rompack/tokens.h"
#include "machine/memory/access_kind.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/cpu/string_pool.h"
#include "machine/runtime/timing/state.h"
#include "machine/scheduler/budget.h"
#include "machine/common/hash.h"
#include "render/texture_manager.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>
#include <utility>
#include <optional>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void writeLe32(std::vector<bmsx::u8>& bytes, bmsx::u32 value) {
	bytes.push_back(static_cast<bmsx::u8>(value & 0xffu));
	bytes.push_back(static_cast<bmsx::u8>((value >> 8) & 0xffu));
	bytes.push_back(static_cast<bmsx::u8>((value >> 16) & 0xffu));
	bytes.push_back(static_cast<bmsx::u8>((value >> 24) & 0xffu));
}

void writeLe32At(std::vector<bmsx::u8>& bytes, size_t offset, bmsx::u32 value) {
	bytes[offset + 0] = static_cast<bmsx::u8>(value & 0xffu);
	bytes[offset + 1] = static_cast<bmsx::u8>((value >> 8) & 0xffu);
	bytes[offset + 2] = static_cast<bmsx::u8>((value >> 16) & 0xffu);
	bytes[offset + 3] = static_cast<bmsx::u8>((value >> 24) & 0xffu);
}

void writeVarUint(std::vector<bmsx::u8>& bytes, bmsx::u32 value) {
	while (value >= 0x80u) {
		bytes.push_back(static_cast<bmsx::u8>((value & 0x7fu) | 0x80u));
		value >>= 7;
	}
	bytes.push_back(static_cast<bmsx::u8>(value));
}

void testMemoryGolden() {
	const std::array<bmsx::u8, 4> systemRom{0x11u, 0x22u, 0x33u, 0x44u};
	bmsx::Memory memory(bmsx::MemoryInit{{systemRom.data(), systemRom.size()}, {}, {}});
	require(memory.readU8(bmsx::SYSTEM_ROM_BASE) == 0x11u, "system ROM byte should be readable");
	memory.writeU32(bmsx::RAM_BASE, 0x12345678u);
	require(memory.readU32(bmsx::RAM_BASE) == 0x12345678u, "RAM u32 should round-trip");
	memory.writeValue(bmsx::IO_DMA_STATUS, bmsx::valueNumber(static_cast<double>(0xfeedcafeu)));
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == 0xfeedcafeu, "numeric I/O word should round-trip");
}

void testBudgetAndFixed16Golden() {
	require(bmsx::cyclesUntilBudgetUnits(60, 7, 0, 1) == 9, "budget helper should round up to next unit");
	require(bmsx::cyclesUntilBudgetUnits(60, 7, 59, 1) == 1, "budget helper should honor carry");
	struct TransformCase {
		bmsx::i32 m0;
		bmsx::i32 m1;
		bmsx::i32 tx;
		bmsx::i32 x;
		bmsx::i32 y;
		bmsx::i32 expected;
	};
	const std::array<TransformCase, 7> cases{{
		{0, 0, 0, 0, 0, 0},
		{65536, 0, 0, 131072, 0, 131072},
		{0x7fffffff, 0, 0, 0x7fffffff, 0, 0x7fffffff},
		{static_cast<bmsx::i32>(0x80000000u), 0, 0, 0x7fffffff, 0, static_cast<bmsx::i32>(0x80000000u)},
		{0x7fffffff, -0x7fffffff, 0, 0x7fffffff, 0x7fffffff, 0},
		{0, 0, -65536, 0, 0, -65536},
		{0x40000000, 0x40000000, 0x7fffffff, 0x40000000, 0x40000000, 0x7fffffff},
	}};
	for (const auto& testCase : cases) {
		require(
			bmsx::transformFixed16(testCase.m0, testCase.m1, testCase.tx, testCase.x, testCase.y) == testCase.expected,
			"fixed16 transform should match golden integer output"
		);
	}
}

void testStringPoolGolden() {
	bmsx::StringPool pool;
	const bmsx::StringId empty = pool.intern("");
	const bmsx::StringId hello = pool.intern("hé");
	require(pool.intern("hé") == hello, "StringPool should reuse interned text id");
	require(pool.toString(empty).empty(), "StringPool should preserve empty interned strings");
	require(pool.codepointCount(hello) == 2, "StringPool should count UTF-8 codepoints");
	const bmsx::StringPoolState state = pool.captureState();
	bmsx::StringPool restored;
	restored.restoreState(state);
	require(restored.toString(empty).empty(), "StringPool restore should preserve empty string id");
	require(restored.toString(hello) == "hé", "StringPool restore should preserve text");
	require(restored.codepointCount(hello) == 2, "StringPool restore should preserve codepoint counts");

	bmsx::resetTrackedLuaHeapBytes();
	bmsx::StringPool trackedPool(true);
	const bmsx::StringId romLiteral = trackedPool.internRom("rom literal");
	require(trackedPool.trackedLuaHeapBytes() == 0u, "ROM string interning should not track Lua heap bytes");
	require(trackedPool.intern("rom literal") == romLiteral, "runtime interning should reuse ROM string ids");
	require(trackedPool.trackedLuaHeapBytes() > 0u, "runtime string materialization should track Lua heap bytes");
	const bmsx::StringPoolState trackedState = trackedPool.captureState();
	require(trackedState.entries[romLiteral].tracked, "StringPool save state should preserve runtime string ownership");
	bmsx::StringPool trackedRestored(true);
	trackedRestored.restoreState(trackedState);
	require(trackedRestored.trackedLuaHeapBytes() == trackedPool.trackedLuaHeapBytes(), "StringPool restore should preserve tracked byte ownership");
	bmsx::resetTrackedLuaHeapBytes();
}

void testProgramRomAccountingGolden() {
	bmsx::resetTrackedLuaHeapBytes();
	const std::array<bmsx::u8, 1> systemRom{0u};
	bmsx::Memory memory(bmsx::MemoryInit{{systemRom.data(), systemRom.size()}, {}, {}});
	bmsx::CPU cpu(memory);

	bmsx::Program program;
	program.constPoolStringPool = &program.stringPool;
	program.constPool.push_back(bmsx::valueString(program.stringPool.intern("program literal")));
	bmsx::Proto proto;
	proto.entryPC = 0;
	proto.maxStack = 1;
	program.protos.push_back(std::move(proto));

	bmsx::ProgramMetadata metadata;
	metadata.globalNames.push_back("cart_global_name");
	metadata.systemGlobalNames.push_back("sys_global_name");

	const size_t beforeSetProgram = bmsx::trackedLuaHeapBytes();
	cpu.setProgram(&program, &metadata);
	require(bmsx::trackedLuaHeapBytes() == beforeSetProgram, "Program .rodata literals and debug/global names should not track RAM");

	cpu.start(0);
	require(bmsx::trackedLuaHeapBytes() == beforeSetProgram, "Root/static closures should not track RAM");
	bmsx::resetTrackedLuaHeapBytes();
}

void testAccessKindAndOpcodeGolden() {
	require(bmsx::memoryAccessKindForName("mem") == bmsx::MemoryAccessKind::Word, "mem should map to word access");
	require(bmsx::memoryAccessKindForName("memf32le") == bmsx::MemoryAccessKind::F32LE, "memf32le should map to F32LE access");
	require(std::string_view(bmsx::memoryAccessKindName(bmsx::MemoryAccessKind::U16LE)) == "mem16le", "U16LE should expose mem16le name");
	require(bmsx::isMemoryAccessKindName("memf64le"), "memf64le should be recognized");
	require(!bmsx::isMemoryAccessKindName("mem128le"), "unknown memory access name should not be recognized");
	require(bmsx::OPCODE_COUNT == 64u, "opcode count should remain 64");
	require(static_cast<int>(bmsx::OpCode::HALT) == 63, "HALT opcode should stay at index 63");
	require(std::string_view(bmsx::opCodeName(bmsx::OpCode::LOAD_MEM)) == "LOAD_MEM", "LOAD_MEM opcode name should match TS");
	require(bmsx::opCodeBaseCycles(bmsx::OpCode::WIDE) == 0u, "WIDE base cycles should match TS");
	require(bmsx::opCodeBaseCycles(bmsx::OpCode::STORE_MEM) == 2u, "STORE_MEM base cycles should match TS");
	require(bmsx::opCodeUsesBx(bmsx::OpCode::JMPIF), "JMPIF should use Bx metadata");
	require(!bmsx::opCodeUsesBx(bmsx::OpCode::ADD), "ADD should not use Bx metadata");
}

void testTimingAndHashGolden() {
	bmsx::TimingState timing(60 * bmsx::HZ_SCALE, 6'000'000, 100'000);
	require(timing.ufpsScaled == 60 * bmsx::HZ_SCALE, "TimingState should store scaled FPS");
	require(timing.ufps == 60.0, "TimingState should derive FPS");
	require(std::abs(timing.frameDurationMs - (1000.0 / 60.0)) < 0.000001, "TimingState should derive frame duration");
	timing.applyUfpsScaled(50 * bmsx::HZ_SCALE);
	require(timing.ufps == bmsx::DEFAULT_UFPS, "TimingState apply should update FPS");
	require(bmsx::fmix32(0u) == 0u, "fmix32 zero should stay zero");
	require(bmsx::xorshift32(0x12345678u) == 0x87985aa5u, "xorshift32 golden value should match TS");
	require(bmsx::scramble32(0x12345678u) == 0xace1e1a8u, "scramble32 golden value should match TS");
	require(bmsx::signed8FromHash(0x80000000u) == 0, "signed8FromHash should decode high byte minus 128");
}


void testRompackSchemaGolden() {
	const bmsx::AssetToken token = bmsx::hashAssetToken("./Foo\\Bar");
	const bmsx::AssetTokenParts parts = bmsx::splitAssetToken(token);
	require(parts.lo == 0x4a2a0873u, "asset token low word should match TS golden vector");
	require(parts.hi == 0x4dc5355fu, "asset token high word should match TS golden vector");
	require(bmsx::tokenKey(token) == "4dc5355f4a2a0873", "asset token key should match TS order");
	require(bmsx::assetTypeToId("lua") == bmsx::ROM_TOC_ASSET_TYPE_LUA, "lua asset type id should match ROM TOC schema");
	require(bmsx::assetTypeFromId(bmsx::ROM_TOC_ASSET_TYPE_AEM) == "aem", "aem asset type id should decode");
	require(bmsx::resolveAssetTypeKind("atlas") == bmsx::AssetTypeKind::ImageAtlas, "atlas should load through image-atlas path");

	std::vector<bmsx::u8> metadata;
	writeLe32(metadata, bmsx::ROM_METADATA_MAGIC);
	writeLe32(metadata, bmsx::ROM_METADATA_VERSION);
	writeLe32(metadata, 2u);
	writeVarUint(metadata, 4u);
	metadata.insert(metadata.end(), {'n', 'a', 'm', 'e'});
	writeVarUint(metadata, 5u);
	metadata.insert(metadata.end(), {'s', 'c', 'o', 'r', 'e'});
	const bmsx::RomMetadataSection section = bmsx::parseRomMetadataSection(metadata.data(), metadata.size());
	require(section.propNames.size() == 2u, "metadata section should decode property count");
	require(section.propNames[0] == "name" && section.propNames[1] == "score", "metadata property names should round-trip");
	require(section.payloadOffset == metadata.size(), "metadata payload offset should point after prop table");

	std::vector<bmsx::u8> stringTable;
	auto appendString = [&stringTable](std::string_view text) {
		const bmsx::u32 offset = static_cast<bmsx::u32>(stringTable.size());
		for (char value : text) {
			stringTable.push_back(static_cast<bmsx::u8>(value));
		}
		return std::pair<bmsx::u32, bmsx::u32>{offset, static_cast<bmsx::u32>(text.size())};
	};
	const std::string resid = "script/main";
	const auto residRef = appendString(resid);
	const auto sourceRef = appendString("src/main.lua");
	const auto rootRef = appendString("cartroot");
	std::vector<bmsx::u8> toc(bmsx::ROM_TOC_HEADER_SIZE + bmsx::ROM_TOC_ENTRY_SIZE + stringTable.size());
	writeLe32At(toc, 0, bmsx::ROM_TOC_MAGIC);
	writeLe32At(toc, 4, bmsx::ROM_TOC_HEADER_SIZE);
	writeLe32At(toc, 8, bmsx::ROM_TOC_ENTRY_SIZE);
	writeLe32At(toc, 12, 1u);
	writeLe32At(toc, 16, bmsx::ROM_TOC_HEADER_SIZE);
	writeLe32At(toc, 20, bmsx::ROM_TOC_HEADER_SIZE + bmsx::ROM_TOC_ENTRY_SIZE);
	writeLe32At(toc, 24, static_cast<bmsx::u32>(stringTable.size()));
	writeLe32At(toc, 28, rootRef.first);
	writeLe32At(toc, 32, rootRef.second);
	const size_t entryBase = bmsx::ROM_TOC_HEADER_SIZE;
	const bmsx::AssetTokenParts scriptToken = bmsx::splitAssetToken(bmsx::hashAssetToken(resid));
	writeLe32At(toc, entryBase + 0, scriptToken.lo);
	writeLe32At(toc, entryBase + 4, scriptToken.hi);
	writeLe32At(toc, entryBase + 8, bmsx::assetTypeToId("lua"));
	writeLe32At(toc, entryBase + 12, 0u);
	writeLe32At(toc, entryBase + 16, residRef.first);
	writeLe32At(toc, entryBase + 20, residRef.second);
	writeLe32At(toc, entryBase + 24, sourceRef.first);
	writeLe32At(toc, entryBase + 28, sourceRef.second);
	writeLe32At(toc, entryBase + 32, bmsx::ROM_TOC_INVALID_U32);
	writeLe32At(toc, entryBase + 36, 0u);
	writeLe32At(toc, entryBase + 40, 2u);
	writeLe32At(toc, entryBase + 44, 5u);
	for (size_t offset = 48; offset < 80; offset += 4) {
		writeLe32At(toc, entryBase + offset, bmsx::ROM_TOC_INVALID_U32);
	}
	writeLe32At(toc, entryBase + 80, 123u);
	writeLe32At(toc, entryBase + 84, 0u);
	std::copy(stringTable.begin(), stringTable.end(), toc.begin() + bmsx::ROM_TOC_HEADER_SIZE + bmsx::ROM_TOC_ENTRY_SIZE);

	const bmsx::RomTocPayload decodedToc = bmsx::decodeRomToc(toc.data(), toc.size());
	require(decodedToc.projectRootPath.has_value() && *decodedToc.projectRootPath == "cartroot", "TOC decode should expose project root");
	require(decodedToc.entries.size() == 1u, "TOC decode should expose one entry");
	require(decodedToc.entries[0].resid == resid, "TOC decode should preserve resid");
	require(decodedToc.entries[0].rom.type == "lua", "TOC decode should preserve type");
	require(decodedToc.entries[0].rom.sourcePath.has_value() && *decodedToc.entries[0].rom.sourcePath == "src/main.lua", "TOC decode should preserve source path");
	require(decodedToc.entries[0].rom.updateTimestamp.has_value() && *decodedToc.entries[0].rom.updateTimestamp == 123, "TOC decode should preserve timestamp");

	const std::vector<bmsx::u8> payload{0, 1, 2, 3, 4, 5};
	bmsx::RomSourceLayer layer;
	layer.id = bmsx::CartridgeLayerId::Overlay;
	layer.index.entries = decodedToc.entries;
	layer.payload = &payload;
	bmsx::RomSourceStack stack(std::vector<bmsx::RomSourceLayer>{layer});
	const std::optional<bmsx::RomSourceEntry> sourceEntry = stack.getEntry(resid);
	require(sourceEntry.has_value(), "source stack should resolve entry by id");
	require(sourceEntry->rom.payloadId.has_value() && *sourceEntry->rom.payloadId == "overlay", "source stack should attach payload id");
	const std::vector<bmsx::u8> bytes = stack.getBytes(*sourceEntry);
	require(bytes.size() == 3u && bytes[0] == 2u && bytes[2] == 4u, "source stack should copy entry bytes");
	const std::span<const bmsx::u8> view = stack.getBytesView(*sourceEntry);
	require(view.data() == payload.data() + 2 && view.size() == 3u, "source stack should expose entry byte view");
	const std::vector<bmsx::RomSourceEntry> listed = stack.list(std::optional<std::string_view>("lua"));
	require(listed.size() == 1u && listed[0].resid == resid, "source stack should list typed entries");
	require(std::string_view(bmsx::cartridgeLayerIdName(layer.id)) == "overlay", "source layer id should expose overlay name");
	require(bmsx::romSourceLayerBytes(layer, sourceEntry->rom) == payload.data() + 2, "source layer bytes should point at entry start");
	require(bmsx::romSourceLayerByteLength(sourceEntry->rom) == 3u, "source layer byte length should use entry range");
}

void testFirmwareDescriptorGolden() {
	require(!bmsx::systemLuaBuiltinFunctions().empty(), "system builtin descriptor table should be populated");
	require(!bmsx::defaultLuaBuiltinFunctions().empty(), "default builtin descriptor table should be populated");
	const bmsx::LuaBuiltinDescriptor* assertDescriptor = bmsx::findDefaultLuaBuiltinDescriptor("assert");
	require(assertDescriptor && assertDescriptor->signature == "assert(value [, message])", "assert builtin descriptor should match TS signature");
	require(std::string_view(bmsx::systemLuaBuiltinGlobals()[0].name) == "timeline", "system global descriptors should keep runtime globals");
	require(std::string_view(bmsx::systemLuaBuiltinFunctions()[0].name) == "define_fsm", "system builtin descriptors should include define_fsm");
}

void testRenderSchemaGolden() {
	const bmsx::Render3D::Mat4 resetProjection = bmsx::buildResetCameraProjection();
	require(resetProjection[0] > 0.0f && resetProjection[5] > 0.0f, "reset camera projection should have focal scale");
	bmsx::resetHardwareCameraBank0();
	const bmsx::ResolvedCameraState camera = bmsx::resolveCameraState();
	require(camera.view[0] == 1.0f && camera.skyboxView[15] == 1.0f, "resolved camera state should expose reset matrices");
	require(camera.camPos.x == 0.0f && camera.camPos.y == 0.0f && camera.camPos.z == 0.0f, "resolved camera position should reset to origin");
	bmsx::AmbientLight light{{1.0f, 0.5f, 0.25f}, 2.0f};
	require(light.color[0] == 1.0f && light.intensity == 2.0f, "light schema should carry color and intensity");
}

void testTextureKeyGolden() {
	bmsx::TextureManager manager(nullptr);
	bmsx::TextureParams params;
	params.size = {16.0f, 8.0f};
	params.srgb = false;
	params.wrapS = 1;
	params.wrapT = 2;
	params.minFilter = 3;
	params.magFilter = 4;
	require(
		manager.makeKey("atlas/main", params) == "atlas/main|size=16.000x8.000|srgb=0|wrapS=1|wrapT=2|minFilter=3|magFilter=4",
		"texture key should use canonical direct string format"
	);
}

} // namespace

int main() {
	const std::array<std::pair<const char*, void (*)()>, 10> tests{{
		{"memory", testMemoryGolden},
		{"budget and fixed16", testBudgetAndFixed16Golden},
		{"texture key", testTextureKeyGolden},
		{"string pool", testStringPoolGolden},
		{"program ROM accounting", testProgramRomAccountingGolden},
		{"memory access and opcode", testAccessKindAndOpcodeGolden},
		{"timing and hash", testTimingAndHashGolden},
		{"rompack schema", testRompackSchemaGolden},
		{"firmware descriptors", testFirmwareDescriptorGolden},
		{"render schema", testRenderSchemaGolden},
	}};
	for (const auto& test : tests) {
		test.second();
	}
	return 0;
}
