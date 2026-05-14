#include "core/system.h"
#include "common/serializer/binencoder.h"
#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/vdp/vout.h"
#include "machine/firmware/builtin_descriptors.h"
#include "machine/firmware/system_globals.h"
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
#include "machine/runtime/save_state/schema.h"
#include "machine/runtime/timing/constants.h"
#include "machine/runtime/timing/state.h"
#include "machine/scheduler/budget.h"
#include "machine/common/hash.h"
#include "audio/soundmaster.h"
#include "input/gamepad.h"
#include "input/manager.h"
#include "input/player.h"
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
	const std::array<uint32_t, 5> readOnlyIcuRegisters{
		bmsx::IO_INP_STATUS,
		bmsx::IO_INP_VALUE,
		bmsx::IO_INP_EVENT_STATUS,
		bmsx::IO_INP_EVENT_COUNT,
		bmsx::IO_INP_OUTPUT_STATUS,
	};
	for (const uint32_t readOnlyIcuRegister : readOnlyIcuRegisters) {
		memory.writeMappedU32LE(readOnlyIcuRegister, 0u);
		requireBusFault(
			memory,
			bmsx::BUS_FAULT_READ_ONLY,
			readOnlyIcuRegister,
			bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U32,
			"mapped I/O u32le write to read-only ICU register should latch a bus fault"
		);
		clearBusFault(memory);
	}

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
	state.machineState.machine.geometry.phase = bmsx::GeometryControllerPhase::Busy;
	state.machineState.machine.geometry.activeJob = geoJob;
	state.machineState.machine.geometry.workCarry = 12;
	state.machineState.machine.geometry.availableWorkUnits = 1u;
	state.machineState.machine.irq.pendingFlags = bmsx::IRQ_VBLANK | bmsx::IRQ_REINIT;
	for (size_t index = 0; index < bmsx::APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		state.machineState.machine.audio.registerWords[index] = static_cast<bmsx::u32>(index + 1u);
	}
	state.machineState.machine.audio.registerWords[bmsx::APU_PARAMETER_SLOT_INDEX] = 1u;
	state.machineState.machine.audio.eventSequence = 3u;
	state.machineState.machine.audio.eventKind = bmsx::APU_EVENT_SLOT_ENDED;
	state.machineState.machine.audio.eventSlot = 2u;
	state.machineState.machine.audio.eventSourceAddr = 0x2000u;
	state.machineState.machine.audio.slotPhases[1u] = bmsx::APU_SLOT_PHASE_FADING;
	state.machineState.machine.audio.slotPhases[2u] = bmsx::APU_SLOT_PHASE_PLAYING;
	state.machineState.machine.audio.slotRegisterWords[bmsx::apuSlotRegisterWordIndex(0u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x1000u;
	state.machineState.machine.audio.slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x2000u;
	state.machineState.machine.audio.slotRegisterWords[bmsx::apuSlotRegisterWordIndex(2u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x3000u;
	state.machineState.machine.audio.slotSourceBytes[1u] = {9u, 8u, 7u, 6u};
	state.machineState.machine.audio.slotPlaybackCursorQ16[1u] = static_cast<bmsx::i64>(2u * bmsx::APU_RATE_STEP_Q16_ONE);
	state.machineState.machine.audio.slotFadeSamplesRemaining[1u] = 7u;
	state.machineState.machine.audio.slotFadeSamplesTotal[1u] = 11u;
	bmsx::ApuOutputVoiceState audioVoice;
	audioVoice.slot = 1u;
	audioVoice.position = 2.5;
	audioVoice.step = 1.0;
	audioVoice.gain = 0.75f;
	audioVoice.targetGain = 0.5f;
	audioVoice.gainRampRemaining = 0.25;
	audioVoice.stopAfter = 0.125;
	audioVoice.filterSampleRate = bmsx::APU_SAMPLE_RATE_HZ;
	audioVoice.filter.enabled = true;
	audioVoice.filter.b0 = 0.1f;
	audioVoice.filter.b1 = 0.2f;
	audioVoice.filter.b2 = 0.3f;
	audioVoice.filter.a1 = -0.4f;
	audioVoice.filter.a2 = 0.5f;
	audioVoice.filter.l1 = 0.6f;
	audioVoice.filter.l2 = 0.7f;
	audioVoice.filter.r1 = 0.8f;
	audioVoice.filter.r2 = 0.9f;
	audioVoice.badp.predictors = std::array<bmsx::i32, 2u>{{11, -12}};
	audioVoice.badp.stepIndices = std::array<bmsx::i32, 2u>{{3, 4}};
	audioVoice.badp.nextFrame = 5u;
	audioVoice.badp.blockEnd = 6u;
	audioVoice.badp.blockFrames = 7u;
	audioVoice.badp.blockFrameIndex = 8u;
	audioVoice.badp.payloadOffset = 9u;
	audioVoice.badp.nibbleCursor = 10u;
	audioVoice.badp.decodedFrame = 11;
	audioVoice.badp.decodedLeft = -12;
	audioVoice.badp.decodedRight = 13;
	state.machineState.machine.audio.output.voices.push_back(audioVoice);
	state.machineState.machine.audio.sampleCarry = 8;
	state.machineState.machine.audio.availableSamples = 9;
	state.machineState.machine.audio.apuStatus = bmsx::APU_STATUS_FAULT;
	state.machineState.machine.audio.apuFaultCode = bmsx::APU_FAULT_SOURCE_RANGE;
	state.machineState.machine.audio.apuFaultDetail = 0x1234u;
	state.machineState.machine.input.sampleArmed = true;
	state.machineState.machine.input.sampleSequence = 3u;
	state.machineState.machine.input.lastSampleCycle = 77u;
	state.machineState.machine.input.registers.player = 2u;
	state.machineState.machine.input.registers.actionStringId = 4u;
	state.machineState.machine.input.registers.bindStringId = 5u;
	state.machineState.machine.input.registers.ctrl = bmsx::INP_CTRL_ARM;
	state.machineState.machine.input.registers.queryStringId = 6u;
	state.machineState.machine.input.registers.status = 1u;
	state.machineState.machine.input.registers.value = 0u;
	state.machineState.machine.input.registers.consumeStringId = 7u;
	state.machineState.machine.input.registers.outputIntensityQ16 = 0x8000u;
	state.machineState.machine.input.registers.outputDurationMs = 120u;
	state.machineState.machine.input.players[1u].actions.push_back(bmsx::InputControllerActionState{ 4u, 5u, 0x809u, 0x8000u, 12.5, 2u });
	state.machineState.machine.input.eventFifoEvents.push_back(bmsx::InputControllerEventState{ 2u, 4u, 0x80au, 0x8000u, 2u });
	state.machineState.machine.input.eventFifoOverflow = true;
	state.machineState.machine.vdp.activeFrame.state = bmsx::VdpSubmittedFrameState::Executing;
	state.machineState.machine.vdp.activeFrame.hasCommands = true;
	state.machineState.machine.vdp.activeFrame.hasFrameBufferCommands = true;
	state.machineState.machine.vdp.activeFrame.cost = 9;
	state.machineState.machine.vdp.activeFrame.workRemaining = 7;
	state.machineState.machine.vdp.activeFrame.ditherType = 2;
	state.machineState.machine.vdp.activeFrame.frameBufferWidth = 256u;
	state.machineState.machine.vdp.activeFrame.frameBufferHeight = 212u;
	state.machineState.machine.vdp.activeFrame.skyboxControl = 5u;
	state.machineState.machine.vdp.activeFrame.skyboxFaceWords[0u] = 6u;
	state.machineState.machine.vdp.activeFrame.skyboxSamples[0u].source.surfaceId = 7u;
	state.machineState.machine.vdp.activeFrame.skyboxSamples[0u].surfaceWidth = 8u;
	state.machineState.machine.vdp.activeFrame.skyboxSamples[0u].surfaceHeight = 9u;
	state.machineState.machine.vdp.activeFrame.skyboxSamples[0u].slot = 10u;
	state.machineState.machine.vdp.pendingFrame.state = bmsx::VdpSubmittedFrameState::Queued;
	state.machineState.machine.vdp.pendingFrame.cost = 3;
	state.machineState.machine.vdp.pendingFrame.workRemaining = 3;
	state.machineState.machine.vdp.workCarry = 12;
	state.machineState.machine.vdp.availableWorkUnits = 3;
	state.machineState.machine.vdp.streamIngress.dmaSubmitActive = true;
	state.machineState.machine.vdp.streamIngress.fifoWordScratch = std::array<bmsx::u8, 4u>{{1u, 2u, 3u, 4u}};
	state.machineState.machine.vdp.streamIngress.fifoWordByteCount = 2;
	state.machineState.machine.vdp.streamIngress.fifoStreamWords = {0x12345678u};
	state.machineState.machine.vdp.streamIngress.fifoStreamWordCount = 1u;
	state.machineState.machine.vdp.blitterSequence = 5u;
	state.cpuState.haltedUntilIrq = true;
	state.cpuState.maskableInterruptsEnabled = false;
	state.cpuState.maskableInterruptsRestoreEnabled = true;
	state.cpuState.nonMaskableInterruptPending = true;
	state.cpuState.yieldRequested = true;
	state.systemProgramActive = true;
	state.luaInitialized = true;
	state.randomSeed = 0x12345678u;

	const std::vector<bmsx::u8> encoded = bmsx::encodeRuntimeSaveState(state);
	require(!encoded.empty(), "runtime save-state should emit payload bytes");
	require(bmsx::decodeBinaryWithPropTable(encoded, bmsx::RUNTIME_SAVE_STATE_PROP_NAMES).isObject(), "runtime save-state bytes should start at the property-table payload");
	bool skippedFrameRejected = false;
	try {
		bmsx::decodeBinaryWithPropTable(encoded.data() + 2u, encoded.size() - 2u, bmsx::RUNTIME_SAVE_STATE_PROP_NAMES);
	} catch (const std::exception&) {
		skippedFrameRejected = true;
	}
	require(skippedFrameRejected, "runtime save-state bytes should not contain a two-byte frame before the payload");
	const bmsx::RuntimeSaveState decoded = bmsx::decodeRuntimeSaveState(encoded);
	require(decoded.machineState.machine.geometry.registerWords[0] == 1u, "save-state should preserve GEO raw registerfile");
	require(decoded.machineState.machine.geometry.phase == bmsx::GeometryControllerPhase::Busy, "save-state should preserve GEO hardware phase");
	require(decoded.machineState.machine.geometry.activeJob.has_value(), "save-state should preserve active GEO job presence");
	require(decoded.machineState.machine.geometry.activeJob->processed == 2u, "save-state should preserve GEO processed latch");
	require(decoded.machineState.machine.geometry.activeJob->count == 6u, "save-state should preserve GEO command count latch");
	require(decoded.machineState.machine.geometry.workCarry == 12, "save-state should preserve GEO timing carry");
	require(decoded.machineState.machine.geometry.availableWorkUnits == 1u, "save-state should preserve GEO available work");
	require(decoded.machineState.machine.irq.pendingFlags == (bmsx::IRQ_VBLANK | bmsx::IRQ_REINIT), "save-state should preserve pending IRQ device flags");
	require(decoded.machineState.machine.audio.eventSequence == 3u, "save-state should preserve APU event sequence");
	require(decoded.machineState.machine.audio.eventKind == bmsx::APU_EVENT_SLOT_ENDED, "save-state should preserve APU event kind latch");
	require(decoded.machineState.machine.audio.eventSlot == 2u, "save-state should preserve APU event slot latch");
	require(decoded.machineState.machine.audio.eventSourceAddr == 0x2000u, "save-state should preserve APU event source latch");
	require(decoded.machineState.machine.audio.registerWords[bmsx::APU_PARAMETER_SLOT_INDEX] == 1u, "save-state should preserve APU selected slot register word");
	require(decoded.machineState.machine.audio.slotPhases[1u] == bmsx::APU_SLOT_PHASE_FADING, "save-state should preserve APU fading slot phase");
	require(decoded.machineState.machine.audio.slotPhases[2u] == bmsx::APU_SLOT_PHASE_PLAYING, "save-state should preserve APU playing slot phase");
	require(decoded.machineState.machine.audio.slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] == 0x2000u, "save-state should preserve APU slot source latch bank");
	require(decoded.machineState.machine.audio.slotSourceBytes[1u].size() == 4u, "save-state should preserve APU slot source byte count");
	require(decoded.machineState.machine.audio.slotSourceBytes[1u][0] == 9u, "save-state should preserve APU slot source bytes");
	require(decoded.machineState.machine.audio.slotPlaybackCursorQ16[1u] == static_cast<bmsx::i64>(2u * bmsx::APU_RATE_STEP_Q16_ONE), "save-state should preserve APU slot playback cursor");
	require(decoded.machineState.machine.audio.slotFadeSamplesRemaining[1u] == 7u, "save-state should preserve APU slot fade timer");
	require(decoded.machineState.machine.audio.slotFadeSamplesTotal[1u] == 11u, "save-state should preserve APU slot fade envelope duration");
	require(decoded.machineState.machine.audio.output.voices.size() == 1u, "save-state should preserve active AOUT voice count");
	require(decoded.machineState.machine.audio.output.voices[0].slot == 1u, "save-state should preserve AOUT voice slot");
	require(decoded.machineState.machine.audio.output.voices[0].position == 2.5, "save-state should preserve AOUT voice position");
	require(decoded.machineState.machine.audio.output.voices[0].filter.enabled, "save-state should preserve AOUT filter enable");
	require(decoded.machineState.machine.audio.output.voices[0].filter.l1 == 0.6f, "save-state should preserve AOUT filter history");
	require(decoded.machineState.machine.audio.output.voices[0].badp.predictors[1u] == -12, "save-state should preserve AOUT BADP predictor state");
	require(decoded.machineState.machine.audio.output.voices[0].badp.decodedRight == 13, "save-state should preserve AOUT BADP decoded sample state");
	require(decoded.machineState.machine.audio.sampleCarry == 8, "save-state should preserve APU sample carry");
	require(decoded.machineState.machine.audio.availableSamples == 9, "save-state should preserve APU available samples");
	require(decoded.machineState.machine.audio.apuStatus == bmsx::APU_STATUS_FAULT, "save-state should preserve APU status");
	require(decoded.machineState.machine.audio.apuFaultCode == bmsx::APU_FAULT_SOURCE_RANGE, "save-state should preserve APU fault code");
	require(decoded.machineState.machine.audio.apuFaultDetail == 0x1234u, "save-state should preserve APU fault detail");
	require(decoded.machineState.machine.input.sampleArmed, "save-state should preserve ICU sample arm latch");
	require(decoded.machineState.machine.input.sampleSequence == 3u, "save-state should preserve ICU sample sequence latch");
	require(decoded.machineState.machine.input.lastSampleCycle == 77u, "save-state should preserve ICU sample cycle latch");
	require(decoded.machineState.machine.input.registers.player == 2u, "save-state should preserve ICU player register");
	require(decoded.machineState.machine.input.registers.actionStringId == 4u, "save-state should preserve ICU action string register");
	require(decoded.machineState.machine.input.registers.bindStringId == 5u, "save-state should preserve ICU bind string register");
	require(decoded.machineState.machine.input.registers.queryStringId == 6u, "save-state should preserve ICU query string register");
	require(decoded.machineState.machine.input.registers.consumeStringId == 7u, "save-state should preserve ICU consume string register");
	require(decoded.machineState.machine.input.players[1u].actions.size() == 1u, "save-state should preserve ICU committed action table");
	require(decoded.machineState.machine.input.players[1u].actions[0].actionStringId == 4u, "save-state should preserve ICU committed action id");
	require(decoded.machineState.machine.input.players[1u].actions[0].bindStringId == 5u, "save-state should preserve ICU committed bind id");
	require(decoded.machineState.machine.input.players[1u].actions[0].statusWord == 0x809u, "save-state should preserve ICU action status snapshot");
	require(decoded.machineState.machine.input.players[1u].actions[0].valueQ16 == 0x8000u, "save-state should preserve ICU action value snapshot");
	require(decoded.machineState.machine.input.players[1u].actions[0].pressTime == 12.5, "save-state should preserve ICU action press-time snapshot");
	require(decoded.machineState.machine.input.players[1u].actions[0].repeatCount == 2u, "save-state should preserve ICU action repeat-count snapshot");
	require(decoded.machineState.machine.vdp.activeFrame.state == bmsx::VdpSubmittedFrameState::Executing, "save-state should preserve active VDP submitted-frame state");
	require(decoded.machineState.machine.vdp.activeFrame.workRemaining == 7, "save-state should preserve active VDP submitted-frame work latch");
	require(decoded.machineState.machine.vdp.activeFrame.skyboxSamples[0u].source.surfaceId == 7u, "save-state should preserve active VDP submitted-frame skybox sample");
	require(decoded.machineState.machine.vdp.pendingFrame.state == bmsx::VdpSubmittedFrameState::Queued, "save-state should preserve queued VDP submitted-frame state");
	require(decoded.machineState.machine.vdp.streamIngress.fifoWordScratch[2u] == 3u, "save-state should preserve VDP FIFO word scratch bytes");
	require(decoded.machineState.machine.vdp.streamIngress.fifoStreamWords.size() == 1u && decoded.machineState.machine.vdp.streamIngress.fifoStreamWords[0u] == 0x12345678u, "save-state should preserve VDP FIFO stream ingress words");
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
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_FLAGS_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_DST_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, bmsx::GEO_INDEX_NONE);
}

void writeOversizeXform2Record(bmsx::Memory& memory, uint32_t addr) {
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_FLAGS_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_DST_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, bmsx::GEO_XFORM2_MAX_VERTICES + 1u);
	memory.writeU32(addr + bmsx::GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, bmsx::GEO_INDEX_NONE);
}

void writeXform2BatchRegisters(bmsx::Memory& memory, uint32_t jobBase, uint32_t count) {
	writeIoWord(memory, bmsx::IO_GEO_SRC0, jobBase);
	writeIoWord(memory, bmsx::IO_GEO_SRC1, jobBase + 0x100u);
	writeIoWord(memory, bmsx::IO_GEO_SRC2, jobBase + 0x200u);
	writeIoWord(memory, bmsx::IO_GEO_DST0, jobBase + 0x300u);
	writeIoWord(memory, bmsx::IO_GEO_DST1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_COUNT, count);
	writeIoWord(memory, bmsx::IO_GEO_PARAM0, 0u);
	writeIoWord(memory, bmsx::IO_GEO_PARAM1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE0, bmsx::GEO_XFORM2_RECORD_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE1, bmsx::GEO_VERTEX2_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE2, bmsx::GEO_XFORM2_MATRIX_BYTES);
}

void writeSat2BatchRegisters(bmsx::Memory& memory, uint32_t pairBase, uint32_t descBase, uint32_t vertexBase, uint32_t resultBase, uint32_t count) {
	writeIoWord(memory, bmsx::IO_GEO_SRC0, pairBase);
	writeIoWord(memory, bmsx::IO_GEO_SRC1, descBase);
	writeIoWord(memory, bmsx::IO_GEO_SRC2, vertexBase);
	writeIoWord(memory, bmsx::IO_GEO_DST0, resultBase);
	writeIoWord(memory, bmsx::IO_GEO_DST1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_COUNT, count);
	writeIoWord(memory, bmsx::IO_GEO_PARAM0, 0u);
	writeIoWord(memory, bmsx::IO_GEO_PARAM1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE0, bmsx::GEO_SAT2_PAIR_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE1, bmsx::GEO_SAT2_DESC_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE2, bmsx::GEO_VERTEX2_BYTES);
}

void writeSat2Pair(bmsx::Memory& memory, uint32_t addr) {
	memory.writeU32(addr + bmsx::GEO_SAT2_PAIR_FLAGS_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_SAT2_PAIR_RESULT_INDEX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET, 1u);
	memory.writeU32(addr + bmsx::GEO_SAT2_PAIR_FLAGS2_OFFSET, 0u);
}

void writeSat2Desc(bmsx::Memory& memory, uint32_t addr, uint32_t vertexCount, uint32_t vertexOffsetBytes) {
	memory.writeU32(addr + bmsx::GEO_SAT2_DESC_FLAGS_OFFSET, bmsx::GEO_SHAPE_CONVEX_POLY);
	memory.writeU32(addr + bmsx::GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, vertexCount);
	memory.writeU32(addr + bmsx::GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET, vertexOffsetBytes);
	memory.writeU32(addr + bmsx::GEO_SAT2_DESC_RESERVED_OFFSET, 0u);
}

constexpr uint32_t OVERLAP2D_FULL_PASS_PARAM0 = bmsx::GEO_OVERLAP2D_MODE_FULL_PASS
	| bmsx::GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
	| bmsx::GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
	| bmsx::GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW;

void writeOverlap2dFullPassRegisters(bmsx::Memory& memory, uint32_t instanceBase, uint32_t instanceCount, uint32_t src2, uint32_t dst0, uint32_t resultCapacity) {
	writeIoWord(memory, bmsx::IO_GEO_SRC0, instanceBase);
	writeIoWord(memory, bmsx::IO_GEO_SRC1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_SRC2, src2);
	writeIoWord(memory, bmsx::IO_GEO_DST0, dst0);
	writeIoWord(memory, bmsx::IO_GEO_DST1, instanceBase + 0x200u);
	writeIoWord(memory, bmsx::IO_GEO_COUNT, instanceCount);
	writeIoWord(memory, bmsx::IO_GEO_PARAM0, OVERLAP2D_FULL_PASS_PARAM0);
	writeIoWord(memory, bmsx::IO_GEO_PARAM1, resultCapacity);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE0, bmsx::GEO_OVERLAP2D_INSTANCE_BYTES);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE1, 0u);
	writeIoWord(memory, bmsx::IO_GEO_STRIDE2, 0u);
}

void writeOverlap2dInstance(bmsx::Memory& memory, uint32_t addr, uint32_t shapeAddr) {
	memory.writeU32(addr + bmsx::GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET, shapeAddr);
	memory.writeU32(addr + bmsx::GEO_OVERLAP2D_INSTANCE_TX_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_OVERLAP2D_INSTANCE_TY_OFFSET, 0u);
	memory.writeU32(addr + bmsx::GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET, 1u);
	memory.writeU32(addr + bmsx::GEO_OVERLAP2D_INSTANCE_MASK_OFFSET, 1u);
}

void writeOversizeOverlapPoly(bmsx::Memory& memory, uint32_t shapeAddr) {
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_KIND_OFFSET, bmsx::GEO_PRIMITIVE_CONVEX_POLY);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, 0x40000000u);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET, 0u);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET, 0u);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET, 0x3f800000u);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET, 0x3f800000u);
}

void writeOverlapAabbShape(bmsx::Memory& memory, uint32_t shapeAddr, uint32_t left, uint32_t top, uint32_t right, uint32_t bottom) {
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_KIND_OFFSET, bmsx::GEO_PRIMITIVE_AABB);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, bmsx::GEO_OVERLAP2D_AABB_DATA_COUNT);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET, left);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET, top);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET, right);
	memory.writeU32(shapeAddr + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET, bottom);
}

void testGeometrySaveStateRestoresActiveCommandLatchGolden() {
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	bmsx::GeometryController& geometry = machine.geometryController;
	const uint32_t jobBase = bmsx::RAM_BASE;

	geometry.setTiming(1, 1, 0);
	for (uint32_t record = 0u; record < 3u; record += 1u) {
		writeNoopXform2Record(memory, jobBase + record * bmsx::GEO_XFORM2_RECORD_BYTES);
	}
	writeXform2BatchRegisters(memory, jobBase, 3u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO command should enter BUSY state");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Busy, "GEO controller phase should enter BUSY with the device status");

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 1u, "GEO should process one record before save");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO should remain BUSY after a partial command");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Busy, "GEO controller phase should stay BUSY while work remains");

	writeIoWord(memory, bmsx::IO_GEO_COUNT, 1u);
	const bmsx::MachineSaveState saved = machine.captureSaveState();

	geometry.accrueCycles(8, 9);
	geometry.onService(9);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_DONE, "mutated live machine should finish before restore");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Done, "completed GEO controller phase should be DONE");

	machine.restoreSaveState(saved);
	geometry.setTiming(1, 1, machine.scheduler.nowCycles());
	require(memory.readIoU32(bmsx::IO_GEO_CMD) == bmsx::IO_CMD_GEO_XFORM2_BATCH, "restore should preserve the latched visible command register");
	require(memory.readIoU32(bmsx::IO_GEO_COUNT) == 1u, "restore should preserve the post-doorbell visible count register");
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 1u, "restore should preserve the partially processed count");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "restore should keep active GEO work BUSY");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == 0u, "restore should not synthesize an abort fault");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Busy, "restore should keep the GEO controller phase BUSY");

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 2u, "restored GEO should continue from the latched job");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "restored GEO should stay BUSY until the latched count completes");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Busy, "restored GEO controller phase should stay BUSY until completion");

	geometry.accrueCycles(1, 2);
	geometry.onService(2);
	require(memory.readIoU32(bmsx::IO_GEO_PROCESSED) == 3u, "restored GEO should complete the latched count");
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_DONE, "restored GEO should finish normally");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Done, "restored GEO controller phase should finish DONE");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GEO_DONE) != 0u, "restored GEO completion should raise DONE IRQ");
}

void testGeometryExecutionFaultAckPreservesCompletedStatusGolden() {
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	bmsx::GeometryController& geometry = machine.geometryController;
	const uint32_t jobBase = bmsx::RAM_BASE + 0x600u;

	geometry.setTiming(1, 1, 0);
	writeNoopXform2Record(memory, jobBase);
	memory.writeU32(jobBase + 0u, 1u);
	writeXform2BatchRegisters(memory, jobBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);

	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO command should enter BUSY before the execution fault");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Busy, "GEO controller phase should enter BUSY before the execution fault");
	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO execution fault should preserve DONE with ERROR status");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) != 0u, "GEO execution fault should expose a fault word");
	const uint32_t executionFault = memory.readIoU32(bmsx::IO_GEO_FAULT);
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO execution fault should latch ERROR controller phase");

	writeNoopXform2Record(memory, jobBase);
	writeXform2BatchRegisters(memory, jobBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO command doorbell should not clear execution fault status before FAULT_ACK");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == executionFault, "GEO command doorbell should not clear the execution fault word before FAULT_ACK");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO command doorbell should keep ERROR phase until FAULT_ACK");
	writeIoWord(memory, bmsx::IO_GEO_CTRL, bmsx::GEO_CTRL_ABORT);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO ABORT should not clear execution fault status before FAULT_ACK");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == executionFault, "GEO ABORT should not clear the execution fault word before FAULT_ACK");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO ABORT should keep ERROR phase until FAULT_ACK");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_DONE, "GEO FAULT_ACK should preserve DONE after an execution fault");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == 0u, "GEO FAULT_ACK should clear the execution fault word");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT_ACK) == 0u, "GEO FAULT_ACK should self-clear after an execution fault");
	require(geometry.captureState().phase == bmsx::GeometryControllerPhase::Done, "GEO FAULT_ACK should return execution fault phase to DONE");
}

void testGeometryRejectedCommandPhaseGolden() {
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	const uint32_t jobBase = bmsx::RAM_BASE;

	writeIoWord(memory, bmsx::IO_GEO_CMD, 0xffffu);

	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_REJECTED, "invalid GEO command should latch REJECTED status");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) != 0u, "invalid GEO command should expose a fault word");
	const uint32_t rejectedFault = memory.readIoU32(bmsx::IO_GEO_FAULT);
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Rejected, "invalid GEO command should latch REJECTED controller phase");

	writeNoopXform2Record(memory, jobBase);
	writeXform2BatchRegisters(memory, jobBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_REJECTED, "GEO command doorbell should not clear rejected status before FAULT_ACK");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == rejectedFault, "GEO command doorbell should not clear the rejected fault word before FAULT_ACK");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Rejected, "GEO command doorbell should keep REJECTED phase until FAULT_ACK");
	writeIoWord(memory, bmsx::IO_GEO_CTRL, bmsx::GEO_CTRL_ABORT);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_REJECTED, "GEO ABORT should not clear rejected status before FAULT_ACK");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == rejectedFault, "GEO ABORT should not clear the rejected fault word before FAULT_ACK");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Rejected, "GEO ABORT should keep REJECTED phase until FAULT_ACK");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == 0u, "GEO FAULT_ACK should clear REJECTED status");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) == 0u, "GEO FAULT_ACK should clear the fault word");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT_ACK) == 0u, "GEO FAULT_ACK should self-clear");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Idle, "GEO FAULT_ACK should return rejected phase to IDLE");
}

void testGeometryXform2RecordCapacityFaultGolden() {
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	const uint32_t jobBase = bmsx::RAM_BASE + 0x700u;

	writeOversizeXform2Record(memory, jobBase);
	writeXform2BatchRegisters(memory, jobBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO xform2 should enter BUSY before record-capacity fault");
	machine.geometryController.accrueCycles(1, 1);
	machine.geometryController.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO xform2 should complete through ERROR for oversize vertex batch");
	require((memory.readIoU32(bmsx::IO_GEO_FAULT) >> bmsx::GEO_FAULT_CODE_SHIFT) == bmsx::GEO_FAULT_BAD_VERTEX_COUNT, "GEO xform2 oversize vertex batch should expose a vertex-count fault");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO xform2 record-capacity fault should latch ERROR phase");
}

void testGeometrySat2ScratchCapacityFaultGolden() {
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	const uint32_t pairBase = bmsx::RAM_BASE + 0x800u;
	const uint32_t descBase = bmsx::RAM_BASE + 0x900u;
	const uint32_t vertexBase = bmsx::RAM_BASE + 0xa00u;
	const uint32_t resultBase = bmsx::RAM_BASE + 0xb00u;

	writeSat2Pair(memory, pairBase);
	writeSat2Desc(memory, descBase, bmsx::GEO_SAT2_MAX_POLY_VERTICES + 1u, 0u);
	writeSat2Desc(memory, descBase + bmsx::GEO_SAT2_DESC_BYTES, 3u, bmsx::GEO_VERTEX2_BYTES * 4u);
	writeSat2BatchRegisters(memory, pairBase, descBase, vertexBase, resultBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_SAT2_BATCH);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO sat2 should enter BUSY before scratch-capacity fault");
	machine.geometryController.accrueCycles(1, 1);
	machine.geometryController.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO sat2 should complete through ERROR for oversize public poly span");
	require((memory.readIoU32(bmsx::IO_GEO_FAULT) >> bmsx::GEO_FAULT_CODE_SHIFT) == bmsx::GEO_FAULT_BAD_VERTEX_COUNT, "GEO sat2 oversize public poly span should expose a vertex-count fault");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO sat2 scratch-capacity fault should latch ERROR phase");
}

void testGeometryOverlap2dSubmitContractGolden() {
	RuntimeHarness harness;
	bmsx::Machine& machine = harness.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	const uint32_t jobBase = bmsx::RAM_BASE + 0x900u;

	writeOverlap2dFullPassRegisters(memory, jobBase, 0u, jobBase + 0x100u, jobBase + 0x300u, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_REJECTED, "GEO overlap2d should reject non-zero reserved src2");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) != 0u, "GEO overlap2d src2 reject should expose a fault word");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Rejected, "GEO overlap2d src2 reject should latch REJECTED phase");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	writeOverlap2dFullPassRegisters(memory, jobBase, 0u, 0u, 0u, 0u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_REJECTED, "GEO overlap2d should reject non-RAM dst0 even with zero result capacity");
	require(memory.readIoU32(bmsx::IO_GEO_FAULT) != 0u, "GEO overlap2d dst0 reject should expose a fault word");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Rejected, "GEO overlap2d dst0 reject should latch REJECTED phase");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	const uint32_t shapeA = jobBase + 0x400u;
	const uint32_t shapeB = jobBase + 0x500u;
	const uint32_t summaryBase = jobBase + 0x200u;
	const uint32_t resultBase = jobBase + 0x300u;

	writeOverlap2dInstance(memory, jobBase, shapeA);
	writeOverlap2dInstance(memory, jobBase + bmsx::GEO_OVERLAP2D_INSTANCE_BYTES, shapeB);
	writeOverlapAabbShape(memory, shapeA, 0x00000000u, 0x00000000u, 0x3f800000u, 0x3f800000u);
	writeOverlapAabbShape(memory, shapeB, 0x3f000000u, 0x00000000u, 0x3fc00000u, 0x3f800000u);
	writeOverlap2dFullPassRegisters(memory, jobBase, 2u, 0u, resultBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO overlap2d AABB test should enter BUSY");
	machine.geometryController.accrueCycles(2, 2);
	machine.geometryController.onService(2);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_DONE, "GEO overlap2d AABB test should complete");
	require(memory.readU32(summaryBase + bmsx::GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET) == 1u, "GEO overlap2d AABB test should write one result");
	require(memory.readU32(resultBase + bmsx::GEO_OVERLAP2D_RESULT_NX_OFFSET) == 0xbf800000u, "GEO overlap2d AABB result should expose normal X");
	require(memory.readU32(resultBase + bmsx::GEO_OVERLAP2D_RESULT_NY_OFFSET) == 0u, "GEO overlap2d AABB result should expose normal Y");
	require(memory.readU32(resultBase + bmsx::GEO_OVERLAP2D_RESULT_DEPTH_OFFSET) == 0x3f000000u, "GEO overlap2d AABB result should expose depth");
	require(memory.readU32(resultBase + bmsx::GEO_OVERLAP2D_RESULT_PX_OFFSET) == 0x3f400000u, "GEO overlap2d AABB result should expose contact X");
	require(memory.readU32(resultBase + bmsx::GEO_OVERLAP2D_RESULT_PY_OFFSET) == 0x3f000000u, "GEO overlap2d AABB result should expose contact Y");
	require(memory.readU32(resultBase + bmsx::GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET) == 1u, "GEO overlap2d AABB result should preserve pair meta");

	writeOverlap2dInstance(memory, jobBase, shapeA);
	writeOverlap2dInstance(memory, jobBase + bmsx::GEO_OVERLAP2D_INSTANCE_BYTES, shapeB);
	writeOversizeOverlapPoly(memory, shapeA);
	writeOversizeOverlapPoly(memory, shapeB);
	writeOverlap2dFullPassRegisters(memory, jobBase, 2u, 0u, resultBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO overlap2d oversize poly test should enter BUSY before execution fault");
	machine.geometryController.accrueCycles(1, 1);
	machine.geometryController.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO overlap2d should fault oversize public poly span without uint32 wrap");
	require((memory.readIoU32(bmsx::IO_GEO_FAULT) >> bmsx::GEO_FAULT_CODE_SHIFT) == bmsx::GEO_FAULT_BAD_VERTEX_COUNT, "GEO overlap2d oversize public poly span should expose a vertex-count fault");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	writeOverlap2dInstance(memory, jobBase, shapeA);
	writeOverlap2dInstance(memory, jobBase + bmsx::GEO_OVERLAP2D_INSTANCE_BYTES, shapeB);
	writeOverlapAabbShape(memory, shapeA, 0x00000000u, 0x00000000u, 0x3f800000u, 0x3f800000u);
	writeOverlapAabbShape(memory, shapeB, 0x3f000000u, 0x00000000u, 0x3fc00000u, 0x3f800000u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + 1u);
	writeOverlap2dFullPassRegisters(memory, jobBase, 2u, 0u, resultBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO overlap2d unaligned bounds offset should enter BUSY before execution fault");
	machine.geometryController.accrueCycles(1, 1);
	machine.geometryController.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO overlap2d should fault unaligned bounds offset as execution error");
	require((memory.readIoU32(bmsx::IO_GEO_FAULT) >> bmsx::GEO_FAULT_CODE_SHIFT) == bmsx::GEO_FAULT_BAD_RECORD_ALIGNMENT, "GEO overlap2d unaligned bounds offset should expose a record-alignment fault");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO overlap2d unaligned bounds offset should latch ERROR phase");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	writeOverlap2dInstance(memory, jobBase, shapeA);
	writeOverlap2dInstance(memory, jobBase + bmsx::GEO_OVERLAP2D_INSTANCE_BYTES, shapeB);
	writeOverlapAabbShape(memory, shapeA, 0x00000000u, 0x00000000u, 0x3f800000u, 0x3f800000u);
	writeOverlapAabbShape(memory, shapeB, 0x3f000000u, 0x00000000u, 0x3fc00000u, 0x3f800000u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + 1u);
	writeOverlap2dFullPassRegisters(memory, jobBase, 2u, 0u, resultBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO overlap2d unaligned data offset should enter BUSY before execution fault");
	machine.geometryController.accrueCycles(1, 1);
	machine.geometryController.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO overlap2d should fault unaligned data offset as execution error");
	require((memory.readIoU32(bmsx::IO_GEO_FAULT) >> bmsx::GEO_FAULT_CODE_SHIFT) == bmsx::GEO_FAULT_BAD_RECORD_ALIGNMENT, "GEO overlap2d unaligned data offset should expose a record-alignment fault");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO overlap2d unaligned data offset should latch ERROR phase");

	writeIoWord(memory, bmsx::IO_GEO_FAULT_ACK, 1u);
	writeOverlap2dInstance(memory, jobBase, shapeA);
	writeOverlap2dInstance(memory, jobBase + bmsx::GEO_OVERLAP2D_INSTANCE_BYTES, shapeB);
	writeOverlapAabbShape(memory, shapeB, 0x3f000000u, 0x00000000u, 0x3fc00000u, 0x3f800000u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_KIND_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_KIND_COMPOUND);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, 1u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + 1u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET, 0u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET, 0u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET, 0x3f800000u);
	memory.writeU32(shapeA + bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES + bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET, 0x3f800000u);
	writeOverlap2dFullPassRegisters(memory, jobBase, 2u, 0u, resultBase, 1u);
	writeIoWord(memory, bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_OVERLAP2D_PASS);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == bmsx::GEO_STATUS_BUSY, "GEO overlap2d compound unaligned data offset should enter BUSY before execution fault");
	machine.geometryController.accrueCycles(1, 1);
	machine.geometryController.onService(1);
	require(memory.readIoU32(bmsx::IO_GEO_STATUS) == (bmsx::GEO_STATUS_DONE | bmsx::GEO_STATUS_ERROR), "GEO overlap2d should fault compound unaligned data offset as execution error");
	require((memory.readIoU32(bmsx::IO_GEO_FAULT) >> bmsx::GEO_FAULT_CODE_SHIFT) == bmsx::GEO_FAULT_BAD_RECORD_ALIGNMENT, "GEO overlap2d compound unaligned data offset should expose a record-alignment fault");
	require(machine.geometryController.captureState().phase == bmsx::GeometryControllerPhase::Error, "GEO overlap2d compound unaligned data offset should latch ERROR phase");
}

void testGeometryContractConstantsGolden() {
	require(bmsx::GEOMETRY_CONTROLLER_REGISTER_COUNT == 16u, "GEO register count should remain stable");
	require(bmsx::IO_GEO_REGISTER_ADDRS.size() == bmsx::GEOMETRY_CONTROLLER_REGISTER_COUNT, "GEO MMIO address bank should match the device register bank");
	require(bmsx::IO_GEO_REGISTER_ADDRS[0] == bmsx::IO_GEO_SRC0, "GEO register bank should start at SRC0");
	require(bmsx::IO_GEO_REGISTER_ADDRS[15] == bmsx::IO_GEO_FAULT, "GEO register bank should end at FAULT");
	require(bmsx::GEOMETRY_CONTROLLER_PHASE_IDLE == 0u, "GEO IDLE phase ABI constant should remain stable");
	require(bmsx::GEOMETRY_CONTROLLER_PHASE_BUSY == 1u, "GEO BUSY phase ABI constant should remain stable");
	require(bmsx::GEOMETRY_CONTROLLER_PHASE_DONE == 2u, "GEO DONE phase ABI constant should remain stable");
	require(bmsx::GEOMETRY_CONTROLLER_PHASE_ERROR == 3u, "GEO ERROR phase ABI constant should remain stable");
	require(bmsx::GEOMETRY_CONTROLLER_PHASE_REJECTED == 4u, "GEO REJECTED phase ABI constant should remain stable");
	require(static_cast<uint32_t>(bmsx::GeometryControllerPhase::Idle) == 0u, "GEO IDLE phase ABI value should remain stable");
	require(static_cast<uint32_t>(bmsx::GeometryControllerPhase::Busy) == 1u, "GEO BUSY phase ABI value should remain stable");
	require(static_cast<uint32_t>(bmsx::GeometryControllerPhase::Done) == 2u, "GEO DONE phase ABI value should remain stable");
	require(static_cast<uint32_t>(bmsx::GeometryControllerPhase::Error) == 3u, "GEO ERROR phase ABI value should remain stable");
	require(static_cast<uint32_t>(bmsx::GeometryControllerPhase::Rejected) == 4u, "GEO REJECTED phase ABI value should remain stable");
	require(bmsx::GEO_XFORM2_MAX_VERTICES == 64u, "GEO xform2 vertex capacity should remain stable");
	require(bmsx::GEO_SAT2_MAX_POLY_VERTICES == 64u, "GEO sat2 convex polygon capacity should remain stable");
}

struct AudioHarness {
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::ApuOutputMixer audioOutput;
	bmsx::IrqController irq;
	bmsx::AudioController audio;

	AudioHarness()
		: memory()
		, cpu(memory)
		, scheduler(cpu)
		, audioOutput()
		, irq(memory)
		, audio(memory, audioOutput, irq, scheduler) {
		audio.reset();
		audio.setTiming(bmsx::APU_SAMPLE_RATE_HZ, 0);
	}
};

struct InputHarness {
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::InputController inputController;

	InputHarness()
		: memory()
		, cpu(memory)
		, inputController(memory, bmsx::Input::instance(), cpu.stringPool()) {
			for (bmsx::i32 player = 1; player <= bmsx::PLAYERS_MAX; player += 1) {
				auto* playerInput = bmsx::Input::instance().getPlayerInput(player);
				playerInput->clearContext("inp_chip");
				playerInput->clearEdgeState();
			}
			inputController.reset();
		}
};

void testInputControllerStateGolden() {
	InputHarness live;
	const bmsx::StringId action = live.cpu.stringPool().intern("jump");
	const bmsx::StringId bind = live.cpu.stringPool().intern("a,left");
	const bmsx::StringId query = live.cpu.stringPool().intern("jump[p]");
	const bmsx::StringId consume = live.cpu.stringPool().intern("jump,dash");

	writeIoWord(live.memory, bmsx::IO_INP_PLAYER, 2u);
	live.memory.writeValue(bmsx::IO_INP_ACTION, bmsx::valueString(action));
	live.memory.writeValue(bmsx::IO_INP_BIND, bmsx::valueString(bind));
	writeIoWord(live.memory, bmsx::IO_INP_CTRL, bmsx::INP_CTRL_COMMIT);
	live.memory.writeValue(bmsx::IO_INP_QUERY, bmsx::valueString(query));
	live.memory.writeValue(bmsx::IO_INP_CONSUME, bmsx::valueString(consume));
	writeIoWord(live.memory, bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);

	const bmsx::StringPoolState stringState = live.cpu.stringPool().captureState();
	const bmsx::InputControllerState state = live.inputController.captureState();
	require(state.sampleArmed, "ICU capture should preserve the armed sample latch");
	require(state.registers.player == 2u, "ICU capture should preserve the selected player register");
	require(state.registers.actionStringId == action, "ICU capture should preserve the action string register");
	require(state.registers.bindStringId == bind, "ICU capture should preserve the bind string register");
	require(state.registers.queryStringId == query, "ICU capture should preserve the query string register");
	require(state.registers.consumeStringId == consume, "ICU capture should preserve the consume string register");
	require(state.players[1u].actions.size() == 1u, "ICU capture should preserve committed player action count");
	require(state.players[1u].actions[0].actionStringId == action, "ICU capture should preserve committed action ids");
	require(state.players[1u].actions[0].bindStringId == bind, "ICU capture should preserve committed binding ids");

	InputHarness restored;
	restored.cpu.stringPool().restoreState(stringState);
	restored.inputController.restoreState(state);

	require(restored.memory.readIoU32(bmsx::IO_INP_PLAYER) == 2u, "ICU restore should mirror the selected player register");
	require(bmsx::asStringId(restored.memory.readValue(bmsx::IO_INP_ACTION)) == action, "ICU restore should mirror the action string register");
	require(bmsx::asStringId(restored.memory.readValue(bmsx::IO_INP_BIND)) == bind, "ICU restore should mirror the bind string register");
	require(bmsx::asStringId(restored.memory.readValue(bmsx::IO_INP_QUERY)) == query, "ICU restore should mirror the query string register");
	require(bmsx::asStringId(restored.memory.readValue(bmsx::IO_INP_CONSUME)) == consume, "ICU restore should mirror the consume string register");
	restored.memory.writeValue(bmsx::IO_INP_QUERY, bmsx::valueString(query));
	require(restored.memory.readIoU32(bmsx::IO_INP_STATUS) == 0u, "restored ICU context should accept a known action query");
	restored.inputController.onVblankEdge(1000.0 / 60.0, 123u);
	require(!restored.inputController.captureState().sampleArmed, "ICU VBlank edge should consume the restored sample arm latch");
	require(restored.inputController.captureState().sampleSequence == 1u, "ICU VBlank edge should count the sampled frame");
	require(restored.inputController.captureState().lastSampleCycle == 123u, "ICU VBlank edge should latch the sample cycle");
	writeIoWord(restored.memory, bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	require(restored.inputController.captureState().sampleArmed, "ICU ARM command should set the private sample latch");
	restored.inputController.cancelArmedSample();
	require(!restored.inputController.captureState().sampleArmed, "ICU runtime cancellation should clear the private sample latch");
}

void testInputControllerOutputRegisters() {
	InputHarness live;
	bmsx::GamepadInput gamepad("gamepad:1", "test rumble");
	bmsx::f32 lastIntensity = 0.0f;
	bmsx::f64 lastDuration = 0.0;
	bmsx::u32 calls = 0u;
	gamepad.setVibrationSupported(true);
	gamepad.setVibrationCallback([&lastIntensity, &lastDuration, &calls](bmsx::f32 intensity, bmsx::f64 duration) {
		lastIntensity = intensity;
		lastDuration = duration;
		calls += 1u;
	});
	auto* playerTwo = bmsx::Input::instance().getPlayerInput(2);
	playerTwo->assignGamepadToPlayer(&gamepad);

	writeIoWord(live.memory, bmsx::IO_INP_PLAYER, 2u);
	writeIoWord(live.memory, bmsx::IO_INP_OUTPUT_INTENSITY_Q16, bmsx::INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >> 1u);
	writeIoWord(live.memory, bmsx::IO_INP_OUTPUT_DURATION_MS, 120u);
	require((live.memory.readIoU32(bmsx::IO_INP_OUTPUT_STATUS) & bmsx::INP_OUTPUT_STATUS_SUPPORTED) != 0u, "ICU output status should expose selected-player output support");
	writeIoWord(live.memory, bmsx::IO_INP_OUTPUT_CTRL, bmsx::INP_OUTPUT_CTRL_APPLY);
	require(calls == 1u, "ICU output command should emit one selected-player output effect");
	require(lastIntensity == 0.5f, "ICU output command should decode unsigned Q16.16 intensity");
	require(lastDuration == 120.0, "ICU output command should pass duration in milliseconds");
	require(live.memory.readIoU32(bmsx::IO_INP_OUTPUT_CTRL) == 0u, "ICU output control doorbell should self-clear");

	const bmsx::InputControllerState savedInput = live.inputController.captureState();
	InputHarness restored;
	restored.inputController.restoreState(savedInput);
	require(restored.memory.readIoU32(bmsx::IO_INP_OUTPUT_INTENSITY_Q16) == (bmsx::INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >> 1u), "ICU restore should mirror output intensity register");
	require(restored.memory.readIoU32(bmsx::IO_INP_OUTPUT_DURATION_MS) == 120u, "ICU restore should mirror output duration register");
	playerTwo->clearGamepad(&gamepad);
}

void testInputControllerRealPlayerContext() {
	InputHarness h;
	const bmsx::StringId action = h.cpu.stringPool().intern("jump");
	const bmsx::StringId bind = h.cpu.stringPool().intern("a");
	const bmsx::StringId query = h.cpu.stringPool().intern("jump[jp]");
	const bmsx::StringId complexQuery = h.cpu.stringPool().intern("jump[jp] || jump[jp]");
	auto* playerTwo = bmsx::Input::instance().getPlayerInput(2);

	writeIoWord(h.memory, bmsx::IO_INP_PLAYER, 2u);
	h.memory.writeValue(bmsx::IO_INP_ACTION, bmsx::valueString(action));
	h.memory.writeValue(bmsx::IO_INP_BIND, bmsx::valueString(bind));
	writeIoWord(h.memory, bmsx::IO_INP_CTRL, bmsx::INP_CTRL_COMMIT);
	bmsx::InputEvent event;
	event.eventType = bmsx::InputEvent::Type::Press;
	event.identifier = "a";
	event.timestamp = 0.0;
	event.consumed = false;
	event.pressId = 7;
	playerTwo->recordButtonEvent(bmsx::InputSource::Gamepad, "a", std::move(event));
	writeIoWord(h.memory, bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	h.inputController.onVblankEdge(1000.0 / 60.0, 456u);
	h.memory.writeValue(bmsx::IO_INP_QUERY, bmsx::valueString(query));

	const uint32_t status = h.memory.readIoU32(bmsx::IO_INP_STATUS);
	require((status & bmsx::INP_STATUS_JUST_PRESSED) != 0u, "real PlayerInput context should expose ICU just-pressed snapshot");
	require((status & bmsx::INP_STATUS_WAS_PRESSED) != 0u, "real PlayerInput context should expose ICU buffered snapshot");
	require((status & bmsx::INP_STATUS_HAS_VALUE) != 0u, "real PlayerInput context should expose ICU value snapshot");
	require(h.memory.readIoU32(bmsx::IO_INP_VALUE) == 0u, "real PlayerInput context should expose ICU Q16 value");
	require(playerTwo->getActionState("jump").justpressed, "real PlayerInput should expose the ICU action edge");
	require(h.memory.readIoU32(bmsx::IO_INP_EVENT_COUNT) == 1u, "ICU event FIFO should expose one sampled edge");
	require(h.memory.readIoU32(bmsx::IO_INP_EVENT_PLAYER) == 2u, "ICU event FIFO should expose the sampled player");
	require(bmsx::asStringId(h.memory.readValue(bmsx::IO_INP_EVENT_ACTION)) == action, "ICU event FIFO should expose the sampled action");
	const uint32_t eventFlags = h.memory.readIoU32(bmsx::IO_INP_EVENT_FLAGS);
	require((eventFlags & bmsx::INP_STATUS_JUST_PRESSED) != 0u, "ICU event FIFO should expose the sampled action edge flags");
	require((eventFlags & bmsx::INP_STATUS_WAS_PRESSED) != 0u, "ICU event FIFO should expose the sampled action buffer flags");
	require((eventFlags & bmsx::INP_STATUS_HAS_VALUE) != 0u, "ICU event FIFO should expose the sampled action value flag");
	require(h.memory.readIoU32(bmsx::IO_INP_EVENT_VALUE) == 0u, "ICU event FIFO should expose the sampled Q16 value");
	require(h.memory.readIoU32(bmsx::IO_INP_EVENT_REPEAT_COUNT) == 0u, "ICU event FIFO should expose the sampled repeat count");
	const bmsx::StringPoolState stringState = h.cpu.stringPool().captureState();
	const bmsx::InputControllerState savedInput = h.inputController.captureState();
	InputHarness restored;
	restored.cpu.stringPool().restoreState(stringState);
	restored.inputController.restoreState(savedInput);
	require(restored.memory.readIoU32(bmsx::IO_INP_EVENT_COUNT) == 1u, "ICU restore should preserve queued input events");
	require(bmsx::asStringId(restored.memory.readValue(bmsx::IO_INP_EVENT_ACTION)) == action, "ICU restore should preserve queued input event action");
	writeIoWord(restored.memory, bmsx::IO_INP_EVENT_CTRL, bmsx::INP_EVENT_CTRL_POP);
	require(restored.memory.readIoU32(bmsx::IO_INP_EVENT_COUNT) == 0u, "ICU event pop should remove the front event");
	require((restored.memory.readIoU32(bmsx::IO_INP_EVENT_STATUS) & bmsx::INP_EVENT_STATUS_EMPTY) != 0u, "ICU event status should expose an empty FIFO");
	require(restored.memory.readIoU32(bmsx::IO_INP_EVENT_CTRL) == 0u, "ICU event control doorbell should self-clear");
	h.memory.writeValue(bmsx::IO_INP_QUERY, bmsx::valueString(complexQuery));
	require(h.memory.readIoU32(bmsx::IO_INP_STATUS) == 1u, "compound ICU query should return boolean status");
	require(h.memory.readIoU32(bmsx::IO_INP_VALUE) == 0u, "compound ICU query should not expose an action value");
}

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
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_FRAME_COUNT, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_OFFSET, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_BYTES, 4u);
}

void writeSquareGeneratorSource(AudioHarness& h) {
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_ADDR, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BYTES, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ / 4u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_CHANNELS, 1u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BITS_PER_SAMPLE, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_FRAME_COUNT, 2u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_OFFSET, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_BYTES, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_LOOP_START_SAMPLE, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 2u);
	writeIoWord(h.memory, bmsx::IO_APU_GENERATOR_KIND, bmsx::APU_GENERATOR_SQUARE);
	writeIoWord(h.memory, bmsx::IO_APU_GENERATOR_DUTY_Q12, 0x0800u);
}

void writeApuCommand(AudioHarness& h, uint32_t command) {
	writeIoWord(h.memory, bmsx::IO_APU_CMD, command);
	h.audio.onService(0);
}

void testApuContractConstantsGolden() {
	require(bmsx::APU_CMD_PLAY == 1u, "APU PLAY command value should match the hardware command doorbell");
	require(bmsx::APU_CMD_STOP_SLOT == 2u, "APU STOP_SLOT command value should match the hardware command doorbell");
	require(bmsx::APU_CMD_SET_SLOT_GAIN == 3u, "APU SET_SLOT_GAIN command value should match the hardware command doorbell");
	require(bmsx::APU_SAMPLE_RATE_HZ == 44100u, "APU sample clock should match the hardware clock");
	require(bmsx::APU_GENERATOR_SQUARE == 1u, "APU square generator value should match the hardware generator register");
	require(bmsx::APU_PARAMETER_REGISTER_COUNT == 21u, "APU parameter register count should match the hardware register bank");
	require(bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX == 0u, "APU source-address parameter index should match the register bank");
	require(bmsx::APU_PARAMETER_SLOT_INDEX == 10u, "APU slot parameter index should match the register bank");
	require(bmsx::APU_PARAMETER_GENERATOR_KIND_INDEX == 19u, "APU generator-kind parameter index should match the register bank");
	require(bmsx::APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX == 20u, "APU generator-duty parameter index should match the register bank");
	require(bmsx::APU_SLOT_REGISTER_WORD_COUNT == 336u, "APU slot register word count should match the slot latch bank");
	require(bmsx::IO_APU_PARAMETER_REGISTER_ADDRS.size() == bmsx::APU_PARAMETER_REGISTER_COUNT, "APU parameter MMIO address bank should match the device register bank");
	require(bmsx::IO_APU_SELECTED_SLOT_REG_COUNT == bmsx::APU_PARAMETER_REGISTER_COUNT, "APU selected-slot readback window should cover the parameter register bank");
	require(bmsx::APU_STATUS_FAULT == 1u, "APU fault status bit ABI value should remain stable");
	require(bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE == 2u, "APU selected-slot active status bit ABI value should remain stable");
	require(bmsx::APU_STATUS_BUSY == 4u, "APU busy status bit ABI value should remain stable");
	require(bmsx::APU_STATUS_OUTPUT_EMPTY == 8u, "APU output-empty status bit ABI value should remain stable");
	require(bmsx::APU_STATUS_OUTPUT_FULL == 16u, "APU output-full status bit ABI value should remain stable");
	require(bmsx::APU_STATUS_CMD_FIFO_EMPTY == 32u, "APU command-FIFO-empty status bit ABI value should remain stable");
	require(bmsx::APU_STATUS_CMD_FIFO_FULL == 64u, "APU command-FIFO-full status bit ABI value should remain stable");
	require(bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES == 16384u, "AOUT output queue capacity should match the hardware ring size");
	require(bmsx::APU_COMMAND_FIFO_CAPACITY == 16u, "APU command FIFO capacity should match the hardware queue size");
	require(bmsx::APU_FAULT_SOURCE_RANGE == 0x0102u, "APU source-range fault ABI value should remain stable");
	require(bmsx::APU_FAULT_CMD_FIFO_FULL == 0x0003u, "APU command FIFO full fault ABI value should remain stable");
	require(bmsx::APU_FAULT_UNSUPPORTED_FORMAT == 0x0201u, "APU unsupported-format fault ABI value should remain stable");
	require(bmsx::APU_FAULT_OUTPUT_PLAYBACK_RATE == 0x0204u, "APU output playback-rate fault ABI value should remain stable");
	require(bmsx::APU_FILTER_HIGHSHELF == 8u, "APU high-shelf filter ABI value should remain stable");
	require(bmsx::APU_EVENT_SLOT_ENDED == 1u, "APU slot-ended event ABI value should remain stable");
}

void testApuDeviceFaultsGolden() {
	AudioHarness h;

	writeIoWord(h.memory, bmsx::IO_APU_CMD, 0xffffu);
	expectApuFault(h, bmsx::APU_FAULT_BAD_CMD, "invalid APU command should latch a device fault");
	writeApuCommand(h, bmsx::APU_CMD_STOP_SLOT);
	require(h.memory.readIoU32(bmsx::IO_APU_FAULT_CODE) == bmsx::APU_FAULT_BAD_CMD, "APU fault latch should be sticky-first until ACK");
	clearApuFault(h);

	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 99u);
	writeApuCommand(h, bmsx::APU_CMD_STOP_SLOT);
	expectApuFault(h, bmsx::APU_FAULT_BAD_SLOT, "invalid APU slot should latch a device fault");
	clearApuFault(h);

	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BYTES, 4u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_SOURCE_RANGE, "unreadable APU source should latch a source-range fault");
	clearApuFault(h);

	writeValidApuSource(h, 8u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_OFFSET, 0xfffffff0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_BYTES, 0x20u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_SOURCE_DATA_RANGE, "wrapped APU source data window should latch a source-data-range fault");
	clearApuFault(h);

	writeValidApuSource(h, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_UNSUPPORTED_FORMAT, "malformed AOUT source should latch an APU fault");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "AOUT start fault should clear the replacement active slot");
	clearApuFault(h);

	writeValidApuSource(h, 8u);
	writeIoWord(h.memory, bmsx::IO_APU_RATE_STEP_Q16, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_OUTPUT_PLAYBACK_RATE, "bad AOUT playback step should latch an APU fault");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "AOUT playback fault should clear the replacement active slot");
	clearApuFault(h);

	writeValidApuSource(h, 16u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	expectApuFault(h, bmsx::APU_FAULT_OUTPUT_DATA_RANGE, "undersized PCM source should latch an AOUT range fault");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "AOUT PCM range fault should clear the replacement active slot");
	clearApuFault(h);
}

void testApuCommandFifoGolden() {
	AudioHarness h;

	writeValidApuSource(h, 8u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeIoWord(h.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	require(h.memory.readIoU32(bmsx::IO_APU_CMD_QUEUED) == 1u, "APU command FIFO should expose one queued command after doorbell write");
	require(h.memory.readIoU32(bmsx::IO_APU_CMD_FREE) == bmsx::APU_COMMAND_FIFO_CAPACITY - 1u, "APU command FIFO should expose free command entries");
	require(h.memory.readIoU32(bmsx::IO_APU_CMD_CAPACITY) == bmsx::APU_COMMAND_FIFO_CAPACITY, "APU command FIFO should expose capacity");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_BUSY) != 0u, "APU status should stay busy while command FIFO has work");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_CMD_FIFO_EMPTY) == 0u, "APU command FIFO empty bit should clear while queued");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "APU queued PLAY should not update active slots before service");
	require(h.memory.readIoU32(bmsx::IO_APU_SLOT) == 0u, "APU command doorbell should reset the visible parameter latch after FIFO capture");
	h.audio.onService(0);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	require(h.memory.readIoU32(bmsx::IO_APU_CMD_QUEUED) == 0u, "APU service should drain the command FIFO");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_CMD_FIFO_EMPTY) != 0u, "APU command FIFO empty bit should restore after service");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU service should execute the queued PLAY snapshot");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == bmsx::RAM_BASE, "APU queued PLAY should keep the captured slot source");

	AudioHarness full;
	for (uint32_t index = 0u; index < bmsx::APU_COMMAND_FIFO_CAPACITY; index += 1u) {
		writeIoWord(full.memory, bmsx::IO_APU_SLOT, 0u);
		writeIoWord(full.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	}
	require(full.memory.readIoU32(bmsx::IO_APU_CMD_QUEUED) == bmsx::APU_COMMAND_FIFO_CAPACITY, "APU command FIFO should fill to capacity");
	require(full.memory.readIoU32(bmsx::IO_APU_CMD_FREE) == 0u, "APU command FIFO should expose no free slots at capacity");
	require((full.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_CMD_FIFO_FULL) != 0u, "APU command FIFO full bit should set at capacity");
	writeIoWord(full.memory, bmsx::IO_APU_SLOT, 1u);
	writeIoWord(full.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_STOP_SLOT);
	expectApuFault(full, bmsx::APU_FAULT_CMD_FIFO_FULL, "APU command FIFO overflow should latch a device fault");
	require(full.memory.readIoU32(bmsx::IO_APU_CMD_QUEUED) == bmsx::APU_COMMAND_FIFO_CAPACITY, "APU overflow command should not displace queued FIFO work");
	full.audio.onService(0);
	require(full.memory.readIoU32(bmsx::IO_APU_CMD_QUEUED) == 0u, "APU service should drain a full command FIFO");

	AudioHarness restored;
	writeValidApuSource(restored, 8u);
	writeIoWord(restored.memory, bmsx::IO_APU_SLOT, 1u);
	writeIoWord(restored.memory, bmsx::IO_APU_CMD, bmsx::APU_CMD_PLAY);
	const bmsx::AudioControllerState saved = restored.audio.captureState();
	require(saved.commandFifoCount == 1u, "APU capture should preserve queued command count");
	require(restored.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "APU capture should not synthesize active slots for queued commands");
	AudioHarness replay;
	replay.audio.restoreState(saved, 0);
	require(replay.memory.readIoU32(bmsx::IO_APU_CMD_QUEUED) == 1u, "APU restore should expose queued command count");
	replay.audio.onService(0);
	writeIoWord(replay.memory, bmsx::IO_APU_SLOT, 1u);
	require(replay.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU restored FIFO work should execute through device service");
}

void testAoutOutputQueueGolden() {
	bmsx::ApuOutputMixer mixer;
	std::array<bmsx::i16, 4> output{};

	mixer.pullOutputFrames(output.data(), 2u, 48000, 1.0f, 6u);
	require(mixer.queuedOutputFrames() == 6u, "AOUT should retain target queued output frames after host pull");
	mixer.pullOutputFrames(output.data(), 2u, 48000, 1.0f);
	require(mixer.queuedOutputFrames() == 4u, "AOUT host-output queue should be consumed by host pulls");
	mixer.clearOutputQueue();
	require(mixer.queuedOutputFrames() == 0u, "AOUT host-output queue clear should reset queued frames");
	mixer.pullOutputFrames(output.data(), 2u, 48000, 1.0f, 20000u);
	require(mixer.queuedOutputFrames() == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "AOUT host-output queue should enforce device queue capacity");
	require(mixer.capacityOutputFrames() == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "AOUT should expose its device queue capacity");
	require(mixer.freeOutputFrames() == 0u, "AOUT should expose zero free frames when the output queue is full");
}

void testApuOutputRingStatusGolden() {
	AudioHarness h;
	std::array<bmsx::i16, 4> output{};

	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES) == 0u, "APU should expose empty AOUT output queue at reset");
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_FREE_FRAMES) == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "APU should expose full AOUT output-ring free capacity at reset");
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_CAPACITY_FRAMES) == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "APU should expose the AOUT output-ring capacity");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_OUTPUT_EMPTY) != 0u, "APU status should expose empty AOUT output ring");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_OUTPUT_FULL) == 0u, "APU output-full status should clear while the ring has free frames");

	h.audioOutput.pullOutputFrames(output.data(), 2u, 48000, 1.0f, 6u);
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES) == 6u, "APU should expose retained AOUT output frames");
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_FREE_FRAMES) == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES - 6u, "APU should expose retained AOUT output free frames");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_OUTPUT_EMPTY) == 0u, "APU output-empty status should clear when the ring has frames");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_OUTPUT_FULL) == 0u, "APU output-full status should remain clear before capacity");

	h.audioOutput.pullOutputFrames(output.data(), 2u, 48000, 1.0f, 20000u);
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES) == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "APU should expose capped full AOUT output queue");
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_FREE_FRAMES) == 0u, "APU should expose zero free frames for a full AOUT output queue");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_OUTPUT_FULL) != 0u, "APU status should expose full AOUT output ring");
	writeIoWord(h.memory, bmsx::IO_APU_OUTPUT_QUEUED_FRAMES, 0u);
	require(h.memory.readIoU32(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES) == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "APU output-ring queued register should be read-only to cart writes");

	AudioHarness restoreHarness;
	const bmsx::AudioControllerState savedEmptyState = restoreHarness.audio.captureState();
	restoreHarness.audioOutput.pullOutputFrames(output.data(), 2u, 48000, 1.0f, 6u);
	require(restoreHarness.memory.readIoU32(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES) == 6u, "APU restore proof should start with retained AOUT output frames");
	restoreHarness.audio.restoreState(savedEmptyState, 0);
	require(restoreHarness.memory.readIoU32(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES) == 0u, "APU restore should clear stale AOUT output-ring frames at the device owner");
	require(restoreHarness.memory.readIoU32(bmsx::IO_APU_OUTPUT_FREE_FRAMES) == bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES, "APU restore should expose full output-ring free capacity");
	const uint32_t restoredStatus = restoreHarness.memory.readIoU32(bmsx::IO_APU_STATUS);
	require((restoredStatus & bmsx::APU_STATUS_OUTPUT_EMPTY) != 0u, "APU restore should expose empty AOUT output ring");
	require((restoredStatus & bmsx::APU_STATUS_OUTPUT_FULL) == 0u, "APU restore should clear stale output-full status");
}

void testApuParameterRegisterStateGolden() {
	AudioHarness h;
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_ADDR, bmsx::RAM_BASE + 0x80u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BYTES, 128u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, 22050u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_CHANNELS, 2u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_BITS_PER_SAMPLE, 16u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_FRAME_COUNT, 32u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_OFFSET, 12u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_DATA_BYTES, 96u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_LOOP_START_SAMPLE, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 28u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 3u);
	writeIoWord(h.memory, bmsx::IO_APU_RATE_STEP_Q16, 0x18000u);
	writeIoWord(h.memory, bmsx::IO_APU_GAIN_Q12, 0x0800u);
	writeIoWord(h.memory, bmsx::IO_APU_START_SAMPLE, 6u);
	writeIoWord(h.memory, bmsx::IO_APU_FILTER_KIND, bmsx::APU_FILTER_HIGHSHELF);
	writeIoWord(h.memory, bmsx::IO_APU_FILTER_FREQ_HZ, 1200u);
	writeIoWord(h.memory, bmsx::IO_APU_FILTER_Q_MILLI, 700u);
	writeIoWord(h.memory, bmsx::IO_APU_FILTER_GAIN_MILLIDB, 3000u);
	writeIoWord(h.memory, bmsx::IO_APU_FADE_SAMPLES, bmsx::APU_SAMPLE_RATE_HZ);
	writeIoWord(h.memory, bmsx::IO_APU_GENERATOR_KIND, bmsx::APU_GENERATOR_SQUARE);
	writeIoWord(h.memory, bmsx::IO_APU_GENERATOR_DUTY_Q12, 0x0800u);

	const bmsx::AudioControllerState state = h.audio.captureState();
	AudioHarness restored;
	restored.audio.restoreState(state, 0);
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_ADDR) == bmsx::RAM_BASE + 0x80u, "APU restore should expose source address register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_BYTES) == 128u, "APU restore should expose source bytes register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ) == 22050u, "APU restore should expose source sample-rate register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_CHANNELS) == 2u, "APU restore should expose source channel register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_BITS_PER_SAMPLE) == 16u, "APU restore should expose source bit-depth register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_FRAME_COUNT) == 32u, "APU restore should expose source frame-count register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_DATA_OFFSET) == 12u, "APU restore should expose source data-offset register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_DATA_BYTES) == 96u, "APU restore should expose source data-bytes register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_LOOP_START_SAMPLE) == 4u, "APU restore should expose loop-start register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE) == 28u, "APU restore should expose loop-end register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_SLOT) == 3u, "APU restore should expose selected slot register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_RATE_STEP_Q16) == 0x18000u, "APU restore should expose rate-step register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_GAIN_Q12) == 0x0800u, "APU restore should expose gain register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_START_SAMPLE) == 6u, "APU restore should expose start-sample register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_FILTER_KIND) == bmsx::APU_FILTER_HIGHSHELF, "APU restore should expose filter-kind register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_FILTER_FREQ_HZ) == 1200u, "APU restore should expose filter-frequency register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_FILTER_Q_MILLI) == 700u, "APU restore should expose filter-Q register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_FILTER_GAIN_MILLIDB) == 3000u, "APU restore should expose filter-gain register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_FADE_SAMPLES) == bmsx::APU_SAMPLE_RATE_HZ, "APU restore should expose fade register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_GENERATOR_KIND) == bmsx::APU_GENERATOR_SQUARE, "APU restore should expose generator-kind register word");
	require(restored.memory.readIoU32(bmsx::IO_APU_GENERATOR_DUTY_Q12) == 0x0800u, "APU restore should expose generator-duty register word");
	require(restored.audio.captureState().registerWords[bmsx::APU_PARAMETER_SLOT_INDEX] == 3u, "APU capture after restore should preserve parameter register words");
}

void testApuSelectedSlotActiveStateGolden() {
	AudioHarness h;

	writeValidApuSource(h, 8u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_LOOP_START_SAMPLE, 0u);
	writeIoWord(h.memory, bmsx::IO_APU_SOURCE_LOOP_END_SAMPLE, 4u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) == 0u, "APU selected-active status should follow IO_APU_SLOT");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == 0u, "APU selected-source readback should clear for inactive selected slots");
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) != 0u, "APU selected-active status should return when selecting the active slot");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_BUSY) != 0u, "APU busy status should stay high while any slot is active");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == bmsx::RAM_BASE, "APU selected-source readback should expose the active slot source");
	require(h.audio.captureState().registerWords[bmsx::APU_PARAMETER_SLOT_INDEX] == 1u, "APU capture should preserve selected slot register word");
	require(h.audio.captureState().slotPhases[1u] == bmsx::APU_SLOT_PHASE_PLAYING, "APU capture should preserve playing slot phase");
	require(h.audio.captureState().slotSourceBytes[1u].size() == 4u, "APU capture should preserve active slot source bytes");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU active-mask register should expose active hardware slots");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0) == bmsx::RAM_BASE, "APU selected-slot register window should expose the active slot source latch");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_SLOT_INDEX * bmsx::IO_WORD_SIZE) == 1u, "APU selected-slot register window should expose the active slot index latch");
	h.memory.writeMappedU32LE(bmsx::IO_APU_ACTIVE_MASK, 0xffffffffu);
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU active-mask register should be read-only to cart writes");
	const uint32_t selectedGainAddr = bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_GAIN_Q12_INDEX * bmsx::IO_WORD_SIZE;
	h.memory.writeMappedU32LE(selectedGainAddr, 0x0800u);
	require(h.memory.readIoU32(selectedGainAddr) == 0x0800u, "APU selected-slot register window should write the selected channel register bank");
	require(h.audio.captureState().slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_GAIN_Q12_INDEX)] == 0x0800u, "APU capture should preserve selected-slot MMIO writes");

	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 0u);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) == 0u, "APU selected-active status should clear when selecting an inactive slot");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == 0u, "APU selected-source readback should clear when selecting an inactive slot");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0) == 0u, "APU selected-slot register window should clear for inactive selected slots");
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) != 0u, "APU selected-active status should restore when reselecting the active slot");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == bmsx::RAM_BASE, "APU selected-source readback should expose the active channel source latch");
	require(h.memory.readIoU32(selectedGainAddr) == 0x0800u, "APU selected-slot register window should restore the selected channel register bank");

	writeValidApuSource(h, 8u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) != 0u, "APU same-source replay should keep the replacement slot active");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_BUSY) != 0u, "APU same-source replay should keep busy status active");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == bmsx::RAM_BASE, "APU same-source replay should keep the replacement source latch");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU same-source replay should keep the active-mask register latched");

	h.memory.writeMappedU32LE(selectedGainAddr, 0x0800u);
	require(h.memory.readIoU32(selectedGainAddr) == 0x0800u, "APU selected-slot MMIO should write the current-gain channel register");
	require(h.audio.captureState().slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_GAIN_Q12_INDEX)] == 0x0800u, "APU selected-slot gain writes should persist in save-state channel latches");
	bmsx::i16 mixedFrame[2] = {0, 0};
	h.audioOutput.renderSamples(mixedFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(mixedFrame[0] == -7680 && mixedFrame[1] == -7680, "APU selected-slot gain writes should update the live AOUT voice");

	writeIoWord(h.memory, bmsx::IO_APU_FADE_SAMPLES, bmsx::APU_SAMPLE_RATE_HZ);
	writeIoWord(h.memory, bmsx::IO_APU_GAIN_Q12, 0x0800u);
	writeApuCommand(h, bmsx::APU_CMD_SET_SLOT_GAIN);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_GAIN_Q12_INDEX * bmsx::IO_WORD_SIZE) == 0x0800u, "APU SET_SLOT_GAIN should write the device-owned current-gain latch directly");
	require(h.audio.captureState().slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_GAIN_Q12_INDEX)] == 0x0800u, "APU capture should preserve the SET_SLOT_GAIN current-gain latch");

	writeIoWord(h.memory, bmsx::IO_APU_FADE_SAMPLES, bmsx::APU_SAMPLE_RATE_HZ);
	writeApuCommand(h, bmsx::APU_CMD_STOP_SLOT);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	require(h.audio.captureState().slotPhases[1u] == bmsx::APU_SLOT_PHASE_FADING, "APU faded STOP_SLOT should enter fading slot phase");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) != 0u, "APU faded STOP_SLOT should keep the slot active until the ended event");
	require(h.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == bmsx::RAM_BASE, "APU faded STOP_SLOT should keep the source latch until the ended event");
	h.audio.accrueCycles(2, 2);
	h.audio.onService(2);
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) != 0u, "APU faded STOP_SLOT should stay active before the device fade timer expires");
	require(h.memory.readIoU32(bmsx::IO_APU_EVENT_SEQ) == 0u, "APU fade timer should not emit before its sample countdown expires");
	require(h.audio.captureState().slotPlaybackCursorQ16[1u] == static_cast<bmsx::i64>(2u * bmsx::APU_RATE_STEP_Q16_ONE), "APU faded STOP_SLOT should keep advancing the device-owned cursor");
	h.audio.accrueCycles(static_cast<int>(bmsx::APU_SAMPLE_RATE_HZ - 2u), bmsx::APU_SAMPLE_RATE_HZ);
	h.audio.onService(bmsx::APU_SAMPLE_RATE_HZ);
	const bmsx::AudioControllerState eventState = h.audio.captureState();
	require(eventState.slotPhases[1u] == bmsx::APU_SLOT_PHASE_IDLE, "APU ended event should return the slot phase to idle");
	require(h.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "APU ended event should clear the active-mask register");
	require((h.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_BUSY) == 0u, "APU ended event should clear busy status when no slots remain active");
	require(eventState.eventKind == bmsx::APU_EVENT_SLOT_ENDED, "APU capture should preserve the event kind latch");
	require(eventState.eventSlot == 1u, "APU capture should preserve the event slot latch");
	require(eventState.eventSourceAddr == bmsx::RAM_BASE, "APU capture should preserve the event source latch");
	require(h.memory.readIoU32(bmsx::IO_APU_EVENT_KIND) == bmsx::APU_EVENT_SLOT_ENDED, "APU ended event should publish the event kind latch");
	require(h.memory.readIoU32(bmsx::IO_APU_EVENT_SLOT) == 1u, "APU ended event should publish the event slot latch");
	require(h.memory.readIoU32(bmsx::IO_APU_EVENT_SOURCE_ADDR) == bmsx::RAM_BASE, "APU ended event should publish the event source latch");
	require(h.memory.readIoU32(bmsx::IO_APU_EVENT_SEQ) == eventState.eventSequence, "APU ended event should publish the event sequence latch");
	require((h.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_APU) != 0u, "APU ended event should raise IRQ_APU");

	AudioHarness eventRestored;
	eventRestored.audio.restoreState(eventState, 0);
	require(eventRestored.memory.readIoU32(bmsx::IO_APU_EVENT_KIND) == bmsx::APU_EVENT_SLOT_ENDED, "APU restore should expose the event kind latch");
	require(eventRestored.memory.readIoU32(bmsx::IO_APU_EVENT_SLOT) == 1u, "APU restore should expose the event slot latch");
	require(eventRestored.memory.readIoU32(bmsx::IO_APU_EVENT_SOURCE_ADDR) == bmsx::RAM_BASE, "APU restore should expose the event source latch");
	require(eventRestored.memory.readIoU32(bmsx::IO_APU_EVENT_SEQ) == eventState.eventSequence, "APU restore should expose the event sequence latch");

	writeIoWord(h.memory, bmsx::IO_APU_FADE_SAMPLES, 0u);
	writeValidApuSource(h, 8u);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(h, bmsx::APU_CMD_PLAY);
	writeIoWord(h.memory, bmsx::IO_APU_SLOT, 1u);
	const bmsx::AudioControllerState state = h.audio.captureState();
	AudioHarness restored;
	restored.audio.restoreState(state, 0);
	require(restored.audio.captureState().registerWords[bmsx::APU_PARAMETER_SLOT_INDEX] == 1u, "APU restore should preserve selected slot register word");
	require(restored.audio.captureState().slotSourceBytes[1u].size() == 4u, "APU restore should preserve active slot source bytes");
	require(restored.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU restore should expose active hardware slots in MMIO");
	require(restored.memory.readIoU32(bmsx::IO_APU_SLOT) == 1u, "APU restore should expose the restored selected slot register");
	require(restored.audio.captureState().slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] == bmsx::RAM_BASE, "APU restore should preserve the selected slot source latch");
	require((restored.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) != 0u, "APU restore should refresh selected-active status from the active slot mask");
	require((restored.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_BUSY) != 0u, "APU restore should derive busy status from the active slot mask");
	require(restored.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == bmsx::RAM_BASE, "APU restore should refresh selected-source readback from the source latch bank");
	require(restored.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0) == bmsx::RAM_BASE, "APU restore should refresh selected-slot register window from the source latch bank");

	writeApuCommand(restored, bmsx::APU_CMD_STOP_SLOT);
	require((restored.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) == 0u, "APU STOP_SLOT should clear selected-active status");
	require((restored.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_BUSY) == 0u, "APU STOP_SLOT should clear busy status when no slots remain active");
	require(restored.memory.readIoU32(bmsx::IO_APU_SELECTED_SOURCE_ADDR) == 0u, "APU STOP_SLOT should clear selected-source readback");
	require(restored.audio.captureState().slotSourceBytes[1u].empty(), "APU STOP_SLOT should clear active slot source bytes");
	require(restored.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "APU STOP_SLOT should clear active-mask register");
	require(restored.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0) == 0u, "APU STOP_SLOT should clear selected-slot register window");
	require(restored.audio.captureState().slotRegisterWords[bmsx::apuSlotRegisterWordIndex(1u, bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX)] == 0u, "APU STOP_SLOT should clear source latch");

	AudioHarness liveRateFaultHarness;
	writeValidApuSource(liveRateFaultHarness, 8u);
	writeIoWord(liveRateFaultHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(liveRateFaultHarness, bmsx::APU_CMD_PLAY);
	writeIoWord(liveRateFaultHarness.memory, bmsx::IO_APU_SLOT, 1u);
	liveRateFaultHarness.memory.writeMappedU32LE(bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_RATE_STEP_Q16_INDEX * bmsx::IO_WORD_SIZE, 0u);
	expectApuFault(liveRateFaultHarness, bmsx::APU_FAULT_OUTPUT_PLAYBACK_RATE, "APU selected-slot invalid rate writes should fault at the AOUT datapath boundary");
	require(liveRateFaultHarness.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "APU selected-slot invalid rate faults should clear the active hardware slot");
	require((liveRateFaultHarness.memory.readIoU32(bmsx::IO_APU_STATUS) & bmsx::APU_STATUS_SELECTED_SLOT_ACTIVE) == 0u, "APU selected-slot invalid rate faults should clear selected-active status");
	require(liveRateFaultHarness.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0) == 0u, "APU selected-slot invalid rate faults should clear the rejected channel latches");

	AudioHarness liveSourceReloadHarness;
	liveSourceReloadHarness.memory.writeU32(bmsx::RAM_BASE + 4u, 0x80808080u);
	writeValidApuSource(liveSourceReloadHarness, 8u);
	writeIoWord(liveSourceReloadHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(liveSourceReloadHarness, bmsx::APU_CMD_PLAY);
	writeIoWord(liveSourceReloadHarness.memory, bmsx::IO_APU_SLOT, 1u);
	liveSourceReloadHarness.memory.writeMappedU32LE(bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX * bmsx::IO_WORD_SIZE, bmsx::RAM_BASE + 4u);
	require(liveSourceReloadHarness.memory.readIoU32(bmsx::IO_APU_SELECTED_SLOT_REG0) == bmsx::RAM_BASE + 4u, "APU selected-slot source-address writes should update the active channel latch");
	require(liveSourceReloadHarness.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU selected-slot source-address writes should keep the reloaded hardware slot active");
	const bmsx::AudioControllerState sourceReloadState = liveSourceReloadHarness.audio.captureState();
	require(sourceReloadState.slotSourceBytes[1u].size() == 4u, "APU source DMA should retain the reloaded source byte count");
	require(sourceReloadState.slotSourceBytes[1u][0] == 0x80u, "APU source DMA should retain the reloaded source bytes");
	bmsx::i16 reloadedFrame[2] = {1, 1};
	liveSourceReloadHarness.audioOutput.renderSamples(reloadedFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(reloadedFrame[0] == 0 && reloadedFrame[1] == 0, "APU source-address writes should reload the live AOUT source buffer");

	AudioHarness sourceReloadFadeHarness;
	sourceReloadFadeHarness.memory.writeU32(bmsx::RAM_BASE + 4u, 0x80808080u);
	writeValidApuSource(sourceReloadFadeHarness, 8u);
	writeIoWord(sourceReloadFadeHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(sourceReloadFadeHarness, bmsx::APU_CMD_PLAY);
	writeIoWord(sourceReloadFadeHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeIoWord(sourceReloadFadeHarness.memory, bmsx::IO_APU_FADE_SAMPLES, bmsx::APU_SAMPLE_RATE_HZ);
	writeApuCommand(sourceReloadFadeHarness, bmsx::APU_CMD_STOP_SLOT);
	sourceReloadFadeHarness.audio.accrueCycles(2, 2);
	sourceReloadFadeHarness.audio.onService(2);
	writeIoWord(sourceReloadFadeHarness.memory, bmsx::IO_APU_SLOT, 1u);
	sourceReloadFadeHarness.memory.writeMappedU32LE(bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_SOURCE_ADDR_INDEX * bmsx::IO_WORD_SIZE, bmsx::RAM_BASE + 4u);
	const bmsx::AudioControllerState sourceReloadFadeState = sourceReloadFadeHarness.audio.captureState();
	require(sourceReloadFadeState.slotPhases[1u] == bmsx::APU_SLOT_PHASE_FADING, "APU source-DMA reload should preserve the fading slot phase");
	require(sourceReloadFadeState.slotFadeSamplesRemaining[1u] == bmsx::APU_SAMPLE_RATE_HZ - 2u, "APU source-DMA reload should preserve the active STOP fade countdown");
	require(sourceReloadFadeState.slotFadeSamplesTotal[1u] == bmsx::APU_SAMPLE_RATE_HZ, "APU source-DMA reload should preserve the active STOP fade envelope duration");
	require(sourceReloadFadeState.slotSourceBytes[1u].size() == 4u, "APU source-DMA reload during fade should retain source bytes");
	require(sourceReloadFadeState.slotSourceBytes[1u][0] == 0x80u, "APU source-DMA reload during fade should capture the new source bytes");

	AudioHarness fadeRestoreHarness;
	writeValidApuSource(fadeRestoreHarness, 8u);
	fadeRestoreHarness.memory.writeU32(bmsx::RAM_BASE, 0x44444444u);
	writeIoWord(fadeRestoreHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(fadeRestoreHarness, bmsx::APU_CMD_PLAY);
	writeIoWord(fadeRestoreHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeIoWord(fadeRestoreHarness.memory, bmsx::IO_APU_FADE_SAMPLES, 4u);
	writeApuCommand(fadeRestoreHarness, bmsx::APU_CMD_STOP_SLOT);
	fadeRestoreHarness.audio.accrueCycles(2, 2);
	fadeRestoreHarness.audio.onService(2);
	const bmsx::AudioControllerState fadeRestoreState = fadeRestoreHarness.audio.captureState();
	require(fadeRestoreState.slotFadeSamplesRemaining[1u] == 2u, "APU restore proof should capture the mid-fade countdown");
	require(fadeRestoreState.slotFadeSamplesTotal[1u] == 4u, "APU restore proof should capture the full STOP fade duration");
	bmsx::i16 liveFadeFrame[2] = {0, 0};
	fadeRestoreHarness.audioOutput.renderSamples(liveFadeFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	AudioHarness fadeRestored;
	fadeRestored.audio.restoreState(fadeRestoreState, 0);
	bmsx::i16 restoredFadeFrame[2] = {0, 0};
	fadeRestored.audioOutput.renderSamples(restoredFadeFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(restoredFadeFrame[0] == liveFadeFrame[0] && restoredFadeFrame[1] == liveFadeFrame[1], "APU restore should preserve the live AOUT STOP fade envelope state");

	AudioHarness noOutputRecordRateFaultHarness;
	writeValidApuSource(noOutputRecordRateFaultHarness, 8u);
	writeIoWord(noOutputRecordRateFaultHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(noOutputRecordRateFaultHarness, bmsx::APU_CMD_PLAY);
	writeIoWord(noOutputRecordRateFaultHarness.memory, bmsx::IO_APU_SLOT, 1u);
	bmsx::i16 expiredOutput[10] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
	noOutputRecordRateFaultHarness.audioOutput.renderSamples(expiredOutput, 5u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(noOutputRecordRateFaultHarness.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU active mask should remain cart-visible until the APU scheduler observes AOUT completion");
	noOutputRecordRateFaultHarness.memory.writeMappedU32LE(bmsx::IO_APU_SELECTED_SLOT_REG0 + bmsx::APU_PARAMETER_RATE_STEP_Q16_INDEX * bmsx::IO_WORD_SIZE, 0u);
	expectApuFault(noOutputRecordRateFaultHarness, bmsx::APU_FAULT_OUTPUT_PLAYBACK_RATE, "APU selected-slot invalid rate writes should fault even after the AOUT voice record ended");
	require(noOutputRecordRateFaultHarness.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 0u, "APU selected-slot no-record rate faults should clear the active hardware slot");

	AudioHarness cursorHarness;
	writeValidApuSource(cursorHarness, 8u);
	writeIoWord(cursorHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(cursorHarness, bmsx::APU_CMD_PLAY);
	cursorHarness.audio.accrueCycles(2, 2);
	cursorHarness.audio.onService(2);
	const bmsx::AudioControllerState cursorState = cursorHarness.audio.captureState();
	require(cursorState.slotPlaybackCursorQ16[1u] == static_cast<bmsx::i64>(2u * bmsx::APU_RATE_STEP_Q16_ONE), "APU device cursor should advance from the scheduler sample clock");
	AudioHarness cursorRestored;
	cursorRestored.audio.restoreState(cursorState, 0);
	require(cursorRestored.audio.captureState().slotPlaybackCursorQ16[1u] == static_cast<bmsx::i64>(2u * bmsx::APU_RATE_STEP_Q16_ONE), "APU restore should preserve the playback cursor");
	cursorRestored.audio.accrueCycles(2, 2);
	cursorRestored.audio.onService(2);
	require(cursorRestored.memory.readIoU32(bmsx::IO_APU_EVENT_KIND) == bmsx::APU_EVENT_SLOT_ENDED, "APU device cursor should emit slot-ended after reaching the source frame count");

	AudioHarness filterOutputHarness;
	writeValidApuSource(filterOutputHarness, 8u);
	writeIoWord(filterOutputHarness.memory, bmsx::IO_APU_FILTER_KIND, bmsx::APU_FILTER_LOWPASS);
	writeIoWord(filterOutputHarness.memory, bmsx::IO_APU_FILTER_FREQ_HZ, 800u);
	writeIoWord(filterOutputHarness.memory, bmsx::IO_APU_FILTER_Q_MILLI, 700u);
	writeIoWord(filterOutputHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(filterOutputHarness, bmsx::APU_CMD_PLAY);
	bmsx::i16 primedFilterOutput[4] = {0, 0, 0, 0};
	filterOutputHarness.audioOutput.renderSamples(primedFilterOutput, 2u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	const bmsx::AudioControllerState filterOutputState = filterOutputHarness.audio.captureState();
	require(filterOutputState.slotPlaybackCursorQ16[1u] == 0, "APU controller cursor should not advance when only the host output edge rendered");
	require(filterOutputState.output.voices.size() == 1u, "APU capture should preserve the active AOUT voice state");
	bmsx::i16 liveFilteredFrame[2] = {0, 0};
	filterOutputHarness.audioOutput.renderSamples(liveFilteredFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	AudioHarness filterOutputRestored;
	filterOutputRestored.audio.restoreState(filterOutputState, 0);
	bmsx::i16 restoredFilteredFrame[2] = {0, 0};
	filterOutputRestored.audioOutput.renderSamples(restoredFilteredFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(restoredFilteredFrame[0] == liveFilteredFrame[0] && restoredFilteredFrame[1] == liveFilteredFrame[1], "APU restore should preserve AOUT position and filter history after host rendering");

	AudioHarness drainedOutputHarness;
	writeValidApuSource(drainedOutputHarness, 8u);
	writeIoWord(drainedOutputHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(drainedOutputHarness, bmsx::APU_CMD_PLAY);
	bmsx::i16 drainedExpiredOutput[10] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
	drainedOutputHarness.audioOutput.renderSamples(drainedExpiredOutput, 5u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	const bmsx::AudioControllerState drainedOutputState = drainedOutputHarness.audio.captureState();
	require(drainedOutputHarness.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU active mask should remain visible after AOUT drained the host voice");
	require(drainedOutputState.output.voices.empty(), "APU capture should not preserve an already drained AOUT voice");
	AudioHarness drainedOutputRestored;
	drainedOutputRestored.audio.restoreState(drainedOutputState, 0);
	bmsx::i16 restoredDrainedOutput[2] = {1, 1};
	drainedOutputRestored.audioOutput.renderSamples(restoredDrainedOutput, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(drainedOutputRestored.memory.readIoU32(bmsx::IO_APU_ACTIVE_MASK) == 2u, "APU restore should keep the controller slot visible until the scheduler observes completion");
	require(restoredDrainedOutput[0] == 0 && restoredDrainedOutput[1] == 0, "APU restore should not recreate host-drained AOUT samples");

	AudioHarness sourceRateCursorHarness;
	writeValidApuSource(sourceRateCursorHarness, 8u);
	writeIoWord(sourceRateCursorHarness.memory, bmsx::IO_APU_SOURCE_SAMPLE_RATE_HZ, bmsx::APU_SAMPLE_RATE_HZ / 2u);
	writeIoWord(sourceRateCursorHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(sourceRateCursorHarness, bmsx::APU_CMD_PLAY);
	sourceRateCursorHarness.audio.accrueCycles(2, 2);
	sourceRateCursorHarness.audio.onService(2);
	require(sourceRateCursorHarness.audio.captureState().slotPlaybackCursorQ16[1u] == static_cast<bmsx::i64>(bmsx::APU_RATE_STEP_Q16_ONE), "APU device cursor should advance at the source sample rate");

	AudioHarness generatorHarness;
	writeSquareGeneratorSource(generatorHarness);
	writeIoWord(generatorHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(generatorHarness, bmsx::APU_CMD_PLAY);
	const bmsx::AudioControllerState generatorState = generatorHarness.audio.captureState();
	require(generatorState.slotSourceBytes[1u].empty(), "APU square generator should not capture RAM source bytes");
	bmsx::i16 squareFrames[8] = {};
	generatorHarness.audioOutput.renderSamples(squareFrames, 4u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(squareFrames[0] == 32767 && squareFrames[1] == 32767 && squareFrames[2] == 32767 && squareFrames[3] == 32767 && squareFrames[4] == -32767 && squareFrames[5] == -32767 && squareFrames[6] == -32767 && squareFrames[7] == -32767, "APU square generator should render from device generator state");

	AudioHarness generatorPhaseHarness;
	writeSquareGeneratorSource(generatorPhaseHarness);
	writeIoWord(generatorPhaseHarness.memory, bmsx::IO_APU_SLOT, 1u);
	writeApuCommand(generatorPhaseHarness, bmsx::APU_CMD_PLAY);
	generatorPhaseHarness.audio.accrueCycles(2, 2);
	generatorPhaseHarness.audio.onService(2);
	const bmsx::AudioControllerState generatorPhaseState = generatorPhaseHarness.audio.captureState();
	require(generatorPhaseState.slotPlaybackCursorQ16[1u] == static_cast<bmsx::i64>(bmsx::APU_RATE_STEP_Q16_ONE / 2u), "APU square generator cursor should advance on the device sample clock");
	bmsx::i16 liveSquareFrame[2] = {};
	generatorPhaseHarness.audioOutput.renderSamples(liveSquareFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	AudioHarness generatorRestored;
	generatorRestored.audio.restoreState(generatorPhaseState, 0);
	bmsx::i16 restoredSquareFrame[2] = {};
	generatorRestored.audioOutput.renderSamples(restoredSquareFrame, 1u, bmsx::APU_SAMPLE_RATE_HZ, 1.0f);
	require(restoredSquareFrame[0] == liveSquareFrame[0] && restoredSquareFrame[1] == liveSquareFrame[1], "APU restore should preserve live square-generator AOUT state");
}

void testRuntimeVblankEdgeCompletesActiveTickGolden() {
	RuntimeHarness harness;
	bmsx::Runtime& runtime = harness.runtime;

	runtime.frameLoop.beginFrameState(runtime);
	require(runtime.frameLoop.frameActive, "frame loop should mark a started frame active");
	require(!runtime.vblank.tickCompleted(), "new active tick should not be completed before VBlank");

	const bmsx::i64 sequenceBefore = runtime.frameScheduler.lastTickSequence;
	runtime.machine.scheduler.setNowCycles(80);
	runtime.vblank.handleBeginTimer(runtime);
	require(runtime.vblank.tickCompleted(), "VBlank edge should complete the active runtime tick");
	require(runtime.frameScheduler.lastTickSequence == sequenceBefore + 1, "VBlank edge should enqueue exactly one tick completion");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "VBlank edge should assert the maskable IRQ line");
	require((runtime.machine.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "VBlank edge should raise the cart-visible VBlank IRQ");
	require(runtime.machine.vdp.readDeviceOutput().scanoutPhase == static_cast<bmsx::u32>(bmsx::VdpVoutScanoutPhase::Vblank), "VBlank edge should publish VOUT VBLANK scanout phase");
	require(runtime.machine.vdp.readDeviceOutput().scanoutX == 0u, "VBlank edge should publish VOUT scanout X at the left edge");
	require(runtime.machine.vdp.readDeviceOutput().scanoutY == 212u, "VBlank edge should publish VOUT scanout Y at the first blank line");

	runtime.vblank.handleBeginTimer(runtime);
	require(runtime.frameScheduler.lastTickSequence == sequenceBefore + 1, "same active VBlank should not double-complete the tick");
	runtime.machine.scheduler.setNowCycles(100);
	runtime.vblank.handleEndTimer(runtime);
	require(runtime.machine.vdp.readDeviceOutput().scanoutPhase == static_cast<bmsx::u32>(bmsx::VdpVoutScanoutPhase::Active), "VBlank end should publish active scanout phase");
	require(runtime.machine.vdp.readDeviceOutput().scanoutX == 0u, "VBlank end should publish new-frame scanout X");
	require(runtime.machine.vdp.readDeviceOutput().scanoutY == 0u, "VBlank end should publish new-frame scanout Y");

	runtime.vblank.setVblankCycles(runtime, 100);
	require(runtime.machine.vdp.readDeviceOutput().scanoutPhase == static_cast<bmsx::u32>(bmsx::VdpVoutScanoutPhase::Vblank), "full-frame VBlank should publish VOUT VBLANK scanout phase");
	require(runtime.machine.vdp.readDeviceOutput().scanoutX == 0u, "full-frame VBlank should publish VOUT scanout X at the left edge");
	require(runtime.machine.vdp.readDeviceOutput().scanoutY == 212u, "full-frame VBlank should publish VOUT scanout Y at the first blank line");
	runtime.machine.scheduler.setNowCycles(100);
	runtime.vblank.handleEndTimer(runtime);
	require(runtime.machine.vdp.readDeviceOutput().scanoutPhase == static_cast<bmsx::u32>(bmsx::VdpVoutScanoutPhase::Vblank), "full-frame VBlank frame end should keep VOUT in VBLANK");
	require(runtime.machine.vdp.readDeviceOutput().scanoutX == 0u, "full-frame VBlank frame end should keep scanout X at the left edge");
	require(runtime.machine.vdp.readDeviceOutput().scanoutY == 212u, "full-frame VBlank frame end should publish the next blank line origin");
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
	const std::string removedStringHelper = std::string("string") + "_ref";
	require(bmsx::findDefaultLuaBuiltinDescriptor(removedStringHelper) == nullptr, "removed compiler intrinsic should not be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_action") != nullptr, "ICU action register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_bind") != nullptr, "ICU bind register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_query") != nullptr, "ICU query register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_consume") != nullptr, "ICU consume register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_fault_code") != nullptr, "APU fault-code register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_fault_detail") != nullptr, "APU fault-detail register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_fault_ack") != nullptr, "APU fault ACK register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_fault") != nullptr, "APU fault status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_selected_slot_active") != nullptr, "APU selected-slot active status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_busy") != nullptr, "APU busy status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_selected_source_addr") != nullptr, "APU selected-source register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_active_mask") != nullptr, "APU active-mask register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_selected_slot_regs") != nullptr, "APU selected-slot register window descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_selected_slot_reg_count") != nullptr, "APU selected-slot register count descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_generator_kind") != nullptr, "APU generator-kind register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_generator_duty_q12") != nullptr, "APU generator-duty register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_generator_none") != nullptr, "APU no-generator constant descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_generator_square") != nullptr, "APU square-generator constant descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_output_queued_frames") != nullptr, "APU output-ring queued-frame register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_output_free_frames") != nullptr, "APU output-ring free-frame register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_output_capacity_frames") != nullptr, "APU output-ring capacity register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_cmd_queued") != nullptr, "APU command-FIFO queued register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_cmd_free") != nullptr, "APU command-FIFO free register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_apu_cmd_capacity") != nullptr, "APU command-FIFO capacity register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_output_empty") != nullptr, "APU output-empty status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_output_full") != nullptr, "APU output-full status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_cmd_fifo_empty") != nullptr, "APU command-FIFO-empty status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_status_cmd_fifo_full") != nullptr, "APU command-FIFO-full status-bit descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_output_queue_capacity_frames") != nullptr, "APU output-ring capacity constant descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_command_fifo_capacity") != nullptr, "APU command-FIFO capacity constant descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_fault_source_range") != nullptr, "APU source-range fault descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("apu_fault_cmd_fifo_full") != nullptr, "APU command-FIFO-full fault descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_event_status") != nullptr, "ICU event FIFO status register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_event_action") != nullptr, "ICU event FIFO action register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_event_ctrl") != nullptr, "ICU event FIFO control register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("inp_event_status_empty") != nullptr, "ICU event FIFO empty status descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("inp_event_ctrl_pop") != nullptr, "ICU event FIFO pop command descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("inp_event_fifo_capacity") != nullptr, "ICU event FIFO capacity descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_output_status") != nullptr, "ICU output status register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_inp_output_ctrl") != nullptr, "ICU output control register descriptor should be exposed");
	require(bmsx::findDefaultLuaBuiltinDescriptor("inp_output_ctrl_apply") != nullptr, "ICU output apply command descriptor should be exposed");
}

void testSystemGlobalsGeometryContractGolden() {
	RuntimeHarness harness;
	bmsx::seedSystemGlobals(harness.runtime);
	auto globalNumber = [&harness](std::string_view name) {
		return bmsx::asNumber(harness.runtime.machine.cpu.getGlobalByKey(harness.runtime.internString(name)));
	};
	require(globalNumber("sys_geo_primitive_aabb") == static_cast<double>(bmsx::GEO_PRIMITIVE_AABB), "C++ system globals should expose GEO AABB primitive");
	require(globalNumber("sys_geo_primitive_convex_poly") == static_cast<double>(bmsx::GEO_PRIMITIVE_CONVEX_POLY), "C++ system globals should expose GEO convex polygon primitive");
	require(globalNumber("sys_geo_xform2_max_vertices") == static_cast<double>(bmsx::GEO_XFORM2_MAX_VERTICES), "C++ system globals should expose GEO xform2 vertex capacity");
	require(globalNumber("sys_geo_sat2_max_poly_vertices") == static_cast<double>(bmsx::GEO_SAT2_MAX_POLY_VERTICES), "C++ system globals should expose GEO sat2 poly scratch capacity");
	require(globalNumber("sys_geo_overlap_max_poly_vertices") == static_cast<double>(bmsx::GEO_OVERLAP2D_MAX_POLY_VERTICES), "C++ system globals should expose GEO overlap poly scratch capacity");
	require(globalNumber("sys_geo_overlap_max_clip_vertices") == static_cast<double>(bmsx::GEO_OVERLAP2D_MAX_CLIP_VERTICES), "C++ system globals should expose GEO overlap clip scratch capacity");
	require(globalNumber("sys_geo_overlap_instance_bytes") == static_cast<double>(bmsx::GEO_OVERLAP2D_INSTANCE_BYTES), "C++ system globals should expose GEO overlap instance record size");
	require(globalNumber("sys_geo_overlap_pair_bytes") == static_cast<double>(bmsx::GEO_OVERLAP2D_PAIR_BYTES), "C++ system globals should expose GEO overlap pair record size");
	require(globalNumber("sys_geo_overlap_result_bytes") == static_cast<double>(bmsx::GEO_OVERLAP2D_RESULT_BYTES), "C++ system globals should expose GEO overlap result record size");
	require(globalNumber("sys_geo_overlap_result_pair_meta_offset") == static_cast<double>(bmsx::GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET), "C++ system globals should expose GEO overlap result pair-meta offset");
	require(globalNumber("sys_geo_overlap_shape_desc_bytes") == static_cast<double>(bmsx::GEO_OVERLAP2D_SHAPE_DESC_BYTES), "C++ system globals should expose GEO overlap shape descriptor size");
	require(globalNumber("sys_geo_overlap_shape_bounds_bottom_offset") == static_cast<double>(bmsx::GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET), "C++ system globals should expose GEO overlap shape bounds offsets");
	require(globalNumber("sys_geo_overlap_aabb_shape_bytes") == static_cast<double>(bmsx::GEO_OVERLAP2D_AABB_SHAPE_BYTES), "C++ system globals should expose GEO overlap AABB footprint");
	require(globalNumber("sys_geo_overlap_pair_meta_instance_a_shift") == static_cast<double>(bmsx::GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT), "C++ system globals should expose GEO overlap pair-meta instance A shift");
	require(globalNumber("sys_geo_overlap_pair_meta_instance_a_mask") == static_cast<double>(bmsx::GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK), "C++ system globals should expose GEO overlap pair-meta instance A mask");
	require(globalNumber("sys_geo_overlap_pair_meta_instance_b_mask") == static_cast<double>(bmsx::GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK), "C++ system globals should expose GEO overlap pair-meta instance B mask");
	require(globalNumber("sys_geo_fault_ack") == static_cast<double>(bmsx::IO_GEO_FAULT_ACK), "C++ system globals should expose the GEO fault ACK doorbell");
	require(globalNumber("sys_geo_fault_code_shift") == static_cast<double>(bmsx::GEO_FAULT_CODE_SHIFT), "C++ system globals should expose the GEO fault code shift");
	require(globalNumber("sys_geo_fault_record_index_none") == static_cast<double>(bmsx::GEO_FAULT_RECORD_INDEX_NONE), "C++ system globals should expose the GEO reject fault sentinel");
	require(globalNumber("sys_apu_active_mask") == static_cast<double>(bmsx::IO_APU_ACTIVE_MASK), "C++ system globals should expose the APU active-mask register");
	require(globalNumber("sys_apu_selected_slot_regs") == static_cast<double>(bmsx::IO_APU_SELECTED_SLOT_REG0), "C++ system globals should expose the APU selected-slot register window");
	require(globalNumber("sys_apu_selected_slot_reg_count") == static_cast<double>(bmsx::IO_APU_SELECTED_SLOT_REG_COUNT), "C++ system globals should expose the APU selected-slot register count");
	require(globalNumber("sys_apu_generator_kind") == static_cast<double>(bmsx::IO_APU_GENERATOR_KIND), "C++ system globals should expose the APU generator-kind register");
	require(globalNumber("sys_apu_generator_duty_q12") == static_cast<double>(bmsx::IO_APU_GENERATOR_DUTY_Q12), "C++ system globals should expose the APU generator-duty register");
	require(globalNumber("sys_apu_output_queued_frames") == static_cast<double>(bmsx::IO_APU_OUTPUT_QUEUED_FRAMES), "C++ system globals should expose the APU output-ring queued-frame register");
	require(globalNumber("sys_apu_output_free_frames") == static_cast<double>(bmsx::IO_APU_OUTPUT_FREE_FRAMES), "C++ system globals should expose the APU output-ring free-frame register");
	require(globalNumber("sys_apu_output_capacity_frames") == static_cast<double>(bmsx::IO_APU_OUTPUT_CAPACITY_FRAMES), "C++ system globals should expose the APU output-ring capacity register");
	require(globalNumber("sys_apu_cmd_queued") == static_cast<double>(bmsx::IO_APU_CMD_QUEUED), "C++ system globals should expose the APU command-FIFO queued register");
	require(globalNumber("sys_apu_cmd_free") == static_cast<double>(bmsx::IO_APU_CMD_FREE), "C++ system globals should expose the APU command-FIFO free register");
	require(globalNumber("sys_apu_cmd_capacity") == static_cast<double>(bmsx::IO_APU_CMD_CAPACITY), "C++ system globals should expose the APU command-FIFO capacity register");
	require(globalNumber("apu_status_busy") == static_cast<double>(bmsx::APU_STATUS_BUSY), "C++ system globals should expose the APU busy status bit");
	require(globalNumber("apu_status_output_empty") == static_cast<double>(bmsx::APU_STATUS_OUTPUT_EMPTY), "C++ system globals should expose the APU output-empty status bit");
	require(globalNumber("apu_status_output_full") == static_cast<double>(bmsx::APU_STATUS_OUTPUT_FULL), "C++ system globals should expose the APU output-full status bit");
	require(globalNumber("apu_status_cmd_fifo_empty") == static_cast<double>(bmsx::APU_STATUS_CMD_FIFO_EMPTY), "C++ system globals should expose the APU command-FIFO-empty status bit");
	require(globalNumber("apu_status_cmd_fifo_full") == static_cast<double>(bmsx::APU_STATUS_CMD_FIFO_FULL), "C++ system globals should expose the APU command-FIFO-full status bit");
	require(globalNumber("apu_output_queue_capacity_frames") == static_cast<double>(bmsx::APU_OUTPUT_QUEUE_CAPACITY_FRAMES), "C++ system globals should expose the APU output-ring capacity constant");
	require(globalNumber("apu_command_fifo_capacity") == static_cast<double>(bmsx::APU_COMMAND_FIFO_CAPACITY), "C++ system globals should expose the APU command-FIFO capacity constant");
	require(globalNumber("apu_generator_none") == static_cast<double>(bmsx::APU_GENERATOR_NONE), "C++ system globals should expose the APU no-generator constant");
	require(globalNumber("apu_generator_square") == static_cast<double>(bmsx::APU_GENERATOR_SQUARE), "C++ system globals should expose the APU square-generator constant");
	require(globalNumber("sys_inp_event_status") == static_cast<double>(bmsx::IO_INP_EVENT_STATUS), "C++ system globals should expose the ICU event FIFO status register");
	require(globalNumber("sys_inp_event_action") == static_cast<double>(bmsx::IO_INP_EVENT_ACTION), "C++ system globals should expose the ICU event FIFO action register");
	require(globalNumber("sys_inp_event_ctrl") == static_cast<double>(bmsx::IO_INP_EVENT_CTRL), "C++ system globals should expose the ICU event FIFO control register");
	require(globalNumber("inp_event_status_empty") == static_cast<double>(bmsx::INP_EVENT_STATUS_EMPTY), "C++ system globals should expose the ICU event FIFO empty status bit");
	require(globalNumber("inp_event_ctrl_pop") == static_cast<double>(bmsx::INP_EVENT_CTRL_POP), "C++ system globals should expose the ICU event FIFO pop command");
	require(globalNumber("inp_event_fifo_capacity") == static_cast<double>(bmsx::INPUT_CONTROLLER_EVENT_FIFO_CAPACITY), "C++ system globals should expose the ICU event FIFO capacity");
	require(globalNumber("sys_inp_output_status") == static_cast<double>(bmsx::IO_INP_OUTPUT_STATUS), "C++ system globals should expose the ICU output status register");
	require(globalNumber("sys_inp_output_ctrl") == static_cast<double>(bmsx::IO_INP_OUTPUT_CTRL), "C++ system globals should expose the ICU output control register");
	require(globalNumber("inp_output_status_supported") == static_cast<double>(bmsx::INP_OUTPUT_STATUS_SUPPORTED), "C++ system globals should expose the ICU output supported bit");
	require(globalNumber("inp_output_ctrl_apply") == static_cast<double>(bmsx::INP_OUTPUT_CTRL_APPLY), "C++ system globals should expose the ICU output apply command");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_overlap_instance_bytes") != nullptr, "C++ builtin descriptors should expose GEO overlap table layout ABI");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_overlap_result_pair_meta_offset") != nullptr, "C++ builtin descriptors should expose GEO overlap result layout ABI");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_overlap_pair_meta_instance_a_shift") != nullptr, "C++ builtin descriptors should expose GEO overlap pair-meta ABI");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_xform2_max_vertices") != nullptr, "C++ builtin descriptors should expose GEO xform2 capacity ABI");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_sat2_max_poly_vertices") != nullptr, "C++ builtin descriptors should expose GEO sat2 scratch capacity ABI");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_overlap_max_poly_vertices") != nullptr, "C++ builtin descriptors should expose GEO overlap scratch capacity ABI");
	require(bmsx::findDefaultLuaBuiltinDescriptor("sys_geo_primitive_aabb") != nullptr, "C++ builtin descriptors should expose GEO primitive ABI");
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
	const std::array<std::pair<const char*, void (*)()>, 41> tests{{
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
		{"GEO execution fault ack preserves completed status", testGeometryExecutionFaultAckPreservesCompletedStatusGolden},
		{"GEO rejected command phase", testGeometryRejectedCommandPhaseGolden},
		{"GEO xform2 record capacity fault", testGeometryXform2RecordCapacityFaultGolden},
		{"GEO sat2 scratch capacity fault", testGeometrySat2ScratchCapacityFaultGolden},
		{"GEO overlap2d submit contract", testGeometryOverlap2dSubmitContractGolden},
		{"GEO contract constants", testGeometryContractConstantsGolden},
		{"APU contract constants", testApuContractConstantsGolden},
		{"APU device faults", testApuDeviceFaultsGolden},
		{"APU command FIFO", testApuCommandFifoGolden},
		{"AOUT output queue", testAoutOutputQueueGolden},
		{"APU output-ring status", testApuOutputRingStatusGolden},
		{"APU parameter register state", testApuParameterRegisterStateGolden},
		{"APU selected-slot active state", testApuSelectedSlotActiveStateGolden},
		{"ICU register and action state", testInputControllerStateGolden},
		{"ICU output registers", testInputControllerOutputRegisters},
		{"ICU real PlayerInput context", testInputControllerRealPlayerContext},
		{"runtime vblank edge completes active tick", testRuntimeVblankEdgeCompletesActiveTickGolden},
		{"memory access and opcode", testAccessKindAndOpcodeGolden},
		{"timing and hash", testTimingAndHashGolden},
		{"rompack schema", testRompackSchemaGolden},
		{"firmware descriptors", testFirmwareDescriptorGolden},
		{"system globals geometry contract", testSystemGlobalsGeometryContractGolden},
		{"render schema", testRenderSchemaGolden},
		{"program loader module paths", testProgramLoaderModulePathsGolden},
	}};
	for (const auto& test : tests) {
		test.second();
	}
	return 0;
}
