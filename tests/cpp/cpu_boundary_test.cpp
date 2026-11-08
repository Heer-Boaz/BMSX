#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

test::Blua32TestImage returnImage(OpCode op = OpCode::RET, u8 a = 0, u8 b = 1, u8 c = 0) {
	test::Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(op), a, b, c);
	image.functions = {{.firstWord = 0, .wordCount = 1}};
	image.constants = {11.0, 29.0};
	return image;
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace executionAddressSpace;
	CPU cpu;

	explicit CpuMachine(test::Blua32TestImage image, u32 ramBytes = PSX_MACHINE_SPEC.ramBytes)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, ramBytes)
		, irq(memory), executionAddressSpace(memory), cpu(memory, irq, executionAddressSpace) {
		cpu.reset();
	}
};

void stringBytePositions() {
	struct Case { std::string source; Value position; u8 arguments; Value expected; };
	const std::string unicode("Aé雪\0😀Z", 12);
	for (const bool instrumented : {false, true}) {
		for (const Case& testCase : {
			Case{unicode, valueNil(), 1, valueNumber(65)},
			Case{unicode, valueNil(), 2, valueNumber(65)},
			Case{unicode, valueNumber(2), 2, valueNumber(233)},
			Case{unicode, valueNumber(3), 2, valueNumber(0x96ea)},
			Case{unicode, valueNumber(4), 2, valueNumber(0)},
			Case{unicode, valueNumber(5), 2, valueNumber(0x1f600)},
			Case{unicode, valueNumber(6), 2, valueNumber(90)},
			Case{unicode, valueNumber(7), 2, valueNil()},
			Case{"", valueNil(), 1, valueNil()},
			Case{"abc", valueNumber(0), 2, valueNil()},
			Case{"abc", valueNumber(-1), 2, valueNil()},
			Case{"abc", valueNumber(2.9), 2, valueNumber(98)},
			Case{"abc", valueNumber(4294967298.0), 2, valueNumber(98)},
			Case{"abc", valueNumber(std::numeric_limits<f64>::quiet_NaN()), 2, valueNil()},
			Case{"abc", valueNumber(std::numeric_limits<f64>::infinity()), 2, valueNil()},
			Case{std::string(4096, 'a'), valueNumber(4096), 2, valueNumber(97)},
		}) {
			auto image = returnImage(OpCode::CALL, 0, encodeFixedCallArgCount(testCase.arguments), 1);
			image.text.resize(2 * INSTRUCTION_BYTES);
			writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			image.functions[0].wordCount = 2;
			image.functions[0].maxStack = 3;
			CpuMachine machine(image);
			auto& cpu = machine.cpu;
			if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
			Value* registers = cpu.activeThread()->frames[0]->registers;
			registers[0] = cpu.createBuiltinFunction(BuiltinFunctionId::StringByte);
			registers[1] = valueString(cpu.stringPool().intern(testCase.source));
			registers[2] = testCase.position;
			require(cpu.runUntilDepth(0, 100) == RunResult::Halted, "string.byte executes in both dispatch modes");
			require(cpu.readFrameRegister(0, 0) == testCase.expected, "string.byte preserves scalar, default and signed-word position semantics");
		}
	}
}

void loadKrIndices() {
	const f64 infinity = std::numeric_limits<f64>::infinity();
	const f64 nan = std::numeric_limits<f64>::quiet_NaN();
	for (const auto [input, expected] : {std::pair{0.0, 11.0}, {1.9, 29.0}, {4294967296.0, 11.0}, {nan, 11.0}, {infinity, 11.0}, {-infinity, 11.0}, {-0.0, 11.0}}) {
		CpuMachine machine(returnImage(OpCode::LOADKR, 0, 0, 0));
		machine.cpu.activeThread()->frames[0]->registers[0] = valueNumber(input);
		machine.cpu.runUntilDepth(0, 1);
		require(asNumber(machine.cpu.readFrameRegister(0, 0)) == expected, "LOADKR word conversion");
	}
	for (const f64 input : {2.0, -1.0, 4294967295.0}) {
		CpuMachine machine(returnImage(OpCode::LOADKR, 0, 0, 0));
		machine.cpu.activeThread()->frames[0]->registers[0] = valueNumber(input);
		const u32 pc = machine.cpu.readFramePc(0);
		machine.cpu.runUntilDepth(0, 1);
		require(machine.cpu.readCauseWord() == CPU_CAUSE_CODE_TRAP, "LOADKR range fault");
		require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT, "LOADKR argument reason");
		require(machine.cpu.readEpcWord() == pc, "LOADKR fault EPC");
	}
}

void zeroLoadNil() {
	CpuMachine machine(returnImage(OpCode::LOADNIL, 6, 0, 0));
	machine.cpu.runUntilDepth(0, 1);
	require(machine.cpu.getFrameRegisterCount(0) == 0, "zero LOADNIL does not extend top");
}

void instructionBoundaryResynchronizesAfterFetchOrObservation() {
	for (const bool instrumented : {false, true}) for (const bool mappedFetch : {false, true}) {
		auto image = returnImage(OpCode::MOV, 6, 7, 0);
		image.text.resize(4 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::K0), 6, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 8}, {.firstWord = 2, .wordCount = 2}};
		image.irqFunctionIndex = 1;
		image.exceptionFunctionIndex = 1;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		Value* interruptedRegisters = cpu.activeThread()->frames[0]->registers;
		interruptedRegisters[6] = valueNumber(0);
		interruptedRegisters[7] = valueNumber(99);
		struct Edge { IrqController& irq; u32 instruction; int count = 0; } edge{machine.irq, readLE32(image.text.data())};
		u32 pc = cpu.readFramePc(0);
		if (mappedFetch) {
			pc = IO_GX_GPU_GP0;
			machine.memory.mapIoRead(pc, &edge, [](void* context, u32, MappedBusSignals) {
				auto& event = *static_cast<Edge*>(context);
				++event.count;
				event.irq.raise(IRQ_GPU);
				return event.instruction;
			});
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		} else {
			InstructionObserverBinding observer;
			observer.points[0].insert(pc);
			observer.context = &edge;
			observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) {
				auto& event = *static_cast<Edge*>(context);
				++event.count;
				event.irq.raise(IRQ_GPU);
			};
			cpu.setInstructionObserver(std::move(observer));
		}
		machine.memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		require(cpu.runUntilDepth(0, 2) == RunResult::Yielded, "fetch/observer edge preserves instruction grant");
		require(edge.count == 1 && cpu.activeThread()->frames.size() == 2, "device edge enters the IRQ frame before the next instruction");
		require(cpu.readCauseWord() == CPU_CAUSE_IRQ && cpu.readEpcWord() == pc + INSTRUCTION_BYTES, "interrupt saves the next physical PC");
		require(cpu.activeThread()->frames[0]->registers[6] == valueNumber(99), "the fetched or observed instruction completes before accepting the edge");
		require(cpu.activeThread()->frames.back()->registers[0] == valueNumber(1), "IRQ execution uses its own frame register base");
	}
}

void cachedFetchCrossesWidePagesAndObservesCodeWrites() {
	for (const bool instrumented : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 3;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		std::vector<u8> code(5 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(code, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, 2, static_cast<u8>(OpCode::KSMI), 1, 1, 2);
		writeInstruction(code, 3, static_cast<u8>(OpCode::K1), 2, 0, 0);
		writeInstruction(code, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 2 * INSTRUCTION_BYTES;
		machine.memory.writeBytes(pc, code.data(), code.size());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		for (const int phase : {0, 1, 2}) {
			if (phase == 1) {
				writeInstruction(code, 2, static_cast<u8>(OpCode::KSMI), 1, 1, 15);
				machine.memory.writeBytes(pc + 2 * INSTRUCTION_BYTES, code.data() + 2 * INSTRUCTION_BYTES, INSTRUCTION_BYTES);
			} else if (phase == 2) {
				writeInstruction(code, 0, static_cast<u8>(OpCode::KM1), 0, 0, 0);
				machine.memory.writeBytes(pc, code.data(), INSTRUCTION_BYTES);
			}
			require(cpu.runUntilDepth(0, 8) == RunResult::Yielded, "two cross-page loops exhaust exactly eight guest cycles");
			require(cpu.instructionBudgetRemaining == 0 && cpu.readCauseWord() == 0u, "cached WIDE fetch preserves cycle charge without an exception");
			require(cpu.readFramePc(0) == pc && cpu.lastPc == pc + 4 * INSTRUCTION_BYTES, "backward branches preserve physical next/last PC");
			require(cpu.readFrameRegister(0, 0) == valueNumber(phase == 2 ? -1 : 1), "code writes invalidate a cached prefix page");
			require(cpu.readFrameRegister(0, 1) == valueNumber(phase == 0 ? 66 : 79), "a body-only write invalidates a WIDE prefix in the preceding page");
			require(cpu.readFrameRegister(0, 2) == valueNumber(1), "execution continues after the cross-page WIDE");
		}
	}
}

void rewrittenInstructionRetainsItsOwnCycleCharge() {
	for (const bool instrumented : {false, true}) for (const bool observed : {false, true}) {
		auto image = returnImage();
		image.functions[0].maxStack = 2;
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		const u32 pc = DYNAMIC_RAM_BASE + 0x4000u;
		const u32 destination = pc + 0x100u;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
		cpu.activeThread()->frames[0]->registers[1] = valueNumber(destination);
		int observations = 0;
		if (observed) {
			InstructionObserverBinding observer;
			observer.points[0].insert(pc);
			observer.context = &observations;
			observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) {
				++*static_cast<int*>(context);
			};
			cpu.setInstructionObserver(std::move(observer));
		}
		std::vector<u8> code(INSTRUCTION_BYTES);
		for (const OpCode op : {OpCode::K1, OpCode::STORE_MEM_D, OpCode::K1}) {
			writeInstruction(code, 0, static_cast<u8>(op), 0, 1, static_cast<u8>(MemoryAccessKind::U32LE));
			machine.memory.writeBytes(pc, code.data(), code.size());
			cpu.activeThread()->frames[0]->pc = pc;
			require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "rewritten instruction completes its grant");
			require(cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(op)], "rewritten opcode replaces the old cached cycle charge");
			require(cpu.readFramePc(0) == pc + INSTRUCTION_BYTES && cpu.lastPc == pc, "cycle charge preserves physical PC boundaries");
		}
		require(machine.memory.readMappedU32LE(destination) == 1u, "two-cycle rewritten store executes exactly once");
		require(observations == (observed ? 3 : 0), "observation adds no execution or cycle charge");
	}
}

void closureCallAndReturnRespectFrameBoundaries() {
	for (const bool instrumented : {false, true}) for (int edgeKind = 0; edgeKind < 6; ++edgeKind) {
		constexpr u32 mappedRecord = IO_GX_GPU_GP0 & ~(BLUA32_FUNCTION_ALIGNMENT - 1u);
		test::Blua32TestImage image;
		image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, encodeFixedCallArgCount(0), 1);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 2, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 1, 0);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 3},
			{.firstWord = 5, .wordCount = 2}, {.firstWord = 7, .wordCount = 2}};
		image.irqFunctionIndex = image.exceptionFunctionIndex = 2;
		image.closureRelocations = {{1, edgeKind == 1 ? mappedRecord : test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image);
		auto& cpu = machine.cpu;
		const u32 calleePc = machine.rom.textAddress + 5 * INSTRUCTION_BYTES;
		struct Edge { IrqController& irq; const u8* record; bool armed = false; int count = 0; }
			edge{machine.irq, machine.rom.bytes.data() + machine.rom.functionAddresses[1]};
		if (edgeKind == 1) {
			for (u32 offset = 0; offset <= BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET; offset += 4) {
				machine.memory.mapIoRead(mappedRecord + offset, &edge, [](void* context, u32 address, MappedBusSignals) {
					auto& event = *static_cast<Edge*>(context);
					const u32 offset = address - mappedRecord;
					if (event.armed && offset == BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) {
						++event.count;
						event.irq.raise(IRQ_GPU);
					}
					return readLE32(event.record + offset);
				});
			}
		}
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
		cpu.activeThread()->frames[0]->registers[2] = valueNumber(99);
		require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "closure setup consumes its own physical instruction");
		const u32 callPc = cpu.readFramePc(0);
		if (edgeKind == 3) {
			asClosure(cpu.activeThread()->frames[0]->registers[0])->functionAddress = CART_ROM_BASE;
			require(cpu.runUntilDepth(0, 3) == RunResult::Halted, "a failed call cannot reuse provenance from the previous function read");
			require(cpu.activeThread()->frames.size() == 1 && cpu.readFrameRegister(0, 2) == valueNumber(99), "failed call does not execute its continuation");
			continue;
		}
		if (edgeKind == 4 || edgeKind == 5) {
			if (edgeKind == 5) require(cpu.runUntilDepth(0, 3) == RunResult::Yielded, "prepare RET at callee depth");
			auto state = cpu.captureRuntimeState();
			state.haltedUntilIrqFrameDepth = edgeKind == 4 ? 2 : 1;
			state.haltedUntilIrqThreadRef = state.activeThreadRef;
			cpu.restoreRuntimeState(state);
			require(cpu.runUntilDepth(0, 3) == RunResult::Halted && cpu.instructionBudgetRemaining == 1, "frame transition activates the retained depth-sensitive HALT latch before another instruction");
			require(cpu.readFrameRegister(0, 2) == valueNumber(99), "HALT retains the caller continuation");
			if (edgeKind == 4) require(isNil(cpu.activeThread()->frames[1]->registers[0]), "HALT at new callee depth precedes callee execution");
			continue;
		}
		if (edgeKind == 2) {
			InstructionObserverBinding observer;
			observer.points[0].insert(callPc);
			observer.context = &edge;
			observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) {
				auto& event = *static_cast<Edge*>(context);
				++event.count;
				event.irq.raise(IRQ_GPU);
			};
			cpu.setInstructionObserver(std::move(observer));
		}
		edge.armed = true;
		machine.memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		require(cpu.runUntilDepth(0, 3) == RunResult::Yielded, "CALL and the next physical instruction exhaust their grant");
		if (edgeKind != 0) {
			require(edge.count == 1 && cpu.activeThread()->frames.size() == 3, "call-side device/observer edge enters IRQ before callee execution");
			require(cpu.readCauseWord() == CPU_CAUSE_IRQ && cpu.readEpcWord() == calleePc, "CALL completes before IRQ saves the callee entry PC");
			require(isNil(cpu.activeThread()->frames[1]->registers[0]) && cpu.activeThread()->frames[2]->registers[0] == valueNumber(1), "IRQ, callee and caller retain separate register bases");
			continue;
		}
		require(cpu.activeThread()->frames.size() == 2 && cpu.readFramePc(1) == calleePc + INSTRUCTION_BYTES, "direct call rebinds the callee and stops before RET");
		require(cpu.runUntilDepth(1, 20) == RunResult::Halted && cpu.instructionBudgetRemaining == 18, "return stops at the requested depth with unused cycles retained");
		require(cpu.readFrameRegister(0, 0) == valueNumber(1) && cpu.readFrameRegister(0, 2) == valueNumber(99), "return publishes results without executing the caller continuation");
		require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && cpu.readFrameRegister(0, 2) == valueNumber(1), "resuming after return binds the caller registers");
	}
}

void successorFetchOrdering() {
	auto image = returnImage(OpCode::K1, 0, 0, 0);
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions[0].maxStack = 3;
	image.functions.push_back({.firstWord = 1, .wordCount = 1});
	image.exceptionFunctionIndex = 1;
	// A partial backing page proves cacheability is not a readable-successor capability.
	for (const u32 ramBytes : {PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.ramBytes - 16u}) {
		for (const auto [op, expected] : {std::pair{OpCode::ADD, 4.0}, {OpCode::SHL, 6.0}, {OpCode::SHR, 1.0}}) {
			for (const bool wideSuccessor : {false, true}) {
				for (int dispatch = 0; dispatch < 4; ++dispatch) {
					for (const bool warm : {false, true}) {
						CpuMachine machine(image, ramBytes);
						auto& cpu = machine.cpu;
						const u32 faultAddress = RAM_BASE + ramBytes;
						const u32 currentPc = faultAddress - (wideSuccessor ? 2u : 1u) * INSTRUCTION_BYTES;
						const u32 successorPc = currentPc + INSTRUCTION_BYTES;
						std::vector<u8> instructions((wideSuccessor ? 2u : 1u) * INSTRUCTION_BYTES);
						writeInstruction(instructions, 0, static_cast<u8>(op), 2, 0, 1);
						if (wideSuccessor) writeInstruction(instructions, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
						machine.memory.writeBytes(currentPc, instructions.data(), instructions.size());
						const u32 functionAddress = machine.rom.functionAddresses[0];
						cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, currentPc);
						Value* registers = cpu.activeThread()->frames[0]->registers;
						registers[0] = valueNumber(3.0);
						registers[1] = valueNumber(1.0);
						int observations = 0;
						if (dispatch == 1 || dispatch == 2) {
							InstructionObserverBinding observer;
							observer.points[0].insert(dispatch == 1 ? currentPc : successorPc);
							observer.observe = [](void* state, ExecutionDomainId, u32, const Value*) { ++*static_cast<int*>(state); };
							observer.context = &observations;
							cpu.setInstructionObserver(std::move(observer));
						}
						if (warm) {
							cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
							require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "warm current instruction consumes its grant");
							cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, currentPc);
							observations = 0;
						}
						if (dispatch == 3) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
						else cpu.setExecutionHook({});
						registers[2] = valueNumber(-1.0);
						const u32 faultSequence = machine.memory.readBusFaultSequence();
						require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "current instruction consumes its own grant");
						require(asNumber(cpu.readFrameRegister(0, 2)) == expected, "current numeric result precedes successor fault");
						require(cpu.readFramePc(0) == successorPc, "current instruction advances to successor");
						require(cpu.lastPc == currentPc, "last PC identifies current instruction");
						require(cpu.instructionBudgetRemaining == 0, "current instruction retains its base charge");
						require(cpu.getFrameDepth() == 1, "successor exception does not enter before current instruction");
						require(machine.memory.readBusFaultSequence() == faultSequence, "speculative lookahead issues no faulting bus read");
						require(observations == (dispatch == 1 ? 1 : 0), "only fetched current instruction is observed");
						require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "successor fetch consumes its own grant");
						require(asNumber(cpu.readFrameRegister(0, 2)) == expected, "successor fault retains current result");
						require(cpu.readCauseWord() == CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, "successor fetch records IBE");
						require(cpu.readEpcWord() == successorPc, "successor fetch records instruction-start EPC");
						require(cpu.readBadAddressWord() == 0u, "IBE retains BadAddress");
						require(cpu.instructionBudgetRemaining == 0, "fetch fault has one-cycle charge");
						require(cpu.getFrameDepth() == 2, "successor fetch enters exception frame");
						require(machine.memory.readBusFaultSequence() == faultSequence + 1u, "architectural successor fetch issues its bus read");
						require(machine.memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED, "successor bus fault retains code");
						require(machine.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == faultAddress, "successor bus fault retains physical address");
						require(machine.memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS) == (BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32), "successor bus fault retains access width");
						require(observations == (dispatch == 1 ? 1 : 0), "unfetched successor is never observed");
					}
				}
			}
		}
	}
}

void reservedMemoryKinds() {
	for (const auto op : {OpCode::LOAD_MEM, OpCode::STORE_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM_D}) {
		for (const u8 kind : {6, 63}) {
			for (const bool instrumented : {false, true}) {
				auto image = returnImage(op, 0, 0, kind);
				image.text.resize(2 * INSTRUCTION_BYTES);
				writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 0, 0);
				image.functions.push_back({.firstWord = 1, .wordCount = 1});
				image.exceptionFunctionIndex = 1;
				CpuMachine machine(image);
				auto& cpu = machine.cpu;
				const u32 pc = cpu.readFramePc(0);
				int observations = 0;
				InstructionObserverBinding observer;
				observer.points[0].insert(pc);
				observer.observe = [](void* state, ExecutionDomainId, u32, const Value*) { ++*static_cast<int*>(state); };
				observer.context = &observations;
				cpu.setInstructionObserver(std::move(observer));
				if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
				const u32 faultSequence = machine.memory.readBusFaultSequence();
				require(cpu.runUntilDepth(0, 1) == RunResult::Yielded, "reserved memory instruction exhausts grant");
				require(cpu.readCauseWord() == CPU_CAUSE_CODE_RESERVED_INSTRUCTION, "reserved scalar kind takes instruction exception");
				require(cpu.readEpcWord() == pc, "reserved scalar instruction EPC");
				require(cpu.instructionBudgetRemaining == -1, "reserved scalar instruction keeps base charge");
				require(machine.memory.readBusFaultSequence() == faultSequence, "reserved instruction does not issue a memory request");
				require(observations == 1, "observer sees reserved instruction exactly once");
			}
		}
	}
}

void zeroStackReuse() {
	test::Blua32TestImage image;
	image.text.resize(10 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 0, 1, 1);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 0, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7}, {.firstWord = 7, .wordCount = 2}, {.firstWord = 9, .wordCount = 1, .maxStack = 0}};
	image.closureRelocations = {{1, 0x180}, {4, 0x1a0}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	require(cpu.runUntilDepth(0, 100) == RunResult::Halted, "zero-stack call finishes");
	require(isNil(cpu.readCompletionValues()[0]), "reused ordinary zero-stack frame clears its spare slot");
	cpu.activeThread()->stack[0] = valueNumber(91.0);
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, 0x1a0);
	require(isNil(cpu.readFrameRegister(0, 0)), "completion zero-stack frame clears its spare slot");
}

void haltYieldPrecedence() {
	for (const bool instrumented : {false, true}) {
		for (int latch = 0; latch < 3; ++latch) {
			CpuMachine machine(returnImage());
			auto& cpu = machine.cpu;
			if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
			if (latch == 0) cpu.haltUntilIrq();
			else {
				auto state = cpu.captureRuntimeState();
				if (latch == 1) state.hardHalted = true;
				else state.memoryWriteBlocked = true;
				cpu.restoreRuntimeState(state);
			}
			cpu.requestYield();
			require(cpu.runUntilDepth(0, 1) == RunResult::Halted, "halted state wins over simultaneous yield");
			require(cpu.captureRuntimeState().yieldRequested, "halted state retains pending yield");
		}
	}
}

void cachedPcWrapping() {
	for (const bool instrumented : {false, true}) {
		for (const u8 width : {1, 2}) {
			for (const bool skip : {false, true}) {
				CpuMachine machine(returnImage());
				auto& cpu = machine.cpu;
				if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
				auto& frame = *cpu.activeThread()->frames[0];
				DecodedInstructionPage page(true, nullptr);
				page.refreshState.fill(0);
				frame.pc = skip ? 0xfffffff8u : 0xfffffffcu;
				frame.decodedPage = &page;
				frame.decodedPageAddress = 0xfffffc00u;
				page.words[255].width = width;
				page.words[255].op = page.words[255].dispatchOp = static_cast<u8>(OpCode::K1);
				page.words[255].baseCycles = page.words[255].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
				page.words[254].width = 1;
				page.words[254].op = page.words[254].dispatchOp = static_cast<u8>(OpCode::EQ);
				page.words[254].baseCycles = page.words[254].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::EQ)];
				cpu.runUntilDepth(0, 1);
				require(frame.pc == (width - 1u) * INSTRUCTION_BYTES, "sequential/wide/skip PC wraps to a word");
			}
		}
	}
	CpuMachine machine(returnImage());
	auto& cpu = machine.cpu;
	auto& frame = *cpu.activeThread()->frames[0];
	DecodedInstructionPage page(true, nullptr);
	page.refreshState.fill(0);
	frame.pc = 0xfffffff8u;
	frame.decodedPage = &page;
	frame.decodedPageAddress = 0xfffffc00u;
	page.words[254].width = page.words[255].width = 1;
	page.words[254].op = static_cast<u8>(OpCode::SHL);
	page.words[254].dispatchOp = static_cast<u8>(DecodedDispatchOp::FusedShlBxor);
	page.words[254].baseCycles = page.words[254].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::SHL)];
	page.words[255].op = page.words[255].dispatchOp = static_cast<u8>(OpCode::BXOR);
	page.words[255].baseCycles = page.words[255].dispatchCycles = BASE_CYCLES[static_cast<u8>(OpCode::BXOR)];
	cpu.runUntilDepth(0, 2);
	require(frame.pc == 0u, "fused successor PC wraps to a word");
}

void imageTextImport() {
	auto image = returnImage(OpCode::LOADK, 0, 0, 0);
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions[0].wordCount = 2;
	image.constants = {std::string("\xef\xbb\xbf" "A")};
	CpuMachine machine(image);
	machine.cpu.runUntilDepth(0, 100);
	require(machine.cpu.stringPool().toString(asStringId(machine.cpu.readCompletionValues()[0])) == "\xef\xbb\xbf" "A", "initial U+FEFF is preserved");
	for (const std::vector<u8>& bytes : {std::vector<u8>{0xc0, 0x80}, {0xed, 0xa0, 0x80}, {0xf4, 0x90, 0x80, 0x80}, {0xe2, 0x82}, {0x80}, {0xe2, 0x28, 0xa1}}) {
		auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		const u32 table = readLE32(rom.bytes.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
		const u32 address = readLE32(rom.bytes.data() + table + BLUA32_CONSTANT_PAYLOAD_OFFSET);
		std::copy(bytes.begin(), bytes.end(), rom.bytes.begin() + address);
		writeLE32(rom.bytes.data() + table + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET, static_cast<u32>(bytes.size()));
		Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addressSpace(memory);
		CPU cpu(memory, irq, addressSpace);
		bool rejected = false;
		try { cpu.reset(); } catch (const std::runtime_error&) { rejected = true; }
		require(rejected, "external malformed UTF8 image text is rejected");
	}
}

void bootAddressWrap() {
	auto system = test::encodeBlua32TestRom(RomImageDomain::System, returnImage());
	auto cart = test::encodeBlua32TestRom(RomImageDomain::Cartridge, returnImage());
	writeLE32(cart.bytes.data() + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, 0xfffffff0u);
	Memory memory(MemoryInit{system.bytes, test::cartridgeSlots(cart.bytes)}, PSX_MACHINE_SPEC.ramBytes);
	ExecutionAddressSpace addressSpace(memory);
	require(addressSpace.resolveDomain(0)->imageAddress == 0x0ffffff0u, "boot image address wraps as a raw word");
}
} // namespace

int main() {
	try {
		stringBytePositions(); loadKrIndices(); zeroLoadNil(); successorFetchOrdering(); reservedMemoryKinds(); zeroStackReuse();
		instructionBoundaryResynchronizesAfterFetchOrObservation();
		cachedFetchCrossesWidePagesAndObservesCodeWrites();
		rewrittenInstructionRetainsItsOwnCycleCharge();
		closureCallAndReturnRespectFrameBoundaries();
		haltYieldPrecedence(); cachedPcWrapping(); imageTextImport(); bootAddressWrap();
		std::cout << "CPU boundary tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
