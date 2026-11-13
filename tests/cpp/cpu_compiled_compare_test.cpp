#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

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
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, slots}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void numericRkComparisonsBelongToTheirExecutionImage() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 63, 7); // R0 == K0
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::KFALSE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::KTRUE), 1, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 4}};
	image.constants = {0.0};
	auto stringImage = image; stringImage.constants = {std::string("same-slot")};
	const auto cart = test::encodeBlua32TestRom(RomImageDomain::Cartridge, stringImage);
	const auto replacement = test::encodeBlua32TestRom(RomImageDomain::System, stringImage);
	CpuMachine native(image, false, test::cartridgeSlots(cart.bytes)), scalar(image, true, test::cartridgeSlots(cart.bytes));
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
	std::array<Blua32ExecutionImage*, 2> owners{};
	for (const auto domain : {SYSTEM_EXECUTION_DOMAIN_ID, ExecutionDomainId{0}, SYSTEM_EXECUTION_DOMAIN_ID, ExecutionDomainId{0}}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, domain,
				domain == SYSTEM_EXECUTION_DOMAIN_ID ? machine->rom.functionAddresses[0] : cart.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.activeThread()->currentFrame->registers[0] = valueString(machine->cpu.stringPool().intern("same-slot"));
		}
		test::runCpuParity(native.cpu, scalar.cpu, 1024);
		const auto& frame = *native.cpu.activeThread()->currentFrame;
		require(frame.registers[1] == valueBool(domain == 0) && frame.pc == DYNAMIC_RAM_BASE,
			"the same RAM instruction and RK index use the activation's Number or String pool, not another resident image");
		const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
		require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()), "both image-local comparisons match complete scalar state");
		owners[domain == 0 ? 1 : 0] = frame.executionImage;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
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
		machine->cpu.activeThread()->currentFrame->registers[0] = valueString(machine->cpu.stringPool().intern("same-slot"));
	}
	test::runCpuParity(native.cpu, scalar.cpu, 4);
	require(native.cpu.activeThread()->currentFrame->registers[1] == valueBool(false),
		"replacing raw ROM bytes does not mutate an already activated numeric constant pool");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.replaceExecutionImage(machine->addresses.resolveSystemDomain());
		// Image replacement retires code; the revision producer then relocates
		// the suspended activation before executing it again.
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, replacement.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1024);
	require(native.cpu.activeThread()->currentFrame->registers[1] == valueBool(true),
		"image replacement recompiles the same RK index as String rather than retaining numeric specialization");
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()), "the relocated replacement preserves full scalar state");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& frame = *native.cpu.activeThread()->currentFrame;
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
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers[0] = valueNumber(0); frame.registers[1] = valueNumber(1);
		frame.registers[2] = valueNumber(73); frame.registers[6] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		machine->cpu.runUntilDepth(0, 800);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto* block = page.nativeBlocks->entries[0].get();
	require(block && block->sourceWords == 4 && block->sideExits.back().exit == NativeBlockExit::Continue
		&& block->sideExits.back().nextPc == DYNAMIC_RAM_BASE + 4u * INSTRUCTION_BYTES,
		"the hot native comparison retains the fetched WIDE dependency and a fixed skip edge");
#endif
	for (const bool wide : {false, true, false}) {
		std::array<u8, INSTRUCTION_BYTES> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(wide ? OpCode::WIDE : OpCode::K0), 0, 0, 0);
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES, replacement.data(), replacement.size());
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.top = 0; frame.registers[2] = valueNumber(73);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			machine->cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::ADD)] + BASE_CYCLES[static_cast<u8>(OpCode::EQ)]);
			require(frame.pc == DYNAMIC_RAM_BASE + (wide ? 4u : 3u) * INSTRUCTION_BYTES
				&& frame.registers[2] == valueNumber(73) && frame.registers[3] == valueNumber(2) && frame.top == 4,
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
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.registers[0] = valueNumber(0); frame.registers[1] = valueNumber(1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 8192);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
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
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words())
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
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		for (int reg = 0; reg < 5; ++reg) machine->cpu.activeThread()->frameAtDepth(0)->registers[reg] = valueNumber(reg == 1 ? 1 : 0);
	}
	for (const int value : {0, 1}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(value);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& cache = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks;
	const auto& root = *cache.entries[0];
	require(root.sourceWords == 2 && !cache.entries[1] && cache.entries[2] && cache.entries[4]
		&& root.sideExits.back().exit == NativeBlockExit::Continue,
		"the fused comparison exposes both compiled targets without a dynamic skip");
	for (const auto* edge : {&root.terminal, &root.sideExits.back()}) {
		const auto& target = cache.entries[(edge->nextPc - DYNAMIC_RAM_BASE) / INSTRUCTION_BYTES];
		require(target && (target->region == root.region ? !edge->link.target : edge->link.target == target.get()),
			"each comparison outcome uses an internal edge or an actual link to its independent owner");
	}
#endif
	for (const int value : {0, 1}) for (int grant = 1; grant <= 32; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(value);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
		require(std::ranges::equal(a.snapshot.words(), b.snapshot.words())
			&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc() && native.cpu.lastPc == scalar.cpu.lastPc,
			"linked comparisons retain the full state and charge of each admitted segment");
	}
	std::array<u32, 2> observations{};
	int index = 0;
	for (auto* machine : {&native, &scalar}) {
		InstructionObserverBinding observer;
		observer.points[0].insert(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
		observer.context = &observations[index++];
		observer.observe = [](void* context, ExecutionDomainId, u32, const Value*) { ++*static_cast<u32*>(context); };
		machine->cpu.setInstructionObserver(std::move(observer));
		machine->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(0);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 512);
	const auto observedNative = native.cpu.captureRuntimeState(), observedScalar = scalar.cpu.captureRuntimeState();
	require(observations[0] > 0 && observations[0] == observations[1]
		&& std::ranges::equal(observedNative.snapshot.words(), observedScalar.snapshot.words()),
		"an observed JMP still executes its observer exactly once per real instruction");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
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
			for (auto* machine : {&native, &scalar}) {
				machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
				auto* r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
				for (int reg = 0; reg < 8; ++reg) r[reg] = valueNumber(reg == 1 ? 1 : reg == 2 ? 7 : 0);
			}
			for (const int value : {6, 7, 8}) {
				for (auto* machine : {&native, &scalar}) {
					machine->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(value);
					machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
				}
				test::runCpuParity(native.cpu, scalar.cpu, 1024);
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
			const auto& root = *page.nativeBlocks->entries[0]; const auto& jumped = root.terminal;
			require(jumped.currentPc == DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES
				&& jumped.nextPc == DYNAMIC_RAM_BASE + 16u * INSTRUCTION_BYTES
				&& jumped.lastPc == DYNAMIC_RAM_BASE + jumpBody * INSTRUCTION_BYTES
				&& jumped.cycles == 4 && root.sideExits.size() == 2 && root.sideExits.back().cycles == 2
				&& root.sideExits[0].nextPc == DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES,
				"paired WIDE comparison/JMP exits preserve the executed prefix PCs and each instruction charge");
			require(!page.nativeBlocks->entries[jumpWord], "a JMP reached only through its fused comparison has no redundant body");
#endif
			for (const int linked : {0, 1, 2}) {
				const u32 entryWord = linked == 1 ? 24u : linked == 2 ? crossPageWord : 0u;
				if (linked != 0) {
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
						auto* r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
						if (strings) {
							const auto left = machine->cpu.stringPool().intern(expected ? "aaaaaa" : "zzzzzz");
							const auto right = machine->cpu.stringPool().intern(op == OpCode::EQ && expected ? "aaaaaa" : "mmmmmm");
							r[0] = valueString(left); r[2] = valueString(right);
						} else {
							r[0] = valueNumber(op == OpCode::EQ ? (expected ? 7 : 6) : (expected ? 6 : 8));
							r[2] = valueNumber(7);
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
			for (auto* machine : {&native, &scalar}) machine->cpu.activeThread()->frameAtDepth(0)->registers[2] = valueNumber(7);
			for (const int value : {6, 7, 8}) for (int grant = 1; grant <= 16; ++grant) {
				for (auto* machine : {&native, &scalar}) {
					machine->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(value);
					machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
				}
				test::runCpuParity(native.cpu, scalar.cpu, grant);
				const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
				require(std::ranges::equal(a.snapshot.words(), b.snapshot.words())
					&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc() && native.cpu.lastPc == scalar.cpu.lastPc,
					"paired comparison/JMP preserves register state and the complete admitted charge");
			}
			for (u32 entered = jumpWord; entered <= jumpBody; ++entered) {
				for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
					for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
						machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + entered * INSTRUCTION_BYTES);
					test::runCpuParity(native.cpu, scalar.cpu, 64);
					const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
					require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()), "independent entries preserve the full machine state");
				}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				require(page.nativeBlocks->entries[entered] && page.nativeBlocks->entries[0],
					"an independently entered JMP prefix or body acquires its own native entry without losing the comparison");
#endif
			}
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
			require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()), "the rewritten paired jump executes exactly the new target");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
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
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		for (int reg = 0; reg < 5; ++reg) machine->cpu.activeThread()->frameAtDepth(0)->registers[reg] = valueNumber(reg == 1 ? 1 : 0);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
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
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()), "a paired cross-page jump sees the rewritten target");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(jumped.link.target && jumped.link.target == target->nativeBlocks->entries[0].get(), "the paired jump links its regenerated target");
#endif
}

void pairedJumpFaultsOnlyOnTheNextGrant() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 2);
	constexpr u32 jumpWords = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES - 2;
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, jumpWords >> 6u, jumpWords & 63u);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 3, 3, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}, {.firstWord = 8, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	const u32 end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes, start = end - MAPPED_PAGE_BYTE_SIZE;
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(start, image.text.data(), image.text.size());
		auto* r = machine->cpu.activeThread()->frameAtDepth(0)->registers;
		r[0] = valueNumber(1); r[1] = valueNumber(1); r[2] = valueNumber(0); r[3] = valueNumber(0);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
		machine->cpu.runUntilDepth(0, 1024);
		r[0] = valueNumber(0); machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
		require(machine->cpu.runUntilDepth(0, 4) == RunResult::Yielded && machine->cpu.readFramePc(0) == end
			&& machine->cpu.readCurrentInstructionPc() == start + INSTRUCTION_BYTES && machine->cpu.activeThread()->frameDepth == 1,
			"a paired JMP completes without speculatively fetching its unmapped target beyond the grant");
	}
	const auto beforeNative = native.cpu.captureRuntimeState(), beforeScalar = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(beforeNative.snapshot.words(), beforeScalar.snapshot.words()), "the pre-fetch paired boundary preserves raw frame state");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.runUntilDepth(0, 1);
		require(machine->cpu.readEpcWord() == end && machine->memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == end,
			"the next grant raises the actual destination fetch fault, not a comparison or JMP fault");
	}
	const auto afterNative = native.cpu.captureRuntimeState(), afterScalar = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(afterNative.snapshot.words(), afterScalar.snapshot.words())
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
		const u32 end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes;
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
			frame.registers[0] = frame.registers[1] = valueNumber(0);
			for (u32 visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8u; ++visit) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
				require(machine->cpu.runUntilDepth(0, 1) == RunResult::Yielded && frame.pc == nextPc
					&& machine->memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE,
					"an untaken skip performs no future fetch even after native warmup at a physical boundary");
			}
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
		require(page.nativeBlocks && page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) >> 2u],
			"a boundary comparison enters generated machine code rather than remaining a cold scalar opcode");
#endif
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers[1] = valueNumber(1);
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
