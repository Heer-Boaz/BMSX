#include "common/hash_fnv.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
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
		const int leftCount = static_cast<int>(left.size());
		const int cycles = BASE_CYCLES[static_cast<u8>(op)]
			+ (op == OpCode::CONCAT ? 9 + leftCount : op == OpCode::CONCATN ? 11 + leftCount : op == OpCode::EQ ? 0 : leftCount);
		require(machine.cpu.instructionBudgetRemaining == 1 - cycles, "logical text work charges agree on cold and warm native paths");
		if (op == OpCode::CONCAT || op == OpCode::CONCATN) {
			require(machine.cpu.stringPool().toString(asStringId(frame.registers.get(0))) == left + right, "concatenation preserves all input bytes, including NUL");
		} else {
			const bool matched = op == OpCode::LT ? left < right : op == OpCode::LE ? left <= right : left == right;
			const int words = matched ? 2 : 1;
			require(frame.readControl(bmsx::FrameField::Pc) == machine.rom.textAddress + words * INSTRUCTION_BYTES, "a charged comparison keeps its exact skip boundary");
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

// String records and their index use the physical RAM port, even when
// software writes untrusted words to the language heap via the main bus.
void ramStringPorts() {
	test::Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}};
	{
		CpuMachine machine(image, true);
		auto& pool = machine.cpu.stringPool();
		auto& memory = machine.memory;
		const std::string bytes("wrapRAM!\0\xf7xyz", 13);
		const u32 straight = pool.intern(bytes);
		const u32 after = pool.intern(std::string("wrapRAM!\0\xf8xyz", 13));
		const u32 mirror = RAM_BASE + 2u * MAIN_RAM_SIZE - 24u;
		memory.writeRamRecordWord(mirror, BLUA32_STRING_RECORD_KIND);
		memory.writeRamRecordWord(mirror + BLUA32_STRING_LENGTH_OFFSET, 0xffc0000du);
		memory.writeRamRecordWord(mirror + BLUA32_STRING_HASH_OFFSET, fnv1a32(bytes));
		for (u32 i = 0; i < bytes.size(); ++i) memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + i, static_cast<u8>(bytes[i]));
		require(pool.byteLength(mirror) == 13 && pool.toString(mirror) == bytes, "String length and data use the mirrored RAM port");
		require(pool.byteAt(mirror, 8) == 0 && pool.byteAt(mirror, 9) == 0xf7, "byte reads cross the physical seam");
		require(pool.compare(mirror, straight) == 0 && pool.compare(mirror, after) < 0, "String comparison visits mirrored bytes in order");
		const u32 metadata = machine.cpu.heapAllocator().managementOffset() + HEAP_STRING_METADATA_OFFSET;
		const u32 count = memory.readRamRecordWord(metadata + 4u);
		const u32 bucket = memory.readRamRecordWord(metadata) + 4u * (fnv1a32(bytes) & (count - 1u));
		memory.writeRamRecordWord(mirror + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
		memory.writeRamRecordWord(bucket, mirror);
		require(pool.find(bytes) == mirror, "intern probing compares the wrapped bytes");
	}
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
				require(static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == placed, "select preserves open and fixed receiving ranges");
				for (int i = available; i < placed; ++i) require(frame.registers.get(i) == valueNil(), "select retains requested nil padding");
			}
		} else {
			for (const bool invalid : {false, true}) {
				auto& frame = machine.restart();
				frame.registers.set(0, machine.cpu.createBuiltinFunction(builtin));
				frame.registers.set(1, valueInteger(invalid ? -1 : 65));
				frame.registers.set(2, valueInteger(0)); frame.registers.set(3, valueInteger(0xff));
				machine.cpu.runUntilDepth(0, 1);
				if (invalid) require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT, "discarding char results must not discard validation");
				require(machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 5, "char charges all supplied byte arguments, including argument faults");
			}
		}
	}
}
} // namespace
int main() {
	try {
		ramStringPorts();
		for (const bool scalar : {true, false}) {
			for (const auto op : {OpCode::CONCAT, OpCode::CONCATN, OpCode::LT, OpCode::LE, OpCode::EQ}) logicalStringWork(scalar, op);
			selectAndChar(scalar);
		}
		std::cout << "String operation cycles and builtin demand passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
