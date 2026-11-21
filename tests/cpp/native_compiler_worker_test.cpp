#include "machine/cpu/native_compiler_worker.h"
#include "machine/cpu/native_table_constructor.h"
#include "machine/cpu/cpu.h"
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
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

void copiedSourceAndDeferredPublication() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	NativeCompilerWorker worker;
	size_t bytes = 0;
	for (int iteration = 0; iteration < 64; ++iteration) {
		std::array<DecodedInstruction, 3> decoded{};
		const std::array ops{OpCode::KSMI, OpCode::ADD, OpCode::JMP};
		std::array<NativeBlockInstruction, 3> instructions;
		for (size_t i = 0; i < ops.size(); ++i) {
			decoded[i].op = static_cast<u8>(ops[i]);
			decoded[i].width = decoded[i].baseCycles = 1;
			instructions[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * 4u};
		}
		decoded[0].a = 1; decoded[0].sbx = iteration;
		decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = 1;
		decoded[2].bx = 0x1800u;
		// Two entries share one executable allocation and an internal edge.
		const std::array sources{
			NativeBlockSource{std::span(instructions.data(), 1)},
			NativeBlockSource{std::span(instructions.data() + 1, 2)},
		};
		worker.submit(sources, NativeCodeBindings(memory, cpu.stringPool()));
		decoded.fill({}); // No live decoded-page references may escape capture.
		instructions.fill({});
		worker.wait();
		require(worker.ready(), "the bounded worker delivers one completed request");
		auto blocks = worker.take();
		require(worker.idle() && bytes == 0, "unpublished code does not alter the CPU-owned code cache");
		blocks.front()->region->publish(bytes);
		require(bytes == blocks.front()->region->codeBytes && blocks[1]->region == blocks[0]->region,
			"one region is accounted once when the owner publishes all its entries");
		ValueSlots registers(3); registers.set(0, valueInteger(7));
		NativeBlockRunState state{.remainingCycles = 100};
		require(blocks.front()->run(registers.view(), state)->nextPc == 0x1800u && registers.get(2) == valueInteger(iteration + 7),
			"the worker compiles captured instructions and the original internal edge");
		blocks.clear();
		require(bytes == 0, "published code leaves its owner accounting on retirement");
	}
}

void unpublishedCodeCanBeDiscarded() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	std::array<DecodedInstruction, 2> decoded{};
	decoded[0].op = static_cast<u8>(OpCode::K1); decoded[0].width = decoded[0].baseCycles = 1;
	decoded[1].op = static_cast<u8>(OpCode::JMP); decoded[1].width = decoded[1].baseCycles = 1;
	decoded[1].bx = 0x1800;
	const std::array instructions{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array sources{NativeBlockSource{instructions}};
	for (int iteration = 0; iteration < 32; ++iteration) {
		NativeCompilerWorker worker;
		worker.submit(sources, NativeCodeBindings(memory, cpu.stringPool()));
		if ((iteration & 1) == 0) {
			worker.wait();
			worker.take().clear();
		}
		// Destruction also joins an outstanding request before source owners die.
	}
}

void recordPlanIsReadyBeforePublication() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	ValueSlots constants(2);
	constants.set(0, valueString(cpu.stringPool().intern("first")));
	constants.set(1, valueString(cpu.stringPool().intern("last")));
	constexpr u32 page = CART_ROM_BASE;
	std::array decoded{
		DecodedInstruction{.bx = 0, .c = 2, .op = static_cast<u8>(OpCode::NEWT)},
		DecodedInstruction{.tableCacheSlot = -1, .c = 1, .op = static_cast<u8>(OpCode::SETFIELD)},
		DecodedInstruction{.tableCacheSlot = -1, .b = 1, .c = 2, .op = static_cast<u8>(OpCode::SETFIELD)},
	};
	std::array<NativeBlockInstruction, decoded.size()> instructions;
	for (u32 i = 0; i < decoded.size(); ++i) {
		decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		instructions[i] = {&decoded[i], page + i * INSTRUCTION_BYTES};
	}
	const std::array sources{NativeBlockSource{std::span(instructions).first<1>()},
		NativeBlockSource{std::span(instructions).last<2>()}};
	NativeCompilerWorker worker;
	worker.submit(sources, NativeCodeBindings(memory, cpu.stringPool(), &cpu), {.immutablePagePc = page});
	decoded.fill({});
	worker.wait();
	auto blocks = worker.take();
	const auto* recipe = blocks.front()->terminal.recordConstructor;
	require(recipe && recipe->count == 2 && recipe->nextPc == page + 3 * INSTRUCTION_BYTES,
		"the worker builds the recipe from the captured source and page provenance");
	require(recipe->continuation[0] == nullptr && recipe->continuation[1] == nullptr,
		"publication alone binds the CPU-owned continuation directory");
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

void cpuInvalidationAndLifecycle() {
	test::Blua32TestImage image;
	image.text.resize(12);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 1, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2}};
	for (int mutation = 0; mutation < 4; ++mutation) {
		CpuMachine generated(image, false), reference(image, true);
		std::array<u32, 2> observations{};
		const u32 ramPc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE;
		for (auto* machine : {&generated, &reference}) {
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
		} else {
			for (auto* machine : {&generated, &reference}) {
				machine->cpu.reset();
				machine->cpu.activeThread()->currentFrame->registers.set(1, valueInteger(0));
			}
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
				"published background code preserves guest state after invalidation, restore, observer replacement and reset");
		}
		if (mutation == 2) require(observations[0] > 0 && observations[0] == observations[1],
			"an observer inserted during compilation observes every executed instruction after publication");
		if (mutation == 0) require(generated.cpu.activeThread()->currentFrame->registers.get(0) == valueInteger(7),
			"an invalidated pending region never reinstalls pre-write instructions");
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
		unpublishedCodeCanBeDiscarded();
		recordPlanIsReadyBeforePublication();
		cpuInvalidationAndLifecycle();
		imageReplacementRetiresBorrowedConstants();
		invalidatedPendingMergeDoesNotRetireDeadOwners();
		for (int mutation = 0; mutation < 5; ++mutation) independentInteriorEntryRetiresEveryOverlappingOwner(mutation);
		std::cout << "Native compiler worker tests passed\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
