#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/common/numeric.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/value_bank.h"

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
	CpuMachine(const test::Blua32TestImage& image, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
			nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto& first = *native.cpu.activeThread()->frameAtDepth(0);
	const auto& second = *scalar.cpu.activeThread()->frameAtDepth(0);
	require(first.readControl(bmsx::FrameField::Pc) == second.readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(first.readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(second.readControl(bmsx::FrameField::Top))
		&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
		&& native.cpu.lastPc == scalar.cpu.lastPc,
		"linked blocks publish the same PC, WIDE body, register extent and cycle boundary as scalar instructions");
	for (int reg = 0; reg < 12; ++reg) require(first.registers.get(reg) == second.registers.get(reg),
		"linked execution preserves each raw live register at every grant");
}

void grantsAndTargetRetirement(bool inRam) {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 8, 8, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMPIF), 2, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::UNM), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SHL), 0, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::MOV), 3, 8, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::ADD), 4, 0, 8);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::JMP), 0, 63, 55, 255);
	image.functions = {{.firstWord = 0, .wordCount = 9, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	const u32 startPc = inRam ? DYNAMIC_RAM_BASE : native.rom.textAddress;
	for (auto* machine : {&native, &scalar}) {
		if (inRam) machine->memory.writeBytes(startPc, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(2)); frame.registers.set(1, valueInteger(1)); frame.registers.set(8, valueInteger(0));
	}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	// Request the root before either branch can submit a different job.
	for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
		for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
			machine->rom.functionAddresses[0], startPc);
		test::runCpuParity(native.cpu, scalar.cpu, 1);
	}
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(startPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
#endif
	for (const bool flag : {true, false}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(2, valueBool(flag));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], startPc);
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, 2048) == RunResult::Yielded, "warm both branch paths");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 base = (startPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, base);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (inRam) for (const bool flag : {true, false}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(2, valueBool(flag));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], startPc);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForNativeEntry(native.cpu, page, base + (flag ? 4u : 2u));
	}
	if (inRam) for (const bool flag : {true, false}) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.activeThread()->frameAtDepth(0)->registers.set(2, valueBool(flag));
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], startPc);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
	}
#endif
	const auto* root = page.nativeBlocks->entries[base].get();
	require(page.nativeBlocks->entries[base + 2] && page.nativeBlocks->entries[base + 4],
		"both branch paths have published native entries");
	if (inRam) {
		u32 externalLinks = 0;
		for (const auto& block : page.nativeBlocks->entries) {
			if (!block) continue;
			const auto countLink = [&](const NativeBlockExitSite& exit) {
				if (exit.link.target && exit.link.target->region != block->region) ++externalLinks;
			};
			countLink(block->terminal);
			for (const auto& exit : block->sideExits) countLink(exit);
		}
		require(externalLinks != 0, "warm independent same-page entries really chain across owners");
	}
	if (!inRam) {
		require(root->region == page.nativeBlocks->entries[base + 2]->region
			&& root->region == page.nativeBlocks->entries[base + 4]->region,
			"a discovered ROM graph keeps both branch targets as internal entries");
	for (const bool flag : {false, true}) for (const u32 start : {0u, 2u, 4u, 6u}) for (int grant = 2; grant <= 64; ++grant) {
		std::array<Value, 12> registers; registers.fill(valueInteger(0));
		registers[0] = valueInteger(2); registers[1] = valueInteger(1); registers[2] = valueBool(flag);
		auto expected = registers;
		auto slots = test::valueBank(registers);
		int remaining = grant, top = 0;
		u32 segment = start;
		const NativeBlockExitSite* expectedExit;
		for (;;) {
			const auto& current = *page.nativeBlocks->entries[base + segment];
			if (remaining <= BASE_CYCLES[static_cast<u8>(OpCode::ADD)]) { expectedExit = nullptr; break; }
			if (segment == 0) {
				expected[8] = valueInteger(asInteger(expected[8]) + 1); top = std::max(top, 9);
			} else if (segment == 2) {
				expected[0] = valueInteger(-asInteger(expected[0])); top = std::max(top, 1);
			} else if (segment == 4) {
				expected[0] = valueInteger(static_cast<i32>(valuePayload(expected[0]) << 1u)); top = std::max(top, 1);
			} else {
				expected[4] = valueInteger(asInteger(expected[0]) + asInteger(expected[8])); top = std::max(top, 5);
			}
			remaining -= BASE_CYCLES[static_cast<u8>(OpCode::ADD)];
			expectedExit = &current.terminal;
			if (segment == 0) {
				if (flag) expectedExit = &current.sideExits.back();
				segment = flag ? 4u : 2u;
			} else if (segment == 4) {
				expected[3] = expected[8]; top = std::max(top, 4); segment = 6;
			} else if (segment == 2) segment = 6;
			else segment = 0;
			remaining -= BASE_CYCLES[static_cast<u8>(OpCode::ADD)];
			if (remaining <= 0) break;
		}
		NativeBlockRunState run{.registers = slots.view(), .constants = native.cpu.activeThread()->frameAtDepth(0)->executionImage->constPool,
			.remainingCycles = grant};
		const auto* exit = page.nativeBlocks->entries[base + start]->run(run);
		require((expectedExit ? exit == expectedExit : exit->exit == NativeBlockExit::ScalarBoundary) && run.remainingCycles == remaining && run.registerTop == top,
			"one native entry traverses both branches, a WIDE merge and a backedge without a CPU dispatcher or intermediate frame");
		require(test::matchesValues(slots.view(), expected), "raw linked execution preserves every word and tag");
	}
	}

#endif
	for (const Value flag : {valueBool(true), valueBool(false), valueInteger(0), valueFloatBits(0x7fc00000u)}) for (int grant = 1; grant <= 96; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0); frame.registers.set(2, flag); frame.writeControl(bmsx::FrameField::Top, 0);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], startPc);
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded, "each short grant completes its admitted segment");
		requireParity(native, scalar);
	}
	if (!inRam) return;
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::SUB), 4, 0, 8);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE + 7u * INSTRUCTION_BYTES,
		replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (page.nativeBlocks) for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
		const auto& block = page.nativeBlocks->entries[entry];
		require(!block || entry > 7u || entry + block->sourceWords <= 7u,
			"rewriting the WIDE body retires every native source that depends on it");
	}
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.activeThread()->frameAtDepth(0)->registers.set(2, valueBool(true));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	for (int pass = 0; pass < 4 && (!page.nativeBlocks || !page.nativeBlocks->entries[0] || !page.nativeBlocks->entries[4]); ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
#endif
	test::waitForNativeEntry(native.cpu, page, 0);
	require(page.nativeBlocks && page.nativeBlocks->entries[0] && page.nativeBlocks->entries[4],
		"both the surviving source and updated target have native entries");
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 600002);
	requireParity(native, scalar);
	// This also destroys a cyclic incoming/outgoing graph under the sanitizers.
	native.cpu.reset();
}

void crossPageLinksRetireTheirTargetsAndKeepBoundedStack() {
	test::Blua32TestImage image; image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
	constexpr u32 second = DECODED_PAGE_WORDS;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 8, 8, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 3, 62);
	writeInstruction(image.text, second, static_cast<u8>(OpCode::MUL), 0, 0, 1);
	writeInstruction(image.text, second + 1, static_cast<u8>(OpCode::MOV), 3, 8, 0);
	writeInstruction(image.text, second + 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, second + 3, static_cast<u8>(OpCode::ADD), 4, 0, 8);
	writeInstruction(image.text, second + 4, static_cast<u8>(OpCode::JMP), 0, 59, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = second + 5, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(2)); frame.registers.set(1, valueInteger(1)); frame.registers.set(8, valueInteger(0));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	auto& decodedPages = native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages;
	auto& sourceDecoded = decodedPages.at(DYNAMIC_RAM_BASE);
	auto& targetDecoded = decodedPages.at(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE);
	for (int pass = 0; pass < 4 && (!sourceDecoded.nativeBlocks || !sourceDecoded.nativeBlocks->entries[0]
		|| !targetDecoded.nativeBlocks || !targetDecoded.nativeBlocks->entries[0]); ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
	test::waitForNativeEntry(native.cpu, sourceDecoded, 0);
	test::waitForNativeEntry(native.cpu, targetDecoded, 0);
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
	const auto& lookup = *native.cpu.activeThread()->frameAtDepth(0)->executionImage->nativeCodeLookup;
	auto* firstPage = lookup.find(DYNAMIC_RAM_BASE, 0);
	auto* secondPage = lookup.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, 0);
	const auto* root = firstPage->nativeBlocks->entries[0].get();
	const auto* target = secondPage->nativeBlocks->entries[0].get();
	require(firstPage->nativeCode && firstPage->nativeCode[0]
		&& secondPage->nativeCode && secondPage->nativeCode[0], "compiled pages publish their native dispatch words");
	require(root && target && root->terminal.link.target == target && target->terminal.link.target == root,
		"both cross-page edges enter the real successor body without the CPU dispatcher");
	for (int grant = 1; grant <= 128; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
	}
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::SUB), 4, 0, 8);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(
		DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE + 3 * INSTRUCTION_BYTES, replacement.data(), replacement.size());
	require(firstPage->nativeBlocks->entries[0].get() == root && !root->terminal.link.target,
		"retiring a cross-page target disconnects its incoming edge without discarding the independent source");
	require(firstPage->nativeCode[0] && secondPage->nativeCode && secondPage->nativeCode[0] == nullptr,
		"retirement withdraws the native dispatch bank before releasing the last target region");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
	requireParity(native, scalar);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(native.cpu);
	for (int pass = 0; pass < 4 && (!targetDecoded.nativeBlocks || !targetDecoded.nativeBlocks->entries[0]); ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 2048);
		test::waitForFixtureWorkerRequests(native.cpu);
	}
	test::waitForNativeEntry(native.cpu, targetDecoded, 0);
	test::runCpuParity(native.cpu, scalar.cpu, 2048);
#endif
	require(root->terminal.link.target == secondPage->nativeBlocks->entries[0].get(), "a rewritten target regenerates and links again");
	require(secondPage->nativeCode && secondPage->nativeCode[0], "a regenerated target republishes its native dispatch word");
	test::runCpuParity(native.cpu, scalar.cpu, 600002);
	requireParity(native, scalar);
	native.cpu.reset();
}

void shortGrantsDoNotPromoteSequentialPositions(bool inRam) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (u32 word = 0; word < 12; ++word) writeInstruction(image.text, word, static_cast<u8>(OpCode::ADD), 0, 0, 1);
	writeInstruction(image.text, 12, static_cast<u8>(OpCode::JMP), 0, 63, 51, 255); // -13 words
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::JMP), 0, 63, 35, 255); // enter word 4
	image.functions = {{.firstWord = 0, .wordCount = 33, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
	native.cpu.setNativeCompilationProfiling(true);
	const u32 start = inRam ? DYNAMIC_RAM_BASE : native.rom.textAddress;
	for (auto* machine : {&native, &scalar}) {
		if (inRam) machine->memory.writeBytes(start, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(0)); frame.registers.set(1, valueInteger(1));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 4096);
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto entry = (start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, entry);
	require(page.nativeBlocks && page.nativeBlocks->entries[entry]
		&& page.nativeBlocks->entries[entry]->sourceWords == 13,
		"entry admission preserves successor stability heat and compiles a complete ROM/RAM loop");
	const auto originalRegion = page.nativeBlocks->entries[entry]->region;
	const auto initialProfile = native.cpu.readNativeCompilationProfile();
	require(initialProfile.prepareRequests != 0 && initialProfile.regionsPublished != 0
		&& initialProfile.entriesPublished != 0 && initialProfile.sourceInstructions >= 13
		&& initialProfile.codeBytes == page.nativeBlocks->entries[entry]->region->codeBytes
		&& initialProfile.emittedCodeBytes == initialProfile.codeBytes
		&& initialProfile.peakCodeBytes == initialProfile.codeBytes,
		"compilation profile counts published regions once and reads the actual executable byte owner");
	require(initialProfile.prepareNanoseconds != 0
		&& initialProfile.maxPrepareNanoseconds <= initialProfile.prepareNanoseconds
		&& initialProfile.prepareNanoseconds == initialProfile.discoveryNanoseconds
			+ initialProfile.retirementNanoseconds + initialProfile.compilationNanoseconds,
		"prepare timing partitions the owning scope and retains its maximum");
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	require(initialProfile.compilationNanoseconds == 0 && initialProfile.backgroundCompleted != 0
		&& initialProfile.backgroundNanoseconds != 0,
		"worker emission is accounted separately from CPU-thread preparation");
#else
	require(initialProfile.compilationNanoseconds != 0,
		"synchronous emission is included in CPU-thread preparation");
#endif
	require(initialProfile.maxPrepareDomain == SYSTEM_EXECUTION_DOMAIN_ID
		&& initialProfile.maxPrepareCartridgeSlot == 0u && initialProfile.maxPrepareRootPc == start
		&& initialProfile.maxPreparePagePc == (start & ~MAPPED_PAGE_BYTE_MASK),
		"the worst prepare reports its raw guest identity rather than source or debugger metadata");
	for (int run = 0; run < 512; ++run) {
		test::runCpuParity(native.cpu, scalar.cpu, 1);
		requireParity(native, scalar);
	}
	for (int grant = 2; grant <= 31; ++grant) {
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
	}
	require(page.nativeBlocks->count == 1 && !page.nativeBlocks->entries[entry + 4],
		"arbitrary sequential grant resumptions do not create overlapping suffix translations");
	const auto warmProfile = native.cpu.readNativeCompilationProfile();
	require(warmProfile.prepareRequests == initialProfile.prepareRequests
		&& warmProfile.prepareNanoseconds == initialProfile.prepareNanoseconds,
		"warm execution does not enter compilation profiling or accumulate compilation time");
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start + 32 * INSTRUCTION_BYTES);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 128);
	requireParity(native, scalar);
	test::waitForNativeEntry(native.cpu, page, entry + 4);
	require(static_cast<bool>(page.nativeBlocks->entries[entry + 4]),
		"an actual branch into the same interior position remains eligible for native execution");
	const auto incrementalProfile = native.cpu.readNativeCompilationProfile();
	require(page.nativeBlocks->entries[entry]->region == originalRegion
		&& page.nativeBlocks->entries[entry]->region != page.nativeBlocks->entries[entry + 4]->region
		&& incrementalProfile.regionsPublished > initialProfile.regionsPublished
		&& incrementalProfile.codeBytes == incrementalProfile.emittedCodeBytes
		&& incrementalProfile.capacityFlushes == 0 && incrementalProfile.capacityRetiredCodeBytes == 0
		&& incrementalProfile.maxPrepareNanoseconds >= initialProfile.maxPrepareNanoseconds,
		"an interior entry adds an independent owner without replacing the original");
}

void compilationProfilingIsOptInAndSurvivesReset() {
	test::Blua32TestImage image; image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 0, 1, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4}};
	CpuMachine native(image, false);
	native.cpu.runUntilDepth(0, 2048);
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto disabled = native.cpu.readNativeCompilationProfile();
	require(disabled.codeBytes != 0 && disabled.prepareRequests == 0 && disabled.prepareNanoseconds == 0
		&& disabled.regionsPublished == 0 && disabled.compilationNanoseconds == 0,
		"unprofiled compilation publishes executable code without collecting counters or timing");
	native.cpu.setNativeCompilationProfiling(true);
	native.cpu.reset();
	native.cpu.runUntilDepth(0, 2048);
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto first = native.cpu.readNativeCompilationProfile();
	require(first.prepareRequests != 0 && first.regionsPublished != 0 && first.codeBytes != 0,
		"opting in observes subsequent real compilation");
	native.cpu.reset();
	const auto reset = native.cpu.readNativeCompilationProfile();
	require(reset.codeBytes == 0 && reset.prepareRequests == first.prepareRequests
		&& reset.prepareNanoseconds == first.prepareNanoseconds && reset.peakCodeBytes == first.peakCodeBytes,
		"guest reset clears live executable ownership but not host-lifetime profile counters");
	native.cpu.runUntilDepth(0, 2048);
	test::waitForNativeEntry(native.cpu, *native.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto second = native.cpu.readNativeCompilationProfile();
	require(second.prepareRequests > first.prepareRequests && second.emittedCodeBytes > first.emittedCodeBytes
		&& second.maxPrepareNanoseconds >= first.maxPrepareNanoseconds,
		"recompilation after reset accumulates instead of rewinding host measurements");
	const auto saved = native.cpu.captureRuntimeState();
	native.cpu.restoreRuntimeState(saved);
	const auto restored = native.cpu.readNativeCompilationProfile();
	require(restored.prepareRequests == second.prepareRequests && restored.prepareNanoseconds == second.prepareNanoseconds
		&& restored.peakCodeBytes == second.peakCodeBytes && restored.codeBytes == 0,
		"save-state restore retires code without restoring or rewinding compilation measurements");
}
void entriesIntoWideBodiesRetainIndependentOwners() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 0, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 2, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::JMP), 0, 63, 48, 255);
	image.functions = {{.firstWord = 0, .wordCount = 17, .maxStack = 12}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
		auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		frame.registers.set(0, valueInteger(0)); frame.registers.set(2, valueInteger(0)); frame.registers.set(1, valueInteger(1));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1200);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	auto& decoded = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(native.cpu, decoded, 0);
	for (const u32 entry : {16u, 1u}) {
		for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
			for (auto* machine : {&native, &scalar}) machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + entry * INSTRUCTION_BYTES);
			test::runCpuParity(native.cpu, scalar.cpu, 1);
		}
		test::waitForNativeEntry(native.cpu, decoded, entry);
	}
#endif
	for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + 16u * INSTRUCTION_BYTES);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 128);
		requireParity(native, scalar);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto& entries = page.nativeBlocks->entries;
	require(entries[0] && entries[1] && entries[16] && entries[0]->region != entries[1]->region,
		"prefix and raw-body entries own independent overlapping native sources");
#endif
	for (const u32 offset : {0u, 1u, 2u}) for (int grant = 1; grant <= 31; ++grant) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + offset * INSTRUCTION_BYTES);
		}
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
	}
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::SUB), 2, 0, 1);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(DYNAMIC_RAM_BASE + 2u * INSTRUCTION_BYTES,
		replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(!page.nativeBlocks || (!page.nativeBlocks->entries[0] && !page.nativeBlocks->entries[1]),
		"rewriting the shared suffix retires both overlapping owners");
#endif
	for (const u32 offset : {0u, 1u, 2u}) for (int grant = 1; grant <= 31; ++grant) {
		for (auto* machine : {&native, &scalar})
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + offset * INSTRUCTION_BYTES);
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
	}
	std::array<u32, 2> observed{};
	for (size_t index = 0; index < observed.size(); ++index) {
		auto* machine = index == 0 ? &native : &scalar;
		InstructionObserverBinding observer;
		observer.points[0].insert(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
		observer.context = &observed[index];
		observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<u32*>(context); };
		machine->cpu.setInstructionObserver(std::move(observer));
	}
	for (const u32 offset : {0u, 1u}) {
		for (auto* machine : {&native, &scalar})
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE + offset * INSTRUCTION_BYTES);
		test::runCpuParity(native.cpu, scalar.cpu, 1);
		requireParity(native, scalar);
	}
	require(observed[0] == 1 && observed[1] == 1,
		"a late observer sees the raw WIDE body entry but not a prefix instruction");
}

} // namespace

int main() {
	try {
		grantsAndTargetRetirement(false); grantsAndTargetRetirement(true); entriesIntoWideBodiesRetainIndependentOwners(); crossPageLinksRetireTheirTargetsAndKeepBoundedStack();
		shortGrantsDoNotPromoteSequentialPositions(false); shortGrantsDoNotPromoteSequentialPositions(true);
		compilationProfilingIsOptInAndSurvivesReset();
		std::cout << "Compiled block link tests passed\n"; return 0;
	}
	catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
