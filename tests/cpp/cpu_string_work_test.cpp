#include "common/hash_fnv.h"
#include "support/string_pool_reference.h"
#include "support/heap_allocator_reference.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/string_slice_reference.h"
#include <array>
#include <iostream>
#include <stdexcept>
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
	CpuMachine(const test::Blua32TestImage& image, bool scalar, CartridgeSocketMediaPair slots = {})
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, slots}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
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
		frame.registers.set(1, valueString(bmsx::test::StringPoolReference(machine.cpu).intern(left)));
		frame.registers.set(2, valueString(bmsx::test::StringPoolReference(machine.cpu).intern(right)));
		machine.cpu.runUntilDepth(0, 1);
		const int leftCount = static_cast<int>(left.size());
		const int cycles = BASE_CYCLES[static_cast<u8>(op)]
			+ (op == OpCode::EQ ? 0 : leftCount);
		require(machine.cpu.instructionBudgetRemaining == 1 - cycles, "logical text work charges agree on cold and warm native paths");
		const bool matched = op == OpCode::LT ? left < right : op == OpCode::LE ? left <= right : left == right;
		const int words = matched ? 2 : 1;
		require(frame.readControl(bmsx::FrameField::Pc) == machine.rom.textAddress + words * INSTRUCTION_BYTES, "a charged comparison keeps its exact skip boundary");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (!scalar) {
		auto& page = *machine.cpu.activeThread()->currentFrame->decodedPage;
		test::waitForNativeEntry(machine.cpu, page, (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		require(page.nativeBlocks != nullptr, "the warm cases really use native regions");
	}
#endif
}

void grantedStringOrder(bool scalar, bool inclusive) {
	test::Blua32TestImage image;
	const auto op = inclusive ? OpCode::LE : OpCode::LT;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(op), 0, 1, 2);
	for (int i = 1; i < 4; ++i) writeInstruction(image.text, i, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
	CpuMachine machine(image, scalar);
	auto& cpu = machine.cpu;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (!scalar) {
		cpu.prepareSystemNativeCode();
		auto& image = *cpu.activeThread()->currentFrame->executionImage;
		require(image.nativeCodeLookup != nullptr, "long comparison has a prepared native image");
		const auto* page = image.nativeCodeLookup->find(machine.rom.textAddress, 0);
		require(page && page->nativeBlocks->entries[(machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
			"long comparison starts at a published native entry");
	}
#endif
	auto& frame = machine.restart();
	const auto a = bmsx::test::StringPoolReference(cpu).intern(std::string(513, 'x'));
	const auto b = bmsx::test::StringPoolReference(cpu).intern(std::string(512, 'x') + 'y');
	frame.registers.set(1, valueString(a)); frame.registers.set(2, valueString(inclusive ? a : b)); frame.setTop(3);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(op)] + 7);
	const auto anchor = cpu.captureRuntimeState();
	const auto ram = machine.memory.captureSaveState();
	require(anchor.stringComparison.offset == 7 && anchor.stringComparison.remaining == 506
		&& cpu.instructionBudgetRemaining == 0, "issue only scans the available byte cycles");
	for (int step : {1, 129}) {
		machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(anchor);
		machine.memory.writeRamRecordByte(a + BLUA32_STRING_RECORD_HEADER_SIZE, 'z');
		cpu.requestNonMaskableInterrupt();
		require(!cpu.enterPendingInterrupt(), "NMI cannot split a comparison");
		for (int remaining = 506; remaining;) {
			const int grant = std::min(remaining, step);
			cpu.runUntilDepth(0, grant); remaining -= grant;
			require(cpu.instructionBudgetRemaining == 0, "resumed bytes consume exactly their grant");
			if (remaining) require(cpu.activeThread()->currentFrame->readControl(FrameField::Pc) == machine.rom.textAddress + 4,
				"no skip until the final byte cycle");
		}
		require(cpu.activeThread()->currentFrame->readControl(FrameField::Pc) == machine.rom.textAddress + 8,
			"restore resumes at the saved byte, and retires exactly one skip");
	}
	// A mismatch in the first grant fixes the result, not the duration.
	machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(anchor);
	machine.memory.writeRamRecordByte(a + BLUA32_STRING_RECORD_HEADER_SIZE + 7, 'z');
	cpu.runUntilDepth(0, 1);
	const auto mismatch = cpu.captureRuntimeState();
	require(mismatch.stringComparison.remaining == 505 && mismatch.stringComparison.order == (inclusive ? 0 : 1),
		"the compare pipeline latches unsigned ordering independently of remaining time");
	machine.memory.writeRamRecordByte(a + BLUA32_STRING_RECORD_HEADER_SIZE + 7, 'a');
	cpu.restoreRuntimeState(mismatch); cpu.runUntilDepth(0, 505);
	require(cpu.activeThread()->currentFrame->readControl(FrameField::Pc) == machine.rom.textAddress + (inclusive ? 8 : 4),
		"a saved first difference survives a change to consumed bytes and controls retirement");
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
		bmsx::test::StringPoolReference pool(machine.cpu);
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
		require(pool.compareBytes(mirror, after, 6, 3) == 0 && pool.compareBytes(mirror, after, 10, 3) == 0, "comparison only visits the supplied byte interval");
		require(pool.compareBytes(mirror, straight, 0, 13) == 0 && pool.compareBytes(mirror, after, 6, 4) < 0, "String comparison visits mirrored bytes in order");
		const auto slice = bmsx::test::StringSliceReference::intern(pool, mirror, 6, 6);
		require(pool.toString(slice) == bytes.substr(6, 6) && pool.intern(bytes.substr(6, 6)) == slice,
			"a byte slice crossing the physical seam interns the same result as ordinary bytes");
		const auto doubled = bmsx::test::StringSliceReference::concat(pool, mirror, bytes.size(), mirror, bytes.size());
		require(pool.toString(doubled) == bytes + bytes && pool.intern(bytes + bytes) == doubled,
			"a concatenation miss assembles both wrapped operands in order");
		const auto prefix = pool.intern(bytes.substr(0, 5)), suffix = pool.intern(bytes.substr(5));
		const u32 metadata = bmsx::HeapAllocator(machine.cpu.memory()).managementOffset() + HEAP_STRING_METADATA_OFFSET;
		const u32 count = memory.readRamRecordWord(metadata + 4u);
		const u32 bucket = memory.readRamRecordWord(metadata) + 4u * (fnv1a32(bytes) & (count - 1u));
		memory.writeRamRecordWord(mirror + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
		memory.writeRamRecordWord(bucket, mirror);
		require(pool.find(bytes) == mirror, "intern probing compares the wrapped bytes");
		require(bmsx::test::StringSliceReference::concat(pool, prefix, 5, suffix, bytes.size() - 5) == mirror,
			"an intern hit crosses the candidate seam at a different offset than the operand boundary");
		memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + 12u, '!');
		require(bmsx::test::StringSliceReference::concat(pool, prefix, 5, suffix, bytes.size() - 5) == straight,
			"a matching stored hash cannot hide a mismatch in the wrapped suffix");
		// The two payloads wrap after bytes 8 and 12 respectively.
		const u32 second = mirror - 4;
		for (u32 i = 0; i < 18; ++i) memory.writeRamRecordByte(second + BLUA32_STRING_RECORD_HEADER_SIZE + i, 0x80);
		memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + 13, 0xff);
		require(pool.compareBytes(mirror, second, 1, 12) == 0 && pool.compareBytes(mirror, second, 1, 13) > 0,
			"both independent RAM seams precede the unsigned mismatch");
	}
}

} // namespace
int main() {
	try {
		ramStringPorts();
		for (const bool scalar : {true, false}) {
			for (const auto op : {OpCode::LT, OpCode::LE, OpCode::EQ}) logicalStringWork(scalar, op);
			grantedStringOrder(scalar, false); grantedStringOrder(scalar, true);
		}
		std::cout << "String operation cycles passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
