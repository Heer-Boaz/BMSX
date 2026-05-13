#include "core/system.h"
#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/irq/controller.h"
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
#include "machine/program/loader.h"
#include "machine/cpu/string_pool.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/runtime/timing/constants.h"
#include "machine/runtime/timing/state.h"
#include "machine/scheduler/budget.h"
#include "machine/common/hash.h"
#include "audio/soundmaster.h"
#include "input/manager.h"
#include "platform/platform.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "rompack/format.h"
#include "rompack/loader.h"

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

void requireBusFault(const bmsx::Memory& memory, uint32_t code, uint32_t addr, uint32_t access, const char* message) {
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == code, message);
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == addr, message);
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ACCESS) == access, message);
}

void clearBusFault(bmsx::Memory& memory) {
	memory.writeMappedU32LE(bmsx::IO_SYS_BUS_FAULT_ACK, 1u);
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_NONE, "bus fault ack should clear the sticky fault");
}

void writeIoWord(bmsx::Memory& memory, uint32_t addr, uint32_t value) {
	const bmsx::Value numericValue = bmsx::valueNumber(static_cast<double>(value));
	memory.writeValue(addr, numericValue);
}

class RecordingVramWriter final : public bmsx::Memory::VramWriter {
public:
	struct Read {
		uint32_t addr = 0;
		size_t length = 0;
	};
	struct Write {
		uint32_t addr = 0;
		std::vector<bmsx::u8> bytes;
	};

	mutable std::vector<Read> reads;
	std::vector<Write> writes;

	void writeVram(uint32_t addr, const bmsx::u8* data, size_t length) override {
		writes.push_back(Write{addr, std::vector<bmsx::u8>(data, data + length)});
	}

	void readVram(uint32_t addr, bmsx::u8* out, size_t length) const override {
		reads.push_back(Read{addr, length});
		for (size_t index = 0; index < length; ++index) {
			out[index] = static_cast<bmsx::u8>(index + 1u);
		}
	}
};

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

void configureInterruptTestProgram(bmsx::Program& program) {
	program.constPoolStringPool = &program.stringPool;
	program.code.resize(2u * bmsx::INSTRUCTION_BYTES);
	bmsx::writeInstruction(program.code, 0, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(program.code, 1, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);

	bmsx::Proto haltProto;
	haltProto.entryPC = 0;
	haltProto.maxStack = 1;
	program.protos.push_back(haltProto);

	bmsx::Proto returnProto;
	returnProto.entryPC = bmsx::INSTRUCTION_BYTES;
	returnProto.maxStack = 1;
	program.protos.push_back(returnProto);
}

void configureThrowingNativeProgram(bmsx::Program& program, bmsx::Value nativeFunction) {
	program.constPoolStringPool = &program.stringPool;
	program.constPool.push_back(nativeFunction);
	program.code.resize(4u * bmsx::INSTRUCTION_BYTES);
	bmsx::writeInstruction(program.code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(program.code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, 0, 0);
	bmsx::writeInstruction(program.code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(program.code, 3, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);

	bmsx::Proto throwingProto;
	throwingProto.entryPC = 0;
	throwingProto.maxStack = 1;
	program.protos.push_back(throwingProto);

	bmsx::Proto returnProto;
	returnProto.entryPC = 3 * bmsx::INSTRUCTION_BYTES;
	returnProto.maxStack = 1;
	program.protos.push_back(returnProto);
}

class TestClock final : public bmsx::Clock {
public:
	bmsx::f64 now() override { return currentMs; }
	bmsx::f64 origin() override { return originMs; }
	bmsx::f64 elapsed() override { return currentMs - originMs; }

	bmsx::f64 originMs = 0.0;
	bmsx::f64 currentMs = 0.0;
};

bmsx::MachineManifest makeRuntimeTestManifest() {
	bmsx::MachineManifest manifest;
	manifest.namespaceName = "core_golden";
	manifest.viewportWidth = 256;
	manifest.viewportHeight = 212;
	manifest.cpuHz = 5'000;
	manifest.ufpsScaled = bmsx::DEFAULT_UFPS_SCALED;
	return manifest;
}

struct RuntimeHarness {
	TestClock clock;
	bmsx::SoundMaster soundMaster;
	bmsx::DefaultMicrotaskQueue microtasks;
	bmsx::GameView view;
	bmsx::MachineManifest manifest;
	bmsx::Runtime runtime;

	RuntimeHarness()
		: view(nullptr, 256, 212)
		, manifest(makeRuntimeTestManifest())
		, runtime(
			bmsx::RuntimeOptions{
				.playerIndex = 0,
				.viewport = {256.0f, 212.0f},
				.systemRomBytes = {},
				.cartRomBytes = {},
				.machineManifest = &manifest,
				.ufpsScaled = bmsx::DEFAULT_UFPS_SCALED,
				.cpuHz = 5'000,
				.cycleBudgetPerFrame = 100,
				.vblankCycles = 20,
				.vdpWorkUnitsPerSec = 25'600,
				.geoWorkUnitsPerSec = 16'384'000,
			},
			clock,
			bmsx::Input::instance(),
			soundMaster,
			microtasks,
			view
		) {
	}
};

void testMemoryGolden() {
	const std::array<bmsx::u8, 4> systemRom{0x11u, 0x22u, 0x33u, 0x44u};
	bmsx::Memory memory(bmsx::MemoryInit{{systemRom.data(), systemRom.size()}, {}, {}});
	require(memory.readU8(bmsx::SYSTEM_ROM_BASE) == 0x11u, "system ROM byte should be readable");
	memory.writeU32(bmsx::RAM_BASE, 0x12345678u);
	require(memory.readU32(bmsx::RAM_BASE) == 0x12345678u, "RAM u32 should round-trip");
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x89abcdefu);
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x89abcdefu, "mapped RAM u32le should round-trip directly");
	memory.writeMappedU16LE(bmsx::GEO_SCRATCH_BASE + 4u, 0xf00du);
	require(memory.readMappedU16LE(bmsx::GEO_SCRATCH_BASE + 4u) == 0xf00du, "mapped RAM u16le should round-trip directly");
	memory.writeValue(bmsx::IO_DMA_STATUS, bmsx::valueNumber(static_cast<double>(0xfeedcafeu)));
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == 0xfeedcafeu, "numeric I/O word should round-trip");
	require(memory.readMappedU32LE(bmsx::IO_DMA_STATUS) == 0xfeedcafeu, "mapped I/O u32le read should use the register word");
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, 0x13572468u);
	require(memory.readIoU32(bmsx::IO_DMA_CTRL) == 0x13572468u, "mapped I/O u32le write should store one register word");
	require(memory.readMappedU16LE(bmsx::IO_DMA_STATUS) == 0u, "mapped I/O u16le read should return open bus");
	requireBusFault(
		memory,
		bmsx::BUS_FAULT_UNALIGNED_IO,
		bmsx::IO_DMA_STATUS,
		bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U16,
		"mapped I/O u16le read should latch an I/O boundary bus fault"
	);
	clearBusFault(memory);
	memory.writeMappedU32LE(bmsx::IO_DMA_STATUS, 0u);
	requireBusFault(
		memory,
		bmsx::BUS_FAULT_READ_ONLY,
		bmsx::IO_DMA_STATUS,
		bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U32,
		"mapped I/O u32le write to read-only register should latch a bus fault"
	);
	clearBusFault(memory);

	RecordingVramWriter vram;
	memory.setVramWriter(&vram);
	require(memory.readMappedU32LE(0xfffffffcu) == 0u, "mapped u32 read near address wrap should return open bus");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, 0xfffffffcu, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U32, "mapped u32 read near address wrap should latch a bus fault");
	clearBusFault(memory);
	memory.writeMappedU32LE(0xfffffffcu, 0u);
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, 0xfffffffcu, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U32, "mapped u32 write near address wrap should latch a bus fault");
	clearBusFault(memory);
	require(memory.readMappedU32LE(bmsx::RAM_END - 3u) == 0u, "mapped u32 read past RAM end should return open bus");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 3u, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U32, "mapped u32 read past RAM end should latch a bus fault");
	clearBusFault(memory);
	memory.writeMappedU16LE(bmsx::RAM_END - 1u, 0u);
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 1u, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U16, "mapped u16 write past RAM end should latch a bus fault");
	clearBusFault(memory);
	require(memory.readMappedU32LE(bmsx::VRAM_STAGING_BASE - 1u) == 0u, "mapped u32 read straddling into VRAM should return open bus");
	requireBusFault(memory, bmsx::BUS_FAULT_VRAM_RANGE, bmsx::VRAM_STAGING_BASE - 1u, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U32, "mapped u32 read straddling into VRAM should latch a bus fault");
	clearBusFault(memory);
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE - 1u, 0xabcdef01u);
	requireBusFault(memory, bmsx::BUS_FAULT_VRAM_RANGE, bmsx::VRAM_STAGING_BASE - 1u, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U32, "mapped u32 write straddling into VRAM should latch a bus fault");
	clearBusFault(memory);
	require(memory.readMappedF64LE(bmsx::VRAM_STAGING_BASE - 4u) == 0.0, "mapped f64 read straddling into VRAM should return open bus");
	requireBusFault(memory, bmsx::BUS_FAULT_VRAM_RANGE, bmsx::VRAM_STAGING_BASE - 4u, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_F64, "mapped f64 read straddling into VRAM should latch a bus fault");
	clearBusFault(memory);
	memory.writeMappedF64LE(bmsx::VRAM_STAGING_BASE - 4u, 1.0);
	requireBusFault(memory, bmsx::BUS_FAULT_VRAM_RANGE, bmsx::VRAM_STAGING_BASE - 4u, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_F64, "mapped f64 write straddling into VRAM should latch a bus fault");
	clearBusFault(memory);
	require(vram.reads.empty(), "VRAM straddle read should not issue a contained VRAM transfer");
	require(vram.writes.empty(), "VRAM straddle write should not issue a contained VRAM transfer");

	require(memory.readMappedU32LE(bmsx::VRAM_STAGING_BASE) == 0x04030201u, "contained VRAM mapped u32 read should use one direct transfer");
	memory.writeMappedU32LE(bmsx::VRAM_STAGING_BASE, 0x78563412u);
	require(vram.reads.size() == 1u && vram.reads[0].addr == bmsx::VRAM_STAGING_BASE && vram.reads[0].length == 4u, "contained VRAM read should be a single 4-byte transfer");
	const std::vector<bmsx::u8> expectedWrite{0x12u, 0x34u, 0x56u, 0x78u};
	require(vram.writes.size() == 1u && vram.writes[0].addr == bmsx::VRAM_STAGING_BASE && vram.writes[0].bytes == expectedWrite, "contained VRAM write should be a single 4-byte transfer");
}

void testRawMemoryBusFaults() {
	const std::array<bmsx::u8, 4> systemRom{0x11u, 0x22u, 0x33u, 0x44u};
	bmsx::Memory memory(bmsx::MemoryInit{{systemRom.data(), systemRom.size()}, {}, {}});
	require(memory.readU8(0xffffffffu) == 0u, "raw u8 unmapped read should return open bus");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, 0xffffffffu, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U8, "raw u8 unmapped read should latch a bus fault");
	clearBusFault(memory);
	std::array<bmsx::u8, 4> bytes{};
	require(!memory.readBytes(bmsx::RAM_END - 1u, bytes.data(), bytes.size()), "raw byte read past RAM should report a failed device transfer");
	require(bytes == std::array<bmsx::u8, 4>{0u, 0u, 0u, 0u}, "raw byte read past RAM should return open bus bytes");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 1u, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U8, "raw byte read past RAM should latch a bus fault");
	clearBusFault(memory);
	const std::array<bmsx::u8, 4> writeBytes{1u, 2u, 3u, 4u};
	require(!memory.writeBytes(bmsx::RAM_END - 1u, writeBytes.data(), writeBytes.size()), "raw byte write past RAM should report a failed device transfer");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 1u, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U8, "raw byte write past RAM should latch a bus fault");
	clearBusFault(memory);
	memory.writeU32(bmsx::RAM_END - 3u, 0x12345678u);
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 3u, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U32, "raw u32 write past RAM should latch a bus fault");
}

void testDmaMemoryFaultStatus() {
	RuntimeHarness harness;
	bmsx::Memory& memory = harness.runtime.machine.memory;
	bmsx::DmaController& controller = harness.runtime.machine.dmaController;
	bmsx::IrqController& irq = harness.runtime.machine.irqController;
	controller.reset();
	irq.reset();
	controller.setTiming(1, 64, 64, 0);
	memory.writeValue(bmsx::IO_DMA_SRC, bmsx::valueNumber(static_cast<double>(bmsx::RAM_END - 1u)));
	memory.writeValue(bmsx::IO_DMA_DST, bmsx::valueNumber(static_cast<double>(bmsx::RAM_BASE)));
	memory.writeValue(bmsx::IO_DMA_LEN, bmsx::valueNumber(4.0));
	memory.writeIoValue(bmsx::IO_DMA_CTRL, bmsx::valueNumber(static_cast<double>(bmsx::DMA_CTRL_START)));
	controller.tryStartIo();
	controller.accrueCycles(1, 1);
	controller.onService(1);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_DONE | bmsx::DMA_STATUS_ERROR), "DMA source bus fault should complete through device error status");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 0u, "DMA source bus fault should not count open-bus bytes as written");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_ERROR) != 0u, "DMA source bus fault should raise the DMA error IRQ");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 1u, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U8, "DMA source bus fault should preserve the memory fault latch");
}

void testImageDecoderFaultStatus() {
	RuntimeHarness harness;
	bmsx::Memory& memory = harness.runtime.machine.memory;
	bmsx::ImgDecController& controller = harness.runtime.machine.imgDecController;
	auto runRegisterFault = [&](bmsx::u32 dst, bmsx::u32 cap) {
		controller.reset();
		harness.runtime.machine.irqController.reset();
		memory.writeValue(bmsx::IO_IMG_SRC, bmsx::valueNumber(static_cast<double>(bmsx::RAM_BASE)));
		memory.writeValue(bmsx::IO_IMG_LEN, bmsx::valueNumber(0.0));
		memory.writeValue(bmsx::IO_IMG_DST, bmsx::valueNumber(static_cast<double>(dst)));
		memory.writeValue(bmsx::IO_IMG_CAP, bmsx::valueNumber(static_cast<double>(cap)));
		memory.writeIoValue(bmsx::IO_IMG_CTRL, bmsx::valueNumber(static_cast<double>(bmsx::IMG_CTRL_START)));
		controller.onCtrlWrite(0);
		require(memory.readIoU32(bmsx::IO_IMG_STATUS) == (bmsx::IMG_STATUS_DONE | bmsx::IMG_STATUS_ERROR), "IMG register fault should complete through device status");
		require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_IMG_ERROR) != 0u, "IMG register fault should raise the cart-visible error IRQ");
	};
	runRegisterFault(0xffff0000u, 4u);
	runRegisterFault(bmsx::VRAM_PRIMARY_SLOT_BASE, 0u);

	controller.reset();
	harness.runtime.machine.irqController.reset();
	clearBusFault(memory);
	memory.writeValue(bmsx::IO_IMG_SRC, bmsx::valueNumber(static_cast<double>(bmsx::RAM_END - 1u)));
	memory.writeValue(bmsx::IO_IMG_LEN, bmsx::valueNumber(4.0));
	memory.writeValue(bmsx::IO_IMG_DST, bmsx::valueNumber(static_cast<double>(bmsx::VRAM_PRIMARY_SLOT_BASE)));
	memory.writeValue(bmsx::IO_IMG_CAP, bmsx::valueNumber(4.0));
	memory.writeIoValue(bmsx::IO_IMG_CTRL, bmsx::valueNumber(static_cast<double>(bmsx::IMG_CTRL_START)));
	controller.onCtrlWrite(0);
	require(memory.readIoU32(bmsx::IO_IMG_STATUS) == (bmsx::IMG_STATUS_DONE | bmsx::IMG_STATUS_ERROR), "IMG source bus fault should complete through device status");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_IMG_ERROR) != 0u, "IMG source bus fault should raise the cart-visible error IRQ");
	requireBusFault(memory, bmsx::BUS_FAULT_UNMAPPED, bmsx::RAM_END - 1u, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U8, "IMG source bus fault should preserve the memory fault latch");

	bool invalidDstRejected = false;
	bool invalidCapRejected = false;
	controller.reset();
	harness.runtime.machine.irqController.reset();
	controller.decodeToVram(
		{},
		0xffff0000u,
		4u,
		{},
		[&](std::exception_ptr error) {
			invalidDstRejected = error != nullptr;
		}
	);
	controller.decodeToVram(
		{},
		bmsx::VRAM_PRIMARY_SLOT_BASE,
		0u,
		{},
		[&](std::exception_ptr error) {
			invalidCapRejected = error != nullptr;
		}
	);
	controller.onService(0);
	require(invalidDstRejected && !invalidCapRejected, "queued invalid destination should reject before the next queued decode");
	controller.onService(0);
	require(invalidCapRejected, "queued invalid capacity should reject after the queue drains");
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

void testCpuHaltRequiresAcceptedInterruptGolden() {
	bmsx::Memory memory;
	bmsx::CPU cpu(memory);
	bmsx::Program program;
	configureInterruptTestProgram(program);
	bmsx::ProgramMetadata metadata;
	cpu.setProgram(&program, &metadata);

	cpu.start(0);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "HALT should suspend CPU execution");
	require(cpu.isHaltedUntilIrq(), "HALT should leave CPU in halted state");

	bmsx::Closure* returnClosure = cpu.createRootClosure(1);
	bool rejectedCall = false;
	try {
		cpu.callExternal(returnClosure);
	} catch (const std::runtime_error& error) {
		rejectedCall = std::string_view(error.what()).find("Cannot enter CPU while halted until IRQ") != std::string_view::npos;
	}
	require(rejectedCall, "external host call must not clear or bypass HALT");
	require(cpu.isHaltedUntilIrq(), "rejected host call should preserve HALT state");
	require(cpu.getFrameDepth() == 1, "rejected host call should not push a new frame");
}

void testCpuExternalHaltDoesNotReturnGolden() {
	bmsx::Memory memory;
	bmsx::CPU cpu(memory);
	bmsx::Program program;
	configureInterruptTestProgram(program);
	bmsx::ProgramMetadata metadata;
	cpu.setProgram(&program, &metadata);

	cpu.start(1);
	bmsx::Closure* haltClosure = cpu.createRootClosure(0);
	cpu.callExternal(haltClosure);
	require(cpu.getFrameDepth() == 2, "external call should push a host frame before executing");
	require(cpu.runUntilDepth(1, 100) == bmsx::RunResult::Halted, "HALT inside host call must not look like a returned call");
	require(cpu.isHaltedUntilIrq(), "HALT inside host call should keep CPU halted");
	require(cpu.getFrameDepth() == 2, "halted host call frame should remain active until host unwinds it");
	cpu.unwindToDepth(1);
	require(cpu.getFrameDepth() == 1, "host unwinding should restore the caller depth after halted external call");
}

void testRuntimeHostCallHaltUnwindsGolden() {
	RuntimeHarness harness;
	bmsx::Runtime& runtime = harness.runtime;
	bmsx::Program program;
	configureInterruptTestProgram(program);
	bmsx::ProgramMetadata metadata;
	runtime.machine.cpu.setProgram(&program, &metadata);

	runtime.machine.cpu.start(1);
	bmsx::Closure* haltClosure = runtime.machine.cpu.createRootClosure(0);
	bmsx::NativeResults out;
	bool rejectedHaltedCall = false;
	try {
		runtime.callLuaFunctionInto(haltClosure, bmsx::NativeArgsView(), out);
	} catch (const std::runtime_error& error) {
		rejectedHaltedCall = std::string_view(error.what()).find("Lua host call halted before returning") != std::string_view::npos;
	}
	require(rejectedHaltedCall, "runtime host-call wrapper should reject HALT before return");
	require(runtime.machine.cpu.isHaltedUntilIrq(), "runtime host-call rejection should preserve CPU HALT");
	require(runtime.machine.cpu.getFrameDepth() == 1, "runtime host-call rejection should unwind the external frame");
}

void testRuntimeHostCallThrowChargesSpentBudgetGolden() {
	RuntimeHarness harness;
	bmsx::Runtime& runtime = harness.runtime;
	const uint16_t nativeCost = 7u;
	bmsx::Value throwingNative = runtime.machine.cpu.createNativeFunction(
		"throwing_native",
		[](bmsx::NativeArgsView, bmsx::NativeResults&) {
			throw std::runtime_error("native boom");
		},
		bmsx::NativeFnCost{nativeCost, 0u, 0u}
	);
	bmsx::Program program;
	configureThrowingNativeProgram(program, throwingNative);
	bmsx::ProgramMetadata metadata;
	runtime.machine.cpu.setProgram(&program, &metadata);
	runtime.machine.cpu.start(1);

	const int spent = static_cast<int>(bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::LOADK)])
		+ static_cast<int>(bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::CALL)])
		+ static_cast<int>(nativeCost);
	bmsx::NativeResults out;
	bool threw = false;
	runtime.machine.cpu.instructionBudgetRemaining = 100;
	try {
		runtime.callLuaFunctionInto(runtime.machine.cpu.createRootClosure(0), bmsx::NativeArgsView(), out);
	} catch (const std::runtime_error& error) {
		threw = std::string_view(error.what()).find("native boom") != std::string_view::npos;
	}
	require(threw, "runtime host-call wrapper should propagate native exceptions");
	require(runtime.machine.cpu.instructionBudgetRemaining == 100 - spent, "runtime host-call wrapper should charge cycles spent before exception");
	require(runtime.machine.cpu.getFrameDepth() == 1, "runtime host-call exception should unwind the external frame");
}

void testRuntimeFrameExecutorThrowClosesCpuSliceGolden() {
	RuntimeHarness harness;
	bmsx::Runtime& runtime = harness.runtime;
	bmsx::Value throwingNative = runtime.machine.cpu.createNativeFunction(
		"throwing_native",
		[](bmsx::NativeArgsView, bmsx::NativeResults&) {
			throw std::runtime_error("native boom");
		},
		bmsx::NativeFnCost{7u, 0u, 0u}
	);
	bmsx::Program program;
	configureThrowingNativeProgram(program, throwingNative);
	bmsx::ProgramMetadata metadata;
	runtime.machine.cpu.setProgram(&program, &metadata);
	runtime.machine.cpu.start(0);

	bmsx::FrameState frameState;
	frameState.cycleBudgetRemaining = 100;
	frameState.cycleBudgetGranted = 100;
	bool threw = false;
	try {
		runtime.cpuExecution.runWithBudget(runtime, frameState);
	} catch (const std::runtime_error& error) {
		threw = std::string_view(error.what()).find("native boom") != std::string_view::npos;
	}
	require(threw, "runtime frame executor should propagate CPU execution exceptions");
	require(
		runtime.machine.scheduler.currentNowCycles() == runtime.machine.scheduler.nowCycles(),
		"runtime frame executor should close scheduler CPU slice after exception"
	);
}

void testCpuNmiPreemptsMaskableIrqGolden() {
	bmsx::Memory memory;
	bmsx::IrqController irq(memory);
	bmsx::CPU cpu(memory);

	cpu.haltUntilIrq();
	irq.raise(bmsx::IRQ_VBLANK);
	cpu.requestNonMaskableInterrupt();
	require(cpu.acceptPendingInterrupt(irq) == bmsx::AcceptedInterruptKind::NonMaskable, "NMI should preempt a pending maskable IRQ");
	require(!cpu.isHaltedUntilIrq(), "accepted NMI should wake HALT");

	cpu.haltUntilIrq();
	require(cpu.acceptPendingInterrupt(irq) == bmsx::AcceptedInterruptKind::None, "NMI entry should inhibit maskable IRQ until CPU restores IFF");
	require(cpu.isHaltedUntilIrq(), "inhibited maskable IRQ should not wake HALT");
	cpu.restoreMaskableInterruptsAfterNonMaskableInterrupt();
	require(cpu.acceptPendingInterrupt(irq) == bmsx::AcceptedInterruptKind::Maskable, "restored IFF should allow pending maskable IRQ");
	require(!cpu.isHaltedUntilIrq(), "accepted maskable IRQ should wake HALT");

	cpu.disableMaskableInterrupts();
	cpu.haltUntilIrq();
	require(cpu.acceptPendingInterrupt(irq) == bmsx::AcceptedInterruptKind::None, "disabled IFF should block maskable IRQ acceptance");
	require(cpu.isHaltedUntilIrq(), "blocked maskable IRQ should leave CPU halted");
	cpu.enableMaskableInterrupts();
	require(cpu.acceptPendingInterrupt(irq) == bmsx::AcceptedInterruptKind::Maskable, "enabled IFF should accept asserted maskable IRQ line");
}

void testRuntimeSaveStateInterruptFieldsGolden() {
	bmsx::RuntimeSaveState state;
	bmsx::GeometryJobState geoJob;
	geoJob.cmd = bmsx::IO_CMD_GEO_XFORM2_BATCH;
	geoJob.src0 = 0x1000u;
	geoJob.src1 = 0x2000u;
	geoJob.src2 = 0x3000u;
	geoJob.dst0 = 0x4000u;
	geoJob.dst1 = 0x5000u;
	geoJob.count = 6u;
	geoJob.param0 = 7u;
	geoJob.param1 = 8u;
	geoJob.stride0 = 9u;
	geoJob.stride1 = 10u;
	geoJob.stride2 = 11u;
	geoJob.processed = 2u;
	geoJob.resultCount = 3u;
	geoJob.exactPairCount = 4u;
	geoJob.broadphasePairCount = 5u;
	for (size_t index = 0; index < bmsx::GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1u) {
		state.machineState.machine.geometry.registerWords[index] = static_cast<bmsx::u32>(index + 1u);
	}
	state.machineState.machine.geometry.activeJob = geoJob;
	state.machineState.machine.geometry.workCarry = 12;
	state.machineState.machine.geometry.availableWorkUnits = 1u;
	state.machineState.machine.irq.pendingFlags = bmsx::IRQ_VBLANK | bmsx::IRQ_REINIT;
	state.machineState.machine.audio.eventSequence = 3u;
	state.machineState.machine.audio.apuStatus = bmsx::APU_STATUS_FAULT;
	state.machineState.machine.audio.apuFaultCode = bmsx::APU_FAULT_SOURCE_RANGE;
	state.machineState.machine.audio.apuFaultDetail = 0x1234u;
	state.cpuState.haltedUntilIrq = true;
	state.cpuState.maskableInterruptsEnabled = false;
	state.cpuState.maskableInterruptsRestoreEnabled = true;
	state.cpuState.nonMaskableInterruptPending = true;
	state.cpuState.yieldRequested = true;
	state.systemProgramActive = true;
	state.luaInitialized = true;
	state.randomSeed = 0x12345678u;

	const std::vector<bmsx::u8> encoded = bmsx::encodeRuntimeSaveState(state);
	const bmsx::RuntimeSaveState decoded = bmsx::decodeRuntimeSaveState(encoded);
	require(decoded.machineState.machine.geometry.registerWords[0] == 1u, "save-state should preserve GEO raw registerfile");
	require(decoded.machineState.machine.geometry.activeJob.has_value(), "save-state should preserve active GEO job presence");
	require(decoded.machineState.machine.geometry.activeJob->processed == 2u, "save-state should preserve GEO processed latch");
	require(decoded.machineState.machine.geometry.activeJob->count == 6u, "save-state should preserve GEO command count latch");
	require(decoded.machineState.machine.geometry.workCarry == 12, "save-state should preserve GEO timing carry");
	require(decoded.machineState.machine.geometry.availableWorkUnits == 1u, "save-state should preserve GEO available work");
	require(decoded.machineState.machine.irq.pendingFlags == (bmsx::IRQ_VBLANK | bmsx::IRQ_REINIT), "save-state should preserve pending IRQ device flags");
	require(decoded.machineState.machine.audio.eventSequence == 3u, "save-state should preserve APU event sequence");
	require(decoded.machineState.machine.audio.apuStatus == bmsx::APU_STATUS_FAULT, "save-state should preserve APU status");
	require(decoded.machineState.machine.audio.apuFaultCode == bmsx::APU_FAULT_SOURCE_RANGE, "save-state should preserve APU fault code");
	require(decoded.machineState.machine.audio.apuFaultDetail == 0x1234u, "save-state should preserve APU fault detail");
	require(decoded.cpuState.haltedUntilIrq, "save-state should preserve HALT state");
	require(!decoded.cpuState.maskableInterruptsEnabled, "save-state should preserve disabled IFF");
	require(decoded.cpuState.maskableInterruptsRestoreEnabled, "save-state should preserve NMI return IFF");
	require(decoded.cpuState.nonMaskableInterruptPending, "save-state should preserve pending NMI");
	require(decoded.cpuState.yieldRequested, "save-state should preserve yield state alongside interrupt state");
	require(decoded.systemProgramActive && decoded.luaInitialized, "save-state should preserve runtime flags around CPU state");
	require(decoded.randomSeed == 0x12345678u, "save-state should preserve scalar runtime fields");
}

void testMachineSaveRestorePreservesIrqLineGolden() {
	RuntimeHarness harness;
	bmsx::Runtime& runtime = harness.runtime;

	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	const bmsx::MachineState fullState = runtime.machine.captureState();
	runtime.machine.irqController.reset();
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the asserted line before full-state restore");

	runtime.machine.restoreState(fullState);

	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "machine full-state restore should restore pending IRQ line state");
	require((runtime.machine.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "machine full-state restore should expose pending IRQ flags to the cart");
	runtime.machine.irqController.reset();

	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	const bmsx::MachineSaveState state = runtime.machine.captureSaveState();
	runtime.machine.irqController.reset();
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the asserted line");

	runtime.machine.restoreSaveState(state);

	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "machine save-state restore should restore pending IRQ line state");
	require((runtime.machine.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "machine save-state restore should expose pending IRQ flags to the cart");
}

void writeNoopXform2Record(bmsx::Memory& memory, uint32_t addr) {
	memory.writeU32(addr + 0u, 0u);
	memory.writeU32(addr + 4u, 0u);
	memory.writeU32(addr + 8u, 0u);
	memory.writeU32(addr + 12u, 0u);
	memory.writeU32(addr + 16u, 0u);
	memory.writeU32(addr + 20u, bmsx::GEO_INDEX_NONE);
}

void testGeometrySaveStateRestoresActiveCommandLatchGolden() {
	constexpr uint32_t XFORM2_JOB_BYTES = 24u;
	constexpr uint32_t XFORM2_VERTEX_BYTES = 8u;
	constexpr uint32_t XFORM2_MATRIX_BYTES = 24u;
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	bmsx::GeometryController& geometry = machine.geometryController;
	const uint32_t jobBase = bmsx::RAM_BASE;

	geometry.setTiming(1, 1, 0);
	for (uint32_t record = 0u; record < 3u; record += 1u) {
		writeNoopXform2Record(memory, jobBase + record * XFORM2_JOB_BYTES);
	}
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);
	writeIoWord(memory, bmsx::IO_GEO_SRC0, jobBase);
	writeIoWord(memory, bmsx::IO_GEO_SRC1, jobBase + 0x100u);
	writeIoWord(memory, bmsx::IO_GEO_SRC2, jobBase + 0x200u);
	writeIoWord(memory, bmsx::IO_GEO_DST0, jobBase + 0x300u);
	writeIoWord(memory, bmsx::IO_GEO_DST1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_COUNT, 3u);
	writeIoWord(memory, bmsx::IO_GEO_PARAM0, 0u);
	writeIoWord(memory, bmsx::IO_GEO_PARAM1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE0, XFORM2_JOB_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE1, XFORM2_VERTEX_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE2, XFORM2_MATRIX_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_CTRL, bmsx::GEO_CTRL_START);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO command should enter BUSY state");

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 1u, "GEO should process one record before save");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO should remain BUSY after a partial command");

	writeIoWord(memory, bmsx::IO_GEO_CMD, 0xffffu);
	writeIoWord(memory, bmsx::IO_GEO_COUNT, 1u);
	const bmsx::MachineSaveState saved = machine.captureSaveState();

	geometry.accrueCycles(8, 9);
	geometry.onService(9);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_DONE, "mutated live machine should finish before restore");

	machine.restoreSaveState(saved);
	geometry.setTiming(1, 1, machine.scheduler.nowCycles());
	require(memory.readIoU32(bmsx::IO_GEO_CMD) == 0xffffu, "restore should preserve the post-START visible command register");
	require(memory.readIoU32(bmsx::IO_GEO_COUNT) == 1u, "restore should preserve the post-START visible count register");
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 1u, "restore should preserve the partially processed count");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "restore should keep active GEO work BUSY");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == 0u, "restore should not synthesize an abort fault");

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 2u, "restored GEO should continue from the latched job");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "restored GEO should stay BUSY until the latched count completes");

	geometry.accrueCycles(1, 2);
	geometry.onService(2);
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 3u, "restored GEO should complete the latched count");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_DONE, "restored GEO should finish normally");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GEO_DONE) != 0u, "restored GEO completion should raise DONE IRQ");
}

struct AudioHarness {
	bmsx::Memory memory;
	bmsx::SoundMaster soundMaster;
	bmsx::IrqController irq;
	bmsx::AudioController audio;

	AudioHarness()
		: memory()
		, soundMaster()
		, irq(memory)
		, audio(memory, soundMaster, irq) {
		audio.reset();
	}
};

void expectApuFault(const AudioHarness& h, uint32_t code, const char* label) {
	require(h.memory.readIoU32(bmsx::IO_APU_FAULT_CODE) == code, label);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_FAULT) != 0u, label);
}

void clearApuFault(AudioHarness& h) {
	writeIoWord(h.memory, bmsx::IO_APU_FAULT_ACK, 1u);
	require(h.memory.readIoU32(bmsx::IO_APU_FAULT_CODE) == bmsx::APU_FAULT_NONE, "APU fault ACK should clear fault code");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_FAULT) == 0u, "APU fault ACK should clear status bit");
	require(h.memory.readIoU32(bmsx::IO_APU_FAULT_ACK) == 0u, "APU fault ACK should self-clear");
}

void writeValidApuSource(AudioHarness& h, uint32_t bitsPerSample) {
	h.memory.writeU32(bmsx::RAM_BASE, 0x11223344u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_ADDR, bmsx::RAM_BASE);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BYTES, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, 44100u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BITS_PER_SAMPLE, bitsPerSample);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_FRAME_COUNT, 1u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_OFFSET, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_BYTES, 4u);
}

void testApuDeviceFaultsGolden() {
	AudioHarness h;

	writeIoWord(h.memory, bmsx::IO_APU_CMD, 0xffffu);
	expectApuFault(h, bmsx::APU_FAULT_BAD_CMD, "invalid APU command should latch a device fault");
	writeIoWord(h.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	require(h.memory.readIoU32(bmsx::IO_APU_FAULT_CODE) == bmsx::APU_FAULT_BAD_CMD, "APU fault latch should be sticky-first until ACK");
	clearApuFault(h);

	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 99u);
	writeIoWord(h.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	expectApuFault(h, bmsx::APU_FAULT_BAD_SLOT, "invalid APU slot should latch a device fault");
	clearApuFault(h);

	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BYTES, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_SOURCE_RANGE, "unreadable APU source should latch a source-range fault");
	clearApuFault(h);

	writeValidApuSource(h, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_PLAYBACK_REJECTED, "rejected APU playback decode should latch a device fault");
}

void testRuntimeVblankEdgeCompletesActiveTickGolden() {
	RuntimeHarness harness;
	bmsx::Runtime& runtime = harness.runtime;

	runtime.frameLoop.beginFrameState(runtime);
	require(runtime.frameLoop.frameActive, "frame loop should mark a started frame active");
	require(!runtime.vblank.tickCompleted(), "new active tick should not be completed before VBlank");

	const bmsx::i64 sequenceBefore = runtime.frameScheduler.lastTickSequence;
	runtime.vblank.handleBeginTimer(runtime);
	require(runtime.vblank.tickCompleted(), "VBlank edge should complete the active runtime tick");
	require(runtime.frameScheduler.lastTickSequence == sequenceBefore + 1, "VBlank edge should enqueue exactly one tick completion");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "VBlank edge should assert the maskable IRQ line");
	require((runtime.machine.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "VBlank edge should raise the cart-visible VBlank IRQ");

	runtime.vblank.handleBeginTimer(runtime);
	require(runtime.frameScheduler.lastTickSequence == sequenceBefore + 1, "same active VBlank should not double-complete the tick");
	runtime.frameLoop.abandonFrameState(runtime);
}

void testAccessKindAndOpcodeGolden() {
	require(bmsx::getMemoryAccessKindForName("mem") == bmsx::MemoryAccessKind::Word, "mem should map to word access");
	require(bmsx::getMemoryAccessKindForName("memf32le") == bmsx::MemoryAccessKind::F32LE, "memf32le should map to F32LE access");
	require(bmsx::MEMORY_ACCESS_KIND_NAMES[static_cast<size_t>(bmsx::MemoryAccessKind::U16LE)] == "mem16le", "U16LE should expose mem16le name");
	require(bmsx::getMemoryAccessKindForName("memf64le").has_value(), "memf64le should be recognized");
	require(!bmsx::getMemoryAccessKindForName("mem128le").has_value(), "unknown memory access name should not be recognized");
	require(bmsx::OPCODE_COUNT == 64u, "opcode count should remain 64");
	require(static_cast<int>(bmsx::OpCode::HALT) == 63, "HALT opcode should stay at index 63");
	require(std::string_view(bmsx::getOpcodeName(bmsx::OpCode::LOAD_MEM)) == "LOAD_MEM", "LOAD_MEM opcode name should match TS");
	require(bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::WIDE)] == 0u, "WIDE base cycles should match TS");
	require(bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::STORE_MEM)] == 2u, "STORE_MEM base cycles should match TS");
	require(bmsx::OPCODE_USES_BX[static_cast<size_t>(bmsx::OpCode::JMPIF)] != 0u, "JMPIF should use Bx metadata");
	require(bmsx::OPCODE_USES_BX[static_cast<size_t>(bmsx::OpCode::ADD)] == 0u, "ADD should not use Bx metadata");
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
	require(bmsx::tokenKey(parts.lo, parts.hi) == "4dc5355f4a2a0873", "asset token key should match TS order");
	require(bmsx::assetTypeToId("lua") == bmsx::ROM_TOC_ASSET_TYPE_LUA, "lua asset type id should match ROM TOC schema");
	require(bmsx::assetTypeFromId(bmsx::ROM_TOC_ASSET_TYPE_AEM) == "aem", "aem asset type id should decode");
	require(bmsx::resolveAssetTypeKind("atlas") == bmsx::AssetTypeKind::ImageAtlas, "atlas should load through image-atlas path");
	bmsx::RuntimeRomPackage package;
	bmsx::LuaSourceAsset luaAsset;
	luaAsset.id = "main";
	luaAsset.path = "cart.lua";
	luaAsset.modulePath = bmsx::toLuaModulePath(luaAsset.path);
	package.insertLuaSource(std::move(luaAsset));
	require(package.getLuaModule("cart") != nullptr, "Lua source lookup should use module path keys");
	require(package.getLuaModule("cart.lua") == nullptr, "Lua source lookup should not pretend source paths are module keys");
	require(package.hasLuaModule("cart"), "Lua source module presence should use module path keys");
	require(package.getLuaSource("cart.lua") != nullptr, "Lua source lookup should use source path keys");
	require(package.getLuaSource("cart") == nullptr, "Lua source lookup should not pretend module paths are source keys");
	require(package.hasLuaSource("cart.lua"), "Lua source path presence should use source path keys");
	require(package.luaSources().size() == 1u, "Lua source storage should be exposed read-only through the package owner");
	bmsx::LuaSourceAsset replacementLuaAsset;
	replacementLuaAsset.id = "main";
	replacementLuaAsset.path = "main.lua";
	replacementLuaAsset.modulePath = "cart";
	package.insertLuaSource(std::move(replacementLuaAsset));
	require(package.getLuaSource("cart.lua") == nullptr, "Lua source replacement should remove stale source-path index entries");
	require(package.getLuaSource("main.lua") != nullptr, "Lua source replacement should index the new source path");
	package.clear();
	require(package.getLuaModule("cart") == nullptr, "RuntimeRomPackage clear should remove Lua module entries");
	require(package.getLuaSource("main.lua") == nullptr, "RuntimeRomPackage clear should remove Lua source-path index entries");
	require(package.luaSources().empty(), "RuntimeRomPackage clear should remove Lua source storage");
	require(std::string(bmsx::systemBootEntryPath()) == "bios/bootrom.lua", "system boot entry should be a Lua source path");
	bmsx::RuntimeRomPackage systemPackage;
	systemPackage.entryPoint = bmsx::systemBootEntryPath();
	bmsx::LuaSourceAsset bootLuaAsset;
	bootLuaAsset.id = "bootrom";
	bootLuaAsset.path = bmsx::systemBootEntryPath();
	bootLuaAsset.modulePath = bmsx::toLuaModulePath(bootLuaAsset.path);
	systemPackage.insertLuaSource(std::move(bootLuaAsset));
	require(systemPackage.getLuaSource(systemPackage.entryPoint) != nullptr, "system boot entry should resolve through source-path lookup");
	require(systemPackage.getLuaModule("bios/bootrom") != nullptr, "system boot module should remain available for module lookup");

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

void testProgramLoaderModulePathsGolden() {
	require(bmsx::toLuaModulePath("cart.lua") == "cart", "module path should strip lua suffix");
	require(bmsx::toLuaModulePath("bios/font.lua") == "bios/font", "module path should preserve bios namespace");
	require(bmsx::toLuaModulePath("src/carts/pietious/cart.lua") == "cart", "module path should strip cart workspace root");
	require(bmsx::toLuaModulePath("src/carts/pietious/room/index.lua") == "room/index", "module path should strip cart name");
	require(bmsx::toLuaModulePath("src\\carts\\pietious\\room\\index.lua") == "room/index", "module path should normalize source separators");
	require(bmsx::toLuaModulePath("src/bmsx/res/_ignore/ide/source_text.lua") == "_ignore/ide/source_text", "module path should strip engine resource root");
	require(bmsx::toLuaModulePath("res/_ignore/ide/source_text.lua") == "_ignore/ide/source_text", "module path should strip virtual resource root");
}

} // namespace

int main() {
	const std::array<std::pair<const char*, void (*)()>, 25> tests{{
		{"memory", testMemoryGolden},
		{"raw memory bus faults", testRawMemoryBusFaults},
		{"dma memory fault status", testDmaMemoryFaultStatus},
		{"image decoder fault status", testImageDecoderFaultStatus},
		{"budget and fixed16", testBudgetAndFixed16Golden},
		{"texture key", testTextureKeyGolden},
		{"string pool", testStringPoolGolden},
		{"program ROM accounting", testProgramRomAccountingGolden},
		{"cpu halt requires accepted interrupt", testCpuHaltRequiresAcceptedInterruptGolden},
		{"cpu external halt does not return", testCpuExternalHaltDoesNotReturnGolden},
		{"runtime host-call halt unwinds", testRuntimeHostCallHaltUnwindsGolden},
		{"runtime host-call throw charges spent budget", testRuntimeHostCallThrowChargesSpentBudgetGolden},
		{"runtime frame executor throw closes cpu slice", testRuntimeFrameExecutorThrowClosesCpuSliceGolden},
		{"cpu nmi preempts maskable irq", testCpuNmiPreemptsMaskableIrqGolden},
		{"runtime save-state interrupt fields", testRuntimeSaveStateInterruptFieldsGolden},
		{"machine save-state restore preserves irq line", testMachineSaveRestorePreservesIrqLineGolden},
		{"GEO save-state restores active command latch", testGeometrySaveStateRestoresActiveCommandLatchGolden},
		{"APU device faults", testApuDeviceFaultsGolden},
		{"runtime vblank edge completes active tick", testRuntimeVblankEdgeCompletesActiveTickGolden},
		{"memory access and opcode", testAccessKindAndOpcodeGolden},
		{"timing and hash", testTimingAndHashGolden},
		{"rompack schema", testRompackSchemaGolden},
		{"firmware descriptors", testFirmwareDescriptorGolden},
		{"render schema", testRenderSchemaGolden},
		{"program loader module paths", testProgramLoaderModulePathsGolden},
	}};
	for (const auto& test : tests) {
		test.second();
	}
	return 0;
}
