#include "support/cpu_execution_parity.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/table.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <limits>
#include <cstdio>
#include <thread>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;

struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	Machine(const test::Blua32TestImage& image, bool scalar, u32 bssByteCount = test::RAM_CODE_FIXTURE_BYTES)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, bssByteCount)),
		  memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		  irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr,
			SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	}
};

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void generatedArithmeticTrainsTheCompiler(bool liveFeedbackIsAlreadyStable) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.constants = {Blua32FloatConstant{valuePayload(valueFloat(1.5f))}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMPIF), 6, 0, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 4, 0, 63, 7);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::K1), 5, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 7}};
	Machine native(image, false), scalar(image, true);
	auto& cpu = native.cpu;
	const u32 start = native.rom.textAddress, pc = start + INSTRUCTION_BYTES, wide = pc + INSTRUCTION_BYTES;
	const auto& installed = *cpu.activeThread()->frameAtDepth(0)->executionImage;
	cpu.prepareSystemNativeCode();
	auto& page = *installed.nativeCodeLookup->find(pc, 0);
	const u32 entryWord = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const int prefixCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
	const int sumCycles = BASE_CYCLES[static_cast<u8>(OpCode::ADD)];
	const auto hasPromotion = [&](const NativeBlock& entry) {
		return std::ranges::any_of(entry.sideExits, [](const auto& exit) { return exit.exit == NativeBlockExit::ProfileReady; });
	};
	require(hasPromotion(*page.nativeBlocks->entries[entryWord]), "cold arithmetic starts in a sampling native entry");
	if (liveFeedbackIsAlreadyStable) {
		// The compiler snapshots this opcode while it is still generic. By
		// the time that image executes, scalar samples may have caught up.
		auto& decoded = page.words[entryWord + 1u];
		for (int sample = 0; sample < 16; ++sample)
			decoded.observeNativeNumericTypes(valueInteger(12), valueFloat(1.5f));
	}
	for (int attempt = 0; attempt < 12; ++attempt) {
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(0, valueInteger(12));
			frame.registers.set(4, valueInteger(91));
			frame.registers.set(5, valueInteger(73));
			frame.setTop(6);
		}
		require(test::runCpuParity(cpu, scalar.cpu, prefixCycles + 1) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == 1 - sumCycles
			&& cpu.readCurrentInstructionPc() == wide && cpu.lastPc == wide + INSTRUCTION_BYTES
			&& cpu.readFramePc(0) == wide + 2 * INSTRUCTION_BYTES
			&& cpu.readFrameRegister(0, 2) == valueInteger(1)
			&& cpu.readFrameRegister(0, 4) == valueFloat(13.5f) && cpu.readFrameRegister(0, 5) == valueInteger(73)
			&& test::sameLanguageRam(cpu, scalar.cpu),
			"the sampling or specialized body completes WIDE ADD exactly once and does not enter its suffix");
		if (!page.nativeBlocks || !page.nativeBlocks->entries[entryWord])
			test::waitForNativeEntry(cpu, page, entryWord);
	}
	const auto& trained = *page.nativeBlocks->entries[entryWord];
	require(!hasPromotion(trained) && trained.sideExits.size() == 1
		&& trained.sideExits.front().operands.replay.arithmetic == NativeArithmeticFeedback{ValueTag::Integer, ValueTag::Float},
		"completed native operations train an inline specialization without a manually prepared replacement");
	const auto& successor = page.nativeBlocks->entries[entryWord + 3u];
	require(trained.terminal.currentPc == wide && successor && successor->firstPc == wide + 2u * INSTRUCTION_BYTES,
		"the replacement preserves independent entries from the original source graph");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& gate = cpu.nativeGateProfile();
	require(gate.exits[static_cast<size_t>(NativeBlockExit::ProfileReady)].entries == 1,
		"only the completed promotion leaves the generic datapath to rebuild");
	require(gate.exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)].entries == 0,
		"training never replays the already completed opcode");
#endif
#else
	(void)liveFeedbackIsAlreadyStable;
#endif
}

void adaptiveArithmeticReplay() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	// The taken edge gives the suffix a separate published entry. The fallthrough
	// can therefore start its final WIDE arithmetic with one cycle left.
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMPIF), 6, 0, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SUB), 4, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::K1), 5, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 7}, {.firstWord = 16, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	Machine native(image, false), scalar(image, true);
	const u32 pc = native.rom.textAddress + INSTRUCTION_BYTES;
	const u32 wide = pc + INSTRUCTION_BYTES, suffix = wide + 2u * INSTRUCTION_BYTES;
	const int prefixCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
	const int complete = prefixCycles + BASE_CYCLES[static_cast<u8>(OpCode::SUB)];
	const auto input = [&](Value step) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(0, valueInteger(12));
			registers.set(1, step);
			registers.set(2, valueNil());
			registers.set(4, valueInteger(73));
			registers.set(5, valueInteger(99));
		}
	};
	const auto subtract = [&](Value step, Value expected, int grant) {
		input(step);
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded, "the grant stops before the suffix");
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			require(cpu.instructionBudgetRemaining == grant - complete
				&& cpu.readCurrentInstructionPc() == wide && cpu.lastPc == wide + INSTRUCTION_BYTES
				&& cpu.readFramePc(0) == suffix, "the WIDE replay pays its base charge once and reports the exact frontier");
			require(cpu.readFrameRegister(0, 2) == valueInteger(1) && cpu.readFrameRegister(0, 4) == expected
				&& cpu.readFrameRegister(0, 5) == valueInteger(99), "the completed prefix, arithmetic result and unstarted suffix agree");
		}
		require(test::sameLanguageRam(native.cpu, scalar.cpu), "arithmetic retry preserves guest RAM");
	};
	for (int i = 0; i < 16; ++i) subtract(valueInteger(2), valueInteger(10), complete);

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 entry = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto installed = [&] { return page.nativeBlocks && page.nativeBlocks->entries[entry]; };
	require(installed() && page.nativeBlocks->entries[entry]->admissionCycles == prefixCycles
		&& page.nativeBlocks->entries[entry]->terminal.currentPc == wide && page.words[entry + 1u].nativeNumericTypes().stable(),
		"successful scalar observations specialize a published region containing WIDE SUB");
	const auto& exits = page.nativeBlocks->entries[entry]->sideExits;
	require(exits.size() == 1 && exits.front().exit == NativeBlockExit::ScalarBoundary
		&& exits.front().nextPc == wide && exits.front().currentPc == pc && exits.front().lastPc == pc
		&& exits.front().cycles == prefixCycles && exits.front().registerTop == 3
		&& exits.front().operands.replay.hasCompletedInstruction
		&& exits.front().operands.replay.arithmetic == NativeArithmeticFeedback{ValueTag::Integer, ValueTag::Integer},
		"published WIDE arithmetic keeps its exact scalar replay, not a dead semantic fault site");
	const auto feedback = page.words[entry + 1u].nativeNumericTypes();
#endif
	input(valueBool(false));
	test::runCpuParity(native.cpu, scalar.cpu, prefixCycles + 1);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		require(cpu.readEpcWord() == wide && cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT
			&& cpu.readFrameRegister(0, 4) == valueInteger(73), "a failed arithmetic replay faults before committing its result");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(installed() && page.words[entry + 1u].nativeNumericTypes() == feedback, "a faulting arithmetic execution cannot train or retire its specialization");
#endif
	for (auto* machine : {&native, &scalar}) {
		require(machine->cpu.runUntilDepth(1, BASE_CYCLES[static_cast<u8>(OpCode::RFE)]) == RunResult::Halted,
			"the real exception return restores the root activation");
	}

	subtract(valueFloat(0.5f), valueFloat(11.5f), prefixCycles + 1);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(installed(), "a single contradictory success does not retire a stable specialization");
	for (int i = 0; i < 8 && installed(); ++i) subtract(valueFloat(0.5f), valueFloat(11.5f), complete);
	require(!installed() && page.words[entry + 1u].nativeNumericTypes().polymorphic(),
		"repeated successful contradictions withdraw the old users and widen the site");
	native.cpu.prepareSystemNativeCode();
	require(installed(), "the code owner can republish the source with the updated feedback");
	const auto& generic = page.nativeBlocks->entries[entry]->sideExits;
	require(generic.size() == 1 && generic.front().exit == NativeBlockExit::InvalidOperand
		&& generic.front().currentPc == wide && generic.front().lastPc == wide + INSTRUCTION_BYTES
		&& generic.front().nextPc == suffix && generic.front().cycles == complete && generic.front().registerTop == 3,
		"the widened site retains the exact WIDE fault, but cannot request another type promotion");
	const auto published = page.nativeBlocks->entries[entry]->region;
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto boundary = static_cast<size_t>(NativeBlockExit::ScalarBoundary);
	const auto exitsBefore = native.cpu.nativeGateProfile().exits[boundary].entries;
#endif
#endif
	for (int i = 0; i < 8; ++i) {
		// Each phase alone was long enough to retrain the old monomorphic
		// policy. The mixed site must now keep executing the same code.
		for (int j = 0; j < 8; ++j) subtract(valueInteger(2), valueInteger(10), complete);
		for (int j = 0; j < 8; ++j) subtract(valueFloat(0.5f), valueFloat(11.5f), prefixCycles + 1);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(installed() && page.nativeBlocks->entries[entry]->region == published,
			"bursts of either representation keep the published numeric region");
#endif
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(native.cpu.nativeGateProfile().exits[boundary].entries == exitsBefore,
		"the rebuilt native body does not repeatedly deoptimize on valid alternating numeric subtypes");
#endif
#endif
}

void copiedArithmeticReplay() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMPIF), 5, 0, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 2, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::K1), 4, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 6}};
	Machine native(image, false), scalar(image, true);
	const u32 pc = native.rom.textAddress + INSTRUCTION_BYTES;
	const u32 wide = pc + INSTRUCTION_BYTES, suffix = wide + 2u * INSTRUCTION_BYTES;
	const int copyCycles = BASE_CYCLES[static_cast<u8>(OpCode::MOV)];
	const int addCycles = BASE_CYCLES[static_cast<u8>(OpCode::ADD)];
	const auto run = [&](Value input, Value result, int grant) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(0, input);
			registers.set(1, valueNil());
			registers.set(2, valueInteger(95));
			registers.set(4, valueInteger(96));
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded,
			"the exact grant retires the copied sum and not its successor");
		require(native.cpu.instructionBudgetRemaining == grant - copyCycles - addCycles
			&& native.cpu.readCurrentInstructionPc() == wide && native.cpu.lastPc == wide + INSTRUCTION_BYTES
			&& native.cpu.readFramePc(0) == suffix,
			"a WIDE retry keeps the prefix PC, last body word and exact debt");
		require(native.cpu.readFrameRegister(0, 0) == input && native.cpu.readFrameRegister(0, 1) == input
			&& native.cpu.readFrameRegister(0, 2) == result && native.cpu.readFrameRegister(0, 4) == valueInteger(96)
			&& test::sameLanguageRam(native.cpu, scalar.cpu),
			"the MOV value, retried result and untouched suffix match the interpreter's guest RAM");
	};
	for (int sample = 0; sample < 16; ++sample)
		run(valueInteger(7), valueInteger(14), copyCycles + addCycles);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto& block = page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->admissionCycles == copyCycles && block->sideExits.size() == 1,
		"the copied arithmetic is a published proof-specialized native block");
	const auto& replay = block->sideExits.front();
	require(replay.exit == NativeBlockExit::ScalarBoundary && replay.currentPc == pc && replay.lastPc == pc
		&& replay.nextPc == wide && replay.cycles == copyCycles && replay.registerTop == 2
		&& replay.operands.replay.arithmetic == NativeArithmeticFeedback{ValueTag::Integer, ValueTag::Integer},
		"the copied-input proof failure replays at the WIDE prefix after committing only the MOV");
#endif
	run(valueFloat(1.25f), valueFloat(2.5f), copyCycles + 1);
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void waitForNativeEntries(Machine& machine, u32 base, std::initializer_list<u32> offsets) {
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	for (;;) {
		const auto* page = machine.cpu.rootThread()->frameAtDepth(0)->decodedPage;
		bool ready = page && page->nativeBlocks;
		for (u32 offset : offsets) {
			if (!ready) break;
			ready = page->nativeBlocks->entries[((base + offset * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) >> 2] != nullptr;
		}
		if (ready) return;
		require(std::chrono::steady_clock::now() < deadline, "native entries must actually be published");
		machine.cpu.runUntilDepth(0, 4000);
		if (machine.cpu.activeThread()->frameDepth() > 1) machine.cpu.runUntilDepth(1, 100);
		std::this_thread::yield();
	}
}
#endif

void exactGrant(bool store) {
	constexpr u32 address = DYNAMIC_RAM_BASE + 0x20000u;
	constexpr u32 bssByteCount = address - DYNAMIC_RAM_BASE + sizeof(u32);
	for (int grant : {2, 4, 6, 8}) {
		test::Blua32TestImage image;
		image.text.resize(6u * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 2, 0, 0);
		if (store) writeInstruction(image.text, 3, static_cast<u8>(OpCode::STORE_MEM), 5, 4,
			static_cast<u8>(MemoryAccessKind::U32LE));
		else writeInstruction(image.text, 3, static_cast<u8>(OpCode::NEWT), 3, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::RFE), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 6},
			{.firstWord = 5, .wordCount = 1, .maxStack = 1}};
		image.irqFunctionIndex = 1;
		Machine native(image, false, bssByteCount), scalar(image, true, bssByteCount);
		for (auto* machine : {&native, &scalar}) {
			auto* frame = machine->cpu.activeThread()->frameAtDepth(0);
			frame->registers.set(4, valueInteger(address));
			frame->registers.set(5, valueInteger(0x12345678));
			for (int i = 0; i < 20; ++i) machine->cpu.runUntilDepth(0, 128);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				waitForNativeEntries(*machine, machine->rom.textAddress, {0});
				const auto* page = frame->decodedPage;
				require(page && page->nativeBlocks && page->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2],
				"the measured native entry was actually compiled");
			}
#endif
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], machine->rom.textAddress);
			for (int reg = 0; reg < 4; ++reg) frame->registers.set(reg, valueNil());
			machine->memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
			machine->memory.writeU32(address, 0);
		}
		const u32 nativeStartCount = test::allocatedObjectRecords(native.cpu);
		const u32 scalarStartCount = test::allocatedObjectRecords(scalar.cpu);
		const auto nativeResult = native.cpu.runUntilDepth(0, grant);
		const auto scalarResult = scalar.cpu.runUntilDepth(0, grant);
		const auto nativePc = native.cpu.readFramePc(0), scalarPc = scalar.cpu.readFramePc(0);
		const u32 nativeAllocations = test::allocatedObjectRecords(native.cpu) - nativeStartCount;
		const u32 scalarAllocations = test::allocatedObjectRecords(scalar.cpu) - scalarStartCount;
		for (auto* machine : {&native, &scalar}) {
			machine->irq.raise(IRQ_GPU);
			require(machine->cpu.enterPendingInterrupt(), "IRQ is accepted");
		}
		std::printf("%s grant=%d cycles=%d/%d pc=%08x/%08x EPC=%08x/%08x allocations=%u/%u RAM=%08x/%08x\n",
			store ? "store" : "allocate", grant, native.cpu.instructionBudgetRemaining, scalar.cpu.instructionBudgetRemaining,
			nativePc, scalarPc, native.cpu.readEpcWord(), scalar.cpu.readEpcWord(), nativeAllocations, scalarAllocations,
			native.memory.readU32(address), scalar.memory.readU32(address));
		require(nativeResult == scalarResult, "both CPUs return the same status for the requested grant");
		require(native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining, "same grant has the same remaining cycles");
		require(nativePc == scalarPc && native.cpu.readEpcWord() == scalar.cpu.readEpcWord(), "IRQ is accepted at the same guest instruction boundary");
		require(nativeAllocations == scalarAllocations, "no premature allocation before the IRQ");
		require(native.memory.readU32(address) == scalar.memory.readU32(address), "no premature native RAM store before the IRQ");
	}
}

void divisionBudget(bool skip) {
	require(BASE_CYCLES[static_cast<u8>(OpCode::DIV)] == 32
		&& BASE_CYCLES[static_cast<u8>(OpCode::FLOORDIV)] == 33, "division charges include the uniform supply cycle");
	for (const bool wide : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(7u * INSTRUCTION_BYTES);
		const int quotient = wide ? 256 : 0, floor = quotient + 1;
		u32 word = 0;
		writeInstruction(image.text, word++, static_cast<u8>(skip ? OpCode::EQ : OpCode::MOV), skip ? 0 : 2, skip ? 4 : 3, skip ? 4 : 0);
		const u32 divWord = word;
		if (wide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), 1, 0, 0);
		writeInstruction(image.text, word++, static_cast<u8>(OpCode::DIV), 0, 4, 5);
		const u32 second = word;
		if (skip) writeInstruction(image.text, word++, static_cast<u8>(OpCode::EQ), 0, 4, 4);
		const u32 floorWord = word;
		if (wide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), 1, 0, 0);
		writeInstruction(image.text, word++, static_cast<u8>(OpCode::FLOORDIV), 1, 4, 5);
		const u32 markerWord = word;
		if (!skip) writeInstruction(image.text, word++, static_cast<u8>(OpCode::KTRUE), 2, 0, 0);
		const u32 jumpWord = word;
		writeInstruction(image.text, word, static_cast<u8>(OpCode::JMP), 0, 63, (-(word + 1u)) & 63u, 255);
		++word;
		image.functions = {{.firstWord = 0, .wordCount = word, .maxStack = static_cast<u32>(quotient + 6)}};
		Machine native(image, false), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			auto* frame = machine->cpu.rootThread()->frameAtDepth(0);
			frame->registers.set(3, valueInteger(9)); frame->registers.set(4, valueInteger(-7)); frame->registers.set(5, valueInteger(3));
			machine->cpu.runUntilDepth(0, skip ? 600 : 7100);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) waitForNativeEntries(*machine, machine->rom.textAddress, {0});
#endif
		}
		const std::array<u32, 6> boundaries{0, divWord, floorWord, markerWord, jumpWord, 0};
		const std::array<int, 5> charges{2, 32, 33, 2, 2};
		for (int grant = 0; grant <= (skip ? 6 : 71); ++grant) {
			for (auto* machine : {&native, &scalar}) {
				machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
					machine->rom.functionAddresses[0], machine->rom.textAddress);
				auto* frame = machine->cpu.rootThread()->frameAtDepth(0);
				frame->registers.set(quotient, valueNil()); frame->registers.set(floor, valueNil()); frame->registers.set(2, valueNil());
				require(machine->cpu.runUntilDepth(0, grant) == RunResult::Yielded, "division loop yields at its next admission boundary");
				if (skip) {
					const int completed = (grant + 1) >> 1;
					const std::array<u32, 4> skippedBoundaries{0, second, jumpWord, 0};
					require(machine->cpu.instructionBudgetRemaining == grant - 2 * completed,
						"a skipped division has no execution charge, including WIDE");
					require(frame->readControl(bmsx::FrameField::Pc) == machine->rom.textAddress + skippedBoundaries[completed] * INSTRUCTION_BYTES,
						"a comparison skips the complete division instruction");
					require(frame->registers.get(quotient) == valueNil() && frame->registers.get(floor) == valueNil(),
						"skipped divisions do not write destinations");
				} else {
					int remaining = grant, completed = 0;
					while (remaining > 0) remaining -= charges[completed++];
					require(machine->cpu.instructionBudgetRemaining == remaining, "each admitted division keeps its complete fixed charge and debt");
					require(frame->readControl(bmsx::FrameField::Pc) == machine->rom.textAddress + boundaries[completed] * INSTRUCTION_BYTES,
						"division debt prevents the next opcode from executing");
					require(frame->registers.get(quotient) == (completed >= 2 ? valueFloat(-7.0f / 3.0f) : valueNil()), "DIV writes only after admission");
					require(frame->registers.get(floor) == (completed >= 3 ? valueInteger(-3) : valueNil()), "FLOORDIV writes only after admission");
					require(frame->registers.get(2) == (completed >= 4 ? valueBool(true) : completed >= 1 ? valueInteger(9) : valueNil()),
						"the successor marker is not published early");
				}
			}
		}
		if (skip) continue;
		const float inf = std::numeric_limits<float>::infinity(), nan = std::numeric_limits<float>::quiet_NaN();
		const std::array<std::array<float, 4>, 4> cases{{{-0.0, 3.0, -0.0, -0.0}, {1.0, 0.0, inf, inf}, {0.0, 0.0, nan, nan}, {inf, -2.0, -inf, -inf}}};
		for (const auto& values : cases) for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], machine->rom.textAddress);
			auto* frame = machine->cpu.rootThread()->frameAtDepth(0);
			frame->registers.set(4, valueFloat(values[0])); frame->registers.set(5, valueFloat(values[1]));
			require(machine->cpu.runUntilDepth(0, 71) == RunResult::Yielded && machine->cpu.instructionBudgetRemaining == 0,
				"nonfinite and signed-zero operands keep the same fixed division budget");
			require(frame->readControl(bmsx::FrameField::Pc) == machine->rom.textAddress, "nonfinite results finish the complete generated loop");
			require(frame->registers.get(quotient) == valueFloat(values[2]) && frame->registers.get(floor) == valueFloat(values[3]),
				"division retains NaN, infinity and signed-zero semantics");
		}
	}
}

// Each pair starts from the same guest state and receives the identical budget.
// An instruction admitted with positive budget completes even if its variable
// cost exhausts that budget: parity concerns the *next* instruction boundary.
void exactGrantSweep(bool scalarControl) {
	constexpr u32 address = DYNAMIC_RAM_BASE + 0x20000u;
	constexpr u32 bssByteCount = address - DYNAMIC_RAM_BASE + sizeof(u32);
	test::Blua32TestImage image;
	image.text.resize(7u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 2, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::NEWT), 3, 4, 3);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::STORE_MEM), 5, 4,
		static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 6},
		{.firstWord = 6, .wordCount = 1, .maxStack = 1}};
	image.irqFunctionIndex = 1;
	unsigned mismatchCount = 0;
	for (int grant = 1; grant <= 64; ++grant) {
		Machine native(image, scalarControl, bssByteCount), scalar(image, true, bssByteCount);
		for (auto* machine : {&native, &scalar}) {
			auto& frame = *machine->cpu.rootThread()->frameAtDepth(0);
			frame.registers.set(4, valueInteger(address));
			frame.registers.set(5, valueInteger(0x12345678));
			// These inputs are live across NEWT and its GC work, not just within the register capacity.
			frame.setTop(6);
		}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		if (!scalarControl) native.cpu.setNativeCompilationProfiling(true);
#endif
		for (int slice = 0; slice < 64; ++slice) {
			require(test::runCpuParity(native.cpu, scalar.cpu, 128) == RunResult::Yielded,
				"both warm loops stop on the same guest budget");
#if defined(BMSX_NATIVE_COMPILER_WORKER)
			// Only publish a submitted job; host waiting must not run more guest code or collect more objects.
			if (!scalarControl) test::waitForFixtureWorkerRequests(native.cpu);
#endif
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (!scalarControl) {
			const auto& page = *native.cpu.rootThread()->frameAtDepth(0)->decodedPage;
			const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
			require(page.nativeBlocks && page.nativeBlocks->entries[word], "the sweep enters compiled native code");
		}
#endif
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		if (!scalarControl) native.cpu.setNativeCompilationProfiling(false);
#endif
		for (auto* machine : {&native, &scalar}) {
			const auto* thread = machine->cpu.activeThread();
			require(thread->frameDepth() == 1u && machine->cpu.readFrameRegister(0, 4) == valueInteger(address)
				&& machine->cpu.readFrameRegister(0, 5) == valueInteger(0x12345678),
				"the warm allocation loop preserves live store operands without faulting");
			auto& frame = *thread->frameAtDepth(0);
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], machine->rom.textAddress);
			for (int reg = 0; reg < 4; ++reg) frame.registers.set(reg, valueNil());
			machine->memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
			machine->memory.writeU32(address, 0);
		}
		const u32 nativeStartCount = test::allocatedObjectRecords(native.cpu);
		const u32 scalarStartCount = test::allocatedObjectRecords(scalar.cpu);
		const auto nativeResult = native.cpu.runUntilDepth(0, grant);
		const auto scalarResult = scalar.cpu.runUntilDepth(0, grant);
		const auto nativePc = native.cpu.readFramePc(0), scalarPc = scalar.cpu.readFramePc(0);
		const u32 nativeAllocations = test::allocatedObjectRecords(native.cpu) - nativeStartCount;
		const u32 scalarAllocations = test::allocatedObjectRecords(scalar.cpu) - scalarStartCount;
		bool registersEqual = native.cpu.getFrameRegisterCount(0) == scalar.cpu.getFrameRegisterCount(0);
		for (const int reg : {0, 1, 2, 4, 5}) {
			registersEqual &= native.cpu.readFrameRegister(0, reg) == scalar.cpu.readFrameRegister(0, reg);
		}
		// Table pointers are host identities, not guest values shared across CPUs.
		const Value nativeTable = native.cpu.readFrameRegister(0, 3), scalarTable = scalar.cpu.readFrameRegister(0, 3);
		registersEqual &= (nativeTable == valueNil() && scalarTable == valueNil())
			|| (valueIsTable(nativeTable) && valueIsTable(scalarTable)
				&& asTable(nativeTable, native.cpu.gcHeap()).storedSlotCount() == asTable(scalarTable, scalar.cpu.gcHeap()).storedSlotCount());
		for (auto* machine : {&native, &scalar}) {
			machine->irq.raise(IRQ_GPU);
			require(machine->cpu.enterPendingInterrupt(), "IRQ is accepted");
		}
		const bool statusEqual = nativeResult == scalarResult;
		const bool cyclesEqual = native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining;
		const bool pcEqual = nativePc == scalarPc;
		const bool epcEqual = native.cpu.readEpcWord() == scalar.cpu.readEpcWord();
		const bool allocationsEqual = nativeAllocations == scalarAllocations;
		const bool ramEqual = native.memory.readU32(address) == scalar.memory.readU32(address);
		const bool equal = statusEqual && cyclesEqual && pcEqual && epcEqual && registersEqual && allocationsEqual && ramEqual;
		if (!equal) {
			++mismatchCount;
			std::printf("grant=%d status=%d cycles=%d/%d pc=%08x/%08x epc=%08x/%08x registers=%d allocations=%u/%u RAM=%08x/%08x\n",
				grant, statusEqual, native.cpu.instructionBudgetRemaining, scalar.cpu.instructionBudgetRemaining,
				nativePc, scalarPc, native.cpu.readEpcWord(), scalar.cpu.readEpcWord(), registersEqual,
				nativeAllocations, scalarAllocations, native.memory.readU32(address), scalar.memory.readU32(address));
		}
	}
	std::printf("exact-grant sweep: %u/64 divergent budgets\n", mismatchCount);
	require(mismatchCount == 0, "native and scalar differ for at least one identical positive grant");
}

void irqAfterNativeMmioBeforeShortSuccessor() {
	test::Blua32TestImage image;
	image.text.resize(5u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::STORE_MEM), 5, 4, static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 0, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 6},
		{.firstWord = 4, .wordCount = 1}};
	image.irqFunctionIndex = 1;
	for (int grant = 3; grant <= 16; ++grant) {
		Machine native(image, false), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			auto* frame = machine->cpu.activeThread()->frameAtDepth(0);
			frame->registers.set(4, valueInteger(IO_IRQ_MASK));
			frame->registers.set(5, valueInteger(0));
			for (int n = 0; n < 30; ++n) machine->cpu.runUntilDepth(0, 128);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				waitForNativeEntries(*machine, machine->rom.textAddress, {0});
				const auto* page = frame->decodedPage;
				require(page && page->nativeBlocks && page->nativeBlocks->entries[(machine->rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2],
					"IRQ boundary starts in a published native entry");
			}
#endif
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], machine->rom.textAddress);
			frame->registers.set(5, valueInteger(IRQ_GPU));
			machine->irq.raise(IRQ_GPU);
		}
		const auto a = native.cpu.runUntilDepth(0, grant);
		const auto b = scalar.cpu.runUntilDepth(0, grant);
		const auto left = native.cpu.captureRuntimeState(), right = scalar.cpu.captureRuntimeState();
		require(a == b && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining,
			"IRQ mask write preserves the same grant outcome");
		require(left.statusWord == right.statusWord && left.causeWord == right.causeWord
			&& left.epcWord == right.epcWord && left.lastPc == right.lastPc
			&& (left == right && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)),
			"IRQ after MMIO is admitted at the same PC with identical live registers and stack");
	}
}

void nmiAfterShortGrant() {
	test::Blua32TestImage image;
	image.text.resize(5u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4},
		{.firstWord = 4, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	for (int grant = 1; grant <= 16; ++grant) {
		Machine native(image, false), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			for (int n = 0; n < 30; ++n) machine->cpu.runUntilDepth(0, 128);
			auto* frame = machine->cpu.activeThread()->frameAtDepth(0);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				waitForNativeEntries(*machine, machine->rom.textAddress, {0});
				const auto* page = frame->decodedPage;
				require(page && page->nativeBlocks && page->nativeBlocks->entries[(machine->rom.textAddress & MAPPED_PAGE_BYTE_MASK) >> 2],
					"NMI test starts in a published native entry");
			}
#endif
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], machine->rom.textAddress);
			machine->cpu.runUntilDepth(0, grant);
			machine->cpu.requestNonMaskableInterrupt();
		}
		const auto a = native.cpu.runUntilDepth(0, grant);
		const auto b = scalar.cpu.runUntilDepth(0, grant);
		const auto left = native.cpu.captureRuntimeState(), right = scalar.cpu.captureRuntimeState();
		require(a == b && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
			&& left.statusWord == right.statusWord && left.causeWord == right.causeWord
			&& left.epcWord == right.epcWord && left.lastPc == right.lastPc
			&& (left == right && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)),
			"NMI and RFE after a short grant preserve the same PC and complete stack");
	}
}

void rewriteAndObserveAfterShortGrant() {
	test::Blua32TestImage image;
	image.text.resize(4u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
	for (const bool restore : {false, true}) {
		Machine native(image, false), scalar(image, true);
		int seenNative = 0, seenScalar = 0;
		for (auto* machine : {&native, &scalar}) {
			machine->memory.writeBytes(DYNAMIC_RAM_BASE, image.text.data(), image.text.size());
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			for (int n = 0; n < 30; ++n) machine->cpu.runUntilDepth(0, 128);
			auto* frame = machine->cpu.activeThread()->frameAtDepth(0);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				waitForNativeEntries(*machine, DYNAMIC_RAM_BASE, {0});
				const auto* page = frame->decodedPage;
				require(page && page->nativeBlocks && page->nativeBlocks->entries[(DYNAMIC_RAM_BASE & MAPPED_PAGE_BYTE_MASK) >> 2],
					"short rewrite test begins in published RAM code");
			}
#endif
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			require(machine->cpu.runUntilDepth(0, 1) == RunResult::Yielded, "first short grant yields");
			require(machine->cpu.readFramePc(0) == DYNAMIC_RAM_BASE + INSTRUCTION_BYTES,
				"only the first instruction precedes the checkpoint");
			if (restore) machine->cpu.restoreRuntimeState(machine->cpu.captureRuntimeState());
			std::array<u8, INSTRUCTION_BYTES> replacement{};
			writeInstruction(replacement, 0, static_cast<u8>(OpCode::K1), 1, 0, 0);
			machine->memory.writeBytes(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES, replacement.data(), replacement.size());
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native && !restore) {
				const auto* page = frame->decodedPage;
				require(!page->nativeBlocks || !page->nativeBlocks->entries[(DYNAMIC_RAM_BASE & MAPPED_PAGE_BYTE_MASK) >> 2],
					"rewriting a dependent word retires the published native predecessor");
			}
#endif
			InstructionObserverBinding observer;
			observer.points[0].insert(DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
			observer.context = machine == &native ? &seenNative : &seenScalar;
			observer.observe = [](void* context, ExecutionDomainId domain, u32 pc, ConstValueSpan registers) {
				++*static_cast<int*>(context);
				require(domain == SYSTEM_EXECUTION_DOMAIN_ID && pc == DYNAMIC_RAM_BASE + INSTRUCTION_BYTES
					&& registers.get(0) == valueInteger(1), "late observer sees the admitted prefix");
			};
			machine->cpu.setInstructionObserver(std::move(observer));
		}
		const auto a = native.cpu.runUntilDepth(0, 2), b = scalar.cpu.runUntilDepth(0, 2);
		const auto left = native.cpu.captureRuntimeState(), right = scalar.cpu.captureRuntimeState();
		require(a == b && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
			&& left.lastPc == right.lastPc && (left == right && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu)),
			"source rewrite and late observation after a short grant preserve the complete guest state");
		require(seenNative == 1 && seenScalar == 1
			&& native.cpu.readFrameRegister(0, 1) == valueInteger(1),
			"both routes observe and execute the replacement exactly once");
	}
}

void exactCallVarargSweep() {
	test::Blua32TestImage image;
	image.text.resize(18u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 10, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 10, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::VARARG), 0, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 16},
		{.firstWord = 16, .wordCount = 2, .maxStack = 4, .isVararg = true}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	unsigned mismatchCount = 0;
	for (int grant = 1; grant <= 64; ++grant) {
		Machine native(image, false), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.runUntilDepth(0, 4000);
			auto* thread = machine->cpu.activeThread();
			if (thread->frameDepth() > 1) machine->cpu.runUntilDepth(1, 100);
			auto* frame = thread->frameAtDepth(0);
			require(valueIsClosure(frame->registers.get(10)), "warm caller retains its closure");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (machine == &native) {
				waitForNativeEntries(*machine, machine->rom.textAddress, {2, 16});
				const auto* page = frame->decodedPage;
				const u32 caller = ((machine->rom.textAddress + 2u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
				const u32 callee = ((machine->rom.textAddress + 16u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
				require(page && page->nativeBlocks && page->nativeBlocks->entries[caller] && page->nativeBlocks->entries[callee],
					"both CALL and VARARG paths are compiled");
			}
#endif
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
				machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
			frame->registers.set(0, valueNil()); frame->registers.set(1, valueNil()); frame->writeControl(bmsx::FrameField::Top, 11);
			machine->memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		}
		const auto nativeResult = native.cpu.runUntilDepth(0, grant);
		const auto scalarResult = scalar.cpu.runUntilDepth(0, grant);
		const auto* nativeThread = native.cpu.activeThread();
		const auto* scalarThread = scalar.cpu.activeThread();
		bool equal = nativeResult == scalarResult && native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
			&& native.cpu.lastPc == scalar.cpu.lastPc && nativeThread->frameDepth() == scalarThread->frameDepth();
		if (nativeThread->frameDepth() == scalarThread->frameDepth()) {
			for (u32 depth = 0; depth < nativeThread->frameDepth(); ++depth) {
				const auto* a = nativeThread->frameAtDepth(depth); const auto* b = scalarThread->frameAtDepth(depth);
				equal &= a->readControl(bmsx::FrameField::Pc) == b->readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(a->readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(b->readControl(bmsx::FrameField::Top)) && static_cast<bmsx::i32>(a->readControl(bmsx::FrameField::VarargCount)) == static_cast<bmsx::i32>(b->readControl(bmsx::FrameField::VarargCount));
				for (int reg = 0; reg < 3; ++reg) {
					const Value av = a->registers.get(reg), bv = b->registers.get(reg);
					equal &= av == bv || (valueIsClosure(av) && valueIsClosure(bv));
				}
			}
		}
		if (!equal) {
			++mismatchCount;
			std::printf("call-vararg grant=%d cycles=%d/%d lastPc=%08x/%08x depth=%zu/%zu\n", grant,
				native.cpu.instructionBudgetRemaining, scalar.cpu.instructionBudgetRemaining,
				native.cpu.lastPc, scalar.cpu.lastPc, nativeThread->frameDepth(), scalarThread->frameDepth());
		}
	}
	std::printf("call-vararg sweep: %u/64 divergent budgets\n", mismatchCount);
	require(mismatchCount == 0, "CALL, RET and open VARARG differ for an identical positive grant");
}
}

int main(int argc, char** argv) {
	try {
		if (argc != 2) throw std::runtime_error("expected allocate or store");
		const std::string_view scenario(argv[1]);
		if (scenario == "allocate") exactGrant(false);
		else if (scenario == "store") exactGrant(true);
		else if (scenario == "division-budget") { divisionBudget(false); divisionBudget(true); }
		else if (scenario == "sweep") exactGrantSweep(false);
		else if (scenario == "sweep-scalar-control") exactGrantSweep(true);
		else if (scenario == "call-vararg-sweep") exactCallVarargSweep();
		else if (scenario == "irq-short") irqAfterNativeMmioBeforeShortSuccessor();
		else if (scenario == "nmi-short") nmiAfterShortGrant();
		else if (scenario == "rewrite-short") rewriteAndObserveAfterShortGrant();
		else if (scenario == "adaptive-arithmetic") adaptiveArithmeticReplay();
		else if (scenario == "copied-arithmetic") copiedArithmeticReplay();
		else if (scenario == "native-arithmetic-profile") {
			generatedArithmeticTrainsTheCompiler(false);
			generatedArithmeticTrainsTheCompiler(true);
		}
		else throw std::runtime_error("unknown scenario");
		return 0;
	} catch (const std::exception& error) {
		std::fprintf(stderr, "FAIL: %s\n", error.what());
		return 1;
	}
}
