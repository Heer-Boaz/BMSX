#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/scheduler/device.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <chrono>
#include <iostream>
#include <stdexcept>
#include <thread>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	DeviceScheduler scheduler;
	DmaController dma;
	static test::Blua32TestImage image() {
		test::Blua32TestImage image;
		image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 4, 1, 1);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
		writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RET), 0, 1, 0);
		writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::SETGL), 1, 0, 0);
		writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
		image.functions = {{.firstWord=0, .wordCount=5, .maxStack=8},
			{.firstWord=DECODED_PAGE_WORDS, .wordCount=1, .maxStack=2}};
		image.globalNames = {"continuationResult"};
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		return image;
	}
	Machine() : rom(test::encodeBlua32TestRom(RomImageDomain::System, image())),
		memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses), scheduler(cpu), dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		cpu.reset();
		memory.writeBytes(rootPc, rom.bytes.data() + rom.textAddress, MAPPED_PAGE_BYTE_SIZE);
	}
	static constexpr u32 rootPc = DYNAMIC_RAM_BASE + 0x4000;
	u32 calleePc() const { return rom.textAddress + MAPPED_PAGE_BYTE_SIZE; }
	u32 markerPc() const { return rom.textAddress + 2 * MAPPED_PAGE_BYTE_SIZE; }
	void warm(u32 pc) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], pc);
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
		for (;;) {
			cpu.runUntilDepth(0, 4096);
			auto& image = *cpu.rootThread()->firstFrame->executionImage;
			const u32 entryPc = pc == rootPc ? pc + 2 * INSTRUCTION_BYTES : pc;
			auto* page = image.nativeCodeLookup ? image.nativeCodeLookup->find(entryPc, 0) : nullptr;
			auto* child = pc == rootPc && image.nativeCodeLookup ? image.nativeCodeLookup->find(calleePc(), 0) : nullptr;
			if (page && page->nativeCode && page->nativeCode[(entryPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]
				&& (pc != rootPc || (child && child->nativeCode && child->nativeCode[(calleePc() & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]))) break;
			require(std::chrono::steady_clock::now() < deadline, "bounded native publication finishes");
			std::this_thread::yield();
		}
		cpu.runUntilDepth(1, 100);
	}
	void enterWarmChild() {
		warm(markerPc());
		warm(rootPc);
		// Observe a generated CALL, not a C++ call with equivalent final state:
		// redirect only its raw entry to a marker translation, as in calls tests.
		auto& lookup = *cpu.rootThread()->firstFrame->executionImage->nativeCodeLookup;
		auto* callee = lookup.find(calleePc(), 0);
		const auto word = (calleePc() & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const auto markerWord = (markerPc() & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		auto* marker = lookup.find(markerPc(), 0);
		require(callee && callee->nativeCode && callee->nativeCode[word], "callee has a published entry");
		void* original = callee->nativeCode[word];
		callee->nativeCode[word] = marker->nativeCode[markerWord];
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rootPc + 2 * INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 4);
		callee->nativeCode[word] = original;
		require(cpu.getFrameDepth() == 2, "generated CALL enters a live child");
		auto* parent = cpu.rootThread()->firstFrame;
		require(parent->nativeContinuationCells[0] == lookup.entrySlot(parent->pc, 0)
			&& parent->nativeContinuationCells[1] == lookup.entrySlot(parent->pc, 1),
			"CALL copies the published callsite bindings to its activation");
		cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[1], calleePc());
		parent->registers[1] = valueNumber(73);
		cpu.setGlobalByKey(cpu.stringPool().intern("continuationResult"), valueNil());
	}
};

void stableLookupSlots() {
	NativeCodeLookup lookup;
	const u32 pc = CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE;
	auto* first = lookup.entrySlot(pc, 0);
	auto* second = lookup.entrySlot(pc, 1);
	require(first != second && !*first && !*second, "absent cartridge pages have independent stable bank slots");
	DecodedInstructionPage a(true, {}), b(true, {});
	a.nativeCode = lookup.install(pc & ~MAPPED_PAGE_BYTE_MASK, 0, a);
	b.nativeCode = lookup.install(pc & ~MAPPED_PAGE_BYTE_MASK, 1, b);
	a.nativeCode[0] = &a; b.nativeCode[0] = &b;
	require(*first == &a && *second == &b && lookup.find(pc, 0) == &a && lookup.find(pc, 1) == &b,
		"later code publication updates retained cells and descriptor lookup independently");
	require(lookup.entrySlot(DYNAMIC_RAM_BASE, 0) == lookup.entrySlot(DYNAMIC_RAM_BASE, 1),
		"shared memory has one code-cell owner aliased across socket roots");
	for (u32 address = 0; address < CART_ROM_BASE; address += 1u << NativeCodeLookup::ROOT_SHIFT)
		lookup.entrySlot(address, 0);
	require(first == lookup.entrySlot(pc, 0) && second == lookup.entrySlot(pc, 1),
		"other group allocations never move retained page slots");
}

void boundReturn(bool replaceTargetStorage, bool changeBank) {
	Machine machine;
	machine.enterWarmChild();
	auto* parent = machine.cpu.rootThread()->firstFrame;
	auto& lookup = *parent->executionImage->nativeCodeLookup;
	auto* page = lookup.find(parent->pc, 0);
	const auto slot = parent->nativeContinuationCells[0];
	const auto word = (parent->pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	auto* marker = lookup.find(machine.markerPc(), 0);
	const auto markerWord = (machine.markerPc() & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	if (replaceTargetStorage) {
		// A real source write retires the source CALL and its continuation while
		// the callee is active. Dispatch-cell storage must not retire with it.
		machine.memory.writeMappedU32LE(parent->pc, packInstructionWord(static_cast<u8>(OpCode::K1), 1, 0, 0));
		require(page->nativeCode && !page->nativeBlocks && !*slot && slot == &page->nativeCode[word],
			"source invalidation zeros stable dispatch cells before freeing code descriptors");
	}
	// This independently owned marker body makes the raw generated route
	// observable. The semantic dispatcher cannot select it via descriptors.
	page->nativeCode[word] = marker->nativeCode[markerWord];
	if (changeBank) {
		// A system return uses the selected bank at RET, not the CALL's bank.
		// Map this fixture's other bank slot to a distinct dispatch page.
		auto* other = lookup.entrySlot(CART_ROM_BASE, 1);
		*other = marker->nativeCode[markerWord];
		parent->nativeContinuationCells[1] = other;
		machine.memory.writeMappedU32LE(IO_CART_SELECT, 1);
	}
	// Hide only the hierarchy root after binding. The stable group allocation
	// still owns the slots; restore it before teardown. A cached RET must not
	// repeat this lookup even when the source region has been destroyed.
	auto& root = const_cast<NativeCodeLookup::Root&>(lookup.root(changeBank ? 1u : 0u));
	auto* group = root[parent->pc >> NativeCodeLookup::ROOT_SHIFT];
	root[parent->pc >> NativeCodeLookup::ROOT_SHIFT] = nullptr;
	machine.cpu.runUntilDepth(0, 3);
	root[parent->pc >> NativeCodeLookup::ROOT_SHIFT] = group;
	require(machine.cpu.getFrameDepth() == 1
		&& machine.cpu.getGlobalByKey(machine.cpu.stringPool().intern("continuationResult")) == valueNumber(73),
		"RET follows the current published slot without a hierarchy walk or C++ continuation lookup");
}

void cartridgeReturnSelectsLiveBank() {
	test::Blua32TestImage systemImage;
	systemImage.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(systemImage.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(systemImage.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(systemImage.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	writeInstruction(systemImage.text, 3, static_cast<u8>(OpCode::LOADK), 1, 0, 0);
	writeInstruction(systemImage.text, 4, static_cast<u8>(OpCode::STORE_MEM), 0, 1, static_cast<u8>(MemoryAccessKind::Word));
	writeInstruction(systemImage.text, 5, static_cast<u8>(OpCode::RET), 0, 1, 0);
	systemImage.constants = {static_cast<double>(IO_CART_SELECT)};
	systemImage.functions = {{.firstWord=0, .wordCount=3, .maxStack=8},
		{.firstWord=3, .wordCount=3, .numParams=1, .maxStack=2}};
	systemImage.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, systemImage);
	test::Blua32TestImage cartridge;
	cartridge.text.resize(5 * INSTRUCTION_BYTES);
	writeInstruction(cartridge.text, 0, static_cast<u8>(OpCode::MOV), 4, 0, 0);
	writeInstruction(cartridge.text, 1, static_cast<u8>(OpCode::MOV), 5, 2, 0);
	writeInstruction(cartridge.text, 2, static_cast<u8>(OpCode::CALL), 4, 2, 1);
	writeInstruction(cartridge.text, 3, static_cast<u8>(OpCode::KSMI), 1, 0, 11);
	writeInstruction(cartridge.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	cartridge.functions = {{.firstWord=0, .wordCount=5, .maxStack=8}};
	const auto first = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridge);
	writeInstruction(cartridge.text, 3, static_cast<u8>(OpCode::KSMI), 1, 0, 22);
	const auto second = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartridge);
	for (const bool scalar : {true, false}) {
		Memory memory(MemoryInit{system.bytes, test::cartridgeSlots(first.bytes, second.bytes)}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
		DeviceScheduler scheduler(cpu); DmaController dma(memory, cpu, irq, scheduler);
		memory.cartridgeController().connect(memory, irq, dma);
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
		cpu.runUntilDepth(0, 3);
		auto* parent = cpu.rootThread()->firstFrame;
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
		for (int round = 0;; ++round) {
			const u32 bank = round & 1;
			memory.writeMappedWord(IO_CART_SELECT, bank ^ 1u);
			parent->registers[2] = valueNumber(bank);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], first.textAddress);
			cpu.runUntilDepth(0, 8192);
			cpu.runUntilDepth(1, 100);
			require(parent->registers[1] == valueNumber(bank == 0 ? 11 : 22)
				&& memory.cartridgeController().selectionWord() == bank,
				"a callee MMIO SELECT write selects the actual return instructions from the other cartridge");
			if (round >= 15) {
				if (scalar) break;
				auto& lookup = *parent->executionImage->nativeCodeLookup;
				auto* a = lookup.entrySlot(first.textAddress + 3 * INSTRUCTION_BYTES, 0);
				auto* b = lookup.entrySlot(first.textAddress + 3 * INSTRUCTION_BYTES, 1);
				if (a != b && *a && *b && parent->nativeContinuationCells[0] == a && parent->nativeContinuationCells[1] == b) break;
			}
			require(std::chrono::steady_clock::now() < deadline, "real cartridge publication supplies both live continuation cells");
			std::this_thread::yield();
		}
	}
}

void wideContinuationAcrossPage() {
	Machine machine;
	machine.warm(Machine::rootPc);
	const u32 start = Machine::rootPc + MAPPED_PAGE_BYTE_SIZE - 2 * INSTRUCTION_BYTES;
	const u32 continuation = start + 2 * INSTRUCTION_BYTES;
	std::vector<u8> code(5 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, static_cast<u8>(OpCode::MOV), 4, 0, 0);
	writeInstruction(code, 1, static_cast<u8>(OpCode::CALL), 4, 1, 1);
	writeInstruction(code, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(code, 3, static_cast<u8>(OpCode::KSMI), 1, 0, 42);
	writeInstruction(code, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	machine.memory.writeBytes(start, code.data(), code.size());
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], start);
	auto* parent = machine.cpu.rootThread()->firstFrame;
	auto& lookup = *parent->executionImage->nativeCodeLookup;
	auto* cell = lookup.entrySlot(continuation, 0);
	require(!*cell, "reserving an absent return page does not fetch or compile it");
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
	for (;;) {
		machine.cpu.runUntilDepth(0, 4096);
		machine.cpu.runUntilDepth(1, 100);
		if (*cell && parent->nativeContinuationCells[0] == cell) break;
		require(std::chrono::steady_clock::now() < deadline, "a cross-page return target is eventually published");
		std::this_thread::yield();
	}
	require(parent->registers[1] == valueNumber(42) && lookup.entrySlot(continuation, 1) == cell,
		"a warm native return consumes the WIDE instruction on the next physical page");
}

void observationAndLifecycle(int action) {
	Machine machine;
	machine.enterWarmChild();
	auto* parent = machine.cpu.rootThread()->firstFrame;
	if (action == 0) {
		unsigned observed = 0;
		InstructionObserverBinding binding;
		binding.points[0].insert(parent->pc);
		binding.context = &observed;
		binding.observe = [](void* context, ExecutionDomainId, u32, const Value*) { ++*static_cast<unsigned*>(context); };
		machine.cpu.setInstructionObserver(std::move(binding));
		machine.cpu.runUntilDepth(0, 3);
		require(observed == 1 && machine.cpu.getFrameDepth() == 1, "retired target obeys a newly installed observer");
	} else if (action == 1) {
		const auto state = machine.cpu.captureRuntimeState();
		machine.cpu.restoreRuntimeState(state);
		parent = machine.cpu.rootThread()->firstFrame;
		require(!parent->nativeContinuationCells[0] && !parent->next->nativeContinuationCells[0],
			"restore reconstructs guest activations without old host continuation metadata");
		machine.cpu.runUntilDepth(1, 100);
		require(machine.cpu.getFrameDepth() == 1 && parent->top == 4, "restored return retains the original result contract");
	} else if (action == 2) {
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.markerPc());
		require(!parent->nativeContinuationCells[0], "hot-resume invalidates the caller's former continuation binding");
		machine.cpu.runUntilDepth(0, 3);
		require(machine.cpu.getGlobalByKey(machine.cpu.stringPool().intern("continuationResult")) == valueNumber(73),
			"return after hot-resume follows the rewritten caller PC");
	} else if (action == 3) {
		machine.cpu.replaceExecutionImage(machine.addresses.resolveSystemDomain());
		require(!parent->nativeContinuationCells[0] && !parent->next->nativeContinuationCells[0],
			"replacement withdraws activation bindings before the lookup owner is destroyed");
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], Machine::rootPc + 4 * INSTRUCTION_BYTES);
		machine.cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[1], machine.calleePc());
		machine.cpu.runUntilDepth(1, 100);
		require(machine.cpu.getFrameDepth() == 1, "image replacement and frame rebinding retain return semantics");
	} else {
		machine.cpu.reset();
		require(!machine.cpu.rootThread()->firstFrame->nativeContinuationCells[0], "reset retires all native continuation bindings");
		machine.cpu.runUntilDepth(0, 100);
	}
}
} // namespace

int main() {
	try {
		stableLookupSlots();
		boundReturn(false, false);
		boundReturn(true, false);
		boundReturn(false, true);
		cartridgeReturnSelectsLiveBank();
		wideContinuationAcrossPage();
		for (int action = 0; action < 5; ++action) observationAndLifecycle(action);
		std::cout << "Native continuation tests passed; exit_bytes=" << sizeof(NativeBlockExitSite)
			<< " frame_bytes=" << sizeof(CallFrame) << '\n';
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
