#include "machine/bus/io.h"
#include "machine/cpu/cop0.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/firmware/boot_primitives.h"
#include "machine/machine.h"
#include "machine/memory/memory.h"
#include "machine/memory/access_kind.h"
#include "machine/model_registry.h"
#include "machine/runtime/boot_timing.h"
#include "machine/runtime/input.h"
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
#include <variant>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class SystemResetInputSource final : public bmsx::RuntimeInputSource {
public:
	void setRuntimeInputFrameDurationMs(bmsx::f64) override {}
	void sampleInputControllerSnapshot(bmsx::f64, bmsx::InputControllerSnapshot&) override {}
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
	image.text.resize(bmsx::INSTRUCTION_BYTES * 11u);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 1);
	bmsx::writeInstruction(
		code,
		2,
		static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM),
		0,
		1,
		static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE)
	);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 2);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 3);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 1);
	bmsx::writeInstruction(
		code,
		7,
		static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM),
		0,
		1,
		static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE)
	);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 2);
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	bmsx::writeInstruction(code, 10, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 5u, .maxStack = 2u},
		{.firstWord = 5u, .wordCount = 5u, .maxStack = 2u},
		{.firstWord = 10u, .wordCount = 1u},
	};
	image.constants = {
		0.0,
		static_cast<bmsx::f64>(bmsx::IO_CART_SELECT),
		static_cast<bmsx::f64>(bmsx::test::blua32TestFunctionAddress(
			bmsx::RomImageDomain::Cartridge,
			0u
		)),
		1.0,
	};
	image.irqFunctionIndex = 2u;
	image.exceptionFunctionIndex = 2u;
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
	image.text.resize(6u * bmsx::INSTRUCTION_BYTES);
	image.constants = {value};
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 1);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 3u},
		{.firstWord = 3u, .wordCount = 2u, .staticClosure = staticClosure},
		{.firstWord = 5u, .wordCount = 1u},
	};
	image.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::Cartridge, 1u),
	}};
	image.irqFunctionIndex = 2u;
	image.exceptionFunctionIndex = 2u;
	return image;
}

struct SystemRuntimeFixture {
	bmsx::test::Blua32TestRom systemRom;
	bmsx::test::Blua32TestRom cartRom;
	bmsx::test::Blua32TestRom cart1Rom;
	bmsx::ResolvedRuntimeTiming timing;
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
		, timing(bmsx::resolveRuntimeTiming(bmsx::PSX_MACHINE_SPEC.cpuFreqHz))
		, runtime(
			bmsx::RuntimeOptions{
				systemRom.bytes,
				bmsx::test::cartridgeSlots(cartRom.bytes, cart1Rom.bytes),
				timing.pcrtcRunning,
				timing.ufpsScaled,
				timing.cpuHz,
				timing.cycleBudgetPerFrame,
				timing.totalHalfLines,
				timing.activeDisplayHalfLines,
				timing.geoWorkUnitsPerSec,
			},
			input
		) {
		runtime.boot();
	}
};

void testResetCommandLatch() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() });
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input);
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

void testSystemPrintRegisters() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() });
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input);
	machine.resetDevices();
	bmsx::SystemController& controller = machine.systemController;

	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x68u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x69u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(controller.hostOutputAvailableByteCount() == 3u, "system print flush publishes one complete host line");
	require(controller.readHostOutputByte() == 0x68u, "host output retains the first byte");
	require(controller.readHostOutputByte() == 0x69u, "host output retains the second byte");
	require(controller.readHostOutputByte() == 0x0au, "host output terminates the completed line");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == 3u, "system print count includes the flushed newline");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x68u, "system print data reads the oldest byte");

	const bmsx::SystemControllerState state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x69u, "save-state restores retained system print bytes");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x0au, "system print flush retains a newline for firmware");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == 0u, "system print count tracks firmware reads");

	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x20acu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(controller.hostOutputAvailableByteCount() == 4u, "system print encodes a Unicode codepoint before host transport");
	require(controller.readHostOutputByte() == 0xe2u, "host output retains UTF-8 byte one");
	require(controller.readHostOutputByte() == 0x82u, "host output retains UTF-8 byte two");
	require(controller.readHostOutputByte() == 0xacu, "host output retains UTF-8 byte three");
	require(controller.readHostOutputByte() == 0x0au, "host UTF-8 output terminates the completed line");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == static_cast<bmsx::u32>('?'), "BIOS print history maps a wide codepoint to its glyph fallback");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x0au, "BIOS glyph history terminates the Unicode host line");

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

	controller.reset();
	for (bmsx::u32 index = 0u; index < bmsx::SYS_PRINT_BUFFER_BYTES + 2u; ++index) {
		memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, index);
	}
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == bmsx::SYS_PRINT_BUFFER_BYTES, "system print ring retains its fixed byte capacity");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 2u, "system print ring overwrites the oldest byte");
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

	require(runtime.isInitialized(), "physical system firmware initializes before the first frame");
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
	require(runtime.isInitialized(), "system firmware is pending after reset");

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
}

void testGuestExecutionSelectionAndClosureIdentitySurviveTheSaveStateWireFormat() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111.0, true),
		makeClosureCartImage(222.0, true)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "guest system code selects cartridge slot 0 through MMIO and CP0.EXEC");
	require(cpu.activeCartridgeSlot() == 0, "CP0.EXEC latches guest-selected cartridge slot 0");
	require(cpu.lastReturnValues.size() == 1u, "slot 0 startup returns one static closure");
	const bmsx::Value slot0ClosureValue = cpu.lastReturnValues[0];
	bmsx::Closure* slot0Closure = bmsx::asClosure(slot0ClosureValue);
	const bmsx::Value savedClosureName = bmsx::valueString(cpu.stringPool().intern("saved_closure"));
	const bmsx::Value closureTableName = bmsx::valueString(cpu.stringPool().intern("closure_table"));
	bmsx::Table* closureTable = cpu.createTable();
	closureTable->set(slot0ClosureValue, bmsx::valueNumber(77.0));
	cpu.setGlobalByKey(savedClosureName, slot0ClosureValue);
	cpu.setGlobalByKey(closureTableName, bmsx::valueTable(closureTable));

	cpu.start(
		fixture.systemRom.functionAddresses[1],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "guest system code selects cartridge slot 1 through MMIO and CP0.EXEC");
	require(cpu.activeCartridgeSlot() == 1, "CP0.EXEC latches guest-selected cartridge slot 1");
	require(cpu.lastReturnValues.size() == 1u, "slot 1 startup returns one static closure");
	const bmsx::Value slot1ClosureValue = cpu.lastReturnValues[0];
	require(bmsx::asClosure(slot1ClosureValue) == slot0Closure, "one raw physical function address has one canonical static closure");
	require(bmsx::asNumber(closureTable->get(slot1ClosureValue)) == 77.0, "canonical closure identity remains a stable table key across cartridge slots");
	const bmsx::CpuDebugState slot1DebugState = cpu.getDebugState();
	require(
		slot1DebugState.image
			&& std::get<bmsx::f64>(slot1DebugState.image->constants[0]) == 222.0,
		"post-unwind debug state retains the CP0.EXEC-latched cartridge image"
	);
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	const bmsx::CpuDebugState selectedSlot0DebugState = cpu.getDebugState();
	require(
		selectedSlot0DebugState.image
			&& std::get<bmsx::f64>(selectedSlot0DebugState.image->constants[0]) == 222.0,
		"data-bus cartridge selection does not replace the post-unwind execution image"
	);

	const std::vector<bmsx::u8> saveBytes = bmsx::captureRuntimeSaveStateBytes(runtime);
	cpu.start(
		fixture.systemRom.functionAddresses[0],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "guest system code can switch execution back to slot 0");
	cpu.call(*slot0Closure);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "the canonical raw closure executes against the slot 0 latch");
	require(
		cpu.lastReturnValues.size() == 1u
			&& bmsx::asNumber(cpu.lastReturnValues[0]) == 111.0,
		"slot 0 supplies the code behind the raw closure address"
	);

	bmsx::applyRuntimeSaveStateBytes(runtime, saveBytes);
	const bmsx::Value restoredClosureValue = cpu.getGlobalByKey(savedClosureName);
	bmsx::Table* restoredTable = bmsx::asTable(cpu.getGlobalByKey(closureTableName));
	require(bmsx::asClosure(restoredClosureValue) == slot0Closure, "wire restore preserves canonical static closure identity");
	require(bmsx::asNumber(restoredTable->get(restoredClosureValue)) == 77.0, "wire restore preserves closure-keyed table entries");
	cpu.call(*bmsx::asClosure(restoredClosureValue));
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "restored closure executes through the restored CP0.EXEC latch");
	require(
		cpu.lastReturnValues.size() == 1u
			&& bmsx::asNumber(cpu.lastReturnValues[0]) == 222.0,
		"wire restore preserves slot 1 as the physical execution source"
	);
}

void testDistinctNonStaticClosuresRemainDistinctTableKeysThroughTheSaveStateWireFormat() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111.0, false)
	);
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cartridge startup returns the first non-static closure");
	const bmsx::Value firstClosureValue = cpu.lastReturnValues[0];
	bmsx::Closure* firstClosure = bmsx::asClosure(firstClosureValue);
	cpu.start(
		fixture.systemRom.functionAddresses[0],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cartridge startup returns the second non-static closure");
	const bmsx::Value secondClosureValue = cpu.lastReturnValues[0];
	bmsx::Closure* secondClosure = bmsx::asClosure(secondClosureValue);
	require(firstClosure != secondClosure, "non-static closure creation retains object identity");
	require(firstClosure->functionAddress == secondClosure->functionAddress, "non-static closures share one physical function record");

	const bmsx::Value firstName = bmsx::valueString(cpu.stringPool().intern("first_closure"));
	const bmsx::Value secondName = bmsx::valueString(cpu.stringPool().intern("second_closure"));
	const bmsx::Value tableName = bmsx::valueString(cpu.stringPool().intern("closure_table"));
	bmsx::Table* closureTable = cpu.createTable();
	closureTable->set(firstClosureValue, bmsx::valueNumber(11.0));
	closureTable->set(secondClosureValue, bmsx::valueNumber(22.0));
	cpu.setGlobalByKey(firstName, firstClosureValue);
	cpu.setGlobalByKey(secondName, secondClosureValue);
	cpu.setGlobalByKey(tableName, bmsx::valueTable(closureTable));

	const std::vector<bmsx::u8> saveBytes = bmsx::captureRuntimeSaveStateBytes(runtime);
	bmsx::applyRuntimeSaveStateBytes(runtime, saveBytes);

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

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "slot 0 returns the dynamic closure");
	const bmsx::Value dynamicClosureValue = cpu.lastReturnValues[0];
	bmsx::Closure* dynamicClosure = bmsx::asClosure(dynamicClosureValue);
	cpu.start(
		fixture.systemRom.functionAddresses[1],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "slot 1 returns the canonical closure");
	const bmsx::Value canonicalClosureValue = cpu.lastReturnValues[0];
	bmsx::Closure* canonicalClosure = bmsx::asClosure(canonicalClosureValue);
	require(dynamicClosure != canonicalClosure, "mixed cartridge closure modes retain distinct object identities");
	require(dynamicClosure->functionAddress == canonicalClosure->functionAddress, "mixed cartridge closure modes share one raw address");

	const bmsx::Value dynamicName = bmsx::valueString(cpu.stringPool().intern("dynamic_closure"));
	const bmsx::Value canonicalName = bmsx::valueString(cpu.stringPool().intern("canonical_closure"));
	const bmsx::Value tableName = bmsx::valueString(cpu.stringPool().intern("mixed_closure_table"));
	bmsx::Table* closureTable = cpu.createTable();
	closureTable->set(dynamicClosureValue, bmsx::valueNumber(11.0));
	closureTable->set(canonicalClosureValue, bmsx::valueNumber(22.0));
	cpu.setGlobalByKey(dynamicName, dynamicClosureValue);
	cpu.setGlobalByKey(canonicalName, canonicalClosureValue);
	cpu.setGlobalByKey(tableName, bmsx::valueTable(closureTable));

	bmsx::applyRuntimeSaveStateBytes(runtime, bmsx::captureRuntimeSaveStateBytes(runtime));
	bmsx::Value restoredDynamicValue = cpu.getGlobalByKey(dynamicName);
	bmsx::Value restoredCanonicalValue = cpu.getGlobalByKey(canonicalName);
	bmsx::Table* restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName));
	require(bmsx::asClosure(restoredDynamicValue) != bmsx::asClosure(restoredCanonicalValue), "slot 1 wire restore retains mixed closure identities");
	require(bmsx::asNumber(restoredTable->get(restoredDynamicValue)) == 11.0, "slot 1 wire restore retains the dynamic closure key");
	require(bmsx::asNumber(restoredTable->get(restoredCanonicalValue)) == 22.0, "slot 1 wire restore retains the canonical closure key");

	cpu.start(
		fixture.systemRom.functionAddresses[0],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "guest switches the execution latch to the non-static cartridge");
	bmsx::applyRuntimeSaveStateBytes(runtime, bmsx::captureRuntimeSaveStateBytes(runtime));
	restoredDynamicValue = cpu.getGlobalByKey(dynamicName);
	restoredCanonicalValue = cpu.getGlobalByKey(canonicalName);
	restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName));
	require(bmsx::asClosure(restoredDynamicValue) != bmsx::asClosure(restoredCanonicalValue), "slot 0 wire restore retains mixed closure identities");
	require(bmsx::asNumber(restoredTable->get(restoredDynamicValue)) == 11.0, "slot 0 wire restore retains the dynamic closure key");
	require(bmsx::asNumber(restoredTable->get(restoredCanonicalValue)) == 22.0, "slot 0 wire restore retains the canonical closure key");

	cpu.start(
		fixture.systemRom.functionAddresses[1],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "guest switches the execution latch back to the static cartridge");
	require(bmsx::asClosure(cpu.lastReturnValues[0]) == bmsx::asClosure(restoredCanonicalValue), "future static closure creation reuses the restored canonical identity");
	require(bmsx::asNumber(restoredTable->get(cpu.lastReturnValues[0])) == 22.0, "future canonical closure remains the restored table key");
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

void testRuntimeRestorePreservesInFlightFrameBudgetAndResetsHostClock() {
	SystemRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameLoopState& frameLoop = runtime.frameLoop;
	frameLoop.beginFrameState(runtime, 23'456, 34'567);
	frameLoop.frameState.updateExecuted = true;
	frameLoop.frameState.luaFaulted = true;
	frameLoop.frameState.cycleBudgetRemaining = 12'345;
	frameLoop.frameState.activeCpuUsedCycles = 45'678;
	frameLoop.frameDeltaMs = 20.096;
	frameLoop.currentTimeSeconds = 0.9875;
	const bmsx::RuntimeMachineState snapshot = bmsx::captureRuntimeMachineState(runtime);

	frameLoop.frameActive = false;
	frameLoop.frameState = bmsx::FrameState{false, false, 99, 98, 97, 96};
	frameLoop.frameDeltaMs = 1.0;
	frameLoop.currentTimeSeconds = 2.0;
	bmsx::applyRuntimeMachineState(runtime, snapshot);

	const bmsx::FrameLoopStateSnapshot restored = frameLoop.captureState();
	require(restored.frameActive == snapshot.frameLoop.frameActive, "runtime restore preserves in-flight frame activity");
	require(restored.frameState.updateExecuted == snapshot.frameLoop.frameState.updateExecuted, "runtime restore preserves in-flight update completion");
	require(restored.frameState.luaFaulted == snapshot.frameLoop.frameState.luaFaulted, "runtime restore preserves in-flight Lua fault state");
	require(restored.frameState.cycleBudgetRemaining == snapshot.frameLoop.frameState.cycleBudgetRemaining, "runtime restore preserves remaining in-flight cycles");
	require(restored.frameState.cycleBudgetGranted == snapshot.frameLoop.frameState.cycleBudgetGranted, "runtime restore preserves granted in-flight cycles");
	require(restored.frameState.cycleCarryGranted == snapshot.frameLoop.frameState.cycleCarryGranted, "runtime restore preserves carried in-flight cycles");
	require(restored.frameState.activeCpuUsedCycles == snapshot.frameLoop.frameState.activeCpuUsedCycles, "runtime restore preserves used in-flight cycles");
	require(restored.frameDeltaMs == snapshot.frameLoop.frameDeltaMs, "runtime restore preserves in-flight frame duration");
	require(frameLoop.currentTimeSeconds == 0.0, "runtime restore resets the host clock outside machine state");
	require(!runtime.vblank.tickCompleted(), "runtime restore prepares the next physical VBlank edge");
}

} // namespace

int main() {
	testResetCommandLatch();
	testSystemPrintRegisters();
	testRuntimeSystemRebootBoundary();
	testUnexecutedSecondCartridgeDoesNotAlterGuestIdentity();
	testGuestExecutionSelectionAndClosureIdentitySurviveTheSaveStateWireFormat();
	testDistinctNonStaticClosuresRemainDistinctTableKeysThroughTheSaveStateWireFormat();
	testMixedStaticAndNonStaticCartridgeClosuresKeepIdentityAcrossEitherSaveStateLatch();
	testRuntimeRestorePreservesInFlightFrameBudgetAndResetsHostClock();
	testHostDeltaGrantsOneFractionallyRetainedMachineBudget();
	return 0;
}
