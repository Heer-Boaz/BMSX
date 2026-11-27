#include "spec/bmsx/io.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/gx/pcrtc.h"
#include "spec/gx/gp0.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/geometry/contracts.h"
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
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/managed_fixture.h"
#include "support/thread_allocation_reference.h"
#include "support/table_allocation_reference.h"

#include <array>
#include <limits>
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
	void sampleInputControllerSnapshot(
		bmsx::InputControllerSnapshot&,
		bmsx::InputControllerSampleContext) override {}
	auto supervisorRequestLineHigh() const -> bool override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
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
	return image;
}

constexpr bmsx::u32 REBOOT_CONTEXT_MAILBOX = bmsx::DYNAMIC_RAM_BASE;

auto makeSystemTransferImage(bmsx::u32 cartridgeStartupAddress) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image = makeRuntimeImage(bmsx::OpCode::RFE);
	image.text.resize(bmsx::INSTRUCTION_BYTES * 10u);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	// Raw reset selects one of two independently prepared contexts. The
	// handoff and cartridge EXEC both go through the actual CPU controls.
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 1);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 1, bmsx::COP0_CONTEXT, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::K0), 2, 0, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::EQ), 0, 1, 2);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 2);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::LOAD_MEM), 0, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE));
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_CONTEXT, 0);
	image.constants = {
		static_cast<bmsx::i32>(cartridgeStartupAddress),
		static_cast<bmsx::i32>(REBOOT_CONTEXT_MAILBOX),
		static_cast<bmsx::i32>(REBOOT_CONTEXT_MAILBOX + bmsx::IO_WORD_SIZE),
	};
	image.functions = {
		{.firstWord = 0u, .wordCount = 2u},
		{.firstWord = 2u, .wordCount = 1u},
		{.firstWord = 3u, .wordCount = 7u, .maxStack = 3u},
	};
	image.startupFunctionIndex = 2u;
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
		static_cast<bmsx::i32>(bmsx::test::blua32TestFunctionAddress(
			bmsx::RomImageDomain::Cartridge,
			0u
		)),
	};
	image.irqFunctionIndex = 1u;
	image.exceptionFunctionIndex = 0u;
	return image;
}

auto makeClosureCartImage(
	bmsx::i32 value,
	bool staticClosure
) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(9u * bmsx::INSTRUCTION_BYTES);
	image.constants = {value};
	image.globalNames.emplace_back(TEST_CARTRIDGE_CLOSURE_GLOBAL);
	image.globalNames.emplace_back(TEST_CARTRIDGE_VALUE_GLOBAL);
	std::span<bmsx::u8> code(image.text);
	if (staticClosure) {
		bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
		bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 1);
		image.closureRelocations = {{1u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::Cartridge, 1u)}};
	} else {
		// The wire-format test supplies its already bound input in R0.
		bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 0, 0, 0);
		bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 0, 0, 0);
	}
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedValueCount(0), 2);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 0, 0, 1);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 6u, .maxStack = staticClosure ? 1u : 3u},
		{.firstWord = 6u, .wordCount = 2u, .staticClosure = staticClosure},
		{.firstWord = 8u, .wordCount = 1u},
	};
	if (!staticClosure) image.functions[1].upvalues = {{true, 2u}};
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
		static_cast<bmsx::i32>(bmsx::GX_GTE_PLUS_FN_VMAD3),
		static_cast<bmsx::i32>(
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
	return image;
}

auto makeCompletionLatchSystemImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(6u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 1);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 3u},
		{.firstWord = 3u, .wordCount = 2u, .numParams = 1u, .maxStack = 1u, .staticClosure = true},
		{.firstWord = 5u, .wordCount = 1u},
	};
	image.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u),
	}};
	image.irqFunctionIndex = 2u;
	image.exceptionFunctionIndex = 2u;
	return image;
}

struct SystemRuntimeFixture {
	bmsx::test::Blua32TestRom systemRom;
	bmsx::test::Blua32TestRom cartRom;
	bmsx::test::Blua32TestRom cart1Rom;
	SystemResetInputSource input;
	bmsx::Runtime runtime;

	explicit SystemRuntimeFixture(bmsx::u32 systemBssBytes = 0u)
		: SystemRuntimeFixture(
			makeRuntimeImage(bmsx::OpCode::HALT),
			makeRuntimeImage(bmsx::OpCode::HALT),
			std::nullopt,
			systemBssBytes
		) {
	}

	SystemRuntimeFixture(
		bmsx::test::Blua32TestImage systemImage,
		bmsx::test::Blua32TestImage cartImage,
		std::optional<bmsx::test::Blua32TestImage> cart1Image = std::nullopt,
		bmsx::u32 systemBssBytes = 0u
	)
		: systemRom(bmsx::test::encodeBlua32TestRom(
			bmsx::RomImageDomain::System,
			systemImage,
			systemBssBytes
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

	void seedLanguageState() {
		bmsx::test::seedManagedFixture(runtime.machine.cpu, runtime.machine.executionAddressSpace);
	}
};

struct ExternalClosureFixture {
	SystemRuntimeFixture system;
	bmsx::Runtime& runtime;
	bmsx::CPU& cpu;
	std::array<bmsx::u32, 2> closures{};

	ExternalClosureFixture()
		: system(
			makeExternalClosureSystemImage(),
			makeRuntimeImage(bmsx::OpCode::RET)
		)
		, runtime(system.runtime)
		, cpu(runtime.machine.cpu) {
		system.seedLanguageState();
		for (size_t index : {1u, 2u}) bmsx::test::seedTestRomClosure(cpu, system.systemRom.functionAddresses[index]);
		const int publicationCycles = 2 * (bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::CLOSURE)]
			+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::SETGL)]);
		require(cpu.runUntilDepth(0, publicationCycles) == bmsx::RunResult::Yielded, "system firmware publishes external-call test closures");
		for (size_t index = 0; index < closures.size(); ++index) {
			const bmsx::StringId name =
				cpu.stringPool().intern(TEST_EXTERNAL_CLOSURE_GLOBALS[index]);
			closures[index] = bmsx::asClosure(cpu.getGlobalByKey(name), cpu.gcHeap());
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

void testSupervisorFaultPublicationBoundary() {
	SystemRuntimeFixture fixture;
	bmsx::Memory& memory = fixture.runtime.machine.memory;

	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_SUPERVISOR_FAULT);
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_SUPERVISOR_FAULT_SEQUENCE) == 0u,
		"fault capture does not publish before firmware presents the monitor"
	);
	memory.writeMappedU32LE(
		bmsx::IO_SYS_CONTROL,
		bmsx::SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH
	);
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_SUPERVISOR_FAULT_SEQUENCE) == 1u,
		"firmware publication advances the physical fault sequence"
	);
}

void testSupervisorFaultParksUnreadReadbackAndWireState() {
	SystemRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& machine = runtime.machine;
	auto& gpu = machine.gxGpu;
	auto& memory = machine.memory;
	const auto& bytes = gpu.readVramSnapshotBytes();
	const bmsx::u32 expected = static_cast<bmsx::u32>(bytes[0]) | (static_cast<bmsx::u32>(bytes[1]) << 8u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	const bmsx::i64 readbackDeadline = machine.scheduler.currentNowCycles() + gpu.captureState().pendingCommandCycles;
	machine.scheduler.advanceTo(readbackDeadline);
	gpu.onService(readbackDeadline);
	auto& readback = gpu.readDeviceOutput().readbackPort;
	require(readback.claimReadback(gpu.readDeviceOutput().commandBuffer.executedCommandCount), "readback backend claims the completed C0 fence");
	readback.pixelBytes()[0] = bytes[0];
	readback.pixelBytes()[1] = bytes[1];
	readback.completeReadback(readback.token());
	gpu.retireExecutedCommands();
	require(gpu.readDeviceOutput().readbackPort.phase() == bmsx::GX_GPU_READBACK_READY, "fault test starts with unread READY pixels");
	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_SUPERVISOR_FAULT);
	require(machine.systemController.cpuHeld(), "FAULT holds CPU during context transition");
	machine.systemController.onService();
	require(!machine.systemController.cpuHeld(), "unread GPUREAD no longer deadlocks FAULT entry");
	require((memory.readMappedU32LE(bmsx::IO_SYS_STATUS) & bmsx::SYS_STATUS_SUPERVISOR_ACTIVE) != 0u, "FAULT reaches ACTIVE");
	require(gpu.readDeviceOutput().readbackPort.phase() == bmsx::GX_GPU_READBACK_IDLE, "supervisor uses empty active transfer");
	require(gpu.captureState().userIngressContext.readbackPhase == bmsx::GX_GPU_READBACK_READY, "USER unread pixels remain parked");
	bmsx::applyRuntimeSaveState(runtime, bmsx::decodeRuntimeSaveState(
		bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime)),
		memory.ramByteCount(), bytes.size()));
	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_SUPERVISOR_LEAVE);
	machine.systemController.onService();
	require(!machine.systemController.supervisorContextActive(), "LEAVE returns to USER");
	require(gpu.readDeviceOutput().readbackPort.phase() == bmsx::GX_GPU_READBACK_READY, "wire state preserves parked USER readback");
	require(gpu.readGp0() == expected, "USER receives its exact original unread pixel");
	require(gpu.readDeviceOutput().readbackPort.phase() == bmsx::GX_GPU_READBACK_IDLE, "USER actual consume completes the transfer");
}

void testNestedSupervisorFaultPreservesExitRequest() {
	SystemRuntimeFixture fixture;
	bmsx::Machine& machine = fixture.runtime.machine;
	bmsx::Memory& memory = machine.memory;
	machine.systemController.requestSupervisorLineEdge();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 16u
			&& machine.systemController.captureState().supervisorPhase
				!= bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1u) {
		const bmsx::i64 deadline = machine.scheduler.nextDeadline();
		require(
			deadline != std::numeric_limits<bmsx::i64>::max(),
			"supervisor entry retains a device-service deadline"
		);
		machine.scheduler.advanceTo(deadline);
		while (machine.scheduler.hasDueTimer()) {
			machine.runDeviceService(machine.scheduler.popDueTimer());
		}
	}
	require(
		machine.systemController.captureState().supervisorPhase
			== bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR,
		"supervisor entry reaches the exception-vector boundary"
	);
	require(machine.cpu.enterPendingInterrupt(), "pending supervisor NMI enters the system exception root");
	memory.writeMappedU32LE(
		bmsx::IO_SYS_CONTROL,
		bmsx::SYS_CONTROL_SUPERVISOR_ENTER
	);
	machine.systemController.requestSupervisorLineEdge();
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_STATUS)
			== (bmsx::SYS_STATUS_SUPERVISOR_ACTIVE
				| bmsx::SYS_STATUS_SUPERVISOR_EXIT_REQUESTED
				| bmsx::SYS_STATUS_SUPERVISOR_RESUMABLE),
		"second supervisor edge publishes the resumable monitor exit request"
	);

	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_SUPERVISOR_FAULT);

	require(
		memory.readMappedU32LE(bmsx::IO_SYS_STATUS)
			== (bmsx::SYS_STATUS_SUPERVISOR_ACTIVE
				| bmsx::SYS_STATUS_SUPERVISOR_EXIT_REQUESTED
				| bmsx::SYS_STATUS_SUPERVISOR_RESUMABLE),
		"nested supervisor fault preserves the pending exit request"
	);
	require(
		machine.systemController.supervisorContextActive(),
		"source sampling remains in supervisor context before the leave fence"
	);
	memory.writeMappedU32LE(
		bmsx::IO_SYS_CONTROL,
		bmsx::SYS_CONTROL_SUPERVISOR_LEAVE
	);
	require(
		machine.systemController.supervisorContextActive(),
		"source sampling remains in supervisor context during the leave fence"
	);
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 16u && machine.systemController.supervisorContextActive();
		serviceCount += 1u) {
		const bmsx::i64 deadline = machine.scheduler.nextDeadline();
		require(
			deadline != std::numeric_limits<bmsx::i64>::max(),
			"supervisor leave retains a device-service deadline"
		);
		machine.scheduler.advanceTo(deadline);
		while (machine.scheduler.hasDueTimer()) {
			machine.runDeviceService(machine.scheduler.popDueTimer());
		}
	}
	require(
		!machine.systemController.supervisorContextActive(),
		"source sampling returns to normal after the leave fence"
	);
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
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 1'317'011u,
		"reset PAL timing exposes its unsigned Q16.16 frame period"
	);
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

void testSystemFrameMillisecondsQ16WordWidth() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input, bmsx::PSX_MACHINE_SPEC);
	machine.resetDevices();

	constexpr std::array<bmsx::u32, 10> timingWords{{
		0x00000c0fu, 0x00000010u, 0x00000000u, 0x00000000u,
		0x003fffffu, 0x07fff800u, 0x07ffffffu, 0x00000000u,
		0xffffffffu, 0xffffffffu,
	}};
	for (bmsx::u32 index = 0u; index < timingWords.size(); ++index) {
		memory.writeMappedU32LE(
			bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW + index),
			timingWords[index]
		);
	}
	const bmsx::GxGpuPcrtcTiming& timing = machine.gxGpu.readPcrtcTiming();
	require(timing.running, "maximum timing fields retain a running PCRTC");
	require(timing.refreshUfpsScaled == 312, "maximum timing fields produce 312 microhertz");
	require(
		timing.frameDurationMillisecondsQ16 == 3'892'851'843u,
		"retained Q16.16 period contains the low word of 210051282051"
	);
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 3'892'851'843u,
		"system frame MMIO exposes the wrapped Q16.16 word"
	);
	require(
		memory.readMappedWord(bmsx::IO_SYS_FRAME_MS_Q16) == 3'892'851'843u,
		"system frame word reads retain the same unsigned Q16.16 bits"
	);
	require(
		timing.frameDurationMs == 3'205'128.205128205,
		"floating frame duration retains the full period independently of the Q16.16 word"
	);
	const bmsx::GxGpuState state = machine.gxGpu.captureState();
	const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode1Address, timingWords[0] | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
	require(memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 0u, "stopping extreme timing drives zero frame duration");
	require(timing.frameDurationMs == 0.0, "stopping extreme timing clears the floating frame duration");
	memory.writeMappedU32LE(smode1Address, timingWords[0]);
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 3'892'851'843u,
		"resuming extreme timing reconstructs the same raw Q16.16 word"
	);
	require(timing.frameDurationMs == 3'205'128.205128205, "resuming extreme timing restores the full floating period");

	machine.resetDevices();
	require(memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 1'317'011u, "device reset restores the PAL Q16.16 word");
	machine.gxGpu.restoreState(state);
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 3'892'851'843u,
		"GPU state restore reconstructs the raw Q16.16 word from timing registers"
	);
	require(timing.refreshUfpsScaled == 312, "GPU state restore reconstructs the retained refresh rate");
	require(timing.frameDurationMs == 3'205'128.205128205, "GPU state restore retains the full floating period");

	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_LOW), 0u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_HIGH), 0x00039800u);
	require(timing.refreshUfpsScaled == 15'277, "230 display lines produce the refresh rate below the Q16.16 wrap boundary");
	require(timing.frameDurationMillisecondsQ16 == 4'289'847'483u, "retained Q16.16 period preserves the unsigned word below the boundary");
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 4'289'847'483u,
		"a Q16.16 period below the word boundary retains its unsigned high bit"
	);
	require(memory.readMappedWord(bmsx::IO_SYS_FRAME_MS_Q16) == 4'289'847'483u, "frame word reads retain the unsigned high bit below the boundary");
	require(timing.frameDurationMs == 65'457.877855599916, "floating period remains unwrapped below the Q16.16 boundary");
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_HIGH), 0x00039c00u);
	require(timing.refreshUfpsScaled == 15'211, "231 display lines produce the refresh rate above the Q16.16 wrap boundary");
	require(timing.frameDurationMillisecondsQ16 == 13'493'686u, "retained Q16.16 period wraps to the low word above the boundary");
	require(
		memory.readMappedU32LE(bmsx::IO_SYS_FRAME_MS_Q16) == 13'493'686u,
		"a Q16.16 period above the word boundary wraps instead of saturating"
	);
	require(memory.readMappedWord(bmsx::IO_SYS_FRAME_MS_Q16) == 13'493'686u, "frame word reads expose the wrapped low word above the boundary");
	require(timing.frameDurationMs == 65'741.8973111564, "floating period remains unwrapped above the Q16.16 boundary");
}

void testSystemPrintRegisters() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input, bmsx::PSX_MACHINE_SPEC);
	machine.resetDevices();
	bmsx::SystemDebugTransmit& output = machine.systemDebugTransmit;

	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x68u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x69u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(output.availableByteCount() == 3u, "system print flush publishes one complete host line");
	require(output.readByte() == 0x68u, "host output retains the first byte");
	require(output.readByte() == 0x69u, "host output retains the second byte");
	require(output.readByte() == 0x0au, "host output terminates the completed line");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x69u, "system print character register retains the last written word");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == 1u, "system print flush register retains the last written word");

	const bmsx::SystemDebugTransmitState state = output.captureState();
	output.reset();
	output.restoreState(state);
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x69u, "save-state restores the character latch");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH) == 1u, "save-state restores the flush latch");
	require(output.availableByteCount() == 0u, "save-state restore clears non-serialized host output");

	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x20acu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(output.availableByteCount() == 4u, "system print encodes a Unicode codepoint before host transport");
	require(output.readByte() == 0xe2u, "host output retains UTF-8 byte one");
	require(output.readByte() == 0x82u, "host output retains UTF-8 byte two");
	require(output.readByte() == 0xacu, "host output retains UTF-8 byte three");
	require(output.readByte() == 0x0au, "host UTF-8 output terminates the completed line");
	require(memory.readMappedU32LE(bmsx::IO_SYS_PRINT_CHAR) == 0x20acu, "system print character latch retains the raw codepoint word");

	output.reset();
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x6fu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x6bu);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	for (bmsx::u32 index = 0u; index < bmsx::SYS_PRINT_BUFFER_BYTES; ++index) {
		memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x78u);
	}
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(output.availableByteCount() == 3u, "host output overflow preserves complete pending lines");
	require(output.readByte() == 0x6fu, "host output overflow retains the first pending byte");
	require(output.readByte() == 0x6bu, "host output overflow retains the second pending byte");
	require(output.readByte() == 0x0au, "host output overflow retains the pending newline");
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_CHAR, 0x79u);
	memory.writeMappedU32LE(bmsx::IO_SYS_PRINT_FLUSH, 1u);
	require(output.availableByteCount() == 2u, "host output accepts the line after an overflowed line");
	require(output.readByte() == 0x79u, "host output retains the line after overflow");
	require(output.readByte() == 0x0au, "host output terminates the line after overflow");
}

void testRuntimeSystemRebootBoundary() {
	const bmsx::u32 cartridgeStartupAddress = bmsx::test::blua32TestFunctionAddress(
		bmsx::RomImageDomain::Cartridge,
		0u
	);
	SystemRuntimeFixture fixture(
		makeSystemTransferImage(cartridgeStartupAddress),
		makeRuntimeImage(bmsx::OpCode::RET),
		std::nullopt, 2u * bmsx::IO_WORD_SIZE
	);
	bmsx::Runtime& runtime = fixture.runtime;

	auto& machine = runtime.machine;
	auto& cpu = machine.cpu;
	auto& memory = machine.memory;
	require(cpu.rootThread()->address == bmsx::CPU_RESET_BANK_ADDRESS
		&& cpu.heapAllocator().occupiedBytes() == 0u, "physical boot begins in the reset bank without a language heap");
	const auto boot = machine.executionAddressSpace.resolveSystemDomain();
	const bmsx::u32 cold = bmsx::test::provisionManagedFixture(cpu, boot.staticEnd);
	const bmsx::u32 warm = bmsx::test::allocateThreadRecordReference(cpu, 0u);
	// Initial physical test data; neither context is selected by the host.
	const bmsx::u32 pc = fixture.systemRom.textAddress;
	const bmsx::FrameEntryControl entry{
		fixture.systemRom.functionAddresses[0], pc, pc, bmsx::frameBankWord(bmsx::SYSTEM_EXECUTION_DOMAIN_ID),
		0, 0, {}, 0, 0u, 0, 1,
	};
	for (const bmsx::u32 context : {cold, warm}) {
		using bmsx::ThreadField;
		const bmsx::u32 frame = bmsx::ThreadRecord::storageLayout(memory, context).frameAddress(0u);
		entry.writeWords([&](bmsx::FrameField field, bmsx::u32 word) {
			memory.writeRamRecordWord(frame + static_cast<bmsx::u32>(field), word);
		});
		memory.writeRamRecordWord(context + static_cast<bmsx::u32>(ThreadField::Status), static_cast<bmsx::u32>(bmsx::ThreadStatus::Running));
		memory.writeRamRecordWord(context + static_cast<bmsx::u32>(ThreadField::StackTop), 1u);
		memory.writeRamRecordWord(context + static_cast<bmsx::u32>(ThreadField::FrameDepth), 1u);
	}
	memory.writeRamRecordPair(REBOOT_CONTEXT_MAILBOX, cold, warm);
	memory.setRamBusEnd(bmsx::DYNAMIC_RAM_BASE);

	bmsx::FrameSchedulerState& frameScheduler = runtime.frameScheduler;
	const bmsx::f64 frameDurationMs = runtime.timing.frameDurationMs;
	const auto runToCartridge = [&] {
		for (int frame = 0; frame < 2 && !cpu.isCartridgeExecutionActive(); ++frame)
			frameScheduler.run(runtime, frameDurationMs);
		require(cpu.isCartridgeExecutionActive(), "system firmware transfers through CP0.EXEC to the selected cartridge");
	};
	runToCartridge();
	require(cpu.rootThread()->address == cold, "cold raw firmware selected the first context");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	frameScheduler.run(runtime, frameDurationMs);
	require(!cpu.isCartridgeExecutionActive() && cpu.rootThread()->address == bmsx::CPU_RESET_BANK_ADDRESS,
		"system reset restarts physical system firmware before cartridge execution");
	require(cpu.captureRuntimeState().previousRootContextWord == cold, "reset retains the original context address");
	require(!runtime.machine.systemController.captureState().resetRequested, "runtime boundary consumes the system reset latch");
	require(frameScheduler.lastTickSequence == 0, "system reset clears scheduler sequence state");

	runToCartridge();
	require(cpu.rootThread()->address == warm && cpu.captureRuntimeState().previousRootContextWord == 0u,
		"warm raw firmware selects its own prepared context before restarting the cartridge");
}

void testUnexecutedSecondCartridgeDoesNotAlterGuestIdentity() {
	bmsx::test::Blua32TestImage unusedCart = makeClosureCartImage(222, true);
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

	single.seedLanguageState();
	dual.seedLanguageState();
	bmsx::CPU& singleCpu = single.runtime.machine.cpu;
	bmsx::CPU& dualCpu = dual.runtime.machine.cpu;
	require(
		singleCpu.stringPool().intern("post-boot-probe")
			== dualCpu.stringPool().intern("post-boot-probe"),
		"an unexecuted second cartridge does not allocate guest string ids"
	);
	require(
		bmsx::test::allocateTableReference(singleCpu).address() == bmsx::test::allocateTableReference(dualCpu).address(),
		"an unexecuted second cartridge does not allocate guest object ids"
	);

	dual.cart1Rom.bytes[dual.cart1Rom.boot.imageOffset] ^= 0xffu;
	dual.runtime.rebootSystem();
}

void testGuestExecutionSelectionAndClosureIdentitySurviveTheSaveStateWireFormat() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111, true),
		makeClosureCartImage(222, true)
	);
	fixture.seedLanguageState();
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	// The image-switch test begins with both operand banks already prepared.
	cpu.replaceExecutionImage(*runtime.machine.executionAddressSpace.resolveDomain(0));
	cpu.replaceExecutionImage(*runtime.machine.executionAddressSpace.resolveDomain(1));
	bmsx::test::seedTestRomClosure(cpu, fixture.cartRom.functionAddresses[1], 0);
	bmsx::test::seedTestRomClosure(cpu, fixture.cart1Rom.functionAddresses[1], 1);
	const bmsx::StringId publishedClosureName =
		cpu.stringPool().intern(TEST_CARTRIDGE_CLOSURE_GLOBAL);
	const bmsx::StringId publishedValueName =
		cpu.stringPool().intern(TEST_CARTRIDGE_VALUE_GLOBAL);

	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system reset firmware enters the selected cartridge through CP0.EXEC");
	require(cpu.activeCartridgeSlot() == 0, "CP0.EXEC latches physically selected cartridge slot 0");
	const bmsx::Value slot0ClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::u32 slot0Closure = bmsx::asClosure(slot0ClosureValue, cpu.gcHeap());
	require(cpu.readClosureBinding(slot0Closure).executionDomainId == 0, "slot 0 closure binds its execution domain");
	require(cpu.getGlobalByKey(publishedValueName) == bmsx::valueInteger(111), "slot 0 startup executes its published closure");
	const bmsx::StringId savedClosureName = cpu.stringPool().intern("saved_closure");
	const bmsx::StringId closureTableName = cpu.stringPool().intern("closure_table");
	bmsx::TableRecord closureTable = bmsx::test::allocateTableReference(cpu);
	closureTable.set(slot0ClosureValue, bmsx::valueInteger(77));
	cpu.setGlobalByKey(savedClosureName, slot0ClosureValue);
	cpu.setGlobalByKey(closureTableName, bmsx::valueTable(closureTable.address()));

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	require(cpu.readClosureBinding(slot0Closure).executionDomainId == 0, "data selection does not change the closure domain");
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI enters the system execution selector");
	require(cpu.readClosureBinding(slot0Closure).executionDomainId == 0, "entering a system exception does not change the closure domain");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler enters the selected cartridge through CP0.EXEC");
	require(cpu.activeCartridgeSlot() == 1, "CP0.EXEC latches physically selected cartridge slot 1");
	const bmsx::Value slot1ClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::u32 slot1Closure = bmsx::asClosure(slot1ClosureValue, cpu.gcHeap());
	require(slot1Closure != slot0Closure, "different execution domains own distinct canonical closures");
	require(cpu.readClosureBinding(slot1Closure) != cpu.readClosureBinding(slot0Closure)
		&& cpu.readClosureBinding(slot1Closure).functionAddress == cpu.readClosureBinding(slot0Closure).functionAddress, "same mapped address in different cartridge domains retains separate prototypes");
	require(cpu.readClosureBinding(slot1Closure).executionDomainId == 1, "slot 1 closure binds its execution domain");
	require(closureTable.get(slot0ClosureValue) == bmsx::valueInteger(77) && bmsx::isNil(closureTable.get(slot1ClosureValue)),
		"closure table keys retain their own execution domain");
	require(cpu.getGlobalByKey(publishedValueName) == bmsx::valueInteger(222), "slot 1 startup executes the canonical closure against slot 1 code");
	require(runtime.callClosure(slot0Closure).get(0) == bmsx::valueInteger(111), "slot 0 closure executes its bound socket while slot 1 is active");
	require(runtime.callClosure(slot1Closure).get(0) == bmsx::valueInteger(222), "slot 1 closure executes its bound socket");
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	require(
		cpu.activeCartridgeSlot() == 1,
		"data-bus cartridge selection does not replace the post-unwind execution domain"
	);
	require(cpu.readClosureBinding(slot0Closure).executionDomainId == 0, "data and execution selection do not redirect the slot 0 closure");

	const std::vector<bmsx::u8> saveBytes =
		bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler can switch execution back to slot 0");
	require(
		cpu.getGlobalByKey(publishedValueName) == bmsx::valueInteger(111),
		"slot 0 supplies the code behind the raw closure address"
	);

	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			saveBytes,
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	const bmsx::Value restoredClosureValue = cpu.getGlobalByKey(savedClosureName);
	bmsx::TableRecord restoredTable = bmsx::asTable(cpu.getGlobalByKey(closureTableName), cpu.gcHeap());
	require(bmsx::asClosure(restoredClosureValue, cpu.gcHeap()) == slot0Closure, "wire restore preserves canonical static closure identity");
	require(restoredTable.get(restoredClosureValue) == bmsx::valueInteger(77), "wire restore preserves closure-keyed table entries");
	bmsx::u32 restoredPublished = bmsx::asClosure(cpu.getGlobalByKey(publishedClosureName), cpu.gcHeap());
	require(restoredPublished != slot0Closure && cpu.readClosureBinding(restoredPublished).executionDomainId == 1, "wire restore preserves the distinct slot 1 closure");
	require(cpu.activeCartridgeSlot() == 1, "wire restore preserves slot 1 as the physical execution source");
	require(cpu.readClosureBinding(bmsx::asClosure(restoredClosureValue, cpu.gcHeap())).executionDomainId == 0, "wire restore retains the slot 0 closure's domain");
	require(
		cpu.getGlobalByKey(publishedValueName) == bmsx::valueInteger(222),
		"wire restore preserves the slot 1 closure result"
	);
	require(runtime.callClosure(bmsx::asClosure(restoredClosureValue, cpu.gcHeap())).get(0) == bmsx::valueInteger(111), "restored slot 0 closure executes slot 0 code");
	require(runtime.callClosure(restoredPublished).get(0) == bmsx::valueInteger(222), "restored slot 1 closure executes slot 1 code");
}

void seedDynamicClosureAtCartStartup(SystemRuntimeFixture& fixture) {
	auto& cpu = fixture.runtime.machine.cpu;
	auto startup = fixture.cartRom.textAddress;
	cpu.setExecutionHook({
		.hook = [](void* context, bmsx::ExecutionDomainId, bmsx::u32 pc) {
			return pc == *static_cast<const bmsx::u32*>(context);
		},
		.context = &startup, .domainMask = bmsx::executionDomainBit(0),
	});
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::ExecutionStopped, "stop at served cart startup before publication");
	cpu.setExecutionHook({});
	std::array<bmsx::u32, 1> cells{};
	const auto record = bmsx::test::seedTestCapturedClosure(cpu, fixture.cartRom.functionAddresses[1], cells, {}, 0);
	cpu.activeThread()->currentFrame->registers.set(0, bmsx::valueClosure(record));
}

void testDistinctNonStaticClosuresRemainDistinctTableKeysThroughTheSaveStateWireFormat() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111, false)
	);
	fixture.seedLanguageState();
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	cpu.replaceExecutionImage(*runtime.machine.executionAddressSpace.resolveDomain(0));
	const bmsx::StringId publishedClosureName =
		cpu.stringPool().intern(TEST_CARTRIDGE_CLOSURE_GLOBAL);

	seedDynamicClosureAtCartStartup(fixture);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cartridge startup publishes the first non-static closure");
	const bmsx::Value firstClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::u32 firstClosure = bmsx::asClosure(firstClosureValue, cpu.gcHeap());
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	seedDynamicClosureAtCartStartup(fixture);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cartridge startup publishes the second non-static closure");
	const bmsx::Value secondClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::u32 secondClosure = bmsx::asClosure(secondClosureValue, cpu.gcHeap());
	require(firstClosure != secondClosure, "non-static closure creation retains object identity");
	require(cpu.readClosureBinding(firstClosure) == cpu.readClosureBinding(secondClosure), "distinct non-static closures retain the same published function binding");

	const bmsx::StringId firstName = cpu.stringPool().intern("first_closure");
	const bmsx::StringId secondName = cpu.stringPool().intern("second_closure");
	const bmsx::StringId tableName = cpu.stringPool().intern("closure_table");
	bmsx::TableRecord closureTable = bmsx::test::allocateTableReference(cpu);
	closureTable.set(firstClosureValue, bmsx::valueInteger(11));
	closureTable.set(secondClosureValue, bmsx::valueInteger(22));
	cpu.setGlobalByKey(firstName, firstClosureValue);
	cpu.setGlobalByKey(secondName, secondClosureValue);
	cpu.setGlobalByKey(tableName, bmsx::valueTable(closureTable.address()));

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
	bmsx::u32 restoredFirst = bmsx::asClosure(restoredFirstValue, cpu.gcHeap());
	bmsx::u32 restoredSecond = bmsx::asClosure(restoredSecondValue, cpu.gcHeap());
	bmsx::TableRecord restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName), cpu.gcHeap());
	require(restoredFirst != restoredSecond, "wire restore retains distinct non-static closure identities");
	require(cpu.readClosureBinding(restoredFirst) == cpu.readClosureBinding(restoredSecond), "wire restore preserves the common published function binding");
	require(restoredTable.get(restoredFirstValue) == bmsx::valueInteger(11), "wire restore retains the first closure table key");
	require(restoredTable.get(restoredSecondValue) == bmsx::valueInteger(22), "wire restore retains the second closure table key");
}

void testMixedStaticAndNonStaticCartridgeClosuresKeepIdentityAcrossEitherSaveStateLatch() {
	SystemRuntimeFixture fixture(
		makeExecutionSelectorSystemImage(),
		makeClosureCartImage(111, false),
		makeClosureCartImage(222, true)
	);
	fixture.seedLanguageState();
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	cpu.replaceExecutionImage(*runtime.machine.executionAddressSpace.resolveDomain(0));
	cpu.replaceExecutionImage(*runtime.machine.executionAddressSpace.resolveDomain(1));
	bmsx::test::seedTestRomClosure(cpu, fixture.cart1Rom.functionAddresses[1], 1);
	const bmsx::StringId publishedClosureName =
		cpu.stringPool().intern(TEST_CARTRIDGE_CLOSURE_GLOBAL);

	seedDynamicClosureAtCartStartup(fixture);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "slot 0 publishes the dynamic closure");
	const bmsx::Value dynamicClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::u32 dynamicClosure = bmsx::asClosure(dynamicClosureValue, cpu.gcHeap());
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "slot 1 publishes the canonical closure");
	const bmsx::Value canonicalClosureValue = cpu.getGlobalByKey(publishedClosureName);
	bmsx::u32 canonicalClosure = bmsx::asClosure(canonicalClosureValue, cpu.gcHeap());
	require(dynamicClosure != canonicalClosure, "mixed cartridge closure modes retain distinct object identities");
	require(cpu.readClosureBinding(dynamicClosure).functionAddress == cpu.readClosureBinding(canonicalClosure).functionAddress, "mixed cartridge closure modes share one raw address");

	const bmsx::StringId dynamicName = cpu.stringPool().intern("dynamic_closure");
	const bmsx::StringId canonicalName = cpu.stringPool().intern("canonical_closure");
	const bmsx::StringId tableName = cpu.stringPool().intern("mixed_closure_table");
	bmsx::TableRecord closureTable = bmsx::test::allocateTableReference(cpu);
	closureTable.set(dynamicClosureValue, bmsx::valueInteger(11));
	closureTable.set(canonicalClosureValue, bmsx::valueInteger(22));
	cpu.setGlobalByKey(dynamicName, dynamicClosureValue);
	cpu.setGlobalByKey(canonicalName, canonicalClosureValue);
	cpu.setGlobalByKey(tableName, bmsx::valueTable(closureTable.address()));

	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime)),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	bmsx::Value restoredDynamicValue = cpu.getGlobalByKey(dynamicName);
	bmsx::Value restoredCanonicalValue = cpu.getGlobalByKey(canonicalName);
	bmsx::TableRecord restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName), cpu.gcHeap());
	require(bmsx::asClosure(restoredDynamicValue, cpu.gcHeap()) != bmsx::asClosure(restoredCanonicalValue, cpu.gcHeap()), "slot 1 wire restore retains mixed closure identities");
	require(restoredTable.get(restoredDynamicValue) == bmsx::valueInteger(11), "slot 1 wire restore retains the dynamic closure key");
	require(restoredTable.get(restoredCanonicalValue) == bmsx::valueInteger(22), "slot 1 wire restore retains the canonical closure key");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	seedDynamicClosureAtCartStartup(fixture);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler switches the execution latch to the non-static cartridge");
	bmsx::applyRuntimeSaveState(
		runtime,
		bmsx::decodeRuntimeSaveState(
			bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime)),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	restoredDynamicValue = cpu.getGlobalByKey(dynamicName);
	restoredCanonicalValue = cpu.getGlobalByKey(canonicalName);
	restoredTable = bmsx::asTable(cpu.getGlobalByKey(tableName), cpu.gcHeap());
	require(bmsx::asClosure(restoredDynamicValue, cpu.gcHeap()) != bmsx::asClosure(restoredCanonicalValue, cpu.gcHeap()), "slot 0 wire restore retains mixed closure identities");
	require(restoredTable.get(restoredDynamicValue) == bmsx::valueInteger(11), "slot 0 wire restore retains the dynamic closure key");
	require(restoredTable.get(restoredCanonicalValue) == bmsx::valueInteger(22), "slot 0 wire restore retains the canonical closure key");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);
	cpu.requestNonMaskableInterrupt();
	require(cpu.enterPendingInterrupt(), "physical NMI re-enters the system execution selector");
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "system NMI handler switches the execution latch back to the static cartridge");
	const bmsx::Value futureCanonicalValue = cpu.getGlobalByKey(publishedClosureName);
	require(bmsx::asClosure(futureCanonicalValue, cpu.gcHeap()) == bmsx::asClosure(restoredCanonicalValue, cpu.gcHeap()), "future static closure creation reuses the restored canonical identity");
	require(restoredTable.get(futureCanonicalValue) == bmsx::valueInteger(22), "future canonical closure remains the restored table key");
}

void testCompletionCallReturnLatchSurvivesSaveStateAndGc() {
	SystemRuntimeFixture fixture(
		makeCompletionLatchSystemImage(),
		makeRuntimeImage(bmsx::OpCode::RET)
	);
	fixture.seedLanguageState();
	bmsx::CPU& cpu = fixture.runtime.machine.cpu;
	bmsx::test::seedTestRomClosure(cpu, fixture.systemRom.functionAddresses[1]);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "completion-latch startup returns its callable closure");
	bmsx::u32 closure = bmsx::asClosure(cpu.readCompletionValues().get(0), cpu.gcHeap());
	const bmsx::StringId closureKey = cpu.stringPool().intern("completion_call");
	cpu.setGlobalByKey(closureKey, bmsx::valueClosure(closure));

	const bmsx::Value argument = bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address());
	cpu.beginCompletionCall(closure, bmsx::BuiltinArgsView(&argument, 1));
	require(cpu.runUntilDepth(0, 1) == bmsx::RunResult::Yielded, "completion call remains in flight before RET");
	const bmsx::CpuRuntimeState state = cpu.captureRuntimeState();
	require(
		cpu.getFrameDepth() == 1u && cpu.rootThread()->currentFrame->hasControlFlag(bmsx::FRAME_COMPLETION),
		"save-state retains the physical completion-latch return route"
	);

	cpu.restoreRuntimeState(state);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "restored completion call returns through its retained route");
	bmsx::TableRecord restoredTable = bmsx::asTable(cpu.readCompletionValues().get(0), cpu.gcHeap());
	cpu.collectHeap();
	require(bmsx::valuePayload(cpu.readCompletionValues().get(0)) == restoredTable.address(), "completion latch roots its restored heap result");

	bmsx::u32 restoredClosure = bmsx::asClosure(cpu.getGlobalByKey(closureKey), cpu.gcHeap());
	const bmsx::Value nextArgument = bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address());
	const bmsx::ConstValueSpan results = fixture.runtime.callClosure(restoredClosure, bmsx::BuiltinArgsView(&nextArgument, 1));
	const auto latch = cpu.readCompletionValues();
	require(results.words() == latch.words() && results.tags() == latch.tags(), "Runtime borrows the CPU completion latch without copying");
	bmsx::TableRecord borrowedTable = bmsx::asTable(results.get(0), cpu.gcHeap());
	cpu.collectHeap();
	require(bmsx::valuePayload(results.get(0)) == borrowedTable.address(), "borrowed completion results remain rooted by the CPU latch");
}

void testCpuAbortsPhysicalCompletionCallAtMarkedRoot() {
	SystemRuntimeFixture fixture(
		makeCompletionLatchSystemImage(),
		makeRuntimeImage(bmsx::OpCode::RET)
	);
	fixture.seedLanguageState();
	bmsx::CPU& cpu = fixture.runtime.machine.cpu;
	bmsx::test::seedTestRomClosure(cpu, fixture.systemRom.functionAddresses[1]);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "completion-latch startup returns its callable closure");
	bmsx::u32 closure = bmsx::asClosure(cpu.readCompletionValues().get(0), cpu.gcHeap());
	const int completionFrameIndex = cpu.getFrameDepth();
	cpu.beginCompletionCall(closure);
	cpu.beginCompletionCall(closure);

	require(cpu.readFrameReturnsToCompletionLatch(completionFrameIndex), "completion root retains its raw return latch");
	require(cpu.readFrameReturnsToCompletionLatch(completionFrameIndex + 1), "later completion root retains its raw return latch");
	require(cpu.completionCallPending(), "completion call is physically pending");
	cpu.abortCompletionCall(completionFrameIndex);
	require(cpu.getFrameDepth() == completionFrameIndex, "completion root and later completion frames are discarded");
	require(!cpu.completionCallPending(), "completion root latch is no longer live");
	require(cpu.readCompletionValues().size() == 0, "completion value latch is cleared");
}

void testSuspendedCompletionReturnsAtPhysicalCpuHold() {
	SystemRuntimeFixture fixture(
		makeCompletionLatchSystemImage(),
		makeRuntimeImage(bmsx::OpCode::RET)
	);
	fixture.seedLanguageState();
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::CPU& cpu = runtime.machine.cpu;
	bmsx::test::seedTestRomClosure(cpu, fixture.systemRom.functionAddresses[1]);
	require(cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "completion-latch startup returns its callable closure");
	bmsx::u32 closure = bmsx::asClosure(cpu.readCompletionValues().get(0), cpu.gcHeap());
	const bmsx::StringId closureKey = cpu.stringPool().intern("held_completion_call");
	cpu.setGlobalByKey(closureKey, bmsx::valueClosure(closure));

	runtime.machine.scheduler.reset();
	bmsx::SystemControllerState systemState = runtime.machine.systemController.captureState();
	systemState.supervisorPhase = bmsx::SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE;
	systemState.supervisorTransitionTarget = bmsx::SYSTEM_SUPERVISOR_TARGET_FAULT;
	runtime.machine.systemController.restoreState(systemState);
	runtime.machine.scheduler.scheduleDeviceService(bmsx::DEVICE_SERVICE_SYSTEM, 7);
	const int baseDepth = cpu.getFrameDepth();
	cpu.beginCompletionCall(bmsx::asClosure(cpu.getGlobalByKey(closureKey), cpu.gcHeap()));

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
		+ bmsx::BASE_CYCLES[static_cast<size_t>(bmsx::OpCode::RET)];

	std::vector<std::array<bmsx::i64, 2>> accepted;
	fixture.runtime.machine.gxGte.setPlusObserver({
		.accepted = [](void* context, bmsx::u32, bmsx::MappedBusSignals, bmsx::i64 cycle, bmsx::i64 deadline,
			const std::array<bmsx::u32, bmsx::GX_GTE_PLUS_REGISTER_COUNT>&) {
			static_cast<std::vector<std::array<bmsx::i64, 2>>*>(context)->push_back({cycle, deadline});
		},
		.context = &accepted,
	});
	const bmsx::ConstValueSpan out = fixture.runtime.callClosure(fixture.closures[0]);
	fixture.runtime.machine.gxGte.setPlusObserver({});
	require(accepted == std::vector<std::array<bmsx::i64, 2>>{{cycleBefore + 7, cycleBefore + 12}, {cycleBefore + 12, cycleBefore + 17}},
		"both commands are admitted exactly once, with the retained retry accepted at the first completion edge without another store base");

	require(fixture.runtime.machine.scheduler.nowCycles() == cycleBefore + expectedCycles, "external closure advances through the scheduled GTE completion deadline");
	require(!fixture.cpu.isMemoryWriteBlocked(), "GTE completion releases the blocked external-closure store");
	require(fixture.cpu.getFrameDepth() == 1, "external closure preserves the suspended firmware frame after the GTE write interlock");
	require(!fixture.runtime.machine.scheduler.isCpuSliceActive(), "external closure completion ends its CPU scheduler slice");
	require(out.size() == 0, "GTE interlock closure returns no values");
	require(
		fixture.runtime.machine.memory.readMappedU32LE(
			bmsx::IO_GX_GTE_PLUS_BASE
				+ bmsx::GX_GTE_PLUS_CYCLES * bmsx::IO_WORD_SIZE
		)
			== bmsx::GX_GTE_PLUS_CYCLES_VMAD3,
		"external closure admits the second command at the first completion edge and its six-cycle RET outlasts the second command"
	);
}

void testExternalClosureVectorsPendingNmiThroughCpuEntry() {
	ExternalClosureFixture fixture;
	const bmsx::i64 cycleBefore = fixture.runtime.machine.scheduler.nowCycles();
	fixture.cpu.requestNonMaskableInterrupt();

	const bmsx::ConstValueSpan out = fixture.runtime.callClosure(fixture.closures[1]);

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
	require(out.size() == 0, "external return closure publishes no values");
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

void testRuntimeCodecRestoresBlockedGp0StoreWakeup() {
	bmsx::test::Blua32TestImage image;
	image.text.resize(5u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 1);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM_D), 1, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE));
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {{.firstWord=0u, .wordCount=4u, .maxStack=2u}, {.firstWord=4u, .wordCount=1u}};
	image.constants.emplace_back(static_cast<bmsx::i32>(bmsx::IO_GX_GPU_GP0));
	image.constants.emplace_back(static_cast<bmsx::i32>(0x1f000000u));
	image.irqFunctionIndex = 1u;
	image.exceptionFunctionIndex = 1u;
	SystemRuntimeFixture fixture(image, makeRuntimeImage(bmsx::OpCode::HALT));
	auto& runtime = fixture.runtime;
	auto& machine = runtime.machine;
	auto& memory = machine.memory;
	auto& scheduler = machine.scheduler;
	auto& cpu = machine.cpu;
	auto& gpu = machine.gxGpu;
	const bmsx::u32 mode = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(scheduler.currentNowCycles());
	for (const bmsx::u32 word : {0x020000ffu, 0u, 0x00010001u}) gpu.writeGp0(word);
	for (bmsx::u32 index = 0; index < bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY; ++index) gpu.writeGp0(0xe1000000u);
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "full GP0 FIFO blocks CPU writes");
	require(scheduler.runCpuSlice(0, 20) == bmsx::RunResult::Halted && cpu.isMemoryWriteBlocked(), "CPU blocks on a GP0 store");
	scheduler.advanceTo(20 - cpu.instructionBudgetRemaining);
	const auto saved = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
	const auto advance = [&](bmsx::i64 cycle) {
		while (scheduler.nextDeadline() <= cycle) {
			const bmsx::i64 deadline = scheduler.nextDeadline();
			scheduler.advanceTo(deadline);
			require(scheduler.popDueTimer() == bmsx::DEVICE_SERVICE_GPU, "scheduled GPU wakeup service");
			gpu.onService(deadline);
		}
		scheduler.advanceTo(cycle);
	};
	for (int iteration = 0; iteration < 2; ++iteration) {
		if (iteration != 0) bmsx::applyRuntimeSaveState(runtime, bmsx::decodeRuntimeSaveState(saved, memory.ramByteCount(), gpu.readVramSnapshotBytes().size()));
		advance(28);
		require(cpu.isMemoryWriteBlocked() && (memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == 0u, "CPU remains blocked before completion");
		advance(29);
		require(!cpu.isMemoryWriteBlocked() && (memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == 0u, "GPU completion wakes the CPU before the write");
		for (int attempt = 0; attempt < 4 && cpu.getFrameDepth() > 0; ++attempt) scheduler.runCpuSlice(0, 20);
		require(cpu.getFrameDepth() == 0 && !cpu.isMemoryWriteBlocked(), "blocked store and return retire");
		advance(44);
		require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == 0u, "queued IRQ is not early");
		advance(45);
		require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == bmsx::IRQ_GPU, "queued IRQ fires at its boundary");
	}
}

void testGeoDmaSameCycleRuntimeRestore() {
	constexpr bmsx::u32 records = bmsx::DYNAMIC_RAM_BASE + 0x1000u;
	constexpr bmsx::u32 source = bmsx::DYNAMIC_RAM_BASE + 0x2000u;
	constexpr bmsx::u32 transferWords = 23u;
	SystemRuntimeFixture fixture(source + transferWords * bmsx::IO_WORD_SIZE - bmsx::DYNAMIC_RAM_BASE);
	auto& runtime = fixture.runtime;
	auto& machine = runtime.machine;
	auto& memory = machine.memory;
	const auto boot = machine.executionAddressSpace.resolveSystemDomain();
	memory.setRamBusEnd(bmsx::RAM_BASE + machine.cpu.heapAllocator().floorOffset(boot.staticEnd));
	for (bmsx::u32 i = 0; i < 10u; ++i) {
		const bmsx::u32 record = records + i * bmsx::GEO_XFORM2_RECORD_BYTES;
		for (bmsx::u32 offset = 0; offset < bmsx::GEO_XFORM2_RECORD_BYTES; offset += 4u) memory.writeU32(record + offset, 0);
		memory.writeU32(record + bmsx::GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, bmsx::GEO_INDEX_NONE);
	}
	memory.writeU32(source, 1u);
	memory.writeMappedWord(bmsx::IO_GEO_SRC0, records);
	memory.writeMappedWord(bmsx::IO_GEO_SRC1, records + 0x100u);
	memory.writeMappedWord(bmsx::IO_GEO_SRC2, records + 0x200u);
	memory.writeMappedWord(bmsx::IO_GEO_DST0, records + 0x300u);
	memory.writeMappedWord(bmsx::IO_GEO_DST1, 0u);
	memory.writeMappedWord(bmsx::IO_GEO_COUNT, 10u);
	memory.writeMappedWord(bmsx::IO_GEO_PARAM0, 0u);
	memory.writeMappedWord(bmsx::IO_GEO_PARAM1, 0u);
	memory.writeMappedWord(bmsx::IO_GEO_STRIDE0, bmsx::GEO_XFORM2_RECORD_BYTES);
	memory.writeMappedWord(bmsx::IO_GEO_STRIDE1, bmsx::GEO_VERTEX2_BYTES);
	memory.writeMappedWord(bmsx::IO_GEO_STRIDE2, bmsx::GEO_XFORM2_MATRIX_BYTES);
	memory.writeMappedWord(bmsx::IO_DMA0_READ_ADDR, source);
	memory.writeMappedWord(bmsx::IO_DMA0_WRITE_ADDR, records + 9u * bmsx::GEO_XFORM2_RECORD_BYTES);
	memory.writeMappedWord(bmsx::IO_DMA0_TRANSFER_COUNT, transferWords);
	memory.writeMappedWord(bmsx::IO_DMA0_CONTROL, bmsx::DMA_ROUTE_COPY);
	memory.writeMappedWord(bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH);
	const auto advance = [&](bmsx::i64 target) {
		while (machine.scheduler.nextDeadline() <= target) {
			const auto deadline = machine.scheduler.nextDeadline();
			machine.scheduler.advanceTo(deadline);
			while (machine.scheduler.hasDueTimer()) machine.runDeviceService(machine.scheduler.popDueTimer());
		}
		machine.scheduler.advanceTo(target);
	};
	advance(6);
	memory.writeMappedWord(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(machine.dmaController.cpuBusHeld(), "DMA holds CPU during the GEO job");
	advance(52);
	require(machine.scheduler.nextDeadline() == 54, "GEO sampling and DMA publication share the cycle 54 boundary");
	const auto saved = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
	advance(60);
	const std::array<bmsx::u32, 3> first = {memory.readIoU32(bmsx::IO_GEO_STATUS), memory.readIoU32(bmsx::IO_GEO_FAULT), memory.readIoU32(bmsx::IO_IRQ_FLAGS)};
	require(first[0] == bmsx::GEO_STATUS_DONE && first[1] == 0, "GEO reads the record before DMA writes it");
	require(memory.readU32(records + 9u * bmsx::GEO_XFORM2_RECORD_BYTES) == 1u,
		"DMA changed the flags after GEO sampled them at cycle 54");
	bmsx::applyRuntimeSaveState(runtime, bmsx::decodeRuntimeSaveState(saved, memory.ramByteCount(), machine.gxGpu.readVramSnapshotBytes().size()));
	advance(60);
	const std::array<bmsx::u32, 3> replay = {memory.readIoU32(bmsx::IO_GEO_STATUS), memory.readIoU32(bmsx::IO_GEO_FAULT), memory.readIoU32(bmsx::IO_IRQ_FLAGS)};
	require(replay == first, "same-cycle GEO and DMA ordering survives runtime codec restore");
}

} // namespace

int main() {
	testResetCommandLatch();
	testSupervisorFaultPublicationBoundary();
	testSupervisorFaultParksUnreadReadbackAndWireState();
	testNestedSupervisorFaultPreservesExitRequest();
	testSystemTimingRegisters();
	testSystemFrameMillisecondsQ16WordWidth();
	testSystemPrintRegisters();
	testRuntimeSystemRebootBoundary();
	testUnexecutedSecondCartridgeDoesNotAlterGuestIdentity();
	testGuestExecutionSelectionAndClosureIdentitySurviveTheSaveStateWireFormat();
	testDistinctNonStaticClosuresRemainDistinctTableKeysThroughTheSaveStateWireFormat();
	testMixedStaticAndNonStaticCartridgeClosuresKeepIdentityAcrossEitherSaveStateLatch();
	testCompletionCallReturnLatchSurvivesSaveStateAndGc();
	testCpuAbortsPhysicalCompletionCallAtMarkedRoot();
	testSuspendedCompletionReturnsAtPhysicalCpuHold();
	testExternalClosureAdvancesToGteInterlockDeadline();
	testExternalClosureVectorsPendingNmiThroughCpuEntry();
	testRuntimeRestorePreservesInFlightFrameBudget();
	testGeoDmaSameCycleRuntimeRestore();
	testRuntimeCodecRestoresBlockedGp0StoreWakeup();
	testHostDeltaGrantsOneFractionallyRetainedMachineBudget();
	return 0;
}
