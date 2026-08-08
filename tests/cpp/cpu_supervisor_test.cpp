#include "spec/bmsx/io.h"
#include "spec/blua32/cop0.h"
#include "machine/cpu/cpu.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_header.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "machine/scheduler/device.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <cstddef>
#include <span>
#include <stdexcept>
#include <utility>

namespace {

constexpr bmsx::u32 SYSTEM_IRQ_FUNCTION = 0u;
constexpr bmsx::u32 SYSTEM_EXCEPTION_FUNCTION = 1u;
constexpr bmsx::u32 SYSTEM_CP0_FUNCTION = 2u;
constexpr bmsx::u32 SYSTEM_BUS_BURST_FUNCTION = 3u;
constexpr bmsx::u32 EXEC_CART_FUNCTION = 4u;
constexpr bmsx::u32 CART_USER_HALT_FUNCTION = 0u;
constexpr bmsx::u32 CART_IRQ_FUNCTION = 1u;
constexpr bmsx::u32 CART_USER_CP0_FUNCTION = 2u;
constexpr bmsx::u32 CART_USER_BUS_LOAD_FUNCTION = 3u;
constexpr bmsx::u32 CART_COMPLETION_FUNCTION = 4u;
constexpr bmsx::u32 UNMAPPED_ADDRESS = 0x06000000u;
constexpr bmsx::u32 RAM_FUNCTION_ADDRESS = bmsx::DYNAMIC_RAM_BASE + 0x1000u;
constexpr bmsx::u32 RAM_CODE_ADDRESS = RAM_FUNCTION_ADDRESS + 0x100u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

auto makeSupervisorSystemImage(
	bmsx::u32 cartridgeEntryFunction = CART_USER_HALT_FUNCTION,
	std::vector<std::string> globalNames = {},
	std::vector<std::string> systemGlobalNames = {}
) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(16u * bmsx::INSTRUCTION_BYTES);
	image.constants = {
		static_cast<bmsx::f64>(bmsx::IO_SYS_BUS_FAULT_CODE - bmsx::IO_WORD_SIZE),
		static_cast<bmsx::f64>(bmsx::test::blua32TestFunctionAddress(
			bmsx::RomImageDomain::Cartridge,
			cartridgeEntryFunction
		)),
	};
	image.globalNames = std::move(globalNames);
	image.systemGlobalNames = std::move(systemGlobalNames);
	std::span<bmsx::u8> code(image.text);

	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_CAUSE, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_STATUS, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EPC, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::K1), 1, 0, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::K1), 2, 0, 0);
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::K1), 3, 0, 0);
	bmsx::writeInstruction(code, 10, static_cast<bmsx::u8>(bmsx::OpCode::K1), 4, 0, 0);
	bmsx::writeInstruction(code, 11, static_cast<bmsx::u8>(bmsx::OpCode::K1), 5, 0, 0);
	bmsx::writeInstruction(code, 12, static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM_WORDS_D), 1, 0, 5);
	bmsx::writeInstruction(code, 13, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 14, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 1);
	bmsx::writeInstruction(code, 15, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);

	image.functions = {
		{.firstWord = 0u, .wordCount = 1u},
		{.firstWord = 1u, .wordCount = 2u},
		{.firstWord = 3u, .wordCount = 3u},
		{.firstWord = 6u, .wordCount = 8u, .maxStack = 6u},
		{.firstWord = 14u, .wordCount = 2u},
	};
	image.startupFunctionIndex = SYSTEM_IRQ_FUNCTION;
	image.irqFunctionIndex = SYSTEM_IRQ_FUNCTION;
	image.exceptionFunctionIndex = SYSTEM_EXCEPTION_FUNCTION;
	return image;
}

auto makeSupervisorCartImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(12u * bmsx::INSTRUCTION_BYTES);
	image.constants = {
		static_cast<bmsx::f64>(UNMAPPED_ADDRESS),
	};
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_STATUS, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::K1), 1, 0, 0);
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::LOAD_MEM_D), 1, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::Word));
	bmsx::writeInstruction(code, 10, static_cast<bmsx::u8>(bmsx::OpCode::RET), 1, 1, 0);
	bmsx::writeInstruction(code, 11, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 3u},
		{.firstWord = 3u, .wordCount = 1u},
		{.firstWord = 4u, .wordCount = 3u},
		{.firstWord = 7u, .wordCount = 4u, .maxStack = 2u},
		{.firstWord = 11u, .wordCount = 1u},
	};
	image.startupFunctionIndex = CART_USER_HALT_FUNCTION;
	image.irqFunctionIndex = CART_IRQ_FUNCTION;
	image.exceptionFunctionIndex = CART_IRQ_FUNCTION;
	return image;
}

auto makeDecodedPairSystemImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(10u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::K1), 1, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::SHL), 2, 0, 1);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::BXOR), 3, 2, 1);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::ADD), 4, 3, 1);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::SHL), 5, 4, 1);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::SHR), 6, 5, 1);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::BXOR), 7, 6, 1);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 9u, .maxStack = 8u},
		{.firstWord = 9u, .wordCount = 1u},
	};
	image.startupFunctionIndex = 0u;
	image.irqFunctionIndex = 1u;
	image.exceptionFunctionIndex = 1u;
	return image;
}

auto makeCartridgeSelectionSwitchImage(bmsx::OpCode result) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(5u * bmsx::INSTRUCTION_BYTES);
	image.constants = {static_cast<bmsx::f64>(bmsx::IO_CART_SELECT)};
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::K0), 1, 0, 0);
	bmsx::writeInstruction(
		code,
		2,
		static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM_D),
		1,
		0,
		static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE)
	);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(result), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0u, .wordCount = 5u, .maxStack = 2u}};
	return image;
}

struct CpuTestMachine {
	bmsx::test::Blua32TestRom systemRom;
	bmsx::test::Blua32TestRom cartRom;
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::ExecutionAddressSpace executionAddressSpace;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;

	CpuTestMachine(
		bmsx::test::Blua32TestImage systemImage,
		bmsx::test::Blua32TestImage cartImage = makeSupervisorCartImage()
	)
		: systemRom(bmsx::test::encodeBlua32TestRom(
			bmsx::RomImageDomain::System,
			systemImage
		))
		, cartRom(bmsx::test::encodeBlua32TestRom(
			bmsx::RomImageDomain::Cartridge,
			cartImage
		))
		, memory(bmsx::MemoryInit{
			systemRom.bytes,
			bmsx::test::cartridgeSlots(cartRom.bytes),
		}, bmsx::PSX_MACHINE_SPEC.ramBytes)
		, irq(memory)
		, executionAddressSpace(memory)
		, cpu(memory, irq, executionAddressSpace)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		irq.reset();
		dma.reset();
		memory.cartridgeController().reset();
		cpu.reset();
	}
};

void testManualNmiAndSaveStateReturn() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "HALT parks the user frame");
	machine.cpu.requestNonMaskableInterrupt();
	require(machine.cpu.enterPendingInterrupt(), "NMI enters through the CPU interrupt boundary");

	bmsx::CpuRuntimeState active = machine.cpu.captureRuntimeState();
	require(active.frames.size() == 2u, "NMI retains the user frame beneath the exception root");
	require(active.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "NMI selects the physical system exception vector");
	require(active.frames.back().isExceptionFrame, "NMI marks the exception root");
	require(active.causeWord == bmsx::CPU_CAUSE_NMI, "NMI latches CAUSE.NMI");
	require(active.epcWord == machine.cartRom.textAddress + bmsx::INSTRUCTION_BYTES, "asynchronous EPC points after HALT");
	require(active.statusWord == (bmsx::CPU_STATUS_CART_ENTRY << 2u), "exception entry pushes the raw STATUS mode stack");
	require(active.lastExecutionDomainId == 0, "NMI entry preserves the cart domain of the last fetched instruction");
	require(machine.cpu.readLastExecutionDomain() == 0, "CPU exposes the raw last-instruction domain");

	machine.cpu.restoreRuntimeState(active);
	require(machine.cpu.runUntilDepth(0, 1) == bmsx::RunResult::Yielded, "MFC0 consumes one instruction before RFE");
	require(machine.cpu.readLastExecutionDomain() == bmsx::SYSTEM_EXECUTION_DOMAIN_ID, "system exception execution replaces the last-instruction domain");
	require(bmsx::asNumber(machine.cpu.readFrameRegister(1, 0)) == bmsx::CPU_CAUSE_NMI, "MFC0 reads the raw CAUSE latch");
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "RFE resumes and completes the retained user frame");
	require(machine.cpu.readCompletionValues().size() == 1u && bmsx::asNumber(machine.cpu.readCompletionValues()[0]) == 1.0, "RFE resumes at EPC");
	require(machine.cpu.captureRuntimeState().statusWord == bmsx::CPU_STATUS_CART_ENTRY, "RFE pops the raw STATUS mode stack");
}

void testPrivilegeVectorRoutingAndCp0Fault() {
	{
		bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
		systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
		CpuTestMachine machine(std::move(systemImage));
		require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "physical reset firmware enters cartridge code");
		machine.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
		machine.irq.raise(bmsx::IRQ_VBLANK);
		require(machine.cpu.enterPendingInterrupt(), "user IRQ enters");
		require(machine.cpu.captureRuntimeState().frames.back().functionAddress == machine.cartRom.functionAddresses[CART_IRQ_FUNCTION], "user IRQ selects the cartridge's physical IRQ vector");
	}

	{
		bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
		systemImage.startupFunctionIndex = SYSTEM_CP0_FUNCTION;
		CpuTestMachine machine(std::move(systemImage));
		machine.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
		machine.irq.raise(bmsx::IRQ_VBLANK);
		require(machine.cpu.enterPendingInterrupt(), "supervisor IRQ enters");
		require(machine.cpu.captureRuntimeState().frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_IRQ_FUNCTION], "supervisor IRQ selects the system's physical IRQ vector");
	}

	{
		bmsx::test::Blua32TestImage systemImage =
			makeSupervisorSystemImage(CART_USER_CP0_FUNCTION);
		systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
		CpuTestMachine machine(std::move(systemImage));
		require(machine.cpu.runUntilDepth(0, 3) == bmsx::RunResult::Yielded, "user MFC0 vectors synchronously");
		bmsx::CpuRuntimeState fault = machine.cpu.captureRuntimeState();
		require(fault.causeWord == bmsx::CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, "user CP0 access latches the privileged-instruction cause");
		require(fault.epcWord == machine.cartRom.textAddress + 4u * bmsx::INSTRUCTION_BYTES, "synchronous EPC identifies the physical faulting instruction");
		require(fault.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "user CP0 fault selects the system exception vector");
		fault.epcWord += bmsx::INSTRUCTION_BYTES;
		machine.cpu.restoreRuntimeState(fault);
		require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "edited EPC skips the faulting instruction on RFE");
		require(machine.cpu.readCompletionValues().size() == 1u && bmsx::asNumber(machine.cpu.readCompletionValues()[0]) == 1.0, "fault handler resumes the selected user instruction");
	}

	{
		bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
		systemImage.startupFunctionIndex = SYSTEM_CP0_FUNCTION;
		CpuTestMachine machine(std::move(systemImage));
		require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "supervisor CP0 code completes");
		require(machine.cpu.captureRuntimeState().epcWord == bmsx::CPU_STATUS_SYSTEM_ENTRY, "MTC0 writes the raw EPC word");
	}
}

void testSystemAndOrdinaryGlobalRegisterfilesStayDistinct() {
	CpuTestMachine machine(makeSupervisorSystemImage(
		CART_USER_HALT_FUNCTION,
		{"irq"},
		{"irq"}
	));
	const bmsx::StringId irqKey = machine.cpu.stringPool().intern("irq");
	machine.cpu.setSystemGlobalByKey(irqKey, bmsx::valueNumber(11.0));
	machine.cpu.setGlobalByKey(irqKey, bmsx::valueNumber(22.0));

	machine.cpu.replaceExecutionImage(
		machine.executionAddressSpace.resolveSystemDomain()
	);
	const bmsx::CpuRuntimeState saved = machine.cpu.captureRuntimeState();
	require(saved.systemGlobals.size() == 1u && saved.systemGlobals[0].name == "irq" && saved.systemGlobals[0].value.numberValue == 11.0, "media remount preserves the system registerfile");
	require(saved.globals.size() == 1u && saved.globals[0].name == "irq" && saved.globals[0].value.numberValue == 22.0, "media remount preserves the ordinary global table");
	require(bmsx::asNumber(machine.cpu.getGlobalByKey(irqKey)) == 22.0, "ordinary global lookup does not expose the system slot");

	machine.cpu.setSystemGlobalByKey(irqKey, bmsx::valueNumber(33.0));
	machine.cpu.setGlobalByKey(irqKey, bmsx::valueNumber(44.0));
	machine.cpu.restoreRuntimeState(saved);
	const bmsx::CpuRuntimeState restored = machine.cpu.captureRuntimeState();
	require(restored.systemGlobals.size() == 1u && restored.systemGlobals[0].name == "irq" && restored.systemGlobals[0].value.numberValue == 11.0, "save-state restores the system registerfile independently");
	require(bmsx::asNumber(machine.cpu.getGlobalByKey(irqKey)) == 22.0, "save-state restores the ordinary global independently");
}

void testCp0ExecTransfersToTheSelectedPhysicalCartridgeImage() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.isExecutionDomainResident(bmsx::SYSTEM_EXECUTION_DOMAIN_ID), "system execution domain is resident after reset");
	require(!machine.cpu.isExecutionDomainResident(0), "unexecuted cartridge domain is not resident");
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "CP0.EXEC transfers execution to cartridge bytecode");
	require(machine.cpu.isExecutionDomainResident(0), "CP0.EXEC makes the selected cartridge domain resident");
	const bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	require(state.executionCartridgeSlot == 0, "CP0.EXEC selects the cartridge in the physical bus socket");
	require(state.frames.size() == 1u, "CP0.EXEC replaces the system root instead of stacking a host call");
	require(state.frames.back().functionAddress == machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION], "CP0.EXEC enters the function record addressed by the cartridge header");
	require(state.statusWord == bmsx::CPU_STATUS_CART_ENTRY, "CP0.EXEC enters cartridge privilege mode");
}

void testControlFlowCannotLeaveTheActiveFunctionRecord() {
	struct BranchCase {
		bmsx::OpCode op;
		bool initializeTrue;
		const char* name;
	};
	constexpr std::array<BranchCase, 3> CASES{{
		{bmsx::OpCode::JMP, false, "JMP"},
		{bmsx::OpCode::JMPIF, true, "JMPIF"},
		{bmsx::OpCode::JMPIFNOT, false, "JMPIFNOT"},
	}};

	for (const BranchCase& testCase : CASES) {
		const bmsx::u32 branchWord = testCase.initializeTrue ? 1u : 0u;
		bmsx::test::Blua32TestImage image;
		image.text.resize((branchWord + 2u) * bmsx::INSTRUCTION_BYTES);
		std::span<bmsx::u8> code(image.text);
		if (testCase.initializeTrue) {
			bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::KTRUE), 0, 0, 0);
		}
		bmsx::writeInstruction(
			code,
			static_cast<int>(branchWord),
			static_cast<bmsx::u8>(testCase.op),
			0,
			0,
			0
		);
		bmsx::writeInstruction(
			code,
			static_cast<int>(branchWord + 1u),
			static_cast<bmsx::u8>(bmsx::OpCode::RET),
			0,
			0,
			0
		);
		image.functions = {
			{.firstWord = 0u, .wordCount = branchWord + 1u},
			{.firstWord = branchWord + 1u, .wordCount = 1u},
		};
		image.irqFunctionIndex = 1u;
		image.exceptionFunctionIndex = 1u;
		CpuTestMachine machine(std::move(image));

		require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, testCase.name);
		const bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
		require(state.frames.size() == 1u, "branch hard-halts before entering adjacent function text");
		require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[0], "branch retains the active function record");
	}
}

void testUnmappedClosureRecordHardHalts() {
	bmsx::test::Blua32TestImage image;
	image.text.resize(2u * bmsx::INSTRUCTION_BYTES);
	bmsx::writeInstruction(
		std::span<bmsx::u8>(image.text),
		0,
		static_cast<bmsx::u8>(bmsx::OpCode::WIDE),
		0,
		0,
		0
	);
	bmsx::writeInstruction(
		std::span<bmsx::u8>(image.text),
		1,
		static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE),
		0,
		0,
		0
	);
	image.functions = {{.firstWord = 0u, .wordCount = 2u}};
	image.closureRelocations = {{.wordIndex = 1u, .functionAddress = UNMAPPED_ADDRESS}};
	CpuTestMachine machine(std::move(image));

	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "unmapped CLOSURE record hard-halts");
	const bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	require(state.frames.size() == 1u, "unmapped CLOSURE record retains the active frame");
	require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[0], "unmapped CLOSURE record does not enter host state");
}

void testCrossImageCallStackPcsBelongToTheirFrames() {
	bmsx::test::Blua32TestImage system;
	system.text.resize(7u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> systemCode(system.text);
	bmsx::writeInstruction(systemCode, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 2, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(0), 1);
	bmsx::writeInstruction(systemCode, 3, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 4, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 5, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 6, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	system.functions = {
		{.firstWord = 0u, .wordCount = 4u},
		{.firstWord = 4u, .wordCount = 1u},
		{.firstWord = 5u, .wordCount = 2u},
	};
	system.constants = {
		static_cast<bmsx::f64>(bmsx::test::blua32TestFunctionAddress(
			bmsx::RomImageDomain::Cartridge,
			0u
		)),
	};
	system.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u),
	}};
	system.startupFunctionIndex = 2u;
	system.irqFunctionIndex = 1u;
	system.exceptionFunctionIndex = 1u;

	bmsx::test::Blua32TestImage cart;
	cart.text.resize(5u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> cartCode(cart.text);
	bmsx::writeInstruction(cartCode, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 2, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(0), 1);
	bmsx::writeInstruction(cartCode, 3, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 4, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	cart.functions = {
		{.firstWord = 0u, .wordCount = 4u},
		{.firstWord = 4u, .wordCount = 1u},
	};
	cart.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 0u),
	}};
	cart.irqFunctionIndex = 1u;
	cart.exceptionFunctionIndex = 1u;

	CpuTestMachine machine(std::move(system), std::move(cart));
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cross-image leaf reaches HALT");
	const std::optional<bmsx::Blua32ImageLayout> systemLayout =
		bmsx::decodeBlua32RomImage(machine.systemRom.bytes, bmsx::SYSTEM_ROM_BASE);
	const std::optional<bmsx::Blua32ImageLayout> cartLayout =
		bmsx::decodeBlua32RomImage(machine.cartRom.bytes, bmsx::CART_ROM_BASE);
	require(systemLayout.has_value() && cartLayout.has_value(), "fixture ROMs expose physical execution layouts");
	const std::array<const bmsx::Blua32ImageLayout*, 2> layoutsByDomain{{
		&*systemLayout,
		&*cartLayout,
	}};
	const int frameDepth = machine.cpu.getFrameDepth();
	require(frameDepth == 3, "cross-image call stack retains cart caller and two system frames");
	require(
		machine.cpu.readFrameExecutionDomain(0) == 0
			&& machine.cpu.readFrameExecutionDomain(1) == bmsx::SYSTEM_EXECUTION_DOMAIN_ID
			&& machine.cpu.readFrameExecutionDomain(2) == bmsx::SYSTEM_EXECUTION_DOMAIN_ID,
		"cross-image call stack retains each raw execution domain"
	);
	for (int frameIndex = 0; frameIndex < frameDepth; ++frameIndex) {
		const int executionDomainId = machine.cpu.readFrameExecutionDomain(frameIndex);
		const bmsx::Blua32ImageLayout& layout =
			*layoutsByDomain[static_cast<size_t>(executionDomainId + 1)];
		const bmsx::u32 pc = frameIndex + 1 < frameDepth
			? machine.cpu.readFrameCallSitePc(frameIndex + 1)
			: machine.cpu.lastPc;
		require(
			pc >= layout.header.textAddress
				&& pc < layout.header.textAddress + layout.header.textByteCount,
			"call-stack PC belongs to the frame image"
		);
	}
}

struct InstrumentedExecutionProbe {
	bmsx::ExecutionDomainId expectedDomain = bmsx::SYSTEM_EXECUTION_DOMAIN_ID;
	bmsx::u32 stopPc = 0;
	std::vector<bmsx::u32> pcs;
};

bool stopInstrumentedExecution(void* context, bmsx::ExecutionDomainId executionDomainId, bmsx::u32 pc) {
	auto& probe = *static_cast<InstrumentedExecutionProbe*>(context);
	require(executionDomainId == probe.expectedDomain, "instrumented hook receives only the selected raw domain");
	probe.pcs.push_back(pc);
	return pc == probe.stopPc;
}

struct SelfClearingExecutionProbe {
	bmsx::CPU* cpu;
	int calls = 0;
};

bool clearExecutionHook(void* context, bmsx::ExecutionDomainId, bmsx::u32) {
	auto& probe = *static_cast<SelfClearingExecutionProbe*>(context);
	probe.calls += 1;
	probe.cpu->setExecutionHook({});
	return probe.calls == 2;
}

bool throwExecutionHook(void*, bmsx::ExecutionDomainId, bmsx::u32) {
	throw std::runtime_error("execution hook failure");
}

void testDecodedSuperinstructionsPreserveGuestBoundaries() {
	require(
		bmsx::decodedDispatchOp(
			static_cast<uint8_t>(bmsx::OpCode::SHL),
			static_cast<uint8_t>(bmsx::OpCode::BXOR)
		) == static_cast<uint8_t>(bmsx::DecodedDispatchOp::FusedShlBxor),
		"decoded dispatch recognizes SHL+BXOR"
	);
	require(
		bmsx::decodedDispatchOp(
			static_cast<uint8_t>(bmsx::OpCode::ADD),
			static_cast<uint8_t>(bmsx::OpCode::SHL)
		) == static_cast<uint8_t>(bmsx::DecodedDispatchOp::FusedAddShl),
		"decoded dispatch recognizes ADD+SHL"
	);
	require(
		bmsx::decodedDispatchOp(
			static_cast<uint8_t>(bmsx::OpCode::SHR),
			static_cast<uint8_t>(bmsx::OpCode::BXOR)
		) == static_cast<uint8_t>(bmsx::DecodedDispatchOp::FusedShrBxor),
		"decoded dispatch recognizes SHR+BXOR"
	);
	require(
		bmsx::decodedDispatchOp(
			static_cast<uint8_t>(bmsx::OpCode::SHL),
			static_cast<uint8_t>(bmsx::OpCode::ADD)
		) == static_cast<uint8_t>(bmsx::OpCode::SHL),
		"decoded dispatch preserves an unfused opcode"
	);

	CpuTestMachine fused(makeDecodedPairSystemImage());
	const bmsx::u32 entryPc = fused.systemRom.textAddress;
	require(
		fused.cpu.runUntilDepth(0, 4) == bmsx::RunResult::Yielded,
		"fused pair consumes the exact guest budget"
	);
	require(
		fused.cpu.readFramePc(0) == entryPc + 4u * bmsx::INSTRUCTION_BYTES,
		"fused pair advances the physical frame PC through its second instruction"
	);
	require(
		fused.cpu.lastPc == entryPc + 3u * bmsx::INSTRUCTION_BYTES,
		"fused pair publishes its second guest PC"
	);
	require(
		bmsx::asNumber(fused.cpu.readFrameRegister(0, 3)) == 3.0,
		"fused pair commits its second numeric result"
	);

	CpuTestMachine budgeted(makeDecodedPairSystemImage());
	require(
		budgeted.cpu.runUntilDepth(0, 3) == bmsx::RunResult::Yielded,
		"budget exhaustion stops between fused guest instructions"
	);
	require(
		budgeted.cpu.readFramePc(0) == entryPc + 3u * bmsx::INSTRUCTION_BYTES,
		"budget exhaustion retains the second guest instruction as continuation"
	);
	require(
		budgeted.cpu.lastPc == entryPc + 2u * bmsx::INSTRUCTION_BYTES,
		"budget exhaustion retains the first guest PC"
	);
	require(
		bmsx::asNumber(budgeted.cpu.readFrameRegister(0, 2)) == 2.0,
		"budget exhaustion commits the first numeric result"
	);
	require(
		budgeted.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted,
		"normal execution completes all decoded pairs"
	);
	require(
		bmsx::asNumber(budgeted.cpu.readFrameRegister(0, 3)) == 3.0
			&& bmsx::asNumber(budgeted.cpu.readFrameRegister(0, 4)) == 4.0
			&& bmsx::asNumber(budgeted.cpu.readFrameRegister(0, 5)) == 8.0
			&& bmsx::asNumber(budgeted.cpu.readFrameRegister(0, 6)) == 4.0
			&& bmsx::asNumber(budgeted.cpu.readFrameRegister(0, 7)) == 5.0,
		"decoded pairs preserve the raw arithmetic results"
	);

	CpuTestMachine instrumented(makeDecodedPairSystemImage());
	InstrumentedExecutionProbe probe{
		.expectedDomain = bmsx::SYSTEM_EXECUTION_DOMAIN_ID,
		.stopPc = entryPc + 3u * bmsx::INSTRUCTION_BYTES,
		.pcs = {},
	};
	instrumented.cpu.setExecutionHook({
		.hook = stopInstrumentedExecution,
		.context = &probe,
		.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
		.preMaskableInterruptDomainMask = 0u,
	});
	require(
		instrumented.cpu.runUntilDepth(0, 100) == bmsx::RunResult::ExecutionStopped,
		"instrumented dispatch stops at the second normally fused instruction"
	);
	require(
		probe.pcs == std::vector<bmsx::u32>{
			entryPc,
			entryPc + bmsx::INSTRUCTION_BYTES,
			entryPc + 2u * bmsx::INSTRUCTION_BYTES,
			entryPc + 3u * bmsx::INSTRUCTION_BYTES,
		},
		"instrumented dispatch observes every raw guest instruction"
	);
}

void testMappedRamFunctionExecution() {
	bmsx::test::Blua32TestImage systemImage;
	systemImage.text.resize(9u * bmsx::INSTRUCTION_BYTES);
	systemImage.constants = {static_cast<bmsx::f64>(RAM_FUNCTION_ADDRESS)};
	std::span<bmsx::u8> systemCode(systemImage.text);
	bmsx::writeInstruction(systemCode, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 2, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 0);
	bmsx::writeInstruction(
		systemCode,
		3,
		static_cast<bmsx::u8>(bmsx::OpCode::WIDE),
		0,
		0,
		bmsx::CLOSURE_ADDRESS_REGISTER_WIDE_C
	);
	bmsx::writeInstruction(systemCode, 4, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 1, 0, 1);
	bmsx::writeInstruction(systemCode, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(systemCode, 6, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 7, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(systemCode, 8, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	systemImage.functions = {
		{.firstWord = 0u, .wordCount = 6u, .maxStack = 2u},
		{.firstWord = 6u, .wordCount = 2u},
		{.firstWord = 8u, .wordCount = 1u},
	};
	systemImage.startupFunctionIndex = 0u;
	systemImage.irqFunctionIndex = 2u;
	systemImage.exceptionFunctionIndex = 2u;
	systemImage.closureRelocations = {{.wordIndex = 1u, .functionAddress = RAM_FUNCTION_ADDRESS}};

	CpuTestMachine machine(std::move(systemImage));
	bmsx::CPU& cpu = machine.cpu;
	bmsx::Memory& memory = machine.memory;
	const bmsx::u32 romFunctionOperand = machine.systemRom.functionAddresses[1] >> 4u;
	std::array<bmsx::u8, 4u * bmsx::INSTRUCTION_BYTES> ramCode{};
	bmsx::writeInstruction(
		ramCode,
		0,
		static_cast<bmsx::u8>(bmsx::OpCode::WIDE),
		0,
		static_cast<bmsx::u8>(romFunctionOperand >> bmsx::BASE_BX_BITS),
		0
	);
	bmsx::writeInstruction(
		ramCode,
		1,
		static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE),
		0,
		static_cast<bmsx::u8>((romFunctionOperand >> 6u) & 0x3fu),
		static_cast<bmsx::u8>(romFunctionOperand & 0x3fu),
		static_cast<bmsx::u8>(romFunctionOperand >> bmsx::MAX_BX_BITS)
	);
	bmsx::writeInstruction(
		ramCode,
		2,
		static_cast<bmsx::u8>(bmsx::OpCode::CALL),
		0,
		bmsx::encodeFixedCallArgCount(0),
		1
	);
	bmsx::writeInstruction(ramCode, 3, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);

	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
		RAM_CODE_ADDRESS
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
		static_cast<bmsx::u32>(ramCode.size())
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
		0u
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_MAX_STACK_OFFSET,
		1u
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_FLAGS_OFFSET,
		bmsx::BLUA32_FUNCTION_STATIC
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
		0u
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + bmsx::BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
		0u
	);
	memory.writeBytes(RAM_CODE_ADDRESS, ramCode.data(), ramCode.size());

	require(
		cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted,
		"ROM creates a closure for a mapped RAM function record"
	);
	bmsx::Closure* directClosure = bmsx::asClosure(cpu.readCompletionValues()[0]);
	bmsx::Closure* closure = bmsx::asClosure(cpu.readCompletionValues()[1]);
	require(
		directClosure->functionAddress == RAM_FUNCTION_ADDRESS
			&& closure->functionAddress == RAM_FUNCTION_ADDRESS,
		"direct and register-addressed closures retain the mapped RAM function address"
	);

	cpu.beginCompletionCall(*closure);
	require(
		cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted,
		"RAM code calls a ROM function and returns"
	);
	const std::span<const bmsx::Value> romResults = cpu.readCompletionValues();
	require(
		romResults.size() == 1u && bmsx::asNumber(romResults[0]) == 1.0,
		"the RAM to ROM call returns the ROM result"
	);

	std::array<bmsx::u8, 2u * bmsx::INSTRUCTION_BYTES> replacement{};
	bmsx::writeInstruction(replacement, 0, static_cast<bmsx::u8>(bmsx::OpCode::K0), 0, 0, 0);
	bmsx::writeInstruction(replacement, 1, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	memory.writeBytes(RAM_CODE_ADDRESS, replacement.data(), replacement.size());

	cpu.beginCompletionCall(*closure);
	require(
		cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted,
		"the same RAM closure executes after its code changes"
	);
	const std::span<const bmsx::Value> changedResults = cpu.readCompletionValues();
	require(
		changedResults.size() == 1u && bmsx::asNumber(changedResults[0]) == 0.0,
		"the decoder observes rewritten mapped RAM instructions"
	);
}

void testCartridgeInstructionFetchRetainsExecSlot() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(
		std::move(systemImage),
		makeCartridgeSelectionSwitchImage(bmsx::OpCode::K0)
	);
	bmsx::test::Blua32TestRom slot1 = bmsx::test::encodeBlua32TestRom(
		bmsx::RomImageDomain::Cartridge,
		makeCartridgeSelectionSwitchImage(bmsx::OpCode::K1)
	);
	machine.memory.cartridgeController().installRom(1u, slot1.bytes);
	machine.memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 1u);

	require(
		machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted,
		"slot-1 cartridge execution returns after changing the data selection"
	);
	const std::span<const bmsx::Value> result = machine.cpu.readCompletionValues();
	require(
		result.size() == 1u && bmsx::asNumber(result[0]) == 1.0,
		"instruction fetch remains on the CP0.EXEC-latched cartridge socket"
	);
	require(
		machine.memory.readMappedU32LE(bmsx::IO_CART_SELECT) == 0u,
		"the cartridge changed only the ordinary data-bus selection"
	);
	require(
		machine.cpu.activeCartridgeSlot() == 1,
		"the CPU retains the slot-1 execution latch"
	);
}

void testExecutionHookReconfigurationAppliesAtTheNextCpuBurst() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	SelfClearingExecutionProbe probe{.cpu = &machine.cpu};
	machine.cpu.setExecutionHook({
		.hook = clearExecutionHook,
		.context = &probe,
		.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
		.preMaskableInterruptDomainMask = 0u,
	});

	require(
		machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::ExecutionStopped,
		"active CPU burst retains its execution-hook snapshot"
	);
	require(probe.calls == 2, "active CPU burst keeps invoking its binding after reconfiguration");
	require(
		machine.cpu.runUntilDepth(0, 100) != bmsx::RunResult::ExecutionStopped,
		"next CPU burst uses the reconfigured normal entry"
	);
	require(probe.calls == 2, "normal CPU burst does not read or invoke the cleared binding");
}

void testDeviceSchedulerOwnsCpuSliceLifetime() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	machine.cpu.setExecutionHook({
		.hook = throwExecutionHook,
		.context = nullptr,
		.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
		.preMaskableInterruptDomainMask = 0u,
	});
	bool threw = false;
	try {
		machine.scheduler.runCpuSlice(0, 100);
	} catch (const std::runtime_error&) {
		threw = true;
	}
	require(threw, "execution-hook host failure escapes the CPU slice");
	require(!machine.scheduler.isCpuSliceActive(), "scheduler ends the CPU slice during stack unwinding");
}

void testInstrumentedExecutionObservesCrossDomainCallAndReturn() {
	bmsx::test::Blua32TestImage system;
	system.text.resize(6u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> systemCode(system.text);
	bmsx::writeInstruction(systemCode, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 1, static_cast<bmsx::u8>(bmsx::OpCode::LOAD_MEM), 0, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE));
	bmsx::writeInstruction(systemCode, 2, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);
	bmsx::writeInstruction(systemCode, 3, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 4, static_cast<bmsx::u8>(bmsx::OpCode::K0), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	system.functions = {
		{.firstWord = 0u, .wordCount = 3u},
		{.firstWord = 3u, .wordCount = 1u},
		{.firstWord = 4u, .wordCount = 2u},
	};
	system.constants = {
		static_cast<bmsx::f64>(
			bmsx::CART_ROM_BASE
				+ bmsx::BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET
		),
	};
	system.startupFunctionIndex = 0u;
	system.irqFunctionIndex = 1u;
	system.exceptionFunctionIndex = 1u;

	bmsx::test::Blua32TestImage cart;
	cart.text.resize(6u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> cartCode(cart.text);
	bmsx::writeInstruction(cartCode, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 2, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(0), 0);
	bmsx::writeInstruction(cartCode, 3, static_cast<bmsx::u8>(bmsx::OpCode::K0), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(cartCode, 5, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	cart.functions = {
		{.firstWord = 0u, .wordCount = 5u, .maxStack = 1u},
		{.firstWord = 5u, .wordCount = 1u},
	};
	cart.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 2u),
	}};
	cart.startupFunctionIndex = 0u;
	cart.irqFunctionIndex = 1u;
	cart.exceptionFunctionIndex = 1u;

	CpuTestMachine machine(std::move(system), std::move(cart));
	require(machine.cpu.runUntilDepth(0, 4) == bmsx::RunResult::Yielded, "system launch reaches the cart entry boundary");
	const bmsx::u32 cartEntryPc = machine.cartRom.textAddress;
	const bmsx::u32 cartCallPc = cartEntryPc + 2u * bmsx::INSTRUCTION_BYTES;
	const bmsx::u32 cartReturnPc = cartEntryPc + 3u * bmsx::INSTRUCTION_BYTES;
	InstrumentedExecutionProbe cartProbe{
		.expectedDomain = 0,
		.stopPc = cartReturnPc,
		.pcs = {},
	};
	machine.cpu.setExecutionHook({
		.hook = stopInstrumentedExecution,
		.context = &cartProbe,
		.domainMask = bmsx::executionDomainBit(0),
		.preMaskableInterruptDomainMask = 0u,
	});
	require(
		machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::ExecutionStopped,
		"instrumented execution stops after a cross-domain RET reveals the cart caller"
	);
	require(
		cartProbe.pcs == std::vector<bmsx::u32>{cartEntryPc, cartCallPc, cartReturnPc},
		"instrumented execution crosses the unselected system callee without host instruction stepping"
	);

	const int baseDepth = machine.cpu.getFrameDepth();
	const bmsx::u32 systemLeafAddress = machine.systemRom.functionAddresses[2];
	const bmsx::u32 systemLeafPc = machine.systemRom.textAddress + 4u * bmsx::INSTRUCTION_BYTES;
	machine.cpu.beginCompletionCallInExecutionDomain(
		bmsx::SYSTEM_EXECUTION_DOMAIN_ID,
		systemLeafAddress
	);
	InstrumentedExecutionProbe systemProbe{
		.expectedDomain = bmsx::SYSTEM_EXECUTION_DOMAIN_ID,
		.stopPc = systemLeafPc,
		.pcs = {},
	};
	machine.cpu.setExecutionHook({
		.hook = stopInstrumentedExecution,
		.context = &systemProbe,
		.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
		.preMaskableInterruptDomainMask = 0u,
	});
	require(
		machine.cpu.runUntilDepth(baseDepth, 100) == bmsx::RunResult::ExecutionStopped,
		"address-based completion entry remains visible to the raw execution hook"
	);
	require(machine.cpu.completionCallPending(), "debugger stop retains the completion frame");
	machine.cpu.setExecutionHook({});
	require(
		machine.cpu.runUntilDepth(baseDepth, 100) == bmsx::RunResult::Halted,
		"completion call resumes through the normal non-instrumented dispatch"
	);
	require(!machine.cpu.completionCallPending(), "completion RET returns to the captured base depth");
}

void testInstrumentedExecutionFenceStopsBeforePendingIrqDelivery() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "HALT parks the user frame");
	const int frameDepth = machine.cpu.getFrameDepth();
	const bmsx::u32 userPc = machine.cpu.readFramePc(frameDepth - 1);
	machine.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	machine.irq.raise(bmsx::IRQ_VBLANK);
	machine.cpu.clearHaltUntilIrq();
	InstrumentedExecutionProbe probe{
		.expectedDomain = 0,
		.stopPc = userPc,
		.pcs = {},
	};
	machine.cpu.setExecutionHook({
		.hook = stopInstrumentedExecution,
		.context = &probe,
		.domainMask = bmsx::executionDomainBit(0),
		.preMaskableInterruptDomainMask = bmsx::executionDomainBit(0),
	});
	require(
		machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::ExecutionStopped,
		"instrumented fence stops on the user boundary before IRQ delivery"
	);
	require(machine.cpu.getFrameDepth() == frameDepth, "pending IRQ did not push an exception frame");
	require(machine.cpu.readFramePc(frameDepth - 1) == userPc, "user instruction remains unexecuted");
	require(machine.cpu.canAcceptMaskableInterruptLine(), "pending IRQ remains asserted at the stopped boundary");
}

void testInstrumentedMaskableInterruptFenceDoesNotDelayPendingNmi() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "HALT parks the user frame");
	const int frameDepth = machine.cpu.getFrameDepth();
	const bmsx::u32 userPc = machine.cpu.readFramePc(frameDepth - 1);
	machine.cpu.clearHaltUntilIrq();
	machine.cpu.requestNonMaskableInterrupt();
	InstrumentedExecutionProbe probe{
		.expectedDomain = 0,
		.stopPc = userPc,
		.pcs = {},
	};
	machine.cpu.setExecutionHook({
		.hook = stopInstrumentedExecution,
		.context = &probe,
		.domainMask = bmsx::executionDomainBit(0),
		.preMaskableInterruptDomainMask = bmsx::executionDomainBit(0),
	});
	require(
		machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::ExecutionStopped,
		"instrumented fence stops only after the pending NMI returns"
	);
	require(
		machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None,
		"pending NMI is delivered before the maskable-interrupt fence"
	);
	require(machine.cpu.getFrameDepth() == frameDepth, "NMI handler returns to the user frame");
	require(machine.cpu.readFramePc(frameDepth - 1) == userPc, "user instruction remains unexecuted");
}

void testSuspendedCompletionExecutionRunsAboveParkedFrame() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "cart reaches HALT before suspended completion execution");
	const int baseDepth = machine.cpu.getFrameDepth();
	const bmsx::u32 completionFunctionAddress = machine.cartRom.functionAddresses[CART_COMPLETION_FUNCTION];
	const bmsx::u32 completionPc = machine.cartRom.textAddress + 11u * bmsx::INSTRUCTION_BYTES;

	machine.cpu.beginCompletionCallInExecutionDomain(0, completionFunctionAddress);
	require(!machine.cpu.isHaltedUntilIrq(), "completion frame executes above the parked frame");
	bmsx::CpuRuntimeState suspended = machine.cpu.captureRuntimeState();
	require(suspended.haltedUntilIrqFrameDepth == baseDepth, "save state stores the raw parked frame depth");
	machine.cpu.restoreRuntimeState(suspended);

	InstrumentedExecutionProbe probe{
		.expectedDomain = 0,
		.stopPc = completionPc,
		.pcs = {},
	};
	machine.cpu.setExecutionHook({
		.hook = stopInstrumentedExecution,
		.context = &probe,
		.domainMask = bmsx::executionDomainBit(0),
		.preMaskableInterruptDomainMask = 0u,
	});
	require(
		machine.cpu.runUntilDepth(baseDepth, 100) == bmsx::RunResult::ExecutionStopped,
		"instrumented completion execution stops above the latent HALT latch"
	);
	require(machine.cpu.completionCallPending(), "debugger stop retains the suspended completion frame");
	require(!machine.cpu.isHaltedUntilIrq(), "latent HALT remains hidden beneath the stopped completion frame");
	machine.cpu.setExecutionHook({});
	require(machine.cpu.runUntilDepth(baseDepth, 100) == bmsx::RunResult::Halted, "normal execution completes the suspended call");
	require(!machine.cpu.completionCallPending(), "completion RET reaches the parked base depth");
	require(machine.cpu.isHaltedUntilIrq(), "returning from completion execution exposes the original HALT latch");

	machine.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	machine.cpu.beginCompletionCallInExecutionDomain(0, completionFunctionAddress);
	machine.irq.raise(bmsx::IRQ_VBLANK);
	require(machine.cpu.enterPendingInterrupt(), "IRQ is accepted above suspended completion execution");
	const bmsx::CpuRuntimeState interrupted = machine.cpu.captureRuntimeState();
	require(interrupted.haltedUntilIrqFrameDepth == -1, "accepted IRQ consumes the latent HALT latch");
	require(!interrupted.interruptEventPending, "accepted IRQ does not queue a duplicate wake event for a consumed HALT latch");
}

void testRfeCannotResumeOutsideTheInterruptedFunctionRecord() {
	bmsx::test::Blua32TestImage systemImage = makeSupervisorSystemImage();
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.runUntilDepth(0, 3) == bmsx::RunResult::Halted, "cart reaches HALT before NMI");
	machine.cpu.requestNonMaskableInterrupt();
	require(machine.cpu.enterPendingInterrupt(), "NMI enters the system exception vector");

	bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	state.epcWord = machine.cartRom.textAddress + 3u * bmsx::INSTRUCTION_BYTES;
	machine.cpu.restoreRuntimeState(state);
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "invalid RFE target hard-halts");
	state = machine.cpu.captureRuntimeState();
	require(state.frames.size() == 2u, "invalid RFE target retains both frames");
	require(state.frames.front().functionAddress == machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION], "invalid RFE target does not replace the interrupted frame");
	require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "invalid RFE target does not pop the exception frame");
}

void testMappedBusErrorsEnterTheSystemExceptionVector() {
	bmsx::test::Blua32TestImage systemImage =
		makeSupervisorSystemImage(CART_USER_BUS_LOAD_FUNCTION);
	systemImage.startupFunctionIndex = EXEC_CART_FUNCTION;
	CpuTestMachine machine(std::move(systemImage));
	require(machine.cpu.runUntilDepth(0, 6) == bmsx::RunResult::Yielded, "faulting mapped load enters the exception root");
	bmsx::CpuRuntimeState loadFault = machine.cpu.captureRuntimeState();
	require(loadFault.causeWord == bmsx::CPU_CAUSE_CODE_DATA_BUS_ERROR, "mapped load latches DBE");
	require(loadFault.epcWord == machine.cartRom.textAddress + 9u * bmsx::INSTRUCTION_BYTES, "mapped load EPC identifies the physical faulting instruction");
	require(loadFault.badAddressWord == 0u, "DBE leaves BAD_ADDRESS unchanged");
	require(loadFault.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "mapped load selects the system exception vector");
	require(bmsx::asNumber(machine.cpu.readFrameRegister(0, 1)) == 1.0, "faulting load does not commit its destination register");
	loadFault.epcWord += bmsx::INSTRUCTION_BYTES;
	machine.cpu.restoreRuntimeState(loadFault);
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "RFE can skip the faulting mapped load");
	require(machine.cpu.readCompletionValues().size() == 1u && bmsx::asNumber(machine.cpu.readCompletionValues()[0]) == 1.0, "mapped load resume retains the destination value");

	machine.memory.writeMappedU32LE(bmsx::IO_SYS_BUS_FAULT_ACK, 1u);
	machine.memory.readMappedU8(UNMAPPED_ADDRESS);
	bmsx::test::programBlua32TestResetVector(
		machine.systemRom,
		SYSTEM_BUS_BURST_FUNCTION
	);
	machine.cpu.reset();
	require(machine.cpu.runUntilDepth(0, 10) == bmsx::RunResult::Yielded, "supervisor burst fault enters a nested exception root");
	const bmsx::CpuRuntimeState burstFault = machine.cpu.captureRuntimeState();
	require(burstFault.causeWord == bmsx::CPU_CAUSE_CODE_DATA_BUS_ERROR, "supervisor burst latches DBE");
	require(burstFault.epcWord == machine.systemRom.textAddress + 12u * bmsx::INSTRUCTION_BYTES, "supervisor burst EPC identifies the physical faulting instruction");
	require(burstFault.statusWord == (bmsx::CPU_STATUS_SYSTEM_ENTRY << 2u), "supervisor DBE pushes the status mode stack");
	require(burstFault.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "supervisor DBE selects the system exception vector");
	require(machine.memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE - bmsx::IO_WORD_SIZE) == 1u, "burst retains the completed write prefix");
	require(machine.memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_UNMAPPED, "occupied first-fault state does not hide a new CPU DBE");
	require(machine.memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == UNMAPPED_ADDRESS, "burst tail does not overwrite the first-fault address");
	require(machine.memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ACCESS) == (bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_U8), "burst tail does not overwrite the first-fault access");
}

void testMappedMemoryAlignmentContract() {
	constexpr bmsx::u32 BYTE_ADDRESS = bmsx::RAM_BASE + bmsx::MIN_RAM_SIZE + 0x101u;
	constexpr bmsx::u32 F64_ADDRESS = bmsx::RAM_BASE + bmsx::MIN_RAM_SIZE + 0x104u;
	constexpr bmsx::f64 F64_VALUE = 3.141592653589793;
	bmsx::test::Blua32TestImage image;
	image.text.resize(6u * bmsx::INSTRUCTION_BYTES);
	image.constants = {
		static_cast<bmsx::f64>(BYTE_ADDRESS),
		static_cast<bmsx::f64>(F64_ADDRESS),
	};
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::LOAD_MEM), 1, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U8));
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 1);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::LOAD_MEM), 2, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::F64LE));
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 1, 2, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 5u, .maxStack = 3u},
		{.firstWord = 5u, .wordCount = 1u},
	};
	image.irqFunctionIndex = 1u;
	image.exceptionFunctionIndex = 1u;
	CpuTestMachine machine(std::move(image));

	machine.memory.writeMappedU8(BYTE_ADDRESS, 0x5au);
	machine.memory.writeMappedF64LE(F64_ADDRESS, F64_VALUE);
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "aligned mapped loads complete");
	require(machine.cpu.readCompletionValues().size() == 2u, "aligned mapped loads return both values");
	require(bmsx::asNumber(machine.cpu.readCompletionValues()[0]) == 0x5a, "byte access accepts an odd address");
	require(bmsx::asNumber(machine.cpu.readCompletionValues()[1]) == F64_VALUE, "f64 access accepts four-byte alignment");
}

void testAddressErrorsPrecedeMappedMemoryBusCycles() {
	struct AddressErrorCase {
		bmsx::OpCode op;
		bmsx::u8 operandC;
		bmsx::u32 valueCount;
		bmsx::u32 cause;
		const char* name;
	};
	constexpr std::array<AddressErrorCase, 6> CASES{{
		{bmsx::OpCode::LOAD_MEM_D, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U16LE), 1u, bmsx::CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, "LOAD_MEM_D u16"},
		{bmsx::OpCode::LOAD_MEM, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::F64LE), 1u, bmsx::CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, "LOAD_MEM f64"},
		{bmsx::OpCode::STORE_MEM_D, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::U32LE), 1u, bmsx::CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, "STORE_MEM_D u32"},
		{bmsx::OpCode::STORE_MEM, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::F64LE), 1u, bmsx::CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, "STORE_MEM f64"},
		{bmsx::OpCode::STORE_MEM_WORDS_D, 2u, 2u, bmsx::CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, "STORE_MEM_WORDS_D"},
		{bmsx::OpCode::STORE_MEM_WORDS, 2u, 2u, bmsx::CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, "STORE_MEM_WORDS"},
	}};
	constexpr bmsx::u32 ALIGNED_ADDRESS = bmsx::RAM_BASE + bmsx::MIN_RAM_SIZE + 0x100u;
	constexpr bmsx::u32 FAULT_ADDRESS = ALIGNED_ADDRESS + 1u;

	for (const AddressErrorCase& testCase : CASES) {
		const bmsx::u32 memoryInstruction = 2u + testCase.valueCount;
		const bmsx::u32 instructionCount = memoryInstruction + 2u;
		bmsx::test::Blua32TestImage image;
		image.text.resize(instructionCount * bmsx::INSTRUCTION_BYTES);
		image.constants = {static_cast<bmsx::f64>(FAULT_ADDRESS)};
		std::span<bmsx::u8> code(image.text);
		bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
		bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
		for (bmsx::u32 value = 0; value < testCase.valueCount; ++value) {
			bmsx::writeInstruction(
				code,
				static_cast<int>(2u + value),
				static_cast<bmsx::u8>(bmsx::OpCode::K1),
				static_cast<bmsx::u8>(1u + value),
				0,
				0
			);
		}
		bmsx::writeInstruction(code, static_cast<int>(memoryInstruction), static_cast<bmsx::u8>(testCase.op), 1, 0, testCase.operandC);
		bmsx::writeInstruction(code, static_cast<int>(memoryInstruction + 1u), static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
		image.functions = {
			{.firstWord = 0u, .wordCount = 1u},
			{.firstWord = 1u, .wordCount = instructionCount - 1u, .maxStack = testCase.valueCount + 1u},
		};
		image.startupFunctionIndex = 1u;
		image.irqFunctionIndex = 0u;
		image.exceptionFunctionIndex = 0u;
		CpuTestMachine machine(std::move(image));

		machine.memory.writeMappedU32LE(ALIGNED_ADDRESS, 0x11223344u);
		machine.memory.writeMappedU32LE(ALIGNED_ADDRESS + 4u, 0x55667788u);
		machine.memory.writeMappedU32LE(ALIGNED_ADDRESS + 8u, 0x99aabbccu);
		const bmsx::u32 faultSequence = machine.memory.readBusFaultSequence();

		require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, testCase.name);
		const bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
		require(state.causeWord == testCase.cause, testCase.name);
		require(state.epcWord == machine.systemRom.textAddress + memoryInstruction * bmsx::INSTRUCTION_BYTES, testCase.name);
		require(state.badAddressWord == FAULT_ADDRESS, testCase.name);
		require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[0], testCase.name);
		require(machine.memory.readBusFaultSequence() == faultSequence, testCase.name);
		require(bmsx::asNumber(machine.cpu.readFrameRegister(0, 1)) == 1.0, testCase.name);
		require(machine.memory.readMappedU32LE(ALIGNED_ADDRESS) == 0x11223344u, testCase.name);
		require(machine.memory.readMappedU32LE(ALIGNED_ADDRESS + 4u) == 0x55667788u, testCase.name);
		require(machine.memory.readMappedU32LE(ALIGNED_ADDRESS + 8u) == 0x99aabbccu, testCase.name);
	}
}

auto makeProtectedCallImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(41u * bmsx::INSTRUCTION_BYTES);
	image.constants = {
		static_cast<bmsx::f64>(3.0),
		static_cast<bmsx::f64>(4.0),
		static_cast<bmsx::f64>(42.0),
	};
	image.systemGlobalNames = {"pcall", "xpcall", "error"};
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 1, 0, 1);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(1), 3);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 3, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 1);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 0, 0, 1);
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 10, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 1, 0, 3);
	bmsx::writeInstruction(code, 11, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 12, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 2, 0, 4);
	bmsx::writeInstruction(code, 13, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(2), 2);
	bmsx::writeInstruction(code, 14, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 15, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 0, 0, 2);
	bmsx::writeInstruction(code, 16, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 2);
	bmsx::writeInstruction(code, 17, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(1), 0);
	bmsx::writeInstruction(code, 18, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 19, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 1, 0, 0);
	bmsx::writeInstruction(code, 20, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 21, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 0, 0, 0);
	bmsx::writeInstruction(code, 22, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 1, 0, 0);
	bmsx::writeInstruction(code, 23, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 24, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 2, 0, 1);
	bmsx::writeInstruction(code, 25, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(2), 4);
	bmsx::writeInstruction(code, 26, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 4, 0);
	bmsx::writeInstruction(code, 27, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 0, 0, 0);
	bmsx::writeInstruction(code, 28, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 1, 0, 1);
	bmsx::writeInstruction(code, 29, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 30, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 2, 0, 1);
	bmsx::writeInstruction(code, 31, static_cast<bmsx::u8>(bmsx::OpCode::LOADNIL), 3, 0, 0);
	bmsx::writeInstruction(code, 32, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(3), 2);
	bmsx::writeInstruction(code, 33, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	bmsx::writeInstruction(code, 34, static_cast<bmsx::u8>(bmsx::OpCode::GETSYS), 0, 0, 1);
	bmsx::writeInstruction(code, 35, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 36, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 1, 0, 3);
	bmsx::writeInstruction(code, 37, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 38, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 2, 0, 3);
	bmsx::writeInstruction(code, 39, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(2), 2);
	bmsx::writeInstruction(code, 40, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 5u, .maxStack = 3u},
		{.firstWord = 5u, .wordCount = 3u, .maxStack = 2u},
		{.firstWord = 8u, .wordCount = 7u, .maxStack = 3u},
		{.firstWord = 15u, .wordCount = 4u, .maxStack = 2u},
		{.firstWord = 19u, .wordCount = 2u, .numParams = 1u, .maxStack = 2u},
		{.firstWord = 21u, .wordCount = 6u, .maxStack = 3u},
		{.firstWord = 27u, .wordCount = 7u, .maxStack = 4u},
		{.firstWord = 34u, .wordCount = 7u, .maxStack = 3u},
	};
	image.closureRelocations = {
		{2u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u)},
		{10u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 3u)},
		{12u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 4u)},
		{24u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u)},
		{30u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u)},
		{36u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 3u)},
		{38u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 3u)},
	};
	return image;
}

void testProtectedCallMicrocodePreemptsSavesAndHandlesLuaErrors() {
	CpuTestMachine machine(makeProtectedCallImage());
	const std::array builtinIds{
		bmsx::BuiltinFunctionId::PCall,
		bmsx::BuiltinFunctionId::XPCall,
		bmsx::BuiltinFunctionId::Error,
	};
	const std::array names{"pcall", "xpcall", "error"};
	for (size_t index = 0; index < names.size(); ++index) {
		const bmsx::StringId key = machine.cpu.stringPool().intern(names[index]);
		machine.cpu.setSystemGlobalByKey(key, machine.cpu.createBuiltinFunction(builtinIds[index]));
	}

	require(machine.cpu.runUntilDepth(0, 3) == bmsx::RunResult::Yielded, "pcall body should remain preemptible");
	bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	require(state.protectedCalls.size() == 1u, "save state should retain the active protected call");
	machine.cpu.restoreRuntimeState(state);
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "restored pcall should complete");
	require(machine.cpu.readCompletionValues().size() == 3u && bmsx::isTruthy(machine.cpu.readCompletionValues()[0]), "pcall should return success");
	require(bmsx::asNumber(machine.cpu.readCompletionValues()[1]) == 3.0 && bmsx::asNumber(machine.cpu.readCompletionValues()[2]) == 4.0, "pcall should preserve multiple results");

	bmsx::test::programBlua32TestResetVector(machine.systemRom, 2u);
	machine.cpu.reset();
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "xpcall error path should complete");
	require(machine.cpu.readCompletionValues().size() == 2u && !bmsx::isTruthy(machine.cpu.readCompletionValues()[0]), "xpcall should return failure");
	require(bmsx::asNumber(machine.cpu.readCompletionValues()[1]) == 42.0, "xpcall handler should receive the thrown Lua value");

	bmsx::test::programBlua32TestResetVector(machine.systemRom, 6u);
	machine.cpu.reset();
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "invalid xpcall handler should be caught by the outer pcall");
	require(machine.cpu.readCompletionValues().size() == 2u && !bmsx::isTruthy(machine.cpu.readCompletionValues()[0]), "xpcall should validate its handler before running the body");
	require(bmsx::valueIsString(machine.cpu.readCompletionValues()[1]), "invalid xpcall handler should return a Lua error value");

	bmsx::test::programBlua32TestResetVector(machine.systemRom, 7u);
	machine.cpu.reset();
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "xpcall handler failure should complete");
	require(machine.cpu.readCompletionValues().size() == 2u && !bmsx::isTruthy(machine.cpu.readCompletionValues()[0]), "xpcall handler failure should return failure");
	require(bmsx::valueIsString(machine.cpu.readCompletionValues()[1]), "xpcall handler failure should return the Lua error-in-handler value");
	require(machine.cpu.stringPool().toString(bmsx::asStringId(machine.cpu.readCompletionValues()[1])) == "error in error handling", "xpcall should hide the handler's replacement error");

	bmsx::test::programBlua32TestResetVector(machine.systemRom, 5u);
	machine.cpu.reset();
	require(machine.cpu.runUntilDepth(0, 100) == bmsx::RunResult::Halted, "nested pcall should complete");
	require(machine.cpu.readCompletionValues().size() == 4u, "nested pcall should preserve the open result sequence");
	require(bmsx::isTruthy(machine.cpu.readCompletionValues()[0]) && bmsx::isTruthy(machine.cpu.readCompletionValues()[1]), "nested pcall should prefix both success values");
	require(bmsx::asNumber(machine.cpu.readCompletionValues()[2]) == 3.0 && bmsx::asNumber(machine.cpu.readCompletionValues()[3]) == 4.0, "nested pcall should preserve child results");
}

} // namespace

int main() {
	testManualNmiAndSaveStateReturn();
	testPrivilegeVectorRoutingAndCp0Fault();
	testSystemAndOrdinaryGlobalRegisterfilesStayDistinct();
	testCp0ExecTransfersToTheSelectedPhysicalCartridgeImage();
	testControlFlowCannotLeaveTheActiveFunctionRecord();
	testUnmappedClosureRecordHardHalts();
	testCrossImageCallStackPcsBelongToTheirFrames();
	testExecutionHookReconfigurationAppliesAtTheNextCpuBurst();
	testDecodedSuperinstructionsPreserveGuestBoundaries();
	testMappedRamFunctionExecution();
	testCartridgeInstructionFetchRetainsExecSlot();
	testDeviceSchedulerOwnsCpuSliceLifetime();
	testInstrumentedExecutionObservesCrossDomainCallAndReturn();
	testInstrumentedExecutionFenceStopsBeforePendingIrqDelivery();
	testInstrumentedMaskableInterruptFenceDoesNotDelayPendingNmi();
	testSuspendedCompletionExecutionRunsAboveParkedFrame();
	testRfeCannotResumeOutsideTheInterruptedFunctionRecord();
	testMappedBusErrorsEnterTheSystemExceptionVector();
	testMappedMemoryAlignmentContract();
	testAddressErrorsPrecedeMappedMemoryBusCycles();
	testProtectedCallMicrocodePreemptsSavesAndHandlesLuaErrors();
	return 0;
}
