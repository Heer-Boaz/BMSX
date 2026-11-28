#include "support/string_pool_reference.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool scalar,
		const CartridgeSocketMediaPair& slots = test::cartridgeSlots())
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES))
		, memory(MemoryInit{rom.bytes, slots}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void genericPredicatesAndStringChargeAgree() {
	constexpr std::array operations{OpCode::EQ, OpCode::LT, OpCode::LE};
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (size_t i = 0; i < operations.size(); ++i) for (bool expected : {false, true}) {
		const u32 word = 4 * static_cast<u32>(i) + 2 * expected;
		writeInstruction(image.text, word, static_cast<u8>(operations[i]), expected ? 2 : 0, 0, 1);
		writeInstruction(image.text, word + 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions.push_back({.firstWord = word, .wordCount = 2, .maxStack = 2});
	}
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	struct Comparison {
		Value left, right;
		std::array<bool, operations.size()> results;
		int orderedStringCycles = 0;
	};
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto& registers = cpu.activeThread()->currentFrame->registers;
		const auto a = valueString(bmsx::test::StringPoolReference(cpu).intern("aa"));
		const auto b = valueString(bmsx::test::StringPoolReference(cpu).intern("aaa"));
		const std::array cases{
			Comparison{valueInteger(16777216), valueFloat(16777216.0f), {true, false, true}},
			Comparison{valueFloat(16777216.0f), valueInteger(16777217), {false, true, true}},
			Comparison{valueFloatBits(BLUA32_FLOAT_NAN), valueFloatBits(BLUA32_FLOAT_NAN), {false, false, false}},
			Comparison{a, valueInteger(0), {false, false, false}},
			Comparison{a, a, {true, false, true}, 2},
			Comparison{a, b, {false, true, true}, 2},
		};
		for (size_t i = 0; i < operations.size(); ++i) for (bool expected : {false, true}) {
			const size_t function = 2 * i + expected;
			const u32 pc = machine->rom.textAddress + 2 * static_cast<u32>(function) * INSTRUCTION_BYTES;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				const auto& image = *cpu.activeThread()->currentFrame->executionImage;
				const auto& page = *image.nativeCodeLookup->find(pc, 0);
				require(page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
					"the generic comparison entry is resident");
			}
#endif
			for (const auto& comparison : cases) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[function], pc);
				registers.set(0, comparison.left);
				registers.set(1, comparison.right);
				const int expectedDebt = operations[i] == OpCode::EQ ? 0 : -comparison.orderedStringCycles;
				const bool skips = comparison.results[i] != expected;
				require(cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(operations[i])]) == RunResult::Yielded
					&& cpu.readFramePc(0) == pc + (skips ? 2u : 1u) * INSTRUCTION_BYTES
					&& cpu.readCurrentInstructionPc() == pc && cpu.lastPc == pc
					&& cpu.instructionBudgetRemaining == expectedDebt,
					"generic comparisons use exact value order, A polarity and ordered-String work");
			}
		}
	}
}

void compareWithOneIntegerProof() {
	constexpr std::array ops{OpCode::EQ, OpCode::LT, OpCode::LE};
	test::Blua32TestImage image;
	image.constants = {i32{16777217}};
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (auto op : ops) for (bool integerLeft : {false, true}) {
		const u32 word = image.functions.size() * 4u;
		writeInstruction(image.text, word, static_cast<u8>(OpCode::LOADK), 1, 0, 0);
		writeInstruction(image.text, word + 1, static_cast<u8>(op), 0, integerLeft, !integerLeft);
		writeInstruction(image.text, word + 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, word + 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions.push_back({.firstWord = word, .wordCount = 4, .maxStack = 2});
	}
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	for (size_t i = 0; i < image.functions.size(); ++i) {
		const u32 pc = native.rom.textAddress + i * 4u * INSTRUCTION_BYTES;
		const int grant = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(ops[i / 2])];
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& imageState = *native.cpu.activeThread()->currentFrame->executionImage;
		const auto& page = *imageState.nativeCodeLookup->find(pc, 0);
		require(page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
			"the integer-producing prefix is compiled");
#endif
		for (auto dynamic : {valueInteger(16777217), valueInteger(-1), valueFloat(16777216.0f),
			valueFloat(16777218.0f), valueFloatBits(BLUA32_FLOAT_NAN), valueFloatBits(0x7f800000),
			valueBool(false), valueFromTag(ValueTag::String, 16777217)}) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[i], pc);
				machine->cpu.activeThread()->currentFrame->registers.set(0, dynamic);
			}
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			require(native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0) && native.cpu.instructionBudgetRemaining == 0,
				"one proven Integer compares exactly across types in either operand position");
		}
	}
}

void equalityConsumesOnlyRelevantValuePlanes() {
	test::Blua32TestImage image;
	image.constants = {std::monostate{}, false, true, std::string("identity")};
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (u8 k = 0; k < 4; ++k) for (bool knownLeft : {false, true}) {
		const u32 word = image.functions.size() * 4;
		writeInstruction(image.text, word, static_cast<u8>(OpCode::LOADK), 1, 0, k);
		writeInstruction(image.text, word + 1, static_cast<u8>(OpCode::EQ), 0, knownLeft, !knownLeft);
		writeInstruction(image.text, word + 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, word + 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions.push_back({.firstWord = word, .wordCount = 4, .maxStack = 2});
	}
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		const Value str = valueString(bmsx::test::StringPoolReference(cpu).intern("identity"));
		const std::array known{valueNil(), valueBool(false), valueBool(true), str};
		for (unsigned fn = 0; fn < image.functions.size(); ++fn) {
			const u32 pc = machine->rom.textAddress + fn * 4 * INSTRUCTION_BYTES;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				const auto& imageState = *cpu.activeThread()->currentFrame->executionImage;
				const auto& page = *imageState.nativeCodeLookup->find(pc, 0);
				require(page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES] != nullptr,
					"the equality prefix is resident");
			}
#endif
			for (Value other : {valueFromTag(ValueTag::Nil, 17), valueFromTag(ValueTag::True, 42),
				valueFromTag(ValueTag::False, 9), str, valueString(bmsx::test::StringPoolReference(cpu).intern("different")),
				valueInteger(valuePayload(str)), valueFloatBits(BLUA32_FLOAT_NAN)}) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[fn], pc);
				cpu.activeThread()->currentFrame->registers.set(0, other);
				const int grant = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::EQ)];
				require(cpu.runUntilDepth(0, grant) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0
					&& cpu.readFramePc(0) == pc + (valuesEqual(known[fn / 2], other) ? 3u : 2u) * INSTRUCTION_BYTES,
					"primitive payloads are ignored, but reference equality needs both the tag and identity word");
			}
		}
	}
}

void stringOrderingKeepsResidentValuesAndExactFrontiers() {
	for (const auto op : {OpCode::LT, OpCode::LE}) for (const bool expected : {true, false}) {
		test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 3, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::KSMI), 4, 0, 2);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(op), expected, 0, 1);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 0, 2);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::MOV), 7, 4, 0);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 0, 1);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::MOV), 8, 4, 0);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::JMP), 0, 63, 55, 255);
		image.functions = {{.firstWord = 0, .wordCount = 9, .maxStack = 9}};
		image.constants = {i32{9}};
		CpuMachine native(image, false), scalar(image, true);
		const u32 pc = native.rom.textAddress;
		const int prefix = BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::KSMI)];
		const int grant = prefix + BASE_CYCLES[static_cast<u8>(op)];
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		native.cpu.prepareSystemNativeCode();
		const auto& installed = *native.cpu.activeThread()->frameAtDepth(0)->executionImage;
		const auto* page = installed.nativeCodeLookup->find(pc, 0);
		const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const auto* block = page->nativeBlocks->entries[word].get();
		require(block && block->admissionCycles == prefix && block->sourceWords >= 5,
			"the generated entry admits the prefix and comparison in one grant");
#endif
		for (auto* machine : {&native, &scalar}) {
			auto& registers = machine->cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(0, valueString(bmsx::test::StringPoolReference(machine->cpu).intern("mz")));
			registers.set(1, valueString(bmsx::test::StringPoolReference(machine->cpu).intern("my")));
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded,
			"the String comparison consumes both bytes and exhausts the grant");
		for (auto* machine : {&native, &scalar}) {
			const auto& cpu = machine->cpu;
			require(cpu.readFramePc(0) == pc + (expected ? 5u : 4u) * INSTRUCTION_BYTES
				&& cpu.readCurrentInstructionPc() == pc + 2u * INSTRUCTION_BYTES
				&& cpu.lastPc == pc + 3u * INSTRUCTION_BYTES && cpu.instructionBudgetRemaining == -2,
				"ordering charges string work at the exact WIDE and fused JMP frontier");
		}
		require(native.cpu.captureRuntimeState() == scalar.cpu.captureRuntimeState()
			&& test::sameLanguageRam(native.cpu, scalar.cpu), "ordering publishes the same architectural state");
		for (auto* machine : {&native, &scalar}) {
			auto& registers = machine->cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(3, valueInteger(0));
			registers.set(4, valueInteger(1));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
		}
		const auto linkedWord = expected ? 5u : 7u;
		const int continuation = BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + (expected ? 0 : BASE_CYCLES[static_cast<u8>(OpCode::JMP)]);
		require(test::runCpuParity(native.cpu, scalar.cpu, grant + 2 + continuation) == RunResult::Yielded
			&& native.cpu.readFramePc(0) == pc + (linkedWord + 1u) * INSTRUCTION_BYTES
			&& native.cpu.lastPc == pc + linkedWord * INSTRUCTION_BYTES && native.cpu.instructionBudgetRemaining == 0
			&& native.cpu.readFrameRegister(0, expected ? 7 : 8) == valueInteger(2),
			"the linked successor sees the retained value with its exact known charge");
		require(native.cpu.captureRuntimeState() == scalar.cpu.captureRuntimeState()
			&& test::sameLanguageRam(native.cpu, scalar.cpu), "the linked successor publishes the same architectural state");
	}
}

void numericRkComparisonsBelongToTheirExecutionImage() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 63, 7); // R0 == K0
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::KFALSE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::KTRUE), 1, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 4}};
	image.constants = {i32{0}};
	auto stringImage = image; stringImage.constants = {std::string("same-slot")};
	const auto cart = test::encodeBlua32TestRom(RomImageDomain::Cartridge, stringImage, test::RAM_CODE_FIXTURE_BYTES);
	const auto replacement = test::encodeBlua32TestRom(RomImageDomain::System, stringImage, test::RAM_CODE_FIXTURE_BYTES);
	CpuMachine native(image, false, test::cartridgeSlots(cart.bytes)), scalar(image, true, test::cartridgeSlots(cart.bytes));
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
	std::array<Blua32ExecutionImage*, 2> owners{};
	for (const auto domain : {SYSTEM_EXECUTION_DOMAIN_ID, ExecutionDomainId{0}, SYSTEM_EXECUTION_DOMAIN_ID, ExecutionDomainId{0}}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, domain,
				domain == SYSTEM_EXECUTION_DOMAIN_ID ? machine->rom.functionAddresses[0] : cart.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.activeThread()->currentFrame->registers.set(0, valueString(bmsx::test::StringPoolReference(machine->cpu).intern("same-slot")));
		}
		test::runCpuParity(native.cpu, scalar.cpu, 1024);
		const auto& frame = *native.cpu.activeThread()->currentFrame;
		require(frame.registers.get(1) == valueBool(domain == 0) && frame.readControl(bmsx::FrameField::Pc) == DYNAMIC_RAM_BASE,
			"the same RAM instruction and RK index use the activation's Number or String pool, not another resident image");
		const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
		require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)), "both image-local comparisons match complete scalar state");
		owners[domain == 0 ? 1 : 0] = frame.executionImage;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		test::waitForNativeEntry(native.cpu, *frame.decodedPage, 0);
		require(frame.decodedPage->nativeBlocks && frame.decodedPage->nativeBlocks->entries[0],
			"each constant-pool kind has its own warmed native comparison at the shared physical RAM PC");
#endif
	}
	require(owners[0] != owners[1], "the two active domains retain distinct constant-pool owners");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto* cartBlock = owners[1]->nativeCodeLookup->find(DYNAMIC_RAM_BASE, 0)->nativeBlocks->entries[0].get();
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.installSystemRom(replacement.bytes);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, replacement.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.activeThread()->currentFrame->registers.set(0, valueString(bmsx::test::StringPoolReference(machine->cpu).intern("same-slot")));
	}
	test::runCpuParity(native.cpu, scalar.cpu, 4);
	require(native.cpu.activeThread()->currentFrame->registers.get(1) == valueBool(false),
		"replacing raw ROM bytes does not mutate an already activated numeric constant pool");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.replaceExecutionImage(machine->addresses.resolveSystemDomain());
		// Image replacement retires code; the revision producer then relocates
		// the suspended activation before executing it again.
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, replacement.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1024);
	require(native.cpu.activeThread()->currentFrame->registers.get(1) == valueBool(true),
		"image replacement recompiles the same RK index as String rather than retaining numeric specialization");
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)), "the relocated replacement preserves full scalar state");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& frame = *native.cpu.activeThread()->currentFrame;
	test::waitForNativeEntry(native.cpu, *frame.decodedPage, 0);
	require(frame.decodedPage->nativeBlocks && frame.decodedPage->nativeBlocks->entries[0]
		&& owners[1]->nativeCodeLookup->find(DYNAMIC_RAM_BASE, 0)->nativeBlocks->entries[0].get() == cartBlock,
		"replacement publishes a new warmed system comparison without retiring the other domain's RAM code");
#endif
}

void changingSkippedBytesRetireResolvedEdges() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 3, 6, 6);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::EQ), 1, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 5, 2, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}, {.firstWord = 6, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(0)); frame.registers.set(1, valueInteger(1));
		frame.registers.set(2, valueInteger(73)); frame.registers.set(6, valueInteger(1));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 800);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(native.cpu, page, 0);
	const auto* block = page.nativeBlocks->entries[0].get();
	require(block && block->sourceWords == 4 && block->sideExits.back().exit == NativeBlockExit::Continue
		&& block->sideExits.back().nextPc == DYNAMIC_RAM_BASE + 4u * INSTRUCTION_BYTES,
		"the hot native comparison retains the fetched WIDE dependency and a fixed skip edge");
#endif
	for (const bool wide : {false, true, false}) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		test::waitForFixtureWorkerRequests(native.cpu);
#endif
		std::array<u8, INSTRUCTION_BYTES> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(wide ? OpCode::WIDE : OpCode::K0), 0, 0, 0);
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES, replacement.data(), replacement.size());
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.writeControl(bmsx::FrameField::Top, 0); frame.registers.set(2, valueInteger(73));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::ADD)] + BASE_CYCLES[static_cast<u8>(OpCode::EQ)]);
			require(frame.readControl(bmsx::FrameField::Pc) == DYNAMIC_RAM_BASE + (wide ? 4u : 3u) * INSTRUCTION_BYTES
				&& frame.registers.get(2) == valueInteger(73) && frame.registers.get(3) == valueInteger(2) && static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == 4,
				"only a taken comparison skip decodes the current complete successor without executing it");
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(!page.nativeBlocks || !page.nativeBlocks->entries[0],
			"rewriting the skipped instruction retires the resolved native edge before reusing its width");
#endif
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
			"comparison and WIDE skips retain scalar budget and last-PC boundaries");
		for (auto* machine : {&native, &scalar}) machine->cpu.runUntilDepth(0, 800);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		test::waitForFixtureWorkerRequests(native.cpu);
		for (int pass = 0; pass < 4 && (!page.nativeBlocks || !page.nativeBlocks->entries[0]); ++pass) {
			test::runCpuParity(native.cpu, scalar.cpu, 800);
			test::waitForFixtureWorkerRequests(native.cpu);
		}
#endif
		test::waitForNativeEntry(native.cpu, page, 0);
		require(page.nativeBlocks && page.nativeBlocks->entries[0], "the changed comparison warms and compiles again");
#endif
	}
}

void maximumLengthSkipDependencyRetires() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (int instruction = 0; instruction < 63; ++instruction) {
		writeInstruction(image.text, instruction * 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, instruction * 2 + 1, static_cast<u8>(OpCode::MOV), 3, 3, 0);
	}
	writeInstruction(image.text, 126, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 127, static_cast<u8>(OpCode::EQ), 1, 0, 1);
	writeInstruction(image.text, 128, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 129, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 130, static_cast<u8>(OpCode::JMP), 0, 61, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 131, .maxStack = 4}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.registers.set(0, valueInteger(0)); frame.registers.set(1, valueInteger(1));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 8192);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(native.cpu, page, 0);
	require(page.nativeBlocks->entries[0] && page.nativeBlocks->entries[0]->sourceWords == 130,
		"the maximum-size body also retains both skipped WIDE words");
#endif
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::K0), 2, 0, 0);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE + 129u * INSTRUCTION_BYTES,
		replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(!page.nativeBlocks || !page.nativeBlocks->entries[0], "the last dependent word retires the complete native body");
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 8192);
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu))
		&& native.cpu.lastPc == scalar.cpu.lastPc,
		"updated WIDE skip dependencies preserve guest state at the admitted boundary");
}

void resolvedComparisonLinksBothPaths() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 2);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 3, 3, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::ADD), 4, 4, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 5}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		for (int reg = 0; reg < 5; ++reg) machine->cpu.activeThread()->frameAtDepth(0)->registers.set(reg, valueInteger(reg == 1 ? 1 : 0));
	}
	for (const int value : {0, 1}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(value));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	for (int pass = 0; pass < 3; ++pass) for (const int value : {0, 1}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(value));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
#endif
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage, 0);
	const auto& cache = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks;
	const auto& root = *cache.entries[0];
	require(root.sourceWords == 2 && !cache.entries[1] && cache.entries[2] && cache.entries[4]
		&& root.sideExits.back().exit == NativeBlockExit::Continue,
		"the fused comparison exposes both compiled targets without a dynamic skip");
	for (const auto* edge : std::array<const NativeBlockExitSite*, 2>{&root.terminal, &root.sideExits.back()}) {
		const auto& target = cache.entries[(edge->nextPc - DYNAMIC_RAM_BASE) / INSTRUCTION_BYTES];
		require(target && (target->region == root.region ? !edge->link.target : edge->link.target == target.get()),
			"each comparison outcome uses an internal edge or an actual link to its independent owner");
	}
#endif
	for (const int value : {0, 1}) for (int grant = 1; grant <= 32; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(value));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
		require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu))
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc() && native.cpu.lastPc == scalar.cpu.lastPc,
			"linked comparisons retain the full state and charge of each admitted segment");
	}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	std::array<u32, 2> observations{};
	int index = 0;
	for (auto* machine : {&native, &scalar}) {
		InstructionObserverBinding observer;
		observer.points[0].insert(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
		observer.context = &observations[index++];
		observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<u32*>(context); };
		machine->cpu.setInstructionObserver(std::move(observer));
		machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(0));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 512);
	const auto observedNative = native.cpu.captureRuntimeState(), observedScalar = scalar.cpu.captureRuntimeState();
	require(observations[0] > 0 && observations[0] == observations[1]
		&& (observedNative == observedScalar && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)),
		"an observed JMP still executes its observer exactly once per real instruction");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	for (int pass = 0; pass < 4 && (!native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks
		|| !native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[0]); ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 512);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
#endif
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage, 0);
	const auto& observed = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[0];
	require(observed.terminal.currentPc == DYNAMIC_RAM_BASE && std::none_of(observed.sideExits.begin(), observed.sideExits.end(), [](const auto& exit) {
		return exit.currentPc == DYNAMIC_RAM_BASE + INSTRUCTION_BYTES;
	}), "an observed JMP is not consumed by the paired branch");
#endif
}


void pairedWideJumpsRetainBoundariesAndMutableTargets() {
	for (const bool comparisonWide : {false, true}) for (const bool jumpWide : {false, true}) {
		for (const auto op : {OpCode::EQ, OpCode::LT, OpCode::LE}) for (const bool expected : {false, true}) {
			test::Blua32TestImage image; image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
			u32 word = 0;
			if (comparisonWide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), expected ? 3 : 0, 0, 0);
			writeInstruction(image.text, word++, static_cast<u8>(op), comparisonWide ? 0 : expected ? 1 : 0, 0, 2);
			const u32 jumpWord = word;
			if (jumpWide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
			const u32 jumpBody = word;
			writeInstruction(image.text, word, static_cast<u8>(OpCode::JMP), 0, 0, 15 - word); ++word;
			writeInstruction(image.text, word++, static_cast<u8>(OpCode::ADD), 3, 3, 1);
			writeInstruction(image.text, word, static_cast<u8>(OpCode::JMP), 0, 63, 63 - word, 255);
			for (const auto pair : {std::array<u32, 2>{16, 4}, std::array<u32, 2>{20, 6}}) {
				writeInstruction(image.text, pair[0], static_cast<u8>(OpCode::ADD), pair[1], pair[1], 1);
				writeInstruction(image.text, pair[0] + 1, static_cast<u8>(OpCode::JMP), 0, 63, 62 - pair[0], 255);
			}
			// A separately enterable native predecessor links into the comparison.
			writeInstruction(image.text, 24, static_cast<u8>(OpCode::JMP), 0, 63, 39, 255);
			const u32 crossPageWord = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
			const u32 crossPageDelta = 0u - crossPageWord - 1u;
			writeInstruction(image.text, crossPageWord, static_cast<u8>(OpCode::JMP), 0,
				(crossPageDelta >> 6u) & 63u, crossPageDelta & 63u, (crossPageDelta >> 12u) & 255u);
			image.functions = {{.firstWord = 0, .wordCount = crossPageWord + 1u, .maxStack = 8}};
			CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			native.cpu.setNativeCompilationProfiling(true);
#endif
			for (auto* machine : {&native, &scalar}) {
				machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
				auto& r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
				for (int reg = 0; reg < 8; ++reg) r.set(reg, valueInteger(reg == 1 ? 1 : reg == 2 ? 7 : 0));
			}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			// Heat the comparison alone first: an exhausted one-cycle grant never
			// executes the JMP that this test expects to remain fused.
			for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
				for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
					machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
				test::runCpuParity(native.cpu, scalar.cpu, 1);
			}
			test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage, 0);
#endif
			for (const int value : {6, 7, 8}) {
				for (auto* machine : {&native, &scalar}) {
					machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(value));
					machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
				}
				test::runCpuParity(native.cpu, scalar.cpu, 1024);
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			test::waitForFixtureWorkerRequests(native.cpu);
#endif
			test::waitForNativeEntry(native.cpu, page, 0);
			const auto& root = *page.nativeBlocks->entries[0]; const auto& jumped = root.terminal;
			const int comparisonCycles = BASE_CYCLES[static_cast<u8>(op)];
			const int jumpCycles = BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
			const u32 comparisonLast = DYNAMIC_RAM_BASE + (jumpWord - 1u) * INSTRUCTION_BYTES;
			// Ordering may also guard operand tags with a scalar side exit.
			// Only the two continuing edges describe a retired comparison.
			const auto continuesAt = [&](u32 word) {
				return std::any_of(root.sideExits.begin(), root.sideExits.end(), [&](const auto& exit) {
					return exit.exit == NativeBlockExit::Continue && exit.currentPc == DYNAMIC_RAM_BASE
						&& exit.lastPc == comparisonLast && exit.nextPc == DYNAMIC_RAM_BASE + word * INSTRUCTION_BYTES
						&& exit.cycles == comparisonCycles;
				});
			};
			require(jumped.exit == NativeBlockExit::Continue
				&& jumped.currentPc == DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES
				&& jumped.nextPc == DYNAMIC_RAM_BASE + 16u * INSTRUCTION_BYTES
				&& jumped.lastPc == DYNAMIC_RAM_BASE + jumpBody * INSTRUCTION_BYTES
				&& jumped.cycles == comparisonCycles + jumpCycles
				&& std::count_if(root.sideExits.begin(), root.sideExits.end(), [](const auto& exit) {
					return exit.exit == NativeBlockExit::Continue;
				}) == 2 && continuesAt(jumpWord) && continuesAt(jumpBody + 1u),
				"paired WIDE comparison/JMP exits preserve the executed prefix PCs and each instruction charge");
			require(!page.nativeBlocks->entries[jumpWord], "a JMP reached only through its fused comparison has no redundant body");
#endif
			for (const int linked : {0, 1, 2}) {
				const u32 entryWord = linked == 1 ? 24u : linked == 2 ? crossPageWord : 0u;
				if (linked != 0) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
					test::waitForFixtureWorkerRequests(native.cpu);
					for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
						for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
							machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES);
						test::runCpuParity(native.cpu, scalar.cpu, 1);
					}
					const auto& decodedPredecessor = *native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.find(
						(DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES) & ~MAPPED_PAGE_BYTE_MASK);
					test::waitForNativeEntry(native.cpu, decodedPredecessor, entryWord % crossPageWord);
#endif
					for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) for (auto* machine : {&native, &scalar}) {
						machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES);
						machine->cpu.runUntilDepth(0, 128);
					}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					const auto* predecessorPage = native.cpu.activeThread()->frameAtDepth(0)->executionImage->nativeCodeLookup->find(
						DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES, 0);
					require(predecessorPage && predecessorPage->nativeBlocks && predecessorPage->nativeBlocks->entries[entryWord % crossPageWord],
						"the predecessor is actually compiled before the linked boundary check");
					const auto& predecessor = *predecessorPage->nativeBlocks->entries[entryWord % crossPageWord];
					const auto& comparison = *page.nativeBlocks->entries[0];
					require(predecessor.region == comparison.region || predecessor.terminal.link.target == &comparison,
						"the native predecessor actually links to the comparison");
#endif
				}
				for (const bool strings : {false, true}) {
					for (auto* machine : {&native, &scalar}) {
						auto& r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
						if (strings) {
							const auto left = bmsx::test::StringPoolReference(machine->cpu).intern(expected ? "aaaaaa" : "zzzzzz");
							const auto right = bmsx::test::StringPoolReference(machine->cpu).intern(op == OpCode::EQ && expected ? "aaaaaa" : "mmmmmm");
							r.set(0, valueString(left)); r.set(2, valueString(right));
						} else {
							r.set(0, valueInteger(op == OpCode::EQ ? (expected ? 7 : 6) : (expected ? 6 : 8)));
							r.set(2, valueInteger(7));
						}
						machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0],
							DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES);
						machine->cpu.runUntilDepth(0, linked != 0 ? 4 : 2);
					}
					require(native.cpu.readFramePc(0) == DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES
						&& native.cpu.readFramePc(0) == scalar.cpu.readFramePc(0)
						&& native.cpu.lastPc == scalar.cpu.lastPc
						&& native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
						&& native.cpu.instructionBudgetRemaining == (strings && op != OpCode::EQ ? -6 : 0),
						"an exhausted compare must defer its fused JMP at direct and linked entries");
				}
			}
			for (auto* machine : {&native, &scalar}) machine->cpu.activeThread()->frameAtDepth(0)->registers.set(2, valueInteger(7));
			for (const int value : {6, 7, 8}) for (int grant = 1; grant <= 16; ++grant) {
				for (auto* machine : {&native, &scalar}) {
					machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(value));
					machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
				}
				test::runCpuParity(native.cpu, scalar.cpu, grant);
				const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
				require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu))
					&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc() && native.cpu.lastPc == scalar.cpu.lastPc,
					"paired comparison/JMP preserves register state and the complete admitted charge");
			}
			for (u32 entered = jumpWord; entered <= jumpBody; ++entered) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
				test::waitForFixtureWorkerRequests(native.cpu);
				for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
					for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
						machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + entered * INSTRUCTION_BYTES);
					test::runCpuParity(native.cpu, scalar.cpu, 1);
				}
				test::waitForNativeEntry(native.cpu, page, entered);
#endif
				for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
					for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
						machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + entered * INSTRUCTION_BYTES);
					test::runCpuParity(native.cpu, scalar.cpu, 64);
					const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
					require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)), "independent entries preserve the full machine state");
				}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				require(page.nativeBlocks->entries[entered] && page.nativeBlocks->entries[0],
					"an independently entered JMP prefix or body acquires its own native entry without losing the comparison");
#endif
			}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			test::waitForFixtureWorkerRequests(native.cpu);
#endif
			std::array<u8, INSTRUCTION_BYTES> replacement{};
			writeInstruction(replacement, 0, static_cast<u8>(OpCode::JMP), 0, 0, 19 - jumpBody);
			for (auto* machine : {&native, &scalar}) {
				machine->memory.writeBytes(DYNAMIC_RAM_BASE + jumpBody * INSTRUCTION_BYTES, replacement.data(), replacement.size());
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			require(!page.nativeBlocks || !page.nativeBlocks->entries[0],
				"changing a paired target retires the comparison, including the second word of a WIDE JMP");
#endif
			test::runCpuParity(native.cpu, scalar.cpu, 1024);
			const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
			require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)), "the rewritten paired jump executes exactly the new target");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			test::waitForFixtureWorkerRequests(native.cpu);
			for (int pass = 0; pass < 4 && (!page.nativeBlocks || !page.nativeBlocks->entries[0]); ++pass) {
				test::runCpuParity(native.cpu, scalar.cpu, 1024);
				test::waitForFixtureWorkerRequests(native.cpu);
			}
#endif
			test::waitForNativeEntry(native.cpu, page, 0);
			require(page.nativeBlocks->entries[0]->terminal.nextPc == DYNAMIC_RAM_BASE + 20u * INSTRUCTION_BYTES,
				"the new comparison translation retains the live branch destination");
#endif
		}
	}
}

void pairedJumpLinksAcrossPages() {
	test::Blua32TestImage image; image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
	constexpr u32 second = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 2);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, (second - 2) >> 6u, (second - 2) & 63u);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 3, 3, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, second, static_cast<u8>(OpCode::ADD), 4, 4, 1);
	constexpr i32 back = -static_cast<i32>(second + 2);
	writeInstruction(image.text, second + 1, static_cast<u8>(OpCode::JMP), 0, (back >> 6) & 63, back & 63, 255);
	image.functions = {{.firstWord = 0, .wordCount = second + 2, .maxStack = 5}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		for (int reg = 0; reg < 5; ++reg) machine->cpu.activeThread()->frameAtDepth(0)->registers.set(reg, valueInteger(reg == 1 ? 1 : 0));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	auto& pages = native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages;
	auto& sourcePage = *pages.find(DYNAMIC_RAM_BASE);
	auto& targetPage = *pages.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE);
	for (int pass = 0; pass < 4 && (!sourcePage.nativeBlocks || !sourcePage.nativeBlocks->entries[0]
		|| !targetPage.nativeBlocks || !targetPage.nativeBlocks->entries[0]); ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
	test::waitForNativeEntry(native.cpu, sourcePage, 0);
	test::waitForNativeEntry(native.cpu, targetPage, 0);
	// Resolve the link with actual guest execution after both bodies publish.
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	const auto& lookup = *native.cpu.activeThread()->frameAtDepth(0)->executionImage->nativeCodeLookup;
	auto* page = lookup.find(DYNAMIC_RAM_BASE, 0); auto* target = lookup.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, 0);
	const auto* root = page->nativeBlocks->entries[0].get(); const auto& jumped = root->terminal;
	require(jumped.link.target && jumped.link.target == target->nativeBlocks->entries[0].get(),
		"the paired JMP links directly to its successor on another physical page");
#endif
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::SUB), 4, 4, 1);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(
		DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(page->nativeBlocks->entries[0].get() == root && !jumped.link.target,
		"target retirement unlinks the paired cross-page exit without retiring its independent source");
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)), "a paired cross-page jump sees the rewritten target");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	for (int pass = 0; pass < 4 && (!targetPage.nativeBlocks || !targetPage.nativeBlocks->entries[0]); ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
	test::waitForNativeEntry(native.cpu, targetPage, 0);
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
#endif
	require(jumped.link.target && jumped.link.target == target->nativeBlocks->entries[0].get(), "the paired jump links its regenerated target");
#endif
}

void pairedJumpFaultsOnlyOnTheNextGrant() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 2);
	constexpr u32 jumpWords = 2;
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, jumpWords >> 6u, jumpWords & 63u);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 3, 3, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}, {.firstWord = 8, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	CpuMachine native(image, false), scalar(image, true);
	const u32 end = native.memory.ramBusEnd(), start = end - 4u * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(start, image.text.data(), 4u * INSTRUCTION_BYTES);
		auto& r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
		r.set(0, valueInteger(1)); r.set(1, valueInteger(1)); r.set(2, valueInteger(0)); r.set(3, valueInteger(0));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
		machine->cpu.runUntilDepth(0, 1024);
		r.set(0, valueInteger(0)); machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
		require(machine->cpu.runUntilDepth(0, 4) == RunResult::Yielded && machine->cpu.readFramePc(0) == end
			&& machine->cpu.readCurrentInstructionPc() == start + INSTRUCTION_BYTES && machine->cpu.activeThread()->frameDepth() == 1,
			"a paired JMP completes without speculatively fetching its unmapped target beyond the grant");
	}
	const auto beforeNative = native.cpu.captureRuntimeState(), beforeScalar = scalar.cpu.captureRuntimeState();
	require((beforeNative == beforeScalar && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)), "the pre-fetch paired boundary preserves raw frame state");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.runUntilDepth(0, 1);
		require(machine->cpu.readEpcWord() == end && machine->memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == end,
			"the next grant raises the actual destination fetch fault, not a comparison or JMP fault");
	}
	const auto afterNative = native.cpu.captureRuntimeState(), afterScalar = scalar.cpu.captureRuntimeState();
	require((afterNative == afterScalar && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu))
		&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
		"paired and scalar destination faults retain the same precise prefix and cycle charge");
}

void skipFetchBoundaries() {
	for (const auto flags : {std::array{false, false}, std::array{true, false}, std::array{false, true}}) {
		const bool currentWide = flags[0], skippedWide = flags[1];
		test::Blua32TestImage image;
		image.text.resize(2 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}, {.firstWord = 1, .wordCount = 1}};
		image.exceptionFunctionIndex = 1;
		CpuMachine native(image, false), scalar(image, true);
		const u32 end = native.memory.ramBusEnd();
		const u32 nextPc = end - (skippedWide ? INSTRUCTION_BYTES : 0u);
		const u32 pc = nextPc - (currentWide ? 2u : 1u) * INSTRUCTION_BYTES;
		std::array<u8, 2 * INSTRUCTION_BYTES> code{};
		u32 word = 0;
		if (currentWide) writeInstruction(code, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(code, word++, static_cast<u8>(OpCode::EQ), 1, 0, 1);
		if (skippedWide) { writeInstruction(code, word, static_cast<u8>(OpCode::WIDE), 0, 0, 0); ++word; }
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(pc, code.data(), word * INSTRUCTION_BYTES);
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(0, valueInteger(0)); frame.registers.set(1, valueInteger(0));
			for (u32 visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8u; ++visit) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
				require(machine->cpu.runUntilDepth(0, 1) == RunResult::Yielded && frame.readControl(bmsx::FrameField::Pc) == nextPc
					&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE,
					"an untaken skip performs no future fetch even after native warmup at a physical boundary");
			}
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
		test::waitForNativeEntry(native.cpu, page, (pc & MAPPED_PAGE_BYTE_MASK) >> 2u);
		require(page.nativeBlocks && page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) >> 2u],
			"a boundary comparison enters generated machine code rather than remaining a cold scalar opcode");
#endif
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(1, valueInteger(1));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			require(machine->cpu.runUntilDepth(0, 1) == RunResult::Yielded && machine->cpu.readEpcWord() == nextPc
				&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED
				&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == end,
				"a taken skip retains the skipped prefix EPC and the actual failed body/fetch bus address");
		}
		require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
			"native and scalar fetch-fault exits publish the same comparison boundary");
	}
}

} // namespace

int main() {
	try {
		genericPredicatesAndStringChargeAgree();
		compareWithOneIntegerProof();
		equalityConsumesOnlyRelevantValuePlanes();
		stringOrderingKeepsResidentValuesAndExactFrontiers();
		numericRkComparisonsBelongToTheirExecutionImage();
		changingSkippedBytesRetireResolvedEdges(); maximumLengthSkipDependencyRetires(); resolvedComparisonLinksBothPaths();
		pairedWideJumpsRetainBoundariesAndMutableTargets(); pairedJumpLinksAcrossPages(); pairedJumpFaultsOnlyOnTheNextGrant(); skipFetchBoundaries();
		std::cout << "Compiled comparison boundary tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
