#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"
#include "machine/devices/irq/controller.h"
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
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
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
			if (page && page->nativeCode && page->nativeCode[(entryPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]) break;
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
		void* original = callee->nativeBlocks->code[word];
		callee->nativeBlocks->code[word] = marker->nativeCode[markerWord];
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rootPc + 2 * INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 4);
		callee->nativeBlocks->code[word] = original;
		require(cpu.getFrameDepth() == 2, "generated CALL enters a live child");
		auto* parent = cpu.rootThread()->firstFrame;
		require(parent->nativeContinuationPages[0] == lookup.pageSlot(parent->pc, 0)
			&& parent->nativeContinuationPages[1] == lookup.pageSlot(parent->pc, 1),
			"CALL copies the published callsite bindings to its activation");
		cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[1], calleePc());
		parent->registers[1] = valueNumber(73);
		cpu.setGlobalByKey(cpu.stringPool().intern("continuationResult"), valueNil());
	}
};

void stableLookupSlots() {
	NativeCodeLookup lookup;
	const u32 pc = CART_ROM_BASE + MAPPED_PAGE_BYTE_SIZE;
	auto* first = lookup.pageSlot(pc, 0);
	auto* second = lookup.pageSlot(pc, 1);
	require(first != second && !*first && !*second, "absent cartridge pages have independent stable bank slots");
	DecodedInstructionPage a(true, {}), b(true, {});
	lookup.install(pc & ~MAPPED_PAGE_BYTE_MASK, 0, a);
	lookup.install(pc & ~MAPPED_PAGE_BYTE_MASK, 1, b);
	require(*first == &a && *second == &b, "later page publication updates already retained slots");
	for (u32 address = 0; address < CART_ROM_BASE; address += 1u << NativeCodeLookup::ROOT_SHIFT)
		lookup.pageSlot(address, 0);
	require(first == lookup.pageSlot(pc, 0) && second == lookup.pageSlot(pc, 1),
		"other group allocations never move retained page slots");
}

void boundReturn(bool replaceTargetStorage, bool changeBank) {
	Machine machine;
	machine.enterWarmChild();
	auto* parent = machine.cpu.rootThread()->firstFrame;
	auto& lookup = *parent->executionImage->nativeCodeLookup;
	auto* page = *parent->nativeContinuationPages[0];
	const auto slot = parent->nativeContinuationPages[0];
	const auto word = (parent->pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	auto* marker = lookup.find(machine.markerPc(), 0);
	const auto markerWord = (machine.markerPc() & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	if (replaceTargetStorage) {
		// A real source write retires the source CALL and its continuation while
		// the callee is active. Replace the raw dispatch allocation afterwards.
		machine.memory.writeMappedU32LE(parent->pc, packInstructionWord(static_cast<u8>(OpCode::K1), 1, 0, 0));
		require(!page->nativeCode && !page->nativeBlocks && *slot == page,
			"source invalidation frees code storage, not the continuation's lookup slot");
		page->nativeBlocks = std::make_unique<NativeBlockPage>();
		page->nativeCode = page->nativeBlocks->code;
	}
	// This independently owned marker body makes the raw generated route
	// observable. The semantic dispatcher cannot select it via descriptors.
	page->nativeBlocks->code[word] = marker->nativeCode[markerWord];
	if (changeBank) {
		// A system return uses the selected bank at RET, not the CALL's bank.
		// Map this fixture's other bank slot to a distinct dispatch page.
		auto* other = lookup.pageSlot(CART_ROM_BASE, 1);
		lookup.install(CART_ROM_BASE, 1, *marker);
		parent->nativeContinuationPages[1] = other;
		marker->nativeBlocks->code[word] = marker->nativeCode[markerWord];
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
		require(!parent->nativeContinuationPages[0] && !parent->next->nativeContinuationPages[0],
			"restore reconstructs guest activations without old host continuation metadata");
		machine.cpu.runUntilDepth(1, 100);
		require(machine.cpu.getFrameDepth() == 1 && parent->top == 4, "restored return retains the original result contract");
	} else if (action == 2) {
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.markerPc());
		require(!parent->nativeContinuationPages[0], "hot-resume invalidates the caller's former continuation binding");
		machine.cpu.runUntilDepth(0, 3);
		require(machine.cpu.getGlobalByKey(machine.cpu.stringPool().intern("continuationResult")) == valueNumber(73),
			"return after hot-resume follows the rewritten caller PC");
	} else if (action == 3) {
		machine.cpu.replaceExecutionImage(machine.addresses.resolveSystemDomain());
		require(!parent->nativeContinuationPages[0] && !parent->next->nativeContinuationPages[0],
			"replacement withdraws activation bindings before the lookup owner is destroyed");
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], Machine::rootPc + 4 * INSTRUCTION_BYTES);
		machine.cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[1], machine.calleePc());
		machine.cpu.runUntilDepth(1, 100);
		require(machine.cpu.getFrameDepth() == 1, "image replacement and frame rebinding retain return semantics");
	} else {
		machine.cpu.reset();
		require(!machine.cpu.rootThread()->firstFrame->nativeContinuationPages[0], "reset retires all native continuation bindings");
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
		for (int action = 0; action < 5; ++action) observationAndLifecycle(action);
		std::cout << "Native continuation tests passed; exit_bytes=" << sizeof(NativeBlockExitSite)
			<< " frame_bytes=" << sizeof(CallFrame) << '\n';
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
