#include "common/hash_fnv.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/scheduler/device.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
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
	const auto a = cpu.stringPool().intern(std::string(513, 'x'));
	const auto b = cpu.stringPool().intern(std::string(512, 'x') + 'y');
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

void grantedConcatRegisters() {
	constexpr int count = 65;
	test::Blua32TestImage im; im.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(im.text, 0, static_cast<u8>(OpCode::CONCATN), 1, 1, 1, 1);
	writeInstruction(im.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(im.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	im.functions = {{.firstWord=0,.wordCount=2,.maxStack=count+1},{.firstWord=2,.wordCount=1}}; im.exceptionFunctionIndex=1;
	CpuMachine m(im, true); auto& cpu = m.cpu; auto& pool = cpu.stringPool(); auto& frame = m.restart();
	const auto empty = pool.intern(""), first = pool.intern("first"), last = pool.intern("unread");
	for (int i = 1; i <= count; ++i) frame.registers.set(i, valueString(empty));
	frame.registers.set(2, valueString(first)); frame.registers.set(count, valueString(last)); frame.setTop(1);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CONCATN)] + 1);
	const auto zero = cpu.captureRuntimeState();
	require(zero.concat.registersLeft == 64 && zero.concat.nextRegister == 2 && !zero.concat.length,
		"an empty sampled operand does not retire the pending register scan");
	const auto ram = m.memory.captureSaveState();
	cpu.requestNonMaskableInterrupt();
	require(!cpu.enterPendingInterrupt(), "the register scan is active before any result bytes are known");
	frame.registers.set(1, valueBool(false));
	for (int i = 2; i <= count; ++i) frame.registers.set(i, valueString(empty));
	cpu.runUntilDepth(0, 63);
	require(frame.registers.get(1) == valueBool(false), "an all-empty range waits for its final register");
	cpu.runUntilDepth(0, 1);
	require(frame.registers.get(1) == valueString(empty) && !cpu.instructionBudgetRemaining, "zero result bytes need no extra grant");
	m.memory.restoreSaveState(ram); cpu.restoreRuntimeState(zero);
	cpu.runUntilDepth(0, 1);
	auto& live = *cpu.activeThread()->currentFrame;
	live.registers.set(2, valueNil()); live.registers.set(3, valueInteger(-7));
	cpu.collectHeap();
	require(pool.find("first") == first && pool.find("unread") == last, "both sides of the admission frontier are GC roots");
	const auto state = cpu.captureRuntimeState(); const auto savedRam = m.memory.captureSaveState();
	cpu.runUntilDepth(0, count - 2);
	const std::string expected = "first-7unread";
	require(!cpu.instructionBudgetRemaining && live.registers.get(1) == valueString(empty), "final register cycle does not publish nonempty bytes");
	cpu.runUntilDepth(0, expected.size());
	require(pool.toString(asStringId(live.registers.get(1))) == expected && !cpu.instructionBudgetRemaining, "sample registers only on their cycle");
	m.memory.restoreSaveState(savedRam); cpu.restoreRuntimeState(state);
	const auto huge = pool.intern("huge");
	m.memory.writeRamRecordWord(huge + BLUA32_STRING_LENGTH_OFFSET, MAIN_RAM_SIZE - 1u);
	cpu.activeThread()->currentFrame->registers.set(4, valueString(huge));
	cpu.runUntilDepth(0, 4);
	require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY && cpu.readEpcWord() == m.rom.textAddress
		&& !cpu.captureRuntimeState().concat.active() && cpu.instructionBudgetRemaining == 4 - (count - 2) - static_cast<int>(MAIN_RAM_SIZE),
		"a resumed overlength range faults at issue PC with saturated byte and outstanding range charges");
}

void incrementalConcatRoots() {
	constexpr int count = 48;
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::CONCATN), 0, 1, count);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = count + 1}};
	CpuMachine m(image, true);
	auto& cpu = m.cpu; auto& frame = m.restart(); auto& pool = cpu.stringPool(); auto& gc = cpu.gcHeap();
	std::array<StringId, count> ids;
	std::string expected;
	for (int i = 0; i < count; ++i) {
		const std::string text(16, static_cast<char>(65 + i));
		ids[i] = pool.intern(text); expected += text; frame.registers.set(i + 1, valueString(ids[i]));
	}
	frame.setTop(count + 1);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CONCATN)] + count);
	for (int i = 0; i <= count; ++i) frame.registers.set(i, valueNil());
	auto step = [&] {
		if (gc.finalMarkPending()) gc.stepFinalMark(2);
		else gc.step(valueNil(), valueNil(), valueNil(), 0, false, 2);
	};
	const auto color = m.memory.readRamRecordByte(ids[0] + 1);
	step(); cpu.runUntilDepth(0, 7 * 16);
	while (gc.active() && !gc.finalMarkPending()) {
		require(m.memory.readRamRecordByte(ids[0] + 1) == color, "ordinary marking does not walk the pending operands");
		step();
	}
	require(gc.finalMarkPending(), "the mutator stops before the intern pool sweep");
	while (m.memory.readRamRecordByte(ids[7] + 1) == color && gc.finalMarkPending()) step();
	require(m.memory.readRamRecordByte(ids[7] + 1) != color && m.memory.readRamRecordByte(ids[8] + 1) == color,
		"the stopped collector yields inside the unread operand bank");
	const auto state = cpu.captureRuntimeState(); const auto ram = m.memory.captureSaveState();
	for (int grant : {2, 17}) {
		m.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		while (gc.active()) {
			if (gc.finalMarkPending()) gc.stepFinalMark(grant);
			else step();
		}
		for (int i = 0; i < count; ++i) {
			const auto found = pool.find(std::string_view(expected).substr(i * 16, 16));
			require(i < 7 ? !found : found == ids[i], "only unread sources retained across restore");
		}
		cpu.runUntilDepth(0, (count - 7) * 16);
		require(pool.toString(asStringId(cpu.rootThread()->currentFrame->registers.get(0))) == expected, "restored concatenation retires");
	}
}

void grantedConcat(bool scalar) {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::CONCATN), 1, 1, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 8}};
	CpuMachine m(image, scalar); auto& cpu = m.cpu;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (!scalar) cpu.prepareSystemNativeCode();
#endif
	auto& frame = m.restart(); auto& pool = cpu.stringPool();
	std::string source(513, 'g'); source[128] = '\0'; source[127] = static_cast<char>(0xff);
	const auto left = pool.intern(source), right = pool.intern("tail");
	frame.registers.set(1, valueString(left)); frame.registers.set(2, valueInteger(-12345)); frame.registers.set(3, valueString(right));
	std::string sampled = source; sampled[200] = '!';
	const auto existing = pool.intern(sampled + "-12345tail"); frame.registers.set(4, valueString(existing)); frame.setTop(5);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CONCATN)] + 3 + 129);
	const auto saved = cpu.captureRuntimeState(); const auto ram = m.memory.captureSaveState();
	require(saved.concat.bytes == source.substr(0, 129) && saved.concat.hash == fnv1a32(saved.concat.bytes),
		"checkpoint contains exactly the sampled prefix and its FNV state");
	for (int grant : {1, 173}) {
		m.memory.restoreSaveState(ram); cpu.restoreRuntimeState(saved);
		auto& live = *cpu.activeThread()->currentFrame;
		m.memory.writeRamRecordByte(left + BLUA32_STRING_RECORD_HEADER_SIZE + 5, 'z');
		m.memory.writeRamRecordByte(left + BLUA32_STRING_RECORD_HEADER_SIZE + 200, '!');
		live.registers.set(3, valueBool(true));
		cpu.requestNonMaskableInterrupt(); require(!cpu.enterPendingInterrupt(), "NMI waits for concat retirement");
		for (int leftBytes = 513 + 6 + 4 - 129; leftBytes;) {
			const int n = std::min(grant, leftBytes);
			cpu.runUntilDepth(0, n); leftBytes -= n;
			require(!cpu.instructionBudgetRemaining && live.registers.get(1) == valueString(leftBytes ? left : existing),
				"concat preserves the destination until its final cycle and interns the sampled bytes");
		}
		require(!cpu.captureRuntimeState().concat.length, "retired assembly leaves no checkpoint payload");
	}
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
		require(pool.compareBytes(mirror, after, 6, 3) == 0 && pool.compareBytes(mirror, after, 10, 3) == 0, "comparison only visits the supplied byte interval");
		require(pool.compareBytes(mirror, straight, 0, 13) == 0 && pool.compareBytes(mirror, after, 6, 4) < 0, "String comparison visits mirrored bytes in order");
		const auto slice = pool.internSlice(mirror, 6, 6);
		require(pool.toString(slice) == bytes.substr(6, 6) && pool.intern(bytes.substr(6, 6)) == slice,
			"a byte slice crossing the physical seam interns the same result as ordinary bytes");
		const auto doubled = pool.internConcat(mirror, bytes.size(), mirror, bytes.size());
		require(pool.toString(doubled) == bytes + bytes && pool.intern(bytes + bytes) == doubled,
			"a concatenation miss assembles both wrapped operands in order");
		const auto prefix = pool.intern(bytes.substr(0, 5)), suffix = pool.intern(bytes.substr(5));
		const u32 metadata = machine.cpu.heapAllocator().managementOffset() + HEAP_STRING_METADATA_OFFSET;
		const u32 count = memory.readRamRecordWord(metadata + 4u);
		const u32 bucket = memory.readRamRecordWord(metadata) + 4u * (fnv1a32(bytes) & (count - 1u));
		memory.writeRamRecordWord(mirror + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
		memory.writeRamRecordWord(bucket, mirror);
		require(pool.find(bytes) == mirror, "intern probing compares the wrapped bytes");
		require(pool.internConcat(prefix, 5, suffix, bytes.size() - 5) == mirror,
			"an intern hit crosses the candidate seam at a different offset than the operand boundary");
		memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + 12u, '!');
		require(pool.internConcat(prefix, 5, suffix, bytes.size() - 5) == straight,
			"a matching stored hash cannot hide a mismatch in the wrapped suffix");
		// The two payloads wrap after bytes 8 and 12 respectively.
		const u32 second = mirror - 4;
		for (u32 i = 0; i < 18; ++i) memory.writeRamRecordByte(second + BLUA32_STRING_RECORD_HEADER_SIZE + i, 0x80);
		memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + 13, 0xff);
		require(pool.compareBytes(mirror, second, 1, 12) == 0 && pool.compareBytes(mirror, second, 1, 13) > 0,
			"both independent RAM seams precede the unsigned mismatch");
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

void openSelectPlacesAliasedResults(bool scalar) {
	for (const u8 wanted : {0, 1, 2, 6}) {
		test::Blua32TestImage image;
		image.mappedCode = false;
		image.text.resize(2 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::CALL), 0, 0, wanted);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 8}};
		CpuMachine machine(image, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (!scalar) machine.cpu.prepareSystemNativeCode();
#endif
		const auto number = valueFloat(9.25f);
		for (const bool countMode : {false, true}) {
			auto& frame = machine.restart();
			frame.registers.set(0, machine.cpu.createBuiltinFunction(BuiltinFunctionId::Select));
			frame.registers.set(1, countMode ? valueString(machine.cpu.stringPool().intern("#")) : valueInteger(-2));
			frame.registers.set(2, valueBool(true));
			frame.registers.set(3, number);
			frame.registers.set(4, valueBool(false));
			frame.setTop(5);
			const int produced = countMode ? 1 : 2;
			const int placed = wanted ? wanted - 1 : produced;
			const int cost = BASE_CYCLES[static_cast<u8>(OpCode::CALL)] +
				BUILTIN_FUNCTION_COSTS[static_cast<size_t>(BuiltinFunctionId::Select)].base + placed;
			require(machine.cpu.runUntilDepth(0, cost) == RunResult::Yielded &&
				machine.cpu.instructionBudgetRemaining == 0 && machine.cpu.readFramePc(0) == machine.rom.textAddress + INSTRUCTION_BYTES,
				"select places its results before yielding on its exact grant");
			require(frame.readWindow(FrameField::Top) == placed, "select publishes the selected top, not the argument top");
			for (int i = 0; i < placed; ++i) {
				const Value expected = i >= produced ? valueNil() : countMode ? valueInteger(3) : i == 0 ? number : valueBool(false);
				require(frame.registers.get(i) == expected, "open select preserves payloads and tags and pads only the requested tail");
			}
		}
#if defined(BMSX_NATIVE_GATE_PROFILE)
		if (!scalar) require(machine.cpu.nativeGateProfile().builtinAttempts == 2 &&
			machine.cpu.nativeGateProfile().builtinDeclines == 0, "both open select calls complete as native leaves");
#endif
	}
}

void mappedStringCopiesStorage() {
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::CALL), 0, 3, 2);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4}};
	constexpr std::array<u8, 2> slot0{0x81u, 0x4bu}, slot1{0x22u, 0x5au};
	CartridgeSocketMediaPair slots{};
	slots[0] = CartridgeCardMedia{slot0, 2u, false};
	slots[1] = CartridgeCardMedia{slot1, std::nullopt, false};
	CpuMachine machine(image, true, slots);
	auto& cpu = machine.cpu;
	auto& memory = machine.memory;
	DeviceScheduler scheduler(cpu);
	DmaController dma(memory, cpu, machine.irq, scheduler);
	memory.cartridgeController().connect(memory, machine.irq, dma);
	constexpr u32 source = RAM_BASE + 0x20000u;
	const std::string bytes = std::string(255, 'm') + std::string("\0\xffK", 3);
	for (u32 i = 0; i < bytes.size(); ++i) memory.writeMappedU8(source + i, static_cast<u8>(bytes[i]));

	const auto call = [](CpuMachine& owner, u32 address, i32 count) -> CallFrame& {
		auto& cpu = owner.cpu;
		auto& frame = owner.restart();
		frame.registers.set(0, cpu.createBuiltinFunction(BuiltinFunctionId::StringFromBytes));
		frame.registers.set(1, valueInteger(static_cast<i32>(address)));
		frame.registers.set(2, valueInteger(count));
		frame.setTop(3);
		cpu.runUntilDepth(0, 1);
		return frame;
	};
	const auto id = asStringId(call(machine, source, static_cast<i32>(bytes.size())).registers.get(0));
	require(cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 2 - static_cast<i32>(bytes.size()) - 1,
		"mapped String work pays for the admitted byte span and exactly one result");
	require(cpu.stringPool().toString(id) == bytes && id == cpu.stringPool().intern(bytes), "mapped and ordinary copies intern identical raw bytes");
	require(asStringId(call(machine, source, static_cast<i32>(bytes.size())).registers.get(0)) == id, "a repeated range reuses its String identity");
	require(cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 2 - static_cast<i32>(bytes.size()) - 1,
		"the byte charge does not depend on an intern hit");
	memory.writeMappedU8(source + 255, 42);
	require(cpu.stringPool().toString(id) == bytes, "the result owns its storage");

	const auto copy = [&](u32 address, i32 count) {
		return asStringId(call(machine, address, count).registers.get(0));
	};
	const u32 systemTail = static_cast<u32>(machine.rom.bytes.size() - 1u);
	const auto lastSystemByte = static_cast<char>(memory.readMappedU8(systemTail));
	require(cpu.stringPool().toString(copy(systemTail, 1)) == std::string(1, lastSystemByte),
		"the last installed system ROM byte is readable");
	require(cpu.stringPool().toString(copy(CART_ROM_BASE, 2)) == std::string("\x81\x4b", 2),
		"read installed ROM bytes from the selected physical socket");
	memory.writeMappedU8(CART_RAM_BASE + 1u, 0xfeu);
	const auto cartRam = copy(CART_RAM_BASE + 1u, 1);
	memory.writeMappedU8(CART_RAM_BASE + 1u, 0x11u);
	require(cpu.stringPool().toString(cartRam) == std::string("\xfe", 1), "copy does not borrow selected cartridge RAM");
	memory.writeMappedU32LE(IO_CART_SELECT, 1u);
	require(cpu.stringPool().toString(copy(CART_ROM_BASE, 2)) == std::string("\x22\x5a", 2),
		"changing physical sockets changes the admitted bytes");

	int ioReads = 0;
	memory.mapIoRead(IO_IRQ_FLAGS, &ioReads, [](void* context, u32, MappedBusSignals) -> u32 {
		++*static_cast<int*>(context);
		return 67u;
	});
	require(cpu.stringPool().toString(asStringId(call(machine, IO_IRQ_FLAGS, 0).registers.get(0))).empty(), "zero count touches no device");
	for (const auto& [address, count] : std::array{
		std::pair{IO_IRQ_FLAGS, 1}, std::pair{memory.ramBusEnd() - 1, 2},
		std::pair{0x0fffffffu, 1}, std::pair{IO_BASE - 1u, 2}, std::pair{source, -1},
		std::pair{systemTail, 2}, std::pair{CART_ROM_BASE + 1u, 2},
		std::pair{CART_ROM_BASE, static_cast<i32>(CART_ROM_SIZE)}, std::pair{CART_RAM_BASE + 1u, 2},
		std::pair{SYSTEM_ROM_SIZE - 1u, 2}, std::pair{CART_RAM_BASE - 1u, 2},
		std::pair{CART_MMIO_BASE - 1u, 2}, std::pair{CART_MMIO_BASE, 1},
	}) {
		CpuMachine rejected(image, true, slots);
		rejected.memory.mapIoRead(IO_IRQ_FLAGS, &ioReads, [](void* context, u32, MappedBusSignals) -> u32 {
			++*static_cast<int*>(context);
			return 67u;
		});
		call(rejected, address, count);
		require(rejected.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
			"invalid storage read faults at its owning builtin");
	}
	require(ioReads == 0, "mapped String admission never reads an IO register");
	call(machine, CART_RAM_BASE, 1);
	require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
		"the selected ROM-only card has no RAM source");
}

} // namespace
int main() {
	try {
		grantedConcatRegisters();
		incrementalConcatRoots();
		ramStringPorts();
		mappedStringCopiesStorage();
		for (const bool scalar : {true, false}) {
			for (const auto op : {OpCode::CONCAT, OpCode::CONCATN, OpCode::LT, OpCode::LE, OpCode::EQ}) logicalStringWork(scalar, op);
			grantedConcat(scalar);
			grantedStringOrder(scalar, false); grantedStringOrder(scalar, true);
			selectAndChar(scalar);
			openSelectPlacesAliasedResults(scalar);
		}
		std::cout << "String operation cycles and builtin demand passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
