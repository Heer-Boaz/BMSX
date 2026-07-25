#include "machine/bus/io.h"
#include "machine/cpu/cop0.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/access_kind.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
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
constexpr bmsx::u32 USER_CP0_FUNCTION = 2u;
constexpr bmsx::u32 SYSTEM_CP0_FUNCTION = 3u;
constexpr bmsx::u32 USER_BUS_LOAD_FUNCTION = 4u;
constexpr bmsx::u32 SYSTEM_BUS_BURST_FUNCTION = 5u;
constexpr bmsx::u32 EXEC_CART_FUNCTION = 6u;
constexpr bmsx::u32 CART_USER_HALT_FUNCTION = 0u;
constexpr bmsx::u32 CART_IRQ_FUNCTION = 1u;
constexpr bmsx::u32 UNMAPPED_ADDRESS = 0x06000000u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

auto makeSupervisorSystemImage(
	std::vector<std::string> globalNames = {},
	std::vector<std::string> systemGlobalNames = {}
) -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(23u * bmsx::INSTRUCTION_BYTES);
	image.constants = {
		static_cast<bmsx::f64>(UNMAPPED_ADDRESS),
		static_cast<bmsx::f64>(bmsx::IO_SYS_BUS_FAULT_CODE - bmsx::IO_WORD_SIZE),
		static_cast<bmsx::f64>(bmsx::test::blua32TestFunctionAddress(
			bmsx::RomImageDomain::Cartridge,
			CART_USER_HALT_FUNCTION
		)),
	};
	image.globalNames = std::move(globalNames);
	image.systemGlobalNames = std::move(systemGlobalNames);
	std::span<bmsx::u8> code(image.text);

	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_CAUSE, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_STATUS, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_STATUS, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EPC, 0);
	bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 0);
	bmsx::writeInstruction(code, 10, static_cast<bmsx::u8>(bmsx::OpCode::K1), 1, 0, 0);
	bmsx::writeInstruction(code, 11, static_cast<bmsx::u8>(bmsx::OpCode::LOAD_MEM_D), 1, 0, static_cast<bmsx::u8>(bmsx::MemoryAccessKind::Word));
	bmsx::writeInstruction(code, 12, static_cast<bmsx::u8>(bmsx::OpCode::RET), 1, 1, 0);
	bmsx::writeInstruction(code, 13, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 1);
	bmsx::writeInstruction(code, 14, static_cast<bmsx::u8>(bmsx::OpCode::K1), 1, 0, 0);
	bmsx::writeInstruction(code, 15, static_cast<bmsx::u8>(bmsx::OpCode::K1), 2, 0, 0);
	bmsx::writeInstruction(code, 16, static_cast<bmsx::u8>(bmsx::OpCode::K1), 3, 0, 0);
	bmsx::writeInstruction(code, 17, static_cast<bmsx::u8>(bmsx::OpCode::K1), 4, 0, 0);
	bmsx::writeInstruction(code, 18, static_cast<bmsx::u8>(bmsx::OpCode::K1), 5, 0, 0);
	bmsx::writeInstruction(code, 19, static_cast<bmsx::u8>(bmsx::OpCode::STORE_MEM_WORDS_D), 1, 0, 5);
	bmsx::writeInstruction(code, 20, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 21, static_cast<bmsx::u8>(bmsx::OpCode::LOADK), 0, 0, 2);
	bmsx::writeInstruction(code, 22, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EXEC, 0);

	image.functions = {
		{.firstWord = 0u, .wordCount = 1u},
		{.firstWord = 1u, .wordCount = 2u},
		{.firstWord = 3u, .wordCount = 3u},
		{.firstWord = 6u, .wordCount = 3u},
		{.firstWord = 9u, .wordCount = 4u, .maxStack = 2u},
		{.firstWord = 13u, .wordCount = 8u, .maxStack = 6u},
		{.firstWord = 21u, .wordCount = 2u},
	};
	image.startupFunctionIndex = SYSTEM_IRQ_FUNCTION;
	image.irqFunctionIndex = SYSTEM_IRQ_FUNCTION;
	image.exceptionFunctionIndex = SYSTEM_EXCEPTION_FUNCTION;
	return image;
}

auto makeSupervisorCartImage() -> bmsx::test::Blua32TestImage {
	bmsx::test::Blua32TestImage image;
	image.text.resize(4u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 3u},
		{.firstWord = 3u, .wordCount = 1u},
	};
	image.startupFunctionIndex = CART_USER_HALT_FUNCTION;
	image.irqFunctionIndex = CART_IRQ_FUNCTION;
	image.exceptionFunctionIndex = CART_IRQ_FUNCTION;
	return image;
}

struct CpuTestMachine {
	bmsx::test::Blua32TestRom systemRom;
	bmsx::test::Blua32TestRom cartRom;
	bmsx::Memory memory;
	bmsx::IrqController irq;
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
		})
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		irq.reset();
		dma.reset();
		memory.cartridgeController().reset();
		cpu.mountExecutionImages();
	}
};

void testManualNmiAndSaveStateReturn() {
	CpuTestMachine machine(makeSupervisorSystemImage());
	machine.cpu.start(machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "HALT parks the user frame");
	machine.cpu.requestNonMaskableInterrupt();
	require(machine.cpu.enterPendingInterrupt(), "NMI enters through the CPU interrupt boundary");

	bmsx::CpuRuntimeState active = machine.cpu.captureRuntimeState();
	require(active.frames.size() == 2u, "NMI retains the user frame beneath the exception root");
	require(active.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "NMI selects the physical system exception vector");
	require(active.frames.back().isExceptionFrame, "NMI marks the exception root");
	require(active.causeWord == bmsx::CPU_CAUSE_NMI, "NMI latches CAUSE.NMI");
	require(active.epcWord == machine.cartRom.textAddress + bmsx::INSTRUCTION_BYTES, "asynchronous EPC points after HALT");
	require(active.statusWord == (bmsx::CPU_STATUS_CART_ENTRY << 2u), "exception entry pushes the raw STATUS mode stack");

	machine.cpu.restoreRuntimeState(active);
	require(machine.cpu.run(1) == bmsx::RunResult::Yielded, "MFC0 consumes one instruction before RFE");
	require(bmsx::asNumber(machine.cpu.readFrameRegister(1, 0)) == bmsx::CPU_CAUSE_NMI, "MFC0 reads the raw CAUSE latch");
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "RFE resumes and completes the retained user frame");
	require(machine.cpu.lastReturnValues.size() == 1u && bmsx::asNumber(machine.cpu.lastReturnValues[0]) == 1.0, "RFE resumes at EPC");
	require(machine.cpu.captureRuntimeState().statusWord == bmsx::CPU_STATUS_CART_ENTRY, "RFE pops the raw STATUS mode stack");
}

void testPrivilegeVectorRoutingAndCp0Fault() {
	CpuTestMachine machine(makeSupervisorSystemImage());
	machine.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	machine.irq.raise(bmsx::IRQ_VBLANK);

	machine.cpu.start(machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION]);
	require(machine.cpu.enterPendingInterrupt(), "user IRQ enters");
	require(machine.cpu.captureRuntimeState().frames.back().functionAddress == machine.cartRom.functionAddresses[CART_IRQ_FUNCTION], "user IRQ selects the cartridge's physical IRQ vector");

	machine.cpu.start(
		machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(machine.cpu.enterPendingInterrupt(), "supervisor IRQ enters");
	require(machine.cpu.captureRuntimeState().frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_IRQ_FUNCTION], "supervisor IRQ selects the system's physical IRQ vector");

	machine.irq.reset();
	machine.cpu.start(machine.systemRom.functionAddresses[USER_CP0_FUNCTION]);
	require(machine.cpu.run(1) == bmsx::RunResult::Yielded, "user MFC0 vectors synchronously");
	bmsx::CpuRuntimeState fault = machine.cpu.captureRuntimeState();
	require(fault.causeWord == bmsx::CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, "user CP0 access latches the privileged-instruction cause");
	require(fault.epcWord == machine.systemRom.textAddress + 3u * bmsx::INSTRUCTION_BYTES, "synchronous EPC identifies the physical faulting instruction");
	require(fault.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "user CP0 fault selects the system exception vector");
	fault.epcWord += bmsx::INSTRUCTION_BYTES;
	machine.cpu.restoreRuntimeState(fault);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "edited EPC skips the faulting instruction on RFE");
	require(machine.cpu.lastReturnValues.size() == 1u && bmsx::asNumber(machine.cpu.lastReturnValues[0]) == 1.0, "fault handler resumes the selected user instruction");

	machine.cpu.start(
		machine.systemRom.functionAddresses[SYSTEM_CP0_FUNCTION],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "supervisor CP0 code completes");
	require(machine.cpu.captureRuntimeState().epcWord == bmsx::CPU_STATUS_SYSTEM_ENTRY, "MTC0 writes the raw EPC word");
}

void testSystemAndOrdinaryGlobalRegisterfilesStayDistinct() {
	CpuTestMachine machine(makeSupervisorSystemImage({"irq"}, {"irq"}));
	const bmsx::Value irqKey = bmsx::valueString(machine.cpu.stringPool().intern("irq"));
	machine.cpu.setSystemGlobalByKey(irqKey, bmsx::valueNumber(11.0));
	machine.cpu.setGlobalByKey(irqKey, bmsx::valueNumber(22.0));

	machine.cpu.mountExecutionImages();
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
	CpuTestMachine machine(makeSupervisorSystemImage());
	machine.cpu.start(
		machine.systemRom.functionAddresses[EXEC_CART_FUNCTION],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "CP0.EXEC transfers execution to cartridge bytecode");
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

		machine.cpu.start(machine.systemRom.functionAddresses[0]);
		require(machine.cpu.run(100) == bmsx::RunResult::Halted, testCase.name);
		const bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
		require(state.frames.size() == 1u, "branch hard-halts before entering adjacent function text");
		require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[0], "branch retains the active function record");
	}
}

void testInvalidClosureTargetHardHalts() {
	bmsx::test::Blua32TestImage image;
	image.text.resize(bmsx::INSTRUCTION_BYTES);
	bmsx::writeInstruction(
		std::span<bmsx::u8>(image.text),
		0,
		static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE),
		0,
		0,
		0
	);
	image.functions = {{.firstWord = 0u, .wordCount = 1u}};
	CpuTestMachine machine(std::move(image));

	machine.cpu.start(machine.systemRom.functionAddresses[0]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "invalid CLOSURE target hard-halts");
	const bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	require(state.frames.size() == 1u, "invalid CLOSURE target retains the active frame");
	require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[0], "invalid CLOSURE target does not enter host state");
}

void testCrossImageCallStackPcsBelongToTheirFrames() {
	bmsx::test::Blua32TestImage system;
	system.text.resize(5u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> systemCode(system.text);
	bmsx::writeInstruction(systemCode, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 2, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 0, bmsx::encodeFixedCallArgCount(0), 1);
	bmsx::writeInstruction(systemCode, 3, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(systemCode, 4, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
	system.functions = {
		{.firstWord = 0u, .wordCount = 4u},
		{.firstWord = 4u, .wordCount = 1u},
	};
	system.closureRelocations = {{
		1u,
		bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u),
	}};
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
	machine.cpu.start(machine.cartRom.functionAddresses[0]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "cross-image leaf reaches HALT");
	const std::vector<bmsx::CpuCallStackEntry> stack = machine.cpu.getCallStack();
	require(stack.size() == 3u, "cross-image call stack retains cart caller and two system frames");
	require(stack[0].image != stack[1].image && stack[1].image == stack[2].image, "cross-image call stack retains each frame image");
	for (const bmsx::CpuCallStackEntry& frame : stack) {
		require(
			frame.pc >= frame.image->header.textAddress
				&& frame.pc < frame.image->header.textAddress + frame.image->header.textByteCount,
			"call-stack PC belongs to the frame image"
		);
	}
}

void testRfeCannotResumeOutsideTheInterruptedFunctionRecord() {
	CpuTestMachine machine(makeSupervisorSystemImage());
	machine.cpu.start(machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION]);
	require(machine.cpu.run(1) == bmsx::RunResult::Halted, "cart reaches HALT before NMI");
	machine.cpu.requestNonMaskableInterrupt();
	require(machine.cpu.enterPendingInterrupt(), "NMI enters the system exception vector");

	bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	state.epcWord = machine.cartRom.textAddress + 3u * bmsx::INSTRUCTION_BYTES;
	machine.cpu.restoreRuntimeState(state);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "invalid RFE target hard-halts");
	state = machine.cpu.captureRuntimeState();
	require(state.frames.size() == 2u, "invalid RFE target retains both frames");
	require(state.frames.front().functionAddress == machine.cartRom.functionAddresses[CART_USER_HALT_FUNCTION], "invalid RFE target does not replace the interrupted frame");
	require(state.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "invalid RFE target does not pop the exception frame");
}

void testMappedBusErrorsEnterTheSystemExceptionVector() {
	CpuTestMachine machine(makeSupervisorSystemImage());
	machine.cpu.start(machine.systemRom.functionAddresses[USER_BUS_LOAD_FUNCTION]);
	require(machine.cpu.run(4) == bmsx::RunResult::Yielded, "faulting mapped load enters the exception root");
	bmsx::CpuRuntimeState loadFault = machine.cpu.captureRuntimeState();
	require(loadFault.causeWord == bmsx::CPU_CAUSE_CODE_DATA_BUS_ERROR, "mapped load latches DBE");
	require(loadFault.epcWord == machine.systemRom.textAddress + 11u * bmsx::INSTRUCTION_BYTES, "mapped load EPC identifies the physical faulting instruction");
	require(loadFault.badAddressWord == 0u, "DBE leaves BAD_ADDRESS unchanged");
	require(loadFault.frames.back().functionAddress == machine.systemRom.functionAddresses[SYSTEM_EXCEPTION_FUNCTION], "mapped load selects the system exception vector");
	require(bmsx::asNumber(machine.cpu.readFrameRegister(0, 1)) == 1.0, "faulting load does not commit its destination register");
	loadFault.epcWord += bmsx::INSTRUCTION_BYTES;
	machine.cpu.restoreRuntimeState(loadFault);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "RFE can skip the faulting mapped load");
	require(machine.cpu.lastReturnValues.size() == 1u && bmsx::asNumber(machine.cpu.lastReturnValues[0]) == 1.0, "mapped load resume retains the destination value");

	machine.memory.writeMappedU32LE(bmsx::IO_SYS_BUS_FAULT_ACK, 1u);
	machine.memory.readMappedU8(UNMAPPED_ADDRESS);
	machine.cpu.start(
		machine.systemRom.functionAddresses[SYSTEM_BUS_BURST_FUNCTION],
		{},
		bmsx::CPU_STATUS_SYSTEM_ENTRY
	);
	require(machine.cpu.run(10) == bmsx::RunResult::Yielded, "supervisor burst fault enters a nested exception root");
	const bmsx::CpuRuntimeState burstFault = machine.cpu.captureRuntimeState();
	require(burstFault.causeWord == bmsx::CPU_CAUSE_CODE_DATA_BUS_ERROR, "supervisor burst latches DBE");
	require(burstFault.epcWord == machine.systemRom.textAddress + 19u * bmsx::INSTRUCTION_BYTES, "supervisor burst EPC identifies the physical faulting instruction");
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
	machine.cpu.start(machine.systemRom.functionAddresses[0]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "aligned mapped loads complete");
	require(machine.cpu.lastReturnValues.size() == 2u, "aligned mapped loads return both values");
	require(bmsx::asNumber(machine.cpu.lastReturnValues[0]) == 0x5a, "byte access accepts an odd address");
	require(bmsx::asNumber(machine.cpu.lastReturnValues[1]) == F64_VALUE, "f64 access accepts four-byte alignment");
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
		image.irqFunctionIndex = 0u;
		image.exceptionFunctionIndex = 0u;
		CpuTestMachine machine(std::move(image));

		machine.memory.writeMappedU32LE(ALIGNED_ADDRESS, 0x11223344u);
		machine.memory.writeMappedU32LE(ALIGNED_ADDRESS + 4u, 0x55667788u);
		machine.memory.writeMappedU32LE(ALIGNED_ADDRESS + 8u, 0x99aabbccu);
		const bmsx::u32 faultSequence = machine.memory.readBusFaultSequence();

		machine.cpu.start(machine.systemRom.functionAddresses[1]);
		require(machine.cpu.run(100) == bmsx::RunResult::Halted, testCase.name);
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
		const bmsx::Value key = bmsx::valueString(machine.cpu.stringPool().intern(names[index]));
		machine.cpu.setSystemGlobalByKey(key, machine.cpu.createBuiltinFunction(builtinIds[index]));
	}

	machine.cpu.start(machine.systemRom.functionAddresses[0]);
	require(machine.cpu.run(3) == bmsx::RunResult::Yielded, "pcall body should remain preemptible");
	bmsx::CpuRuntimeState state = machine.cpu.captureRuntimeState();
	require(state.protectedCalls.size() == 1u, "save state should retain the active protected call");
	machine.cpu.restoreRuntimeState(state);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "restored pcall should complete");
	require(machine.cpu.lastReturnValues.size() == 3u && bmsx::isTruthy(machine.cpu.lastReturnValues[0]), "pcall should return success");
	require(bmsx::asNumber(machine.cpu.lastReturnValues[1]) == 3.0 && bmsx::asNumber(machine.cpu.lastReturnValues[2]) == 4.0, "pcall should preserve multiple results");

	machine.cpu.start(machine.systemRom.functionAddresses[2]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "xpcall error path should complete");
	require(machine.cpu.lastReturnValues.size() == 2u && !bmsx::isTruthy(machine.cpu.lastReturnValues[0]), "xpcall should return failure");
	require(bmsx::asNumber(machine.cpu.lastReturnValues[1]) == 42.0, "xpcall handler should receive the thrown Lua value");

	machine.cpu.start(machine.systemRom.functionAddresses[6]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "invalid xpcall handler should be caught by the outer pcall");
	require(machine.cpu.lastReturnValues.size() == 2u && !bmsx::isTruthy(machine.cpu.lastReturnValues[0]), "xpcall should validate its handler before running the body");
	require(bmsx::valueIsString(machine.cpu.lastReturnValues[1]), "invalid xpcall handler should return a Lua error value");

	machine.cpu.start(machine.systemRom.functionAddresses[7]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "xpcall handler failure should complete");
	require(machine.cpu.lastReturnValues.size() == 2u && !bmsx::isTruthy(machine.cpu.lastReturnValues[0]), "xpcall handler failure should return failure");
	require(bmsx::valueIsString(machine.cpu.lastReturnValues[1]), "xpcall handler failure should return the Lua error-in-handler value");
	require(machine.cpu.stringPool().toString(bmsx::asStringId(machine.cpu.lastReturnValues[1])) == "error in error handling", "xpcall should hide the handler's replacement error");

	machine.cpu.start(machine.systemRom.functionAddresses[5]);
	require(machine.cpu.run(100) == bmsx::RunResult::Halted, "nested pcall should complete");
	require(machine.cpu.lastReturnValues.size() == 4u, "nested pcall should preserve the open result sequence");
	require(bmsx::isTruthy(machine.cpu.lastReturnValues[0]) && bmsx::isTruthy(machine.cpu.lastReturnValues[1]), "nested pcall should prefix both success values");
	require(bmsx::asNumber(machine.cpu.lastReturnValues[2]) == 3.0 && bmsx::asNumber(machine.cpu.lastReturnValues[3]) == 4.0, "nested pcall should preserve child results");
}

} // namespace

int main() {
	testManualNmiAndSaveStateReturn();
	testPrivilegeVectorRoutingAndCp0Fault();
	testSystemAndOrdinaryGlobalRegisterfilesStayDistinct();
	testCp0ExecTransfersToTheSelectedPhysicalCartridgeImage();
	testControlFlowCannotLeaveTheActiveFunctionRecord();
	testInvalidClosureTargetHardHalts();
	testCrossImageCallStackPcsBelongToTheirFrames();
	testRfeCannotResumeOutsideTheInterruptedFunctionRecord();
	testMappedBusErrorsEnterTheSystemExceptionVector();
	testMappedMemoryAlignmentContract();
	testAddressErrorsPrecedeMappedMemoryBusCycles();
	testProtectedCallMicrocodePreemptsSavesAndHandlesLuaErrors();
	return 0;
}
