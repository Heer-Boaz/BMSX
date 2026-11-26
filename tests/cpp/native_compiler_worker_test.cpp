#include "machine/cpu/jit/worker.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include <algorithm>
#include <chrono>

#include <array>
#include <iostream>
#include <memory>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

// Assemble synthetic runs in the worker lane just as the CPU discovery pass
// does. The fixture retains its original rows so tests can mutate them.
NativeCompileSpecializationBuffer& captureRuns(NativeCompilerWorker& worker, std::span<const NativeBlockSource> runs) {
	size_t count = 0;
	for (const auto& run : runs) count += run.instructions.size();
	auto& workspace = worker.beginCapture(count);
	workspace.instructions.clear();
	workspace.instructions.reserve(count);
	workspace.sources.clear();
	for (const auto& run : runs) {
		const size_t first = workspace.instructions.size();
		for (const auto& row : run.instructions)
			workspace.instructions.push_back({worker.captureInstruction(*row.decoded), row.pc});
		workspace.sources.push_back({std::span(workspace.instructions).subspan(first),
			run.skippedInstruction ? worker.captureInstruction(*run.skippedInstruction) : nullptr});
	}
	return workspace.specializations;
}

void copiedSourceAndDeferredPublication() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	NativeCompilerWorker worker;
	std::vector<std::unique_ptr<NativeBlock>> retained;
	for (int iteration = 0; iteration < 64; ++iteration) {
		std::array<DecodedInstruction, 3> decoded{};
		const std::array ops{OpCode::KSMI, OpCode::ADD, OpCode::JMP};
		std::array<NativeBlockInstruction, 3> instructions;
		for (size_t i = 0; i < ops.size(); ++i) {
			decoded[i].op = static_cast<u8>(ops[i]);
			decoded[i].width = decoded[i].baseCycles = 1;
			instructions[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * 4u};
		}
		decoded[0].a = 1; decoded[0].setSbx(iteration);
		decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = 1;
		const u32 exitPc = 0x1800u + iteration * INSTRUCTION_BYTES;
		decoded[2].setBx(exitPc);
		// Two entries share one executable allocation and an internal edge.
		const std::array sources{
			NativeBlockSource{std::span(instructions.data(), 1)},
			NativeBlockSource{std::span(instructions.data() + 1, 2)},
		};
		captureRuns(worker, sources);
		worker.submit(NativeCodeBindings(memory, cpu.stringPool()));
		decoded.fill({}); // No live decoded-page references may escape capture.
		instructions.fill({});
		worker.wait();
		require(worker.ready(), "the bounded worker delivers one completed request");
		auto blocks = worker.take();
		require(worker.idle() && cpu.readNativeCompilationProfile().codeBytes == 0,
			"taking an emitted region does not install it in the CPU cache");
		blocks.front()->region->synchronizeInstructionStream();
		const std::weak_ptr<NativeCodeRegion> region = blocks.front()->region;
		require(blocks[1]->region == blocks[0]->region, "a standalone result owns one shared region");
		ValueSlots registers(3); registers.set(0, valueInteger(7));
		NativeBlockRunState state{.remainingCycles = 100};
		require(blocks.front()->run(registers.view(), state)->nextPc == exitPc && registers.get(2) == valueInteger(iteration + 7),
			"the worker compiles captured instructions and the original internal edge");
		if (iteration == 0) {
			retained = std::move(blocks);
			continue;
		}
		blocks.clear();
		require(region.expired() && cpu.readNativeCompilationProfile().codeBytes == 0,
			"releasing the standalone entries frees the region without changing CPU residency");
		state.remainingCycles = 100;
		const auto* retainedExit = retained.front()->run(registers.view(), state);
		require(retainedExit == &retained.back()->terminal && retainedExit->nextPc == 0x1800u && registers.get(2) == valueInteger(7),
			"reusing source, IR and lowering storage cannot replace the live region's exit descriptors or code");
	}
}

void comparisonCapturesSkippedWideBody() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	NativeCompilerWorker worker;
	constexpr u32 pc = 0x1000u;
	constexpr auto eq = static_cast<u8>(OpCode::EQ);
	DecodedInstruction comparison{.op = eq, .width = 1, .baseCycles = BASE_CYCLES[eq]};
	DecodedInstruction skipped{.op = static_cast<u8>(OpCode::KSMI), .width = 2};
	const std::array instructions{NativeBlockInstruction{&comparison, pc}};
	const std::array sources{NativeBlockSource{instructions, &skipped}};
	captureRuns(worker, sources);
	// Mutate before emission even starts, not after a timing-dependent sleep.
	skipped.width = 1;
	worker.submit(NativeCodeBindings(memory, cpu.stringPool()));
	worker.wait();
	const auto blocks = worker.take();
	require(blocks.size() == 1 && blocks.front()->sourceWords == 3,
		"the worker owns both words of the skipped WIDE instruction's dependency");
}

void unpublishedCodeCanBeDiscarded() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	std::array<DecodedInstruction, 2> decoded{};
	decoded[0].op = static_cast<u8>(OpCode::K1); decoded[0].width = decoded[0].baseCycles = 1;
	decoded[1].op = static_cast<u8>(OpCode::JMP); decoded[1].width = decoded[1].baseCycles = 1;
	decoded[1].setBx(0x1800);
	const std::array instructions{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array sources{NativeBlockSource{instructions}};
	for (int iteration = 0; iteration < 32; ++iteration) {
		NativeCompilerWorker worker;
		captureRuns(worker, sources);
		worker.submit(NativeCodeBindings(memory, cpu.stringPool()));
		if ((iteration & 1) == 0) {
			worker.wait();
			worker.take().clear();
		}
		// Destruction also joins an outstanding request before source owners die.
	}
}

void rejectedFieldProofIsFrozenForWorker() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	constexpr u32 pc = 0x1000u;
	std::array decoded{
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(0), .a = 2, .b = 0, .c = 0, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 3, .b = 2, .c = 1, .op = static_cast<u8>(OpCode::SUB)},
	};
	for (auto& row : decoded) {
		row.width = 1;
		row.baseCycles = BASE_CYCLES[row.op];
	}
	for (int i = 0; i < 4; ++i) decoded.back().observeNativeNumericTypes(valueInteger(8), valueInteger(3));
	const std::array instructions{NativeBlockInstruction{&decoded[0], pc}, NativeBlockInstruction{&decoded[1], pc + INSTRUCTION_BYTES}};
	const std::array sources{NativeBlockSource{instructions}};
	NativeFieldProofFeedback sourceProfile;
	for (int i = 0; i < 3; ++i) sourceProfile.contradict(0, ValueTag::Integer);
	NativeCompilerWorker worker;
	sourceProfile.appendSnapshot(pc, captureRuns(worker, sources).rejectedFieldProofs);
	worker.submit(NativeCodeBindings(memory, cpu.stringPool(), &cpu));
	sourceProfile.forget(0);
	worker.wait();
	auto blocks = worker.take();
	require(blocks.size() == 2 && blocks.front()->sideExits.front().exit == NativeBlockExit::ReadField
		&& !blocks.front()->sideExits.front().operands.table.resultProof,
		"the worker retains the submitted rejection after the source profile drops it");
	captureRuns(worker, sources);
	worker.submit(NativeCodeBindings(memory, cpu.stringPool(), &cpu));
	worker.wait();
	auto next = worker.take();
	require(next.size() == 1 && next.front()->sideExits.front().operands.table.resultProof == ValueTag::Integer
		&& !blocks.front()->sideExits.front().operands.table.resultProof,
		"the next job starts with empty profile lanes without changing the prior region's proof");
}

void biosCallUsesTheCapturedTerminal() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	constexpr u32 pc = CART_ROM_BASE;
	std::array decoded{
		DecodedInstruction{.a = 70, .b = 131, .c = 2, .op = static_cast<u8>(OpCode::BIOSCALL)},
		DecodedInstruction{.op = static_cast<u8>(OpCode::HALT)},
	};
	decoded[0].width = 2;
	decoded[1].width = 1;
	for (auto& word : decoded) word.baseCycles = BASE_CYCLES[word.op];
	const std::array head{NativeBlockInstruction{&decoded[0], pc}};
	const std::array next{NativeBlockInstruction{&decoded[1], pc + 2 * INSTRUCTION_BYTES}};
	const std::array sources{NativeBlockSource{head}, NativeBlockSource{next}};
	NativeCompilerWorker worker;
	captureRuns(worker, sources);
	worker.submit(NativeCodeBindings(memory, cpu.stringPool(), &cpu), {.immutableSource = true});
	decoded.fill({});
	worker.wait();
	auto blocks = worker.take();
	const auto& exit = blocks.front()->terminal;
	const auto [dest, selector, argc] = exit.operands.biosCall;
	require(exit.exit == NativeBlockExit::BiosCall && dest == 70 && selector == 131 && argc == 2
			&& exit.currentPc == pc && exit.lastPc == pc + INSTRUCTION_BYTES && exit.nextPc == next.front().pc,
		"the worker retains raw operands and the complete captured WIDE frontier");
	require(exit.continuationCells[0] == nullptr && exit.continuationCells[1] == nullptr
			&& blocks[1]->firstPc == next.front().pc,
		"the CPU alone reenters the caller after BIOS service completion");
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool reference)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES)),
		  memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		  irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		cpu.setNativeCompilationProfiling(true);
		if (reference) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void retainedDemandFollowsPhysicalRoots() {
	test::Blua32TestImage source;
	source.text.resize(INSTRUCTION_BYTES);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::RET), 0, 1, 0);
	source.functions = {{.firstWord = 0, .wordCount = 1}};
	CpuMachine machine(source, false);
	auto* image = machine.cpu.activeThread()->currentFrame->executionImage;
	DecodedInstructionPage page(MappedPageBinding{0, true, nullptr, {}});
	const u32 pc = machine.rom.textAddress, function = machine.rom.functionAddresses[0];
	NativeDemandQueue queue;
	queue.enqueue({image, &page, function, pc, 0});
	queue.enqueue({image, &page, function, pc, 0});
	queue.enqueue({image, &page, function, pc, 1});
	queue.enqueue({image, &page, function, pc + INSTRUCTION_BYTES, 0});
	const auto first = queue.pop();
	const auto second = queue.pop();
	require(first.pc == pc && first.slot == 0 && second.pc == pc && second.slot == 1,
		"repeated demand is coalesced without losing the other socket or changing service order");
	queue.enqueue(first);
	require(queue.pop().pc == pc + INSTRUCTION_BYTES, "a resubmission follows older demand");
	queue.clear();
	queue.enqueue(first);
	require(!queue.empty() && queue.pop().pc == pc && queue.empty(),
		"image retirement releases every queued root marker");
}

void hotRootsPublishWithoutAnotherGuestVisit() {
	test::Blua32TestImage source;
	source.mappedCode = false;
	source.text.resize(2 * INSTRUCTION_BYTES);
	for (u32 word = 0; word < 2; ++word) {
		writeInstruction(source.text, word, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		source.functions.push_back({.firstWord = word, .wordCount = 1});
	}
	CpuMachine machine(source, false);
	auto& cpu = machine.cpu;
	for (u32 i = 0; i < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++i) {
		for (u32 word = 0; word < 2; ++word) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[word],
				machine.rom.textAddress + word * INSTRUCTION_BYTES);
			require(cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::JMP)]) == RunResult::Yielded,
				"each visit executes exactly one guest jump");
		}
	}
	const auto& page = *cpu.activeThread()->currentFrame->decodedPage;
	const u32 first = (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(cpu, page, first);
	test::waitForNativeEntry(cpu, page, first + 1);
	require(cpu.readNativeCompilationProfile().backgroundCompleted == 2,
		"both independent hot roots publish with exhausted grants and no additional guest visit");
}

void cpuInvalidationAndLifecycle() {
	test::Blua32TestImage image;
	image.text.resize(12);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 1, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2}};
	for (int mutation = 0; mutation < 7; ++mutation) {
		CpuMachine generated(image, false), reference(image, true);
		std::array<u32, 2> observations{};
		const u32 ramPc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE;
		for (auto* machine : {&generated, &reference}) {
			if (mutation == 5) machine->memory.ramWriteWatches().armHistoryWrites();
			for (size_t i = 0; i < image.text.size(); ++i) machine->memory.writeMappedU8(ramPc + static_cast<u32>(i), image.text[i]);
			auto* frame = machine->cpu.activeThread()->currentFrame;
			frame->writeControl(bmsx::FrameField::Pc, ramPc);
			frame->registers.set(1, valueInteger(0));
		}
		for (int step = 0; generated.cpu.readNativeCompilationProfile().prepareRequests == 0; ++step) {
			require(step < NATIVE_BLOCK_COMPILATION_THRESHOLD * 8, "a warmed RAM loop submits a bounded compilation request");
			test::runCpuParity(generated.cpu, reference.cpu, 1);
		}
		require(generated.cpu.readNativeCompilationProfile().regionsPublished == 0,
			"submission does not synchronously publish the outstanding request");
		if (mutation == 0) {
			std::array<u8, 4> replacement;
			writeInstruction(replacement, 0, static_cast<u8>(OpCode::KSMI), 0, 0, 7);
			for (auto* machine : {&generated, &reference})
				for (u32 i = 0; i < replacement.size(); ++i) machine->memory.writeMappedU8(ramPc + i, replacement[i]);
		} else if (mutation == 1) {
			for (auto* machine : {&generated, &reference}) {
				const auto state = machine->cpu.captureRuntimeState();
				machine->cpu.restoreRuntimeState(state);
			}
		} else if (mutation == 2) {
			size_t index = 0;
			for (auto* machine : {&generated, &reference}) {
				InstructionObserverBinding observer;
				observer.points[0].insert(ramPc + INSTRUCTION_BYTES);
				observer.context = &observations[index++];
				observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<u32*>(context); };
				machine->cpu.setInstructionObserver(std::move(observer));
			}
		} else if (mutation == 3) {
			for (auto* machine : {&generated, &reference}) {
				machine->cpu.reset();
				machine->cpu.activeThread()->currentFrame->registers.set(1, valueInteger(0));
			}
		} else {
			for (auto* machine : {&generated, &reference}) {
				auto& watches = machine->memory.ramWriteWatches();
				if (mutation == 5) watches.disarmHistoryWrites();
				else watches.armHistoryWrites();
			}
			if (mutation == 6) {
				test::runCpuParity(generated.cpu, reference.cpu, 0);
				for (auto* machine : {&generated, &reference}) machine->memory.ramWriteWatches().disarmHistoryWrites();
			}
			test::waitForFixtureWorkerRequests(generated.cpu);
			const auto profile = generated.cpu.readNativeCompilationProfile();
			require(profile.backgroundCompleted == 1 && profile.backgroundCancelled == 1 && profile.regionsPublished == 0,
				"rewind transitions reject an outstanding result from the old compilation mode without executing it");
		}
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
		while (generated.cpu.readNativeCompilationProfile().regionsPublished == 0) {
			require(std::chrono::steady_clock::now() < deadline, "a valid replacement request is eventually published");
			test::runCpuParity(generated.cpu, reference.cpu, 16);
			std::this_thread::yield();
		}
		for (int step = 0; step < 100; ++step) {
			test::runCpuParity(generated.cpu, reference.cpu, 17);
			const auto a = generated.cpu.captureRuntimeState(), b = reference.cpu.captureRuntimeState();
			require((a == b && bmsx::test::sameLanguageRam(generated.cpu, reference.cpu)) && a.lastPc == b.lastPc,
				"published background code preserves guest state after invalidation, restore, observer changes, reset and rewind transitions");
		}
		if (mutation == 2) require(observations[0] > 0 && observations[0] == observations[1],
			"an observer inserted during compilation observes every executed instruction after publication");
		if (mutation == 0) require(generated.cpu.activeThread()->currentFrame->registers.get(0) == valueInteger(7),
			"an invalidated pending region never reinstalls pre-write instructions");
	}
}

void pendingGenericWorkSurvivesFirstCallObservation() {
	for (const bool matching : {false, true}) {
		test::Blua32TestImage image;
		image.mappedCode = false;
		image.text.resize(18u * INSTRUCTION_BYTES);
		image.functions = {{.firstWord = 0u, .wordCount = 10u, .maxStack = 3},
			{.firstWord = 12u, .wordCount = 2u, .numParams = 1u}, {.firstWord = 16u, .wordCount = 2u}};
		image.closureRelocations = {{1u, test::blua32TestFunctionAddress(RomImageDomain::System, 1u)},
			{3u, test::blua32TestFunctionAddress(RomImageDomain::System, 2u)}};
		const auto put = [&](u32 word, OpCode op, u8 a = 0u, u8 b = 0u, u8 c = 0u, u8 ext = 0u) {
			writeInstruction(image.text, word, static_cast<u8>(op), a, b, c, ext);
		};
		put(0, OpCode::WIDE);
		put(1, OpCode::CLOSURE, 1);
		put(2, OpCode::WIDE);
		put(3, OpCode::CLOSURE, 2);
		// R0 starts nil. Enter the loop by a real branch so the root,
		// rather than its backedge, reaches the threshold first.
		put(4, OpCode::JMP);
		put(5, OpCode::JMPIF, 0, 0, 1);
		put(6, OpCode::JMP, 0, 63, 62, 255);
		put(7, OpCode::WIDE);
		put(8, OpCode::CALL, 1, matching ? 2 : 0, 2);
		put(9, OpCode::RET, 1, 2);
		put(12, OpCode::CALL, 0, 1, 2);
		put(13, OpCode::RET, 0, 2);
		put(16, OpCode::KSMI, 0, 0, 29);
		put(17, OpCode::RET, 0, 2);

		CpuMachine machine(image, false);
		auto& cpu = machine.cpu;
		const u32 text = machine.rom.textAddress, root = text + 5u * INSTRUCTION_BYTES;
		for (int step = 0; cpu.readFramePc(0) != root && step < 4; ++step) cpu.runUntilDepth(0, 1);
		require(cpu.readFramePc(0) == root, "real closure setup reaches the verified loop root");
		auto& page = *cpu.rootThread()->currentFrame->decodedPage;
		const u32 first = (text & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		require(first + 17u < DECODED_PAGE_WORDS, "the source and the sibling function share one physical page");
		for (u32 visit = 1; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++visit) {
			require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && cpu.readFramePc(0) == root + INSTRUCTION_BYTES,
				"the untaken branch does not execute either unresolved CALL");
			require(cpu.runUntilDepth(0, 1) == RunResult::Yielded && cpu.readFramePc(0) == root,
				"the loop re-enters the same native demand root");
		}
		require(cpu.readNativeCompilationProfile().prepareRequests == 0, "the next root visit will submit the worker job");
		cpu.rootThread()->currentFrame->registers.set(0, valueBool(true));
		require(cpu.runUntilDepth(0, 1024) == RunResult::Halted && cpu.readCompletionValues().get(0) == valueInteger(29),
			"submission and later feedback happen in the same real CPU grant");
		const auto queued = cpu.readNativeCompilationProfile();
		require(queued.prepareRequests == 1u && queued.backgroundCompleted == 0u && queued.regionsPublished == 0u,
			"no poll can publish the result before feedback has already happened");
		require(page.words[first + 12u].nativeCallTarget() == machine.rom.functionAddresses[2]
			&& page.words[first + 7u].nativeCallTarget() == (matching ? machine.rom.functionAddresses[1] : DecodedInstruction::CALL_TARGET_UNSEEN),
			"the sibling CALL teaches a prototype in both lanes; only the fixed WIDE CALL also teaches a captured instruction");
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
		while (cpu.readNativeCompilationProfile().backgroundCompleted == 0u) {
			require(std::chrono::steady_clock::now() < deadline, "the worker returns the original captured batch");
			cpu.runUntilDepth(0, 0);
			std::this_thread::yield();
		}
		const auto completed = cpu.readNativeCompilationProfile();
		require(completed.backgroundCancelled == 0u && completed.regionsPublished == 1u
			&& page.nativeBlocks->entries[first + 5u],
			"first learning at either the captured WIDE call or the sibling call does not invalidate a generic pending body");
		require(page.words[first + 12u].nativeCallTarget() == machine.rom.functionAddresses[2]
			&& page.words[first + 7u].nativeCallTarget() == (matching ? machine.rom.functionAddresses[1] : DecodedInstruction::CALL_TARGET_UNSEEN),
			"publication preserves the prototype observations newer than its source snapshot");
	}
}

void imageReplacementRetiresBorrowedConstants() {
	test::Blua32TestImage image;
	image.text.resize(24);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::EQ), 1, 0, 63, 7);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::KFALSE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::KTRUE), 1, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 2}};
	image.constants = {0};
	auto changed = image;
	changed.constants = {std::string("replacement")};
	const auto replacement = test::encodeBlua32TestRom(RomImageDomain::System, changed, test::RAM_CODE_FIXTURE_BYTES);
	CpuMachine generated(image, false), reference(image, true);
	for (auto* machine : {&generated, &reference})
		machine->cpu.activeThread()->currentFrame->registers.set(0, valueString(machine->cpu.stringPool().intern("replacement")));
	for (int step = 0; generated.cpu.readNativeCompilationProfile().prepareRequests == 0; ++step) {
		require(step < NATIVE_BLOCK_COMPILATION_THRESHOLD * 8, "the old constant pool is captured by a pending compilation");
		test::runCpuParity(generated.cpu, reference.cpu, 1);
	}
	for (auto* machine : {&generated, &reference}) {
		machine->memory.installSystemRom(replacement.bytes);
		machine->cpu.replaceExecutionImage(machine->addresses.resolveSystemDomain());
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, replacement.functionAddresses[0], replacement.textAddress);
	}
	require(generated.cpu.readNativeCompilationProfile().backgroundCancelled == 1,
		"image replacement joins and discards code before freeing its borrowed constant pool");
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	while (generated.cpu.readNativeCompilationProfile().regionsPublished == 0) {
		require(std::chrono::steady_clock::now() < deadline, "replacement image is compiled and adopted");
		test::runCpuParity(generated.cpu, reference.cpu, 16);
		std::this_thread::yield();
	}
	for (int step = 0; step < 100; ++step) {
		test::runCpuParity(generated.cpu, reference.cpu, 17);
		const auto a = generated.cpu.captureRuntimeState(), b = reference.cpu.captureRuntimeState();
		require((a == b && bmsx::test::sameLanguageRam(generated.cpu, reference.cpu)) && a.lastPc == b.lastPc,
			"replacement constant type is specialized only against the new image");
	}
	require(generated.cpu.activeThread()->currentFrame->registers.get(1) == valueBool(true),
		"new string constant is not the retired numeric constant at the same index");
}

void invalidatedPendingMergeDoesNotRetireDeadOwners() {
	test::Blua32TestImage image;
	image.text.resize(12);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 1, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2}};
	CpuMachine generated(image, false), reference(image, true);
	const u32 ramPc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE;
	for (auto* machine : {&generated, &reference}) {
		machine->memory.writeBytes(ramPc, image.text.data(), image.text.size());
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], ramPc);
		machine->cpu.activeThread()->currentFrame->registers.set(1, valueInteger(0));
	}
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	for (;;) {
		const auto profile = generated.cpu.readNativeCompilationProfile();
		const auto* page = generated.cpu.activeThread()->currentFrame->decodedPage;
		if (page && page->nativeBlocks && page->nativeBlocks->entries[0]
			&& page->nativeBlocks->entries[0]->sourceWords == 3
			&& profile.backgroundCompleted == profile.prepareRequests) break;
		require(std::chrono::steady_clock::now() < deadline, "the complete original RAM loop becomes one idle compiled region");
		test::runCpuParity(generated.cpu, reference.cpu, 16);
		std::this_thread::yield();
	}
	auto& page = *generated.cpu.activeThread()->currentFrame->decodedPage;
	require(!page.nativeBlocks->entries[1], "the new entry is an interior instruction, not an existing segment");
	const auto before = generated.cpu.readNativeCompilationProfile();
	for (auto* machine : {&generated, &reference})
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], ramPc + INSTRUCTION_BYTES);
	test::runCpuParity(generated.cpu, reference.cpu, 1);
	require(generated.cpu.readNativeCompilationProfile().prepareRequests == before.prepareRequests + 1
		&& page.nativeBlocks->entries[0] && !page.nativeBlocks->entries[1],
		"splitting an interior entry compiles a replacement without retiring live code first");
	std::array<u8, 4> replacement;
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::KSMI), 0, 0, 7);
	for (auto* machine : {&generated, &reference}) machine->memory.writeBytes(ramPc, replacement.data(), replacement.size());
	const auto replacementDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	while (generated.cpu.readNativeCompilationProfile().backgroundCancelled == before.backgroundCancelled
		|| generated.cpu.readNativeCompilationProfile().regionsPublished == before.regionsPublished) {
		require(std::chrono::steady_clock::now() < replacementDeadline, "invalidated merge is discarded and current code is published");
		test::runCpuParity(generated.cpu, reference.cpu, 16);
		std::this_thread::yield();
	}
	for (int step = 0; step < 100; ++step) {
		test::runCpuParity(generated.cpu, reference.cpu, 17);
		const auto a = generated.cpu.captureRuntimeState(), b = reference.cpu.captureRuntimeState();
		require((a == b && bmsx::test::sameLanguageRam(generated.cpu, reference.cpu)) && a.lastPc == b.lastPc,
			"a pending merge cannot inspect freed region owners or revive their old instructions");
	}
	require(generated.cpu.activeThread()->currentFrame->registers.get(0) == valueInteger(7),
		"the replacement merge observes the new physical source words");
}

void independentInteriorEntryRetiresEveryOverlappingOwner(int mutation) {
	test::Blua32TestImage image;
	image.text.resize(20);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::ADD), 1, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 2, 2, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 3}};
	CpuMachine generated(image, false), reference(image, true);
	const u32 pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE;
	for (auto* machine : {&generated, &reference}) {
		machine->memory.writeBytes(pc, image.text.data(), image.text.size());
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
		machine->cpu.activeThread()->currentFrame->registers.set(1, valueInteger(0));
		machine->cpu.activeThread()->currentFrame->registers.set(2, valueInteger(0));
	}
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(4);
	for (;;) {
		const auto* page = generated.cpu.activeThread()->currentFrame->decodedPage;
		const auto profile = generated.cpu.readNativeCompilationProfile();
		if (page && page->nativeBlocks && page->nativeBlocks->entries[0]
			&& page->nativeBlocks->entries[0]->sourceWords == 5
			&& profile.prepareRequests == profile.backgroundCompleted) break;
		require(std::chrono::steady_clock::now() < deadline, "original wide loop publishes");
		test::runCpuParity(generated.cpu, reference.cpu, 32);
		std::this_thread::yield();
	}
	auto& page = *generated.cpu.activeThread()->currentFrame->decodedPage;
	std::weak_ptr<NativeCodeRegion> oldRegion = page.nativeBlocks->entries[0]->region;
	for (auto* machine : {&generated, &reference})
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc + 2u * INSTRUCTION_BYTES);
	while (!page.nativeBlocks->entries[2]) {
		require(std::chrono::steady_clock::now() < deadline, "wide body publishes as independent entry");
		test::runCpuParity(generated.cpu, reference.cpu, 32);
		for (auto* machine : {&generated, &reference})
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc + 2u * INSTRUCTION_BYTES);
		std::this_thread::yield();
	}
	require(page.nativeBlocks->entries[0]->region == oldRegion.lock() && page.nativeBlocks->entries[2]->region != oldRegion.lock(),
		"new body entry preserves original executable owner");
	for (int grant = 1; grant <= 64; ++grant) test::runCpuParity(generated.cpu, reference.cpu, grant);
	require(page.nativeBlocks->entries[2]->terminal.link.target == page.nativeBlocks->entries[0].get(),
		"independent body region links back to the original entry");
	std::array<u32, 2> observations{};
	if (mutation < 3) {
		const u32 word = 1u + static_cast<u32>(mutation);
		std::array<u8, 4> replacement{};
		writeInstruction(replacement, 0, static_cast<u8>(OpCode::KSMI), mutation == 2 ? 2 : 1, 0, 7);
		for (auto* machine : {&generated, &reference}) machine->memory.writeBytes(pc + word * INSTRUCTION_BYTES, replacement.data(), replacement.size());
		if (mutation == 0) {
			require(page.nativeBlocks && !page.nativeBlocks->entries[0] && page.nativeBlocks->entries[2]
				&& !page.nativeBlocks->entries[2]->terminal.link.target,
				"rewriting only the prefix disconnects the independent body and keeps its owner");
		} else {
			require(!page.nativeBlocks || (!page.nativeBlocks->entries[0] && !page.nativeBlocks->entries[2]),
				"rewriting the body or shared suffix retires both overlapping executable owners");
		}
		require(oldRegion.expired(), "the retired original region releases its executable owner");
	} else if (mutation == 3) {
		for (size_t index = 0; index < observations.size(); ++index) {
			auto* machine = index == 0 ? &generated : &reference;
			InstructionObserverBinding observer;
			observer.points[0].insert(pc + 2u * INSTRUCTION_BYTES);
			observer.context = &observations[index];
			observer.observe = [](void* context, ExecutionDomainId, u32, ConstValueSpan) { ++*static_cast<u32*>(context); };
			machine->cpu.setInstructionObserver(std::move(observer));
		}
		require(!page.nativeBlocks && oldRegion.expired(), "a late observer retires both native owners");
		for (auto* machine : {&generated, &reference})
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc + 2u * INSTRUCTION_BYTES);
	} else {
		for (auto* machine : {&generated, &reference}) {
			const auto state = machine->cpu.captureRuntimeState();
			machine->cpu.restoreRuntimeState(state);
		}
		require(oldRegion.expired(), "restoring state releases the native owners before rebuilding them");
	}
	for (int grant = 1; grant <= 64; ++grant) test::runCpuParity(generated.cpu, reference.cpu, grant);
	if (mutation == 3) require(observations[0] != 0 && observations[0] == observations[1],
		"late observation agrees after native owners retire");
}

}

int main() {
	try {
		copiedSourceAndDeferredPublication();
		comparisonCapturesSkippedWideBody();
		rejectedFieldProofIsFrozenForWorker();
		unpublishedCodeCanBeDiscarded();
		biosCallUsesTheCapturedTerminal();
		retainedDemandFollowsPhysicalRoots();
		hotRootsPublishWithoutAnotherGuestVisit();
		cpuInvalidationAndLifecycle();
		pendingGenericWorkSurvivesFirstCallObservation();
		imageReplacementRetiresBorrowedConstants();
		invalidatedPendingMergeDoesNotRetireDeadOwners();
		for (int mutation = 0; mutation < 5; ++mutation) independentInteriorEntryRetiresEveryOverlappingOwner(mutation);
		std::cout << "Native compiler worker tests passed\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
