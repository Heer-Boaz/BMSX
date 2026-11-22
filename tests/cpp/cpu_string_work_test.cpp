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
#include <array>
#include <iostream>
#include <stdexcept>
#include <tuple>
#include <utility>

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
		const auto slice = pool.internSlice(mirror, 6, 6);
		require(pool.toString(slice) == bytes.substr(6, 6) && pool.intern(bytes.substr(6, 6)) == slice,
			"a byte slice crossing the physical seam interns the same result as ordinary bytes");
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

void stringSlice(bool wide) {
	const u32 callWord = wide ? 1u : 0u;
	const u32 base = wide ? 256u : 0u;
	std::string input(300, 'x');
	input.replace(254, 4, std::string("A\0\xf7" "B", 4));
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.constants = {input};
	image.text.resize((callWord + 3) * INSTRUCTION_BYTES);
	if (wide) writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 1, 0, 0);
	writeInstruction(image.text, callWord, static_cast<u8>(OpCode::CALL), 0, 4, 2);
	writeInstruction(image.text, callWord + 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, callWord + 2, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = callWord + 3, .maxStack = base + 5}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& execution = *native.cpu.activeThread()->currentFrame->executionImage;
	const auto* page = execution.nativeCodeLookup->find(native.rom.textAddress, 0);
	const u32 entryWord = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(page && page->nativeBlocks && page->nativeBlocks->entries[entryWord],
		"the tested StringSlice call has an installed native entry");
#endif
	struct Slice {
		Value first, last;
		size_t offset, bytes;
	};
	const std::array slices{
		Slice{valueInteger(255), valueInteger(258), 254, 4},
		Slice{valueFloat(255.0f), valueFloat(258.0f), 254, 4},
		Slice{valueInteger(256), valueInteger(256), 255, 1},
		Slice{valueInteger(1), valueInteger(300), 0, 300},
	};
	for (const auto& slice : slices) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			auto& frame = machine->restart();
			frame.registers.set(base, cpu.createBuiltinFunction(BuiltinFunctionId::StringSlice));
			frame.registers.set(base + 1, frame.executionImage->constPool.get(0));
			frame.registers.set(base + 2, slice.first);
			frame.registers.set(base + 3, slice.last);
			frame.setTop(base + 4);
			require(cpu.runUntilDepth(0, 1) == RunResult::Yielded
				&& cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 2 - static_cast<int>(slice.bytes) - 1,
				"StringSlice charges CALL, tier two, the inclusive byte count and one placed result");
			require(cpu.readFramePc(0) == machine->rom.textAddress + (callWord + 1) * INSTRUCTION_BYTES
				&& frame.readControl(FrameField::Top) == base + 1,
				"the completed StringSlice call publishes its exact successor and single result");
			const auto result = frame.registers.get(base);
			require(valueIsString(result) && cpu.stringPool().toString(asStringId(result)) == input.substr(slice.offset, slice.bytes),
				"StringSlice preserves its exact raw bytes, including NUL and non-UTF-8");
		}
	}

	// Discarded results do not bypass argument or byte-range admission.
	writeInstruction(image.text, callWord, static_cast<u8>(OpCode::CALL), 0, 4, 1);
	for (const auto [first, last] : std::array{
		std::pair{valueInteger(0), valueInteger(2)}, std::pair{valueInteger(2), valueInteger(1)},
		std::pair{valueInteger(1), valueInteger(301)}, std::pair{valueFloat(1.5f), valueInteger(2)},
		std::pair{valueInteger(1), valueBool(true)},
	}) {
		CpuMachine machine(image, true);
		auto& frame = machine.restart();
		frame.registers.set(base, machine.cpu.createBuiltinFunction(BuiltinFunctionId::StringSlice));
		frame.registers.set(base + 1, valueString(machine.cpu.stringPool().intern(input)));
		frame.registers.set(base + 2, first);
		frame.registers.set(base + 3, last);
		frame.setTop(base + 4);
		machine.cpu.runUntilDepth(0, 1);
		require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
			"StringSlice rejects invalid or non-integral endpoints even when its result is discarded");
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
		for (const bool wide : {false, true}) stringSlice(wide);
		std::cout << "String operation cycles and builtin demand passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
