#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include <iostream>
#include <stdexcept>
#include <tuple>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
	CallFrame& restart() {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
		return *cpu.activeThread()->frameAtDepth(0);
	}
};

void logicalStringWork(bool scalar, OpCode op) {
	test::Blua32TestImage image;
	image.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(op), 0, 1, 2);
	for (int i = 1; i < 4; ++i) writeInstruction(image.text, i, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 8}};
	CpuMachine machine(image, scalar);
	for (int repeat = 0; repeat < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++repeat) {
		auto& frame = machine.restart();
		const std::string right("a😀雪\0", 9);
		const std::string left = repeat % 3 == 2 ? right : repeat % 3 == 1 ? "a😀雪" : "z😀雪";
		frame.registers.set(1, valueString(machine.cpu.stringPool().intern(left)));
		frame.registers.set(2, valueString(machine.cpu.stringPool().intern(right)));
		machine.cpu.runUntilDepth(0, 1);
		const int leftCount = repeat % 3 == 2 ? 4 : 3;
		const int cycles = BASE_CYCLES[static_cast<u8>(op)]
			+ (op == OpCode::CONCAT ? 4 + leftCount : op == OpCode::CONCATN ? 6 + leftCount : op == OpCode::EQ ? 0 : leftCount);
		require(machine.cpu.instructionBudgetRemaining == 1 - cycles, "logical text work charges agree on cold and warm native paths");
		if (op == OpCode::CONCAT || op == OpCode::CONCATN) {
			require(machine.cpu.stringPool().toString(asStringId(frame.registers.get(0))) == left + right, "concatenation preserves complete Unicode and zero codepoints");
		} else {
			const bool matched = op == OpCode::LT ? left < right : op == OpCode::LE ? left <= right : left == right;
			const int words = matched ? 2 : 1;
			require(frame.pc == machine.rom.textAddress + words * INSTRUCTION_BYTES, "a charged comparison keeps its exact skip boundary");
		}
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (!scalar) {
		auto& page = *machine.cpu.activeThread()->currentFrame->decodedPage;
		test::waitForNativeEntry(machine.cpu, page, (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		require(page.nativeBlocks != nullptr, "the warm cases really use native regions");
	}
#endif
}

void selectAndChar(bool scalar) {
	for (const auto [builtin, argc, wanted] : {std::tuple{BuiltinFunctionId::Select, 33, 0}, std::tuple{BuiltinFunctionId::Select, 33, 1}, std::tuple{BuiltinFunctionId::Select, 33, 2}, std::tuple{BuiltinFunctionId::Select, 33, 35}, std::tuple{BuiltinFunctionId::StringChar, 3, 1}}) {
		test::Blua32TestImage image;
		image.text.resize(2 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::CALL), 0, argc + 1, wanted);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 40}};
		CpuMachine machine(image, scalar);
		if (builtin == BuiltinFunctionId::Select) {
			for (const int selector : {-2147483647 - 1, 0, -32, -1, 1, 32, 33}) {
				auto& frame = machine.restart();
				frame.registers.set(0, machine.cpu.createBuiltinFunction(builtin));
				frame.registers.set(1, valueInteger(selector));
				for (int i = 1; i <= 32; ++i) frame.registers.set(i + 1, valueInteger(i));
				machine.cpu.runUntilDepth(0, 1);
				const auto expected = selector == 33 ? valueNil() : valueInteger(selector == -1 || selector == 32 ? 32 : 1);
				if (wanted != 1 && !(wanted == 0 && selector == 33)) require(frame.registers.get(0) == expected, "negative select clips to valid argument storage even at INT_MIN");
				const int available = selector == 33 ? 0 : selector == -1 || selector == 32 ? 1 : 32;
				const int placed = wanted == 0 ? available : wanted - 1;
				require(frame.top == placed, "select preserves open and fixed receiving ranges");
				for (int i = available; i < placed; ++i) require(frame.registers.get(i) == valueNil(), "select retains requested nil padding");
			}
		} else {
			for (const bool invalid : {false, true}) {
				auto& frame = machine.restart();
				frame.registers.set(0, machine.cpu.createBuiltinFunction(builtin));
				frame.registers.set(1, valueInteger(invalid ? -1 : 65));
				frame.registers.set(2, valueInteger(0)); frame.registers.set(3, valueInteger(0x1f600));
				machine.cpu.runUntilDepth(0, 1);
				if (invalid) require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT, "discarding char results must not discard validation");
				require(machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 5, "char charges all supplied codepoints, including argument faults");
			}
		}
	}
}
} // namespace
int main() {
	try {
		for (const bool scalar : {true, false}) {
			for (const auto op : {OpCode::CONCAT, OpCode::CONCATN, OpCode::LT, OpCode::LE, OpCode::EQ}) logicalStringWork(scalar, op);
			selectAndChar(scalar);
		}
		std::cout << "String operation cycles and builtin demand passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
