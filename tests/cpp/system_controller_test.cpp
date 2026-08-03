#include "spec/bmsx/io.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/gx/gte.h"
#include "spec/blua32/builtin.h"
#include "machine/machine.h"
#include "machine/memory/memory.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/model.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/machine_state.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/scheduler/device.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace {

constexpr std::string_view TEST_CARTRIDGE_CLOSURE_GLOBAL = "test_cartridge_closure";
constexpr std::string_view TEST_CARTRIDGE_VALUE_GLOBAL = "test_cartridge_value";
constexpr std::array<std::string_view, 2> TEST_EXTERNAL_CLOSURE_GLOBALS{{
	"test_external_gte",
	"test_external_return",
}};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class SystemResetInputSource final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&) override {}
	auto supervisorRequestLineHigh() const -> bool override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
};

auto makeRuntimeImage(bmsx::OpCode startupOpcode) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(bmsx::INSTRUCTION_BYTES * 2u);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(
		code,
		0,
		static_cast<bmsx::u8>(startupOpcode),
		0,
		0,
		0
	);
	bmsx::writeInstruction(
		code,
		1,
		static_cast<bmsx::u8>(bmsx::OpCode::RFE),
		0,
		0,
		0
	);
	image.functions = {
		{.firstWord = 0u, .wordCount = 1u},
		{.firstWord = 1u, .wordCount = 1u},
	};
	image.irqFunctionIndex = 1u;
	image.exceptionFunctionIndex = 1u;
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		image.systemGlobalNames.emplace_back(primitive.name);
	}
	return image;
}

auto makeSystemTransferImage(bmsx::u32 cartridgeStartupAddress) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image = makeRuntimeImage(bmsx::OpCode::RFE);
	image.text.resize(bmsx::INSTRUCTION_BYTES * 3u);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.constants.emplace_back(static_cast<bmsx::f64>(cartridgeStartupAddress));
	image.functions = {
		{.firstWord = 0u, .wordCount = 2u},
		{.firstWord = 2u, .wordCount = 1u},
	};
	return image;
}

auto makeExecutionSelectorSystemImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(bmsx::INSTRUCTION_BYTES * 3u);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 2u},
		{.firstWord = 2u, .wordCount = 1u},
	};
	image.constants = {
		static_cast<bmsx::f64>(bmsx::test::blua32TestFunctionAddress(
			bmsx::RomImageDomain::Cartridge,
			0u
		)),
	};
	image.irqFunctionIndex = 1u;
	image.exceptionFunctionIndex = 0u;
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		image.systemGlobalNames.emplace_back(primitive.name);
	}
	return image;
}

auto makeClosureCartImage(
	bmsx::f64 value,
	bool staticClosure
) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(9u * bmsx::INSTRUCTION_BYTES);
	image.constants = {value};
	image.globalNames.emplace_back(TEST_CARTRIDGE_CLOSURE_GLOBAL);
	image.globalNames.emplace_back(TEST_CARTRIDGE_VALUE_GLOBAL);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 1);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(0), 1);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 0, 0, 1);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 6u},
		{.firstWord = 6u, .wordCount = 2u, .staticClosure = staticClosure},
		{.firstWord = 8u, .wordCount = 1u},
	};
	image.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::Cartridge, 1u),
	}};
	image.irqFunctionIndex = 2u;
	image.exceptionFunctionIndex = 2u;
	return image;
}

auto makeExternalClosureSystemImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(14u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 1);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 1, 0, 2);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 0, 0, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 1, 0, 1);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 1);
	bmsx::writeInstruction(
		code,
		9,
		static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM),
		0,
		1,
		static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE)
	);
	bmsx::writeInstruction(
		code,
		10,
		static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM),
		0,
		1,
		static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE)
	);
	bmsx::writeInstruction(code, 11, static_cast<bmsx::u8>(bmsx::OpCode::RET), 2, 0, 0);
	bmsx::writeInstruction(code, 12, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 13, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 7u, .maxStack = 2u},
		{.firstWord = 7u, .wordCount = 5u, .maxStack = 2u, .staticClosure = true},
		{.firstWord = 12u, .wordCount = 1u, .staticClosure = true},
		{.firstWord = 13u, .wordCount = 1u},
	};
	image.constants = {
		static_cast<bmsx::f64>(bmsx::GX_GTE_PLUS_FN_VMAD3),
		static_cast<bmsx::f64>(
			bmsx::IO_GX_GTE_PLUS_BASE
				+ bmsx::GX_GTE_PLUS_COMMAND * bmsx::IO_WORD_SIZE
		),
	};
	for (std::string_view name : TEST_EXTERNAL_CLOSURE_GLOBALS) {
		image.globalNames.emplace_back(name);
	}
	image.closureRelocations = {
		{
			1u,
			bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u),
		},
		{
			3u,
			bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 2u),
		},
	};
	image.irqFunctionIndex = 3u;
	image.exceptionFunctionIndex = 3u;
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		image.systemGlobalNames.emplace_back(primitive.name);
	}
	return image;
}

auto makeCompletionLatchSystemImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(6u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 1);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::NEWT), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 3u},
		{.firstWord = 3u, .wordCount = 2u, .maxStack = 1u, .staticClosure = true},
		{.firstWord = 5u, .wordCount = 1u},
	};
	image.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u),
	}};
	image.irqFunctionIndex = 2u;
	image.exceptionFunctionIndex = 2u;
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		image.systemGlobalNames.emplace_back(primitive.name);
	}
	return image;
}

struct SystemRuntimeFixture {
	bmsx::test::Blua32TestRom systemRom;
	bmsx::test::Blua32TestRom cartRom;
	bmsx::test::Blua32TestRom cart1Rom;
	SystemResetInputSource input;
	bmsx::Runtime runtime;

	SystemRuntimeFixture()
		: SystemRuntimeFixture(
			makeRuntimeImage(bmsx::OpCode::HALT),
			makeRuntimeImage(bmsx::OpCode::HALT)
		) {
	}

	SystemRuntimeFixture(
		bmsx::test::Blua32TestImage systemImage,
		bmsx::test::Blua32TestImage cartImage,
		std::optional<bmsx::test::Blua32TestImage> cart1Image = std::nullopt
	)
		: systemRom(bmsx::test::encodeBlua32TestRom(
			bmsx::RomImageDomain::System,
			systemImage
		))
		, cartRom(bmsx::test::encodeBlua32TestRom(
			bmsx::RomImageDomain::Cartridge,
			cartImage
		))
		, cart1Rom(cart1Image
			? bmsx::test::encodeBlua32TestRom(
				bmsx::RomImageDomain::Cartridge,
				*cart1Image
			)
			: bmsx::test::Blua32TestRom{})
		, runtime(
			bmsx::RuntimeOptions{
				systemRom.bytes,
				bmsx::test::cartridgeSlots(cartRom.bytes, cart1Rom.bytes),
				bmsx::PSX_MACHINE_SPEC,
			},
			input
		) {
		runtime.boot();
	}
};

struct ExternalClosureFixture {
	SystemRuntimeFixture system;
	bmsx::Runtime& runtime;
	bmsx::CPU& cpu;
	std::array<bmsx::Closure*, 2> closures{};

	ExternalClosureFixture()
		: system(
			makeExternalClosureSystemImage(),
			makeRuntimeImage(bmsx::OpCode::RET)
		)
		, runtime(system.runtime)
		, cpu(runtime.machine.cpu) {
		require(cpu.runUntilDepth(0, 6) == bmsx::RunResult::Yielded, "system firmware publishes external-call test closures");
		for (size_t index = 0; index < closures.size(); ++index) {
			const bmsx::StringId name =
				cpu.stringPool().intern(TEST_EXTERNAL_CLOSURE_GLOBALS[index]);
			closures[index] = bmsx::asClosure(cpu.getGlobalByKey(name));
		}
	}
};

void testResetCommandLatch() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input, bmsx::PSX_MACHINE_SPEC);
	machine.resetDevices();
	bmsx::SystemController& controller = machine.systemController;

	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	require(memory.readIoU32(bmsx::IO_SYS_CONTROL) == 0u, "system control command register is self-clearing");
	require(controller.captureState().resetRequested, "system reset command latches a reset request");

	const bmsx::SystemControllerState state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	require(controller.takeResetRequest(), "save-state restores a pending system reset");
	require(!controller.takeResetRequest(), "consuming a system reset clears the latch");
}

void testSystemTimingRegisters() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input, bmsx::PSX_MACHINE_SPEC);
	machine.resetDevices();
	machine.scheduler.setNowCycles(bmsx::PSX_MACHINE_SPEC.cpuFreqHz);
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_TIME_MS) == 1000u,
		"system time has the physical model clock from device construction"
	);
	machine.scheduler.setNowCycles(0);
	machine.refreshDeviceTimings(
		bmsx::MachineTiming{5'000'000, bmsx::PSX_MACHINE_SPEC.geoWorkUnitsPerSec},
		machine.scheduler.currentNowCycles()
	);

	require(memory.readMappedU32LE(bmsx::IO_SYS_TIME_MS) == 0u, "system time starts at the scheduler reset epoch");
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16)
			== machine.gxGpu.readPcrtcTiming().frameDurationMillisecondsQ16,
		"system frame period is decoded from the retained PCRTC timing signal"
	);
	require(
		memory.readMappedWord(bmsx::IO_SYS_CYCLES_PER_FRAME)
			== static_cast<bmsx::u32>(machine.gxGpu.readPcrtcTiming().nextVblankCycleBudget),
		"system frame-cycle count is read directly from the retained PCRTC timing signal"
	);

	machine.scheduler.setNowCycles(12'500'001);
	require(memory.readMappedU32LE(bmsx::IO_SYS_TIME_MS) == 2500u, "system time exposes whole elapsed machine milliseconds");
	require(machine.systemController.elapsedMilliseconds() == 2500.0002, "system controller exposes the exact VBlank sample timestamp");

	const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
	const bmsx::u32 smode1 = memory.readMappedU32LE(smode1Address);
	memory.writeMappedU32LE(smode1Address, smode1 | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
	require(memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 0u, "stopped PCRTC publishes zero frame duration");
	require(memory.readMappedWord(bmsx::IO_SYS_CYCLES_PER_FRAME) == 0u, "stopped PCRTC publishes zero frame-cycle budget");

	machine.scheduler.setNowCycles(9'000'006'099'639'999);
	require(memory.readMappedU32LE(bmsx::IO_SYS_TIME_MS) == 409'922'903u, "system time retains exact low-u32 milliseconds near the TS integer boundary");
}

void testSystemPrintRegisters() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input, bmsx::PSX_MACHINE_SPEC);
	machine.resetDevices();
	bmsx::SystemController& controller = machine.systemController;

	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x68u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x69u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(controller.hostOutputAvailableByteCount() == 3u, "system print flush publishes one complete host line");
	require(controller.readHostOutputByte() == 0x68u, "host output retains the first byte");
	require(controller.readHostOutputByte() == 0x69u, "host output retains the second byte");
	require(controller.readHostOutputByte() == 0x0au, "host output terminates the completed line");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x69u, "system print character register retains the last written word");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == 1u, "system print flush register retains the last written word");

	const bmsx::SystemControllerState state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x69u, "save-state restores the character latch");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == 1u, "save-state restores the flush latch");
	require(controller.hostOutputAvailableByteCount() == 0u, "save-state restore clears non-serialized host output");

	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x20acu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(controller.hostOutputAvailableByteCount() == 4u, "system print encodes a Unicode codepoint before host transport");
	require(controller.readHostOutputByte() == 0xe2u, "host output retains UTF-8 byte one");
	require(controller.readHostOutputByte() == 0x82u, "host output retains UTF-8 byte two");
	require(controller.readHostOutputByte() == 0xacu, "host output retains UTF-8 byte three");
	require(controller.readHostOutputByte() == 0x0au, "host UTF-8 output terminates the completed line");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x20acu, "system print character latch retains the raw codepoint word");

	controller.reset();
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x6fu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x6bu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	for (bmsx::u32 index = 0u; index < bmsx::SYS_PRINT_BUFFER_BYTES; ++index) {
		memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x78u);
	}
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(controller.hostOutputAvailableByteCount() == 3u, "host output overflow preserves complete pending lines");
	require(controller.readHostOutputByte() == 0x6fu, "host output overflow retains the first pending byte");
	require(controller.readHostOutputByte() == 0x6bu, "host output overflow retains the second pending byte");
	require(controller.readHostOutputByte() == 0x0au, "host output overflow retains the pending newline");
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x79u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(controller.hostOutputAvailableByteCount() == 2u, "host output accepts the line after an overflowed line");
	require(controller.readHostOutputByte() == 0x79u, "host output retains the line after overflow");
	require(controller.readHostOutputByte() == 0x0au, "host output terminates the line after overflow");
}

void testRuntimeSystemRebootBoundary() {
	const bmsx::u32 cartridgeStartupAddress = bmsx::test::blua32TestFunctionAddress(
		bmsx::RomImageDomain::Cartridge,
		0u
	);
	SystemRuntimeFixture fixture(
		makeSystemTransferImage(cartridgeStartupAddress),
		makeRuntimeImage(bmsx::OpCode::RET)
	);
	bmsx::Runtime& runtime = fixture.runtime;

	require(!runtime.machine.cpu.isCartridgeExecutionActive(), "physical boot begins in system firmware");
	bmsx::FrameSchedulerState& frameScheduler = runtime.frameScheduler;
	const bmsx::f64 frameDurationMs = runtime.timing.frameDurationMs;
	frameScheduler.run(runtime, frameDurationMs);
	require(runtime.machine.cpu.isCartridgeExecutionActive(), "system firmware transfers through CP0.EXEC to the selected cartridge");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	frameScheduler.run(runtime, frameDurationMs);
	require(!runtime.machine.cpu.isCartridgeExecutionActive(), "system reset restarts physical system firmware before cartridge execution");
	require(!runtime.machine.systemController.captureState().resetRequested, "runtime boundary consumes the system reset latch");
	require(frameScheduler.lastTickSequence == 0, "system reset clears scheduler sequence state");

	frameScheduler.run(runtime, frameDurationMs);
	require(runtime.machine.cpu.isCartridgeExecutionActive(), "rebooted system firmware can execute the original cartridge entry address");
}

void testUnexecutedSecondCartridgeDoesNotAlterGuestIdentity() {
	bmsx::test::Blua32TestImage unusedCart = makeClosureCartImage(222.0, true);
	unusedCart.constants.emplace_back(std::string("unused-slot-string"));
	unusedCart.globalNames.emplace_back("unused_slot_global");
	SystemRuntimeFixture single(
		makeRuntimeImage(bmsx::OpCode::HALT),
		makeRuntimeImage(bmsx::OpCode::HALT)
	);
	SystemRuntimeFixture dual(
		makeRuntimeImage(bmsx::OpCode::HALT),
		makeRuntimeImage(bmsx::OpCode::HALT),
		std::move(unusedCart)
	);

	bmsx::CPU& singleCpu = single.runtime.machine.cpu;
	bmsx::CPU& dualCpu = dual.runtime.machine.cpu;
	require(
		singleCpu.stringPool().intern("post-boot-probe", false)
			== dualCpu.stringPool().intern("post-boot-probe", false),
		"an unexecuted second cartridge does not allocate guest string ids"
	);
	require(
		singleCpu.createTable()->hashId == dualCpu.createTable()->hashId,
		"an unexecuted second cartridge does not allocate guest object ids"
	);

	dual.cart1Rom.bytes[dual.cart1Rom.boot.imageOffset] ^= 0xffu;
	dual.runtime.rebootSystem();
}

void testGuestExecutionSelectionAndClosureIdentitySurviveTheSaveStateWireFormat() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111.0, true),
		makeClosureCartImage(222.0, true)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	const bmsx::StringId publishedClosureName =
		cpu.stringPool().intern(TEST_CARTRIDGE_CLOSURE_GLOBAL);
	const bmsx::StringId publishedValueName =
		cpu.stringPool().intern(TEST_CARTRIDGE_VALUE_GLOBAL);

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system reset firmware enters the selected cartridge through CP0.EXEC");
	require(cpu.activeCartridgeSlot() == 0, "CP0.EXEC latches physically selected cartridge slot 0");
	const bmsx::Value slot0ClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::Closure* slot0Closure = bmsx::asClosure(slot0ClosureValue);
	require(bmsx::asNumber(cpu.getGlobalByKey(publishedValueName)) == 111.0, "slot 0 startup executes its published closure");
	const bmsx::StringId savedClosureName = cpu.stringPool().intern("saved_closure");
	const bmsx::StringId closureTableName = cpu.stringPool().intern("closure_table");
	bmsx::Table* closureTable = cpu.createTable();
	closureTable->set(slot0ClosureValue, bmsx::valueNumber(77.0));
	cpu.setGlobalByKey(savedClosureName, slot0ClosureValue);
	cpu.setGlobalByKey(closureTableName, bmsx::valueTable(closureTable));

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler enters the selected cartridge through CP0.EXEC");
	require(cpu.activeCartridgeSlot() == 1, "CP0.EXEC latches physically selected cartridge slot 1");
	const bmsx::Value slot1ClosureValue = cpu.getGlobalByKey(publishedClosureName);
	require(bmsx::asClosure(slot1ClosureValue) == slot0Closure, "one raw physical function address has one canonical static closure");
	require(bmsx::asNumber(closureTable->get(slot1ClosureValue)) == 77.0, "canonical closure identity remains a stable table key across cartridge slots");
	require(bmsx::asNumber(cpu.getGlobalByKey(publishedValueName)) == 222.0, "slot 1 startup executes the canonical closure against slot 1 code");
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	require(
		cpu.activeCartridgeSlot() == 1,
		"data-bus cartridge selection does not replace the post-unwind execution domain"
	);

	const std::vector<bmsx::u8> saveBytes =
		bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler can switch execution back to slot 0");
	require(
		bmsx::asNumber(cpu.getGlobalByKey(publishedValueName)) == 111.0,
		"slot 0 supplies the code behind the raw closure address"
	);

	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			saveBytes,
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	const bmsx::Value restoredClosureValue = cpu.getGlobalByKey(savedClosureName);
	bmsx::Table* restoredTable = bmsx::asTable(cpu.getGlobalByKey(closureTableName));
	require(bmsx::asClosure(restoredClosureValue) == slot0Closure, "wire restore preserves canonical static closure identity");
	require(bmsx::asNumber(restoredTable->get(restoredClosureValue)) == 77.0, "wire restore preserves closure-keyed table entries");
	require(cpu.activeCartridgeSlot() == 1, "wire restore preserves slot 1 as the physical execution source");
	require(
		bmsx::asNumber(cpu.getGlobalByKey(publishedValueName)) == 222.0,
		"wire restore preserves the slot 1 closure result"
	);
}

void testDistinctNonStaticClosuresRemainDistinctTableKeysThroughTheSaveStateWireFormat() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111.0, false)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	const bmsx::StringId publishedClosureName =
		cpu.stringPool().intern(TEST_CARTRIDGE_CLOSURE_GLOBAL);

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cartridge startup publishes the first non-static closure");
	const bmsx::Value firstClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::Closure* firstClosure = bmsx::asClosure(firstClosureValue);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cartridge startup publishes the second non-static closure");
	const bmsx::Value secondClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::Closure* secondClosure = bmsx::asClosure(secondClosureValue);
	require(firstClosure != secondClosure, "non-static closure creation retains object identity");
	require(firstClosure->functionAddress == secondClosure->functionAddress, "non-static closures share one physical function record");

	const bmsx::StringId firstName = cpu.stringPool().intern("first_closure");
	const bmsx::StringId secondName = cpu.stringPool().intern("second_closure");
	const bmsx::StringId tableName = cpu.stringPool().intern("closure_table");
	bmsx::Table* closureTable = cpu.createTable();
	closureTable->set(firstClosureValue, bmsx::valueNumber(11.0));
	closureTable->set(secondClosureValue, bmsx::valueNumber(22.0));
	cpu.setGlobalByKey(firstName, firstClosureValue);
	cpu.setGlobalByKey(secondName, secondClosureValue);
	cpu.setGlobalByKey(tableName, bmsx::valueTable(closureTable));

	const std::vector<bmsx::u8> saveBytes =
		bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			saveBytes,
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));

	const bmsx::Value restoredFirstValue = cpu.getGlobalByKey(firstName);
	const bmsx::Value restoredSecondValue = cpu.getGlobalByKey(secondName);
	bmsx::Closure* restoredFirst = bmsx::asClosure(restoredFirstValue);
	bmsx::Closure* restoredSecond = bmsx::asClosure(restoredSecondValue);
	bmsx::Table* restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName));
	require(restoredFirst != restoredSecond, "wire restore retains distinct non-static closure identities");
	require(restoredFirst->functionAddress == restoredSecond->functionAddress, "wire restore retains the shared physical function record");
	require(bmsx::asNumber(restoredTable->get(restoredFirstValue)) == 11.0, "wire restore retains the first closure table key");
	require(bmsx::asNumber(restoredTable->get(restoredSecondValue)) == 22.0, "wire restore retains the second closure table key");
}

void testMixedStaticAndNonStaticCartridgeClosuresKeepIdentityAcrossEitherSaveStateLatch() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111.0, false),
		makeClosureCartImage(222.0, true)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	const bmsx::StringId publishedClosureName =
		cpu.stringPool().intern(TEST_CARTRIDGE_CLOSURE_GLOBAL);

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "slot 0 publishes the dynamic closure");
	const bmsx::Value dynamicClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::Closure* dynamicClosure = bmsx::asClosure(dynamicClosureValue);
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "slot 1 publishes the canonical closure");
	const bmsx::Value canonicalClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::Closure* canonicalClosure = bmsx::asClosure(canonicalClosureValue);
	require(dynamicClosure != canonicalClosure, "mixed cartridge closure modes retain distinct object identities");
	require(dynamicClosure->functionAddress == canonicalClosure->functionAddress, "mixed cartridge closure modes share one raw address");

	const bmsx::StringId dynamicName = cpu.stringPool().intern("dynamic_closure");
	const bmsx::StringId canonicalName = cpu.stringPool().intern("canonical_closure");
	const bmsx::StringId tableName = cpu.stringPool().intern("mixed_closure_table");
	bmsx::Table* closureTable = cpu.createTable();
	closureTable->set(dynamicClosureValue, bmsx::valueNumber(11.0));
	closureTable->set(canonicalClosureValue, bmsx::valueNumber(22.0));
	cpu.setGlobalByKey(dynamicName, dynamicClosureValue);
	cpu.setGlobalByKey(canonicalName, canonicalClosureValue);
	cpu.setGlobalByKey(tableName, bmsx::valueTable(closureTable));

	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime)),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	bmsx::Value restoredDynamicValue = cpu.getGlobalByKey(dynamicName);
	bmsx::Value restoredCanonicalValue = cpu.getGlobalByKey(canonicalName);
	bmsx::Table* restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName));
	require(bmsx::asClosure(restoredDynamicValue) != bmsx::asClosure(restoredCanonicalValue), "slot 1 wire restore retains mixed closure identities");
	require(bmsx::asNumber(restoredTable->get(restoredDynamicValue)) == 11.0, "slot 1 wire restore retains the dynamic closure key");
	require(bmsx::asNumber(restoredTable->get(restoredCanonicalValue)) == 22.0, "slot 1 wire restore retains the canonical closure key");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler switches the execution latch to the non-static cartridge");
	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime)),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	restoredDynamicValue = cpu.getGlobalByKey(dynamicName);
	restoredCanonicalValue = cpu.getGlobalByKey(canonicalName);
	restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName));
	require(bmsx::asClosure(restoredDynamicValue) != bmsx::asClosure(restoredCanonicalValue), "slot 0 wire restore retains mixed closure identities");
	require(bmsx::asNumber(restoredTable->get(restoredDynamicValue)) == 11.0, "slot 0 wire restore retains the dynamic closure key");
	require(bmsx::asNumber(restoredTable->get(restoredCanonicalValue)) == 22.0, "slot 0 wire restore retains the canonical closure key");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler switches the execution latch back to the static cartridge");
	const bmsx::Value futureCanonicalValue = cpu.getGlobalByKey(publishedClosureName);
	require(bmsx::asClosure(futureCanonicalValue) == bmsx::asClosure(restoredCanonicalValue), "future static closure creation reuses the restored canonical identity");
	require(bmsx::asNumber(restoredTable->get(futureCanonicalValue)) == 22.0, "future canonical closure remains the restored table key");
}

void testCompletionCallReturnLatchSurvivesSaveStateAndGc() {
	SystemRuntimeFixture fixture(
		makeCompletionLatchSystemImage(),
		makeRuntimeImage(bmsx::OpCode::RET)
	);
	bmsx::CPU& cpu = fixture.runtime.machine.cpu;
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "completion-latch startup returns its callable closure");
	bmsx::Closure* closure = bmsx::asClosure(cpu.readCompletionValues()[0]);
	const bmsx::StringId closureKey = cpu.stringPool().intern("completion_call");
	cpu.setGlobalByKey(closureKey, bmsx::valueClosure(closure));

	cpu.beginCompletionCall(*closure);
	require(cpu.runUntilDepth(0, 1) == bmsx::RunResult::Yielded, "completion call remains in flight before RET");
	const bmsx::CpuRuntimeState state = cpu.captureRuntimeState();
	require(
		state.frames.size() == 1u && state.frames.back().returnToCompletionLatch,
		"save-state retains the physical completion-latch return route"
	);

	cpu.restoreRuntimeState(state);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "restored completion call returns through its retained route");
	bmsx::Table* restoredTable = bmsx::asTable(cpu.readCompletionValues()[0]);
	cpu.collectHeap();
	require(bmsx::asTable(cpu.readCompletionValues()[0]) == restoredTable, "completion latch roots its restored heap result");

	bmsx::Closure* restoredClosure = bmsx::asClosure(cpu.getGlobalByKey(closureKey));
	const std::span<const bmsx::Value> results = fixture.runtime.callClosure(*restoredClosure);
	require(results.data() == cpu.readCompletionValues().data(), "Runtime borrows the CPU completion latch without copying");
	bmsx::Table* borrowedTable = bmsx::asTable(results[0]);
	cpu.collectHeap();
	require(bmsx::asTable(results[0]) == borrowedTable, "borrowed completion results remain rooted by the CPU latch");
}

void testSuspendedCompletionReturnsAtPhysicalCpuHold() {
	SystemRuntimeFixture fixture(
		makeCompletionLatchSystemImage(),
		makeRuntimeImage(bmsx::OpCode::RET)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "completion-latch startup returns its callable closure");
	bmsx::Closure* closure = bmsx::asClosure(cpu.readCompletionValues()[0]);
	const bmsx::StringId closureKey = cpu.stringPool().intern("held_completion_call");
	cpu.setGlobalByKey(closureKey, bmsx::valueClosure(closure));

	runtime.machine.scheduler.reset();
	bmsx::SystemControllerState systemState = runtime.machine.systemController.captureState();
	systemState.supervisorPhase = bmsx::SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE;
	systemState.supervisorTransitionTarget = bmsx::SYSTEM_SUPERVISOR_TARGET_FAULT;
	runtime.machine.systemController.restoreState(systemState);
	runtime.machine.scheduler.scheduleDeviceService(bmsx::DEVICE_SERVICE_SYSTEM, 7);
	const int baseDepth = cpu.getFrameDepth();
	cpu.beginCompletionCall(*bmsx::asClosure(cpu.getGlobalByKey(closureKey)));

	require(
		runtime.cpuExecution.runSuspendedUntilDepth(runtime, baseDepth)
			== bmsx::CpuSuspendedRunResult::Halted,
		"suspended completion returns when the physical system controller holds the CPU"
	);
	require(runtime.machine.scheduler.nowCycles() == 0, "suspended completion does not advance held hardware deadlines");
	require(runtime.completionCallPending(), "held suspended completion remains physically pending");
	require(cpu.getFrameDepth() == baseDepth + 1, "held suspended completion preserves its frame");
}

void testExternalClosureAdvancesToGteInterlockDeadline() {
	ExternalClosureFixture fixture;
	const bmsx::i64 cycleBefore = fixture.runtime.machine.scheduler.nowCycles();
	const int expectedCycles =
		2 * bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::LOADK)]
		+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::STORE_MEM)]
		+ static_cast<int>(bmsx::GX_GTE_PLUS_CYCLES_VMAD3)
		+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::STORE_MEM)]
		+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::RET)];
	fixture.cpu.instructionBudgetRemaining = 100;

	const std::span<const bmsx::Value> out = fixture.runtime.callClosure(*fixture.closures[0]);

	require(fixture.runtime.machine.scheduler.nowCycles() == cycleBefore + expectedCycles, "external closure advances through the scheduled GTE completion deadline");
	require(fixture.cpu.instructionBudgetRemaining == 100, "external closure restores the suspended CPU budget after the GTE wait");
	require(!fixture.cpu.isMemoryWriteBlocked(), "GTE completion releases the blocked external-closure store");
	require(fixture.cpu.getFrameDepth() == 1, "external closure preserves the suspended firmware frame after the GTE write interlock");
	require(!fixture.runtime.machine.scheduler.isCpuSliceActive(), "external closure completion ends its CPU scheduler slice");
	require(out.empty(), "GTE interlock closure returns no values");
	require(
		fixture.runtime.machine.memory.readMappedU32LE(
			bmsx::IO_GX_GTE_PLUS_BASE
				+ bmsx::GX_GTE_PLUS_CYCLES * bmsx::IO_WORD_SIZE
		)
			== (bmsx::GX_GTE_PLUS_CYCLES_BUSY | bmsx::GX_GTE_PLUS_CYCLES_VMAD3),
		"external closure retries and admits the second GTE command after the first completion edge"
	);
}

void testExternalClosureVectorsPendingNmiThroughCpuEntry() {
	ExternalClosureFixture fixture;
	const bmsx::i64 cycleBefore = fixture.runtime.machine.scheduler.nowCycles();
	fixture.cpu.requestNonMaskableInterrupt();

	const std::span<const bmsx::Value> out = fixture.runtime.callClosure(*fixture.closures[1]);

	require(
		fixture.runtime.machine.scheduler.nowCycles()
			== cycleBefore
				+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::RFE)]
				+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::RET)],
		"external closure execution charges the physical NMI vector and target return"
	);
	require(
		fixture.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None,
		"external closure execution consumes the physical NMI latch"
	);
	require(fixture.cpu.getFrameDepth() == 1, "external closure returns through the physical NMI frame to suspended firmware");
	require(!fixture.runtime.machine.scheduler.isCpuSliceActive(), "external NMI execution ends its CPU scheduler slice");
	require(out.empty(), "external return closure publishes no values");
}

void testHostDeltaGrantsOneFractionallyRetainedMachineBudget() {
	SystemRuntimeFixture fixture(
		makeRuntimeImage(bmsx::OpCode::HALT),
		makeRuntimeImage(bmsx::OpCode::HALT)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
	const bmsx::u32 smode1 = runtime.machine.memory.readMappedU32LE(smode1Address);
	runtime.machine.memory.writeMappedU32LE(smode1Address, smode1 | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
	runtime.machine.runDeviceService(bmsx::DEVICE_SERVICE_GPU);
	runtime.machine.scheduler.cancelDeviceService(bmsx::DEVICE_SERVICE_APU);
	runtime.machine.scheduler.cancelDeviceService(bmsx::DEVICE_SERVICE_APU_TRANSFER);

	runtime.frameScheduler.run(runtime, 50.03125);

	require(runtime.frameLoop.frameActive, "host delta starts one in-flight machine budget while PCRTC is stopped");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 1'694'498, "host delta grants its complete machine-cycle budget once");
	// 33,868,800 Hz doesn't divide 1000 as cleanly as the old 50,000,000 Hz did,
	// so the exact remainder carries floating-point noise past a few decimal
	// digits; 0x1.9999999cp-2 is the precise double this computation lands on.
	require(runtime.frameScheduler.captureState().cycleGrantRemainder == 0x1.9999999cp-2, "host delta retains its fractional machine cycle");
}

void testRuntimeRestorePreservesInFlightFrameBudget() {
	SystemRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameLoopState& frameLoop = runtime.frameLoop;
	frameLoop.beginFrameState(runtime, 23'456, 34'567);
	frameLoop.frameState.updateExecuted = true;
	frameLoop.frameState.cycleBudgetRemaining = 12'345;
	frameLoop.frameState.activeCpuUsedCycles = 45'678;
	const bmsx::RuntimeMachineState snapshot = bmsx::captureRuntimeMachineState(runtime);

	frameLoop.frameActive = false;
	frameLoop.frameState = bmsx::FrameState{false, 99, 98, 97, 96};
	bmsx::applyRuntimeMachineState(runtime, snapshot);

	const bmsx::FrameLoopStateSnapshot restored = frameLoop.captureState();
	require(restored.frameActive == snapshot.frameLoop.frameActive, "runtime restore preserves in-flight frame activity");
	require(restored.frameState.updateExecuted == snapshot.frameLoop.frameState.updateExecuted, "runtime restore preserves in-flight update completion");
	require(restored.frameState.cycleBudgetRemaining == snapshot.frameLoop.frameState.cycleBudgetRemaining, "runtime restore preserves remaining in-flight cycles");
	require(restored.frameState.cycleBudgetGranted == snapshot.frameLoop.frameState.cycleBudgetGranted, "runtime restore preserves granted in-flight cycles");
	require(restored.frameState.cycleCarryGranted == snapshot.frameLoop.frameState.cycleCarryGranted, "runtime restore preserves carried in-flight cycles");
	require(restored.frameState.activeCpuUsedCycles == snapshot.frameLoop.frameState.activeCpuUsedCycles, "runtime restore preserves used in-flight cycles");
	require(!runtime.vblank.tickCompleted(), "runtime restore prepares the next physical VBlank edge");
}

} // namespace

int main() {
	testResetCommandLatch();
	testSystemTimingRegisters();
	testSystemPrintRegisters();
	testRuntimeSystemRebootBoundary();
	testUnexecutedSecondCartridgeDoesNotAlterGuestIdentity();
	testGuestExecutionSelectionAndClosureIdentitySurviveTheSaveStateWireFormat();
	testDistinctNonStaticClosuresRemainDistinctTableKeysThroughTheSaveStateWireFormat();
	testMixedStaticAndNonStaticCartridgeClosuresKeepIdentityAcrossEitherSaveStateLatch();
	testCompletionCallReturnLatchSurvivesSaveStateAndGc();
	testSuspendedCompletionReturnsAtPhysicalCpuHold();
	testExternalClosureAdvancesToGteInterlockDeadline();
	testExternalClosureVectorsPendingNmiThroughCpuEntry();
	testRuntimeRestorePreservesInFlightFrameBudget();
	testHostDeltaGrantsOneFractionallyRetainedMachineBudget();
	return 0;
}
