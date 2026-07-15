#include "machine/bus/io.h"
#include "machine/cpu/cop0.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"

#include <array>
#include <span>
#include <stdexcept>
#include <string>
#include <unordered_map>

namespace {

constexpr int USER_HALT_PROTO = 0;
constexpr int SYSTEM_IRQ_PROTO = 1;
constexpr int CART_IRQ_PROTO = 2;
constexpr int SYSTEM_EXCEPTION_PROTO = 3;
constexpr int USER_CP0_PROTO = 4;
constexpr int SYSTEM_CP0_PROTO = 5;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

bmsx::Proto makeProto(int entryPc, int instructionCount, int maxStack = 1) {
	bmsx::Proto proto;
	proto.entryPC = entryPc;
	proto.codeLen = instructionCount * bmsx::INSTRUCTION_BYTES;
	proto.maxStack = maxStack;
	return proto;
}

struct CpuSupervisorHarness {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::Program program;
	bmsx::ProgramRuntimeSymbols runtimeSymbols;
	std::unordered_map<std::string, bmsx::Value> moduleCache;

	CpuSupervisorHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, irq(memory)
		, cpu(memory, irq) {
		program.programRom.resize(13u * bmsx::INSTRUCTION_BYTES);
		program.programRomTextByteLength = program.programRom.size();
		program.constPoolStringPool = &program.stringPool;
		std::span<bmsx::u8> code(program.programRom);

		bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::HALT), 0, 0, 0);
		bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
		bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
		bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
		bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
		bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_CAUSE, 0);
		bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::RFE), 0, 0, 0);
		bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_STATUS, 0);
		bmsx::writeInstruction(code, 8, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
		bmsx::writeInstruction(code, 9, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
		bmsx::writeInstruction(code, 10, static_cast<bmsx::u8>(bmsx::OpCode::MFC0), 0, bmsx::COP0_STATUS, 0);
		bmsx::writeInstruction(code, 11, static_cast<bmsx::u8>(bmsx::OpCode::MTC0), 0, bmsx::COP0_EPC, 0);
		bmsx::writeInstruction(code, 12, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);

		program.protos.push_back(makeProto(0, 3));
		program.protos.push_back(makeProto(3 * bmsx::INSTRUCTION_BYTES, 1));
		program.protos.push_back(makeProto(4 * bmsx::INSTRUCTION_BYTES, 1));
		program.protos.push_back(makeProto(5 * bmsx::INSTRUCTION_BYTES, 2));
		program.protos.push_back(makeProto(7 * bmsx::INSTRUCTION_BYTES, 3));
		program.protos.push_back(makeProto(10 * bmsx::INSTRUCTION_BYTES, 3));

		irq.reset();
		cpu.setProgram(&program, runtimeSymbols, nullptr, SYSTEM_IRQ_PROTO, CART_IRQ_PROTO, SYSTEM_EXCEPTION_PROTO);
	}
};

void testManualNmiAndSaveStateReturn() {
	CpuSupervisorHarness harness;
	harness.cpu.start(USER_HALT_PROTO);
	require(harness.cpu.run(100) == bmsx::RunResult::Halted, "HALT parks the user frame");
	harness.cpu.requestNonMaskableInterrupt();
	require(harness.cpu.enterPendingInterrupt(), "NMI enters through the CPU interrupt boundary");

	bmsx::CpuRuntimeState active = harness.cpu.captureRuntimeState(harness.moduleCache);
	require(active.frames.size() == 2u, "NMI retains the user frame beneath the exception root");
	require(active.frames.back().protoIndex == SYSTEM_EXCEPTION_PROTO, "NMI selects the system exception vector");
	require(active.frames.back().isExceptionFrame, "NMI marks the exception root");
	require(active.causeWord == bmsx::CPU_CAUSE_NMI, "NMI latches CAUSE.NMI");
	require(active.epcWord == bmsx::INSTRUCTION_BYTES, "asynchronous EPC points after HALT");
	require(active.statusWord == (bmsx::CPU_STATUS_CART_ENTRY << 2u), "exception entry pushes the raw STATUS mode stack");

	harness.cpu.restoreRuntimeState(active, harness.moduleCache);
	require(harness.cpu.run(1) == bmsx::RunResult::Yielded, "MFC0 consumes one instruction before RFE");
	require(bmsx::asNumber(harness.cpu.readFrameRegister(1, 0)) == bmsx::CPU_CAUSE_NMI, "MFC0 reads the raw CAUSE latch");
	require(harness.cpu.run(100) == bmsx::RunResult::Halted, "RFE resumes and completes the retained user frame");
	require(harness.cpu.lastReturnValues.size() == 1u && bmsx::asNumber(harness.cpu.lastReturnValues[0]) == 1.0, "RFE resumes at EPC");
	require(harness.cpu.captureRuntimeState(harness.moduleCache).statusWord == bmsx::CPU_STATUS_CART_ENTRY, "RFE pops the raw STATUS mode stack");
}

void testPrivilegeVectorRoutingAndCp0Fault() {
	CpuSupervisorHarness harness;
	harness.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	harness.irq.raise(bmsx::IRQ_VBLANK);

	harness.cpu.start(USER_HALT_PROTO);
	require(harness.cpu.enterPendingInterrupt(), "user IRQ enters");
	require(harness.cpu.captureRuntimeState(harness.moduleCache).frames.back().protoIndex == CART_IRQ_PROTO, "user IRQ selects the cart vector");

	harness.cpu.start(USER_HALT_PROTO, {}, bmsx::CPU_STATUS_SYSTEM_ENTRY);
	require(harness.cpu.enterPendingInterrupt(), "supervisor IRQ enters");
	require(harness.cpu.captureRuntimeState(harness.moduleCache).frames.back().protoIndex == SYSTEM_IRQ_PROTO, "supervisor IRQ selects the system vector");

	harness.irq.reset();
	harness.cpu.start(USER_CP0_PROTO);
	require(harness.cpu.run(1) == bmsx::RunResult::Yielded, "user MFC0 vectors synchronously");
	bmsx::CpuRuntimeState fault = harness.cpu.captureRuntimeState(harness.moduleCache);
	require(fault.causeWord == bmsx::CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, "user CP0 access latches the privileged-instruction cause");
	require(fault.epcWord == 7u * bmsx::INSTRUCTION_BYTES, "synchronous EPC identifies the faulting instruction");
	require(fault.frames.back().protoIndex == SYSTEM_EXCEPTION_PROTO, "user CP0 fault selects the system exception vector");
	fault.epcWord += bmsx::INSTRUCTION_BYTES;
	harness.cpu.restoreRuntimeState(fault, harness.moduleCache);
	require(harness.cpu.run(100) == bmsx::RunResult::Halted, "edited EPC skips the faulting instruction on RFE");
	require(harness.cpu.lastReturnValues.size() == 1u && bmsx::asNumber(harness.cpu.lastReturnValues[0]) == 1.0, "fault handler resumes the selected user instruction");

	harness.cpu.start(SYSTEM_CP0_PROTO, {}, bmsx::CPU_STATUS_SYSTEM_ENTRY);
	require(harness.cpu.run(100) == bmsx::RunResult::Halted, "supervisor CP0 program completes");
	const bmsx::CpuRuntimeState systemState = harness.cpu.captureRuntimeState(harness.moduleCache);
	require(systemState.epcWord == bmsx::CPU_STATUS_SYSTEM_ENTRY, "MTC0 writes the raw EPC word");
}

} // namespace

int main() {
	testManualNmiAndSaveStateReturn();
	testPrivilegeVectorRoutingAndCp0Fault();
	return 0;
}
