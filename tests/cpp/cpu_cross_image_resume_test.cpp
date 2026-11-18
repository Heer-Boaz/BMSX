#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#endif

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct Images {
	test::Blua32TestRom system;
	std::array<test::Blua32TestRom, 2> cards;
	Images() {
		test::Blua32TestImage bios;
		bios.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(bios.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
		writeInstruction(bios.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 0, 0, static_cast<u8>(MemoryAccessKind::U32LE));
		writeInstruction(bios.text, 2, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
		writeInstruction(bios.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::LOADK), 1, 0, 2);
		writeInstruction(bios.text, DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::STORE_MEM), 0, 1, static_cast<u8>(MemoryAccessKind::Word));
		writeInstruction(bios.text, DECODED_PAGE_WORDS + 2, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
		writeInstruction(bios.text, DECODED_PAGE_WORDS + 3, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
		writeInstruction(bios.text, DECODED_PAGE_WORDS + 4, static_cast<u8>(OpCode::SETSYS), 0, 0, 0);
		writeInstruction(bios.text, DECODED_PAGE_WORDS + 5, static_cast<u8>(OpCode::RET), 0, 2, 0);
		writeInstruction(bios.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RFE), 0, 0, 0);
		bios.constants = {static_cast<i32>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET),
			303, static_cast<i32>(IO_CART_SELECT)};
		bios.globalNames = {"systemMarker"}; bios.systemGlobalNames = {"systemSlot"};
		bios.functions = {{.firstWord=0, .wordCount=3, .maxStack=8},
			{.firstWord=DECODED_PAGE_WORDS, .wordCount=6, .numParams=1, .maxStack=2},
			{.firstWord=2 * DECODED_PAGE_WORDS, .wordCount=1},
			// A second legal function root gives the isolated gate test a real
			// published RET entry, not an assumed entry in a larger region.
			{.firstWord=DECODED_PAGE_WORDS + 5, .wordCount=1, .maxStack=2}};
		bios.irqFunctionIndex = 2; bios.exceptionFunctionIndex = 2;
		system = test::encodeBlua32TestRom(RomImageDomain::System, bios);
		for (u32 slot = 0; slot != cards.size(); ++slot) {
			test::Blua32TestImage cart;
			cart.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
			writeInstruction(cart.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
			writeInstruction(cart.text, 1, static_cast<u8>(OpCode::CLOSURE), 7, 0, 0);
			writeInstruction(cart.text, 2, static_cast<u8>(OpCode::MOV), 4, 7, 0);
			writeInstruction(cart.text, 3, static_cast<u8>(OpCode::LOADK), 5, 0, 1);
			writeInstruction(cart.text, 4, static_cast<u8>(OpCode::CALL), 4, 2, 2);
			writeInstruction(cart.text, 5, static_cast<u8>(OpCode::LOADK), 6, 0, 0);
			writeInstruction(cart.text, 6, static_cast<u8>(OpCode::ADD), 0, 4, 6);
			writeInstruction(cart.text, 7, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
			writeInstruction(cart.text, 8, static_cast<u8>(OpCode::GETSYS), 1, 0, 0);
			writeInstruction(cart.text, 9, static_cast<u8>(OpCode::ADD), 2, 0, 1);
			writeInstruction(cart.text, 10, static_cast<u8>(OpCode::SETGL), 2, 0, 1);
			writeInstruction(cart.text, 11, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			writeInstruction(cart.text, 12, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
			writeInstruction(cart.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::K1), 3, 0, 0);
			writeInstruction(cart.text, DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::SETSYS), 3, 0, 1);
			writeInstruction(cart.text, DECODED_PAGE_WORDS + 2, static_cast<u8>(OpCode::LOADK), 0, 0, 2);
			writeInstruction(cart.text, DECODED_PAGE_WORDS + 3, static_cast<u8>(OpCode::LOADK), 1, 0, 3);
			writeInstruction(cart.text, DECODED_PAGE_WORDS + 4, static_cast<u8>(OpCode::STORE_MEM), 1, 0, static_cast<u8>(MemoryAccessKind::Word));
			writeInstruction(cart.text, DECODED_PAGE_WORDS + 5, static_cast<u8>(OpCode::RFE), 0, 0, 0);
			cart.constants = {static_cast<i32>(101u * (slot + 1)), static_cast<i32>(slot ^ 1u),
				static_cast<i32>(IO_IRQ_ACK), static_cast<i32>(IRQ_VBLANK)};
			cart.globalNames = {"cartMarker", "cartSystemMarker"};
			cart.systemGlobalNames = {"systemSlot", "irqSeen"};
			cart.closureRelocations = {{1, system.functionAddresses[1]}};
			cart.functions = {{.firstWord=0, .wordCount=13, .maxStack=16},
				{.firstWord=DECODED_PAGE_WORDS, .wordCount=6, .maxStack=4}};
			cart.irqFunctionIndex = 1; cart.exceptionFunctionIndex = 1;
			cards[slot] = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cart);
		}
	}
};

struct Machine {
	const Images& images;
	u32 slot;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	DeviceScheduler scheduler;
	DmaController dma;
	Machine(const Images& imageBytes, u32 socket, bool scalar) : images(imageBytes), slot(socket),
		memory(MemoryInit{images.system.bytes, test::cartridgeSlots(images.cards[0].bytes, images.cards[1].bytes)}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses), scheduler(cpu), dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		cpu.reset();
		memory.writeMappedU32LE(IO_CART_SELECT, slot);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
	u32 cartPc(u32 word) const { return images.cards[slot].textAddress + word * INSTRUCTION_BYTES; }
	u32 returnPc() const { return images.system.textAddress + MAPPED_PAGE_BYTE_SIZE + 5 * INSTRUCTION_BYTES; }
	void stopBeforeCall() {
		for (int step = 0; step != 16; ++step) {
			cpu.runUntilDepth(0, 1);
			if (cpu.readFrameExecutionDomain(0) == static_cast<ExecutionDomainId>(slot)
				&& cpu.rootThread()->firstFrame->pc == cartPc(2)) return;
		}
		throw std::runtime_error("ordinary EXEC and CLOSURE reach the real cartridge activation");
	}
	void stopBeforeReturn() {
		stopBeforeCall();
		for (int step = 0; step != 16; ++step) {
			cpu.runUntilDepth(0, 1);
			if (cpu.getFrameDepth() == 2 && cpu.activeThread()->currentFrame->pc == returnPc()) return;
		}
		throw std::runtime_error("the real system callee reaches its RET boundary");
	}
	Value global(const char* name) { return cpu.getGlobalByKey(cpu.stringPool().intern(name)); }
	void completedMarkers() {
		require(global("systemMarker") == valueInteger(303) && global("cartMarker") == valueInteger(303 + 101 * (slot + 1))
			&& global("cartSystemMarker") == valueInteger(606 + 101 * (slot + 1)),
			"each image consumes its own constants/name slots and the shared global banks");
		require(memory.cartridgeController().selectionWord() == (slot ^ 1u)
			&& cpu.readFrameExecutionDomain(0) == static_cast<ExecutionDomainId>(slot)
			&& cpu.readExecutionBusSignals() == mappedBusSignalsForCartridgeSlot(slot) && cpu.isUserMode(),
			"system CALL/RET keeps user privilege and returns to the bound instruction socket rather than SELECT");
	}
};

void parity(Machine& generated, Machine& scalar) {
	const auto a = generated.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words())
		&& std::ranges::equal(a.snapshot.objectWords(), b.snapshot.objectWords())
		&& a.programExecutionDomainId == b.programExecutionDomainId && a.executionCartridgeSlot == b.executionCartridgeSlot
		&& a.statusWord == b.statusWord && a.causeWord == b.causeWord && a.epcWord == b.epcWord
		&& a.lastExecutionDomainId == b.lastExecutionDomainId && a.lastPc == b.lastPc
		&& a.haltedUntilIrqFrameDepth == b.haltedUntilIrqFrameDepth && a.hardHalted == b.hardHalted,
		"cross-image execution retains complete value graphs and execution/exception snapshots");
	require(generated.cpu.getFrameDepth() == scalar.cpu.getFrameDepth()
		&& generated.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
		&& generated.memory.cartridgeController().selectionWord() == scalar.memory.cartridgeController().selectionWord()
		&& generated.memory.readBusFaultSequence() == scalar.memory.readBusFaultSequence(), "all activation and bus boundaries agree");
	for (int depth = 0; depth != generated.cpu.getFrameDepth(); ++depth) {
		const auto& x = *generated.cpu.activeThread()->frameAtDepth(depth);
		const auto& y = *scalar.cpu.activeThread()->frameAtDepth(depth);
		require(x.executionImage->executionDomainId == y.executionImage->executionDomainId && x.pc == y.pc
			&& x.top == y.top && x.stackBase == y.stackBase && x.stackCapacity == y.stackCapacity
			&& x.returnBase == y.returnBase && x.returnCount == y.returnCount && x.callSitePc == y.callSitePc,
			"each live frame retains its own image and exact argument/result window");
	}
}

void shortGrantsAndRestore(const Images& images, u32 slot, bool restore) {
	Machine generated(images, slot, false), scalar(images, slot, true);
	if (restore) {
		generated.stopBeforeReturn(); scalar.stopBeforeReturn(); parity(generated, scalar);
		generated.cpu.restoreRuntimeState(generated.cpu.captureRuntimeState());
		scalar.cpu.restoreRuntimeState(scalar.cpu.captureRuntimeState());
	}
	for (const int grant : {0, 1, 2, 3, 1, 4, 1, 5, 2, 8, 13, 64}) {
		test::runCpuParity(generated.cpu, scalar.cpu, grant); parity(generated, scalar);
		if (generated.cpu.isHaltedUntilIrq()) break;
	}
	require(generated.cpu.isHaltedUntilIrq(), "the same short grants reach the cart HALT");
	generated.completedMarkers(); scalar.completedMarkers();
}

void irqInSystemCallee(const Images& images, u32 slot) {
	Machine generated(images, slot, false), scalar(images, slot, true);
	for (auto* m : {&generated, &scalar}) {
		m->stopBeforeReturn();
		m->memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_VBLANK);
		m->irq.raise(IRQ_VBLANK);
	}
	for (const int grant : {1, 1, 2, 3, 5, 8, 64}) {
		test::runCpuParity(generated.cpu, scalar.cpu, grant); parity(generated, scalar);
		if (generated.cpu.isHaltedUntilIrq()) break;
	}
	const auto key = generated.cpu.stringPool().intern("irqSeen");
	require(generated.cpu.getSystemGlobalByKey(key) == valueInteger(1), "IRQ in a user-mode BIOS callee uses the program socket's vector");
	generated.completedMarkers(); scalar.completedMarkers();
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void oneStableGate(const Images& images, u32 slot, bool returning, bool cold, bool exhausted, int targetDepth = 0) {
	Machine m(images, slot, false);
	auto* systemImage = m.cpu.rootThread()->firstFrame->executionImage;
	if (returning) m.stopBeforeReturn(); else m.stopBeforeCall();
	auto* frame = m.cpu.activeThread()->currentFrame;
	auto* sourceImage = frame->executionImage;
	const u32 sourceSlot = m.memory.cartridgeController().selectedSlot(m.cpu.readExecutionBusSignals());
	auto* sourcePage = sourceImage->nativeCodeLookup->find(frame->pc, sourceSlot);
	require(sourcePage && sourcePage->nativeCode, "the gate starts at an actual published caller/RET entry");
	void* body = sourcePage->nativeCode[(frame->pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(body != nullptr, "the source entry is warm before the stable gate is entered");
	if (cold) {
		auto* targetImage = returning ? frame->previous->executionImage : systemImage;
		const u32 targetPc = returning ? frame->previous->pc : images.system.textAddress + MAPPED_PAGE_BYTE_SIZE;
		auto* targetPage = targetImage->nativeCodeLookup->find(targetPc, slot);
		targetPage->retireNativeBlocks();
	}
	ValueSlots decoyGlobals(8);
	std::array<u32, COP0_EXEC + 1> decoyCp0{};
	decoyCp0[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
	const int grant = exhausted ? BASE_CYCLES[static_cast<u8>(OpCode::RET)] + 1 : 100;
	const auto& gate = nativeBlockGate();
	NativeCpuRunState run{.state={.registers=frame->registers, .constants=sourceImage->constPool.view(), .frame=frame, .heap=&m.cpu.gcHeap(),
		.globalValues=decoyGlobals.view(), .systemGlobalValues=decoyGlobals.view(), .cop0Words=decoyCp0.data(),
		.constantCount=static_cast<u32>(sourceImage->constPool.capacity()), .remainingCycles=grant, .registerTop=frame->top,
		.exitCode=gate.dispatch,
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		.diagnosticOpcodes={},
#endif
		}, .cpu=&m.cpu, .targetDepth=targetDepth, .codeRoot=sourceImage->nativeCodeLookup->root(sourceSlot),
		.systemRom=&m.memory.systemRomStorage(), .cartridgeRom=m.memory.cartridgeController().romStorage(sourceSlot),
		.ram={m.memory.ramData(), m.memory.ramByteCount()}, .cartridgeSlot=sourceSlot, .error={}};
	// No CPU run loop surrounds this call. Only a same-stable-gate resume can
	// execute the genuine guest marker instructions before the gate returns.
	using Entry = void (SLJIT_FUNC *)(NativeCpuRunState*, void*);
	reinterpret_cast<Entry>(gate.entry)(&run, body);
	if (run.error) std::rethrow_exception(run.error);
	if (cold || exhausted || targetDepth == 1) {
		require(m.global("cartMarker") == valueNil() && m.cpu.getFrameDepth() == (returning ? 1 : 2),
			"cold/exhausted/depth-limited transitions commit once but cannot enter the receiving body");
		if (exhausted) require(m.cpu.instructionBudgetRemaining == 0, "RET placement consumes the exact final grant");
		if (cold) {
			m.cpu.runUntilDepth(0, m.cpu.instructionBudgetRemaining);
			m.completedMarkers();
		}
		return;
	}
	require(m.cpu.isHaltedUntilIrq(), "one stable native gate reaches the cartridge's real HALT");
	m.completedMarkers();
	require(run.state.frame == m.cpu.activeThread()->currentFrame && run.state.registers.words() == run.state.frame->registers.words()
		&& run.state.registers.tags() == run.state.frame->registers.tags()
		&& run.state.constants.words() == run.state.frame->executionImage->constPool.words()
		&& run.state.constants.tags() == run.state.frame->executionImage->constPool.tags()
		&& run.state.constantCount == run.state.frame->executionImage->constPool.capacity()
		&& run.state.globalValues.words() != decoyGlobals.words() && run.state.globalValues.tags() != decoyGlobals.tags()
		&& run.state.systemGlobalValues.words() != decoyGlobals.words() && run.state.systemGlobalValues.tags() != decoyGlobals.tags()
		&& run.state.cop0Words != decoyCp0.data() && run.state.cop0Words[COP0_STATUS] == CPU_STATUS_CART_ENTRY
		&& run.codeRoot == run.state.frame->executionImage->nativeCodeLookup->root(slot)
		&& run.cartridgeSlot == slot && run.cartridgeRom == m.memory.cartridgeController().romStorage(slot),
		"the retained native frame rebinds every image/CPU/instruction-socket bank before resuming");
}
#endif
} // namespace

int main() {
	try {
		const Images images;
		for (u32 slot = 0; slot != 2; ++slot) {
			shortGrantsAndRestore(images, slot, false); shortGrantsAndRestore(images, slot, true);
			irqInSystemCallee(images, slot);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			oneStableGate(images, slot, false, false, false);
			oneStableGate(images, slot, true, false, false);
			oneStableGate(images, slot, false, true, false);
			oneStableGate(images, slot, true, true, false);
			oneStableGate(images, slot, true, false, true);
			oneStableGate(images, slot, true, false, false, 1);
#endif
		}
		std::cout << "Cross-image native resume tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
