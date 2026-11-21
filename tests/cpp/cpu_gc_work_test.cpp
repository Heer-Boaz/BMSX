#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/thread_record.h"
#include "machine/cpu/upvalue.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

test::Blua32TestImage image(OpCode operation = OpCode::HALT, bool wide = false) {
	test::Blua32TestImage result;
	result.text.resize(MAPPED_PAGE_BYTE_SIZE);
	u32 word = 0;
	if (wide) writeInstruction(result.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(result.text, word++, static_cast<u8>(operation), 0,
		operation == OpCode::NEWT ? 2 : 1, 1);
	writeInstruction(result.text, word++, static_cast<u8>(OpCode::KSMI), 7, 0, 37);
	writeInstruction(result.text, word++, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	result.functions = {{.firstWord=0, .wordCount=word, .maxStack=8}};
	result.constants = {std::monostate{}, 12, std::string("ROM text does not own guest text bytes")};
	result.systemGlobalNames = {"system", "system"};
	result.globalNames = {"global", "global"};
	return result;
}

struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	Machine(const test::Blua32TestImage& source, bool scalar = false)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, source)),
		memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
};

// Thread232 (80-byte header, 40 Value bytes and two 56-byte frame records)
// + Closure12, a 15-byte constant bank (three slots), 17 machine Strings charged 697 bytes
// and their 32 four-byte intern buckets, two 136-byte global banks and a 16-byte image map. Each live String marks once,
// and every issued object block, intern bucket and String chain node is visited once.
constexpr int bootBytes = 232 + 12 + 15 + 697 + 128 + 16 + 2 * 136;
constexpr int bootCollectionWork = 4 * 58 + 3 + 1 + 3 * 12 + 3 * 17 + 32;

void allocationAdmissionUsesLogicalBytes() {
	Machine machine(image()); auto& cpu = machine.cpu;
	const size_t logical = cpu.luaHeap().usedBytes();
	const u32 physical = cpu.heapAllocator().occupiedBytes();
	constexpr u32 logicalCharge = (32 + 2 * 5 + 4 * 14) + (32 + 512 * 5);
	cpu.luaHeap().setCollectionTarget(static_cast<u32>(logical) + logicalCharge);
	cpu.instructionBudgetRemaining = 23;
	cpu.createTable(2, 3);
	cpu.createTable(512, 0);
	require(cpu.instructionBudgetRemaining == 23, "the allocations fit at the exact logical threshold");
	require(cpu.luaHeap().usedBytes() == logical + logicalCharge, "size-class slack is not charged to the language budget");
	require(cpu.heapAllocator().occupiedBytes() == physical + 112 + 32 + HEAP_PAGE_SIZE,
		"physical diagnostics include both size classes and whole pages");
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == logical && cpu.heapAllocator().occupiedBytes() == physical,
		"reclamation returns the corresponding charges to both measurements");
}

void canonicalPoolAndRootRanges() {
	Machine machine(image()); auto& cpu = machine.cpu;
	require(cpu.luaHeap().usedBytes() == bootBytes, "boot pool is the literal canonical allocation sum, not host object sizes");
	cpu.instructionBudgetRemaining = 7;
	require(cpu.collectHeap() == bootCollectionWork && cpu.instructionBudgetRemaining == 7,
		"physical collection counts object passes, three root passes and String work without a cycle debit");
	require(cpu.luaHeap().usedBytes() == bootBytes, "readonly ROM String bytes are not charged as allocated text");
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.createTable(2, 3).address())); //32+10+56=98 logical bytes.
	frame.registers.set(1, valueString(cpu.stringPool().intern("é😀"))); //6 UTF8 bytes.
	frame.writeControl(bmsx::FrameField::Top, 2);
	require(cpu.luaHeap().usedBytes() == bootBytes + 98 + 22, "canonical reserved table capacity and UTF8 text bytes agree");
	require(cpu.collectHeap() == bootCollectionWork + (8 + 2 + 8 + 1) + 3
		&& cpu.instructionBudgetRemaining == 7 && cpu.luaHeap().usedBytes() == bootBytes + 98 + 22,
		"table scans reserved slots; the String is marked and visited without reading its bytes");
	const auto threshold = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
	require(threshold.second == 1048576, "the existing minimum collection threshold is unchanged");
	cpu.instructionBudgetRemaining = 123;
	cpu.collectHeap();
	require(cpu.instructionBudgetRemaining == 123, "host/reset raw collection does not bill guest work");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == bootBytes + 98 + 22,
		"snapshot capture/restore does not collect or bill runtime work and preserves canonical accounting");
	cpu.reset();
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == bootBytes,
		"reset installation and raw maintenance collection do not execute or bill guest work");
}

void explicitCollectionAndNoReplay() {
	for (bool wide : {false, true}) {
		Machine generated(image(OpCode::CALL, wide)), scalar(image(OpCode::CALL, wide), true);
		for (auto* m : {&generated, &scalar}) {
			auto& frame = *m->cpu.rootThread()->currentFrame;
			frame.registers.set(0, m->cpu.createBuiltinFunction(BuiltinFunctionId::CollectGarbage));
			frame.writeControl(bmsx::FrameField::Top, 1);
		}
		const auto doomed = generated.cpu.createTable(16384, 0).address();
		require(scalar.cpu.createTable(16384, 0).address() == doomed, "both backends start with the same garbage");
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
			&& generated.cpu.instructionBudgetRemaining == 1 - 32 - 4,
			"explicit collection pays CALL32 and primitive4, without a collector charge or receiving slots");
		require(generated.cpu.gcHeap().tableRecordAddress(doomed) == 0u,
			"explicit collection completes before the instruction retires");
		require(generated.cpu.readFramePc(0) == generated.rom.textAddress + (wide ? 8 : 4)
			&& isNil(generated.cpu.readFrameRegister(0, 7)), "collection completes but cannot execute its successor");
		test::runCpuParity(generated.cpu, scalar.cpu, 0);
		require(generated.cpu.instructionBudgetRemaining == 0 && isNil(generated.cpu.readFrameRegister(0, 7)),
			"zero grant performs no replay or collection");
		test::runCpuParity(generated.cpu, scalar.cpu, 2);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 7) == valueInteger(37),
			"fresh grant executes only the actual successor, not the completed builtin");
	}
}

void allocationCollectionAndFailure() {
	for (bool wide : {false, true}) {
		Machine generated(image(OpCode::NEWT, wide)), scalar(image(OpCode::NEWT, wide), true);
		for (auto* m : {&generated, &scalar}) {
			m->cpu.luaHeap().setCollectionTarget(0);
		}
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
			&& generated.cpu.instructionBudgetRemaining == 1 - 24 - 4 && generated.cpu.collecting(),
			"automatic GC advances; only NEWT24 and four initialized Values are charged");
		require(generated.cpu.luaHeap().usedBytes() == bootBytes + 56 && valueIsTable(generated.cpu.readFrameRegister(0, 0))
			&& isNil(generated.cpu.readFrameRegister(0, 7)), "request56 is admitted after collection");
		test::runCpuParity(generated.cpu, scalar.cpu, 2);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 7) == valueInteger(37),
			"allocation and GC are not replayed on the next grant");
	}
	Machine failure(image()); auto& cpu = failure.cpu;
	const auto doomed = cpu.createTable(16384, 0).address();
	cpu.instructionBudgetRemaining = 1;
	bool failed = false;
	try { cpu.luaHeap().admit(4 * 1024 * 1024); }
	catch (const LuaOutOfMemorySignal&) { failed = true; }
	require(failed && cpu.instructionBudgetRemaining == 1 && cpu.luaHeap().usedBytes() == bootBytes
		&& cpu.gcHeap().tableRecordAddress(doomed) == 0u,
		"failed admission completes emergency collection, with no cycle debit or pending bytes");
	cpu.runUntilDepth(0, 1);
	require(cpu.instructionBudgetRemaining == -1, "the next grant pays only for HALT");
}

void collectionPrimitiveCyclesIgnoreHeapShape() {
	auto source = image(OpCode::CALL);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	for (auto operation : {GarbageCollectionOperation::Collect, GarbageCollectionOperation::Step}) {
		size_t previousWork = 0;
		for (u32 capacity : {1u, 8192u}) {
			Machine generated(source), scalar(source, true), inspected(source, true);
			for (auto* machine : {&generated, &scalar, &inspected}) {
				auto& cpu = machine->cpu;
				auto& frame = *cpu.rootThread()->currentFrame;
				frame.registers.set(0, cpu.createBuiltinFunction(BuiltinFunctionId::CollectGarbage));
				frame.registers.set(1, valueInteger(static_cast<i32>(operation)));
				frame.registers.set(5, valueTable(cpu.createTable(capacity, 0).address()));
				frame.setTop(6);
			}
			const bool step = operation == GarbageCollectionOperation::Step;
			const size_t work = step ? inspected.cpu.stepHeap(valueNil(), valueNil(), valueNil()) : inspected.cpu.collectHeap();
			require(work > previousWork, "the same guest instruction causes different physical work");
			previousWork = work;
			require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
				&& generated.cpu.instructionBudgetRemaining == 1 - 32 - 4 - 1
				&& generated.cpu.readFrameRegister(0, 0) == (step ? valueBool(false) : valueNil())
				&& generated.cpu.collecting() == step,
				"both execution routes pay only CALL, primitive and placement regardless of heap shape");
		}
	}
}

void constantBankUsesGuestRam() {
	auto source = image();
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::ADD), 1, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	source.functions[0].wordCount = 3;
	for (bool scalar : {false, true}) {
		Machine machine(source, scalar);
		auto& cpu = machine.cpu;
		const u32 base = cpu.captureRuntimeState().constantPoolBases[SYSTEM_EXECUTION_DOMAIN_ID + 1];
		const u32 tag = base + 3 * sizeof(u32) + 1;
		require(base >= RAM_BASE && machine.memory.readRamRecordWord(base + 4) == 12
			&& machine.memory.readRamRecordByte(tag) == static_cast<u8>(ValueTag::Integer), "ROM loader installed the compact RAM bank");
		cpu.runUntilDepth(0, 1000);
		require(cpu.readFrameRegister(0, 1) == valueInteger(24), "LOADK and ADD use the decoded bank");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (!scalar) {
			const auto* page = cpu.rootThread()->currentFrame->decodedPage;
			const u32 entry = (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
			require(page, "execution has bound the bank's decoded page");
			test::waitForNativeEntry(cpu, *page, entry);
		}
#endif
		auto ram = machine.memory.captureSaveState();
		const auto state = cpu.captureRuntimeState();
		const auto occupied = cpu.heapAllocator().occupiedBytes();
		// Restore binds the image to the saved physical bytes. Compiled
		// execution must consume those lanes rather than the old ROM value.
		ram.ram[tag - RAM_BASE] = static_cast<u8>(ValueTag::Float);
		for (const auto [payload, result] : {std::pair{0x3fa00000u, 0x40200000u}, std::pair{0x40000000u, 0x40800000u},
				std::pair{0x3fa00000u, 0x40200000u}}) {
			writeLE32(ram.ram.data() + base - RAM_BASE + 4, payload);
			machine.memory.restoreSaveState(ram);
			cpu.restoreRuntimeState(state);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (!scalar) cpu.prepareSystemNativeCode();
#endif
			cpu.runUntilDepth(0, 1000);
			require(cpu.readFrameRegister(0, 1) == valueFloatBits(result) && cpu.heapAllocator().occupiedBytes() == occupied,
				"each restored bank supplies both constant lanes without charging another allocation");
		}
		const auto startup = cpu.heapAllocator().occupiedBytes();
		cpu.reset(); cpu.reset();
		require(cpu.heapAllocator().occupiedBytes() == startup, "reset replaces rather than leaking the bank");
	}
}

void allActivatedImagesAndUniqueGlobals() {
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image());
	auto cartSource = image();
	cartSource.constants = {std::monostate{}, 1, 2, std::string("card0")};
	cartSource.globalNames = {"global", "card0", "card0"};
	const auto card0 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartSource);
	cartSource.constants = {std::string("card1")};
	cartSource.globalNames = {"global", "card1"};
	const auto card1 = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cartSource);
	Memory memory(MemoryInit{system.bytes, test::cartridgeSlots(card0.bytes, card1.bytes)}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
	cpu.reset();
	cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], card0.textAddress);
	cpu.writeFrameExecution(0, 1, card1.functionAddresses[0], card1.textAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], system.textAddress);
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == bootBytes + (20 + 20) + (5 + 16), "each card allocates one constant bank and one name-slot map");
	cpu.instructionBudgetRemaining = 5;
	// C=3+4+1, S=1, G=3; all activated images remain roots. The two
	// retired cartridge closure slots still cost one visit each on the system closure's page.
	const size_t work = bootCollectionWork + 3 * (2 * 5 + 3 * 2) + 2;
	require(cpu.collectHeap() == work && cpu.instructionBudgetRemaining == 5,
		"work includes three root passes over all resident images and two vacant closure slots");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	require(cpu.collectHeap() == work && cpu.instructionBudgetRemaining == 5,
		"restored residency and registered ranges reproduce the same physical work");
}

void temporaryRootsAndUnreachablePool() {
	Machine machine(image()); auto& cpu = machine.cpu;
	TableRecord table = cpu.createTable(); //32; retained only by the reserve temporary root.
	const auto id = cpu.stringPool().intern("é😀"); //6; another temporary root.
	const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
	require(before.first == bootBytes + 32 + 22, "precollection includes currently unreachable allocations");
	cpu.luaHeap().setCollectionTarget(0);
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().admit(0, valueTable(table.address()), valueString(id));
	require(cpu.instructionBudgetRemaining == 1 && cpu.luaHeap().usedBytes() == bootBytes + 32 + 22
		&& cpu.gcHeap().isAlive(table.address()) && cpu.stringPool().toString(id) == "é😀",
		"all reserve temporary roots survive the first unbilled incremental pass");
	while (cpu.collecting()) cpu.stepHeap(valueTable(table.address()), valueString(id), valueNil());
	require(cpu.collectHeap() == bootCollectionWork + 3 && cpu.instructionBudgetRemaining == 1
		&& cpu.luaHeap().usedBytes() == bootBytes,
		"dead Table incurs one block visit, not another mark pass; its String incurs one visit, not a scan of its bytes");
}

void incrementalStateAndBarriers() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto roots = cpu.createTable(1024, 0);
	cpu.rootThread()->currentFrame->registers.set(0, valueTable(roots.address()));
	cpu.rootThread()->currentFrame->writeControl(bmsx::FrameField::Top, 1);
	const auto field = cpu.stringPool().intern("child");
	for (int i = 1; i <= 1000; ++i) {
		auto item = cpu.createTable(1, 1);
		item.setStringKey(field, valueBool(false)); roots.setInteger(i, valueTable(item.address()));
		auto dead = cpu.createTable(1, 0);
		dead.setInteger(1, valueTable(cpu.createTable().address()));
	}
	for (int i = 0; i < 4200; ++i) cpu.stringPool().intern("dead-" + std::to_string(i) + std::string(16, 'x'));
	auto target = asTable(roots.getInteger(1000), cpu.gcHeap());
	require(cpu.stepHeap(valueNil(), valueNil(), valueNil()) >= GC_STEP_WORDS
		&& cpu.gcHeap().phase() == GcPhase::Mark && (machine.memory.readRamRecordByte(target.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3,
		"mutations target a black allocation while marking is incomplete");
	target.setStringKey(field, valueInteger(1));
	require((machine.memory.readRamRecordByte(target.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3
		&& machine.memory.readRamRecordWord(cpu.gcHeap().changedHeadOffset()) == 0,
		"scalar replacement does not enqueue a black table");
	auto child = cpu.createTable();
	target.setInteger(1, valueTable(child.address()));
	target.setStringKey(field, valueTable(child.address()));
	target.setMetatableAddress(cpu.createTable().address());
	const auto childId = child.address();
	u32 phases = 0, bornId = 0;
	for (int step = 0; step < 1000; ++step) {
		auto state = cpu.captureRuntimeState();
		phases |= 1u << static_cast<u32>(cpu.gcHeap().phase());
		if (cpu.gcHeap().phase() == GcPhase::Sweep && bornId == 0) {
			auto born = cpu.createTable(); bornId = born.address();
			auto* frame = cpu.rootThread()->currentFrame;
			frame->registers.set(1, valueTable(born.address())); frame->writeControl(bmsx::FrameField::Top, 2);
			state = cpu.captureRuntimeState();
		}
		const auto ram = cpu.memory().captureSaveState();
		cpu.memory().restoreSaveState(ram); cpu.restoreRuntimeState(state);
		const auto after = cpu.captureRuntimeState();
		require(state == after,
			"restore preserves collector cursors, queues and dead allocation work, not dead graph pointers");
		require(cpu.memory().captureSaveState().ram == ram.ram, "restoration never rewrites raw mark colors or phase");
		if (!cpu.collecting()) break;
		cpu.stepHeap(valueNil(), valueNil(), valueNil());
	}
	require(phases == 59, "snapshot/restore exercised Mark, Atomic, Sweep, Strings and Pause");
	roots = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
	target = asTable(roots.getInteger(1000), cpu.gcHeap());
	require(asTable(target.getInteger(1), cpu.gcHeap()).address() == childId
		&& asTable(target.getStringKey(field), cpu.gcHeap()).address() == childId && target.metatableAddress() != 0u,
		"barriers preserve changed array, hash and metatable edges");
	require(asTable(cpu.rootThread()->currentFrame->registers.get(1), cpu.gcHeap()).address() == bornId,
		"an allocation born during sweep is retained");
	require(!cpu.stringPool().find("dead-0" + std::string(16, 'x')), "incremental String sweep reclaims dead text");
	cpu.collectHeap();
	require(test::allocatedObjectRecords(cpu) == 1006,
		"full collection retains root Thread, closure, roots Table, 1000 children and three new live Tables");
}

void resumesCompletionRootBank() {
	test::Blua32TestImage source;
	source.text.resize(5 * INSTRUCTION_BYTES);
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(source.text, 3, static_cast<u8>(OpCode::VARARG), 0, 0, 0);
	writeInstruction(source.text, 4, static_cast<u8>(OpCode::RET), 0, 0, 0);
	source.functions = {{.firstWord=0, .wordCount=3}, {.firstWord=3, .wordCount=2, .isVararg=true}};
	source.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	Machine machine(source, true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "bring back an actual guest vararg closure");
	const auto callee = asClosure(cpu.readCompletionValues().get(0), heap);
	const auto target = cpu.createTable().address();
	std::vector<Value> args(GC_STEP_WORDS + 64, valueInteger(7));
	args.back() = valueTable(target);
	cpu.beginCompletionCall(callee, BuiltinArgsView(args.data(), args.size()));
	require(cpu.runUntilDepth(0, static_cast<int>(4 * args.size() + 1000)) == RunResult::Halted
		&& cpu.getFrameDepth() == 0 && cpu.readCompletionValues().size() == args.size()
		&& cpu.readCompletionValues().get(args.size() - 1) == valueTable(target),
		"VARARG and RET leave the real completion latch as the last table's only root");
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	require(advance() < GC_STEP_WORDS && memory.readRamRecordWord(control + GC_ROOT_CURSOR) != 0u
		&& !heap.isAlive(target), "the first quantum stops before the last Value without pricing completion slot reads");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		for (int step = 0; heap.active() && step < 60; ++step) advance();
		require(!heap.active() && heap.tableRecordAddress(target) == target, "the resumed completion root retains the table");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "restoring the completion Values and the raw index replays exactly");
}

void resumesRootBanksBeforeTracing() {
	auto program = image();
	for (int slot = 0; slot < 2200; ++slot) program.globalNames.push_back("root-" + std::to_string(slot));
	for (int slot = 0; slot < 1600; ++slot) program.constants.emplace_back(slot);
	Machine machine(program, true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	const auto first = cpu.stringPool().intern("global");
	const auto weakRoot = cpu.stringPool().intern("root-0");
	const auto finalRoot = cpu.stringPool().intern("root-1");
	const auto last = cpu.stringPool().intern(program.globalNames.back());
	const u32 lastTarget = cpu.createTable().address();
	cpu.setGlobalByKey(last, valueTable(lastTarget));
	auto weak = cpu.createTable(1, 0), mode = cpu.createTable();
	mode.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
	weak.setMetatableAddress(mode.address());
	const u32 weakTarget = cpu.createTable().address();
	weak.setInteger(1, valueTable(weakTarget));
	cpu.setGlobalByKey(weakRoot, valueTable(weak.address()));
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const size_t work = advance();
	require(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 4 && heap.phase() == GcPhase::Mark
		&& memory.readRamRecordWord(control + GC_ROOT_CURSOR) != 0u && !heap.isAlive(lastTarget),
		"initial root admission stops before unvisited entries of a large global bank");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		const u32 late = cpu.createTable().address();
		cpu.setGlobalByKey(first, valueTable(late));
		advance();
		require(heap.isAlive(lastTarget) && !heap.isAlive(late),
			"resuming scans the untouched suffix without repeating the amended prefix");
		for (int step = 0; heap.phase() != GcPhase::Atomic && step < 30; ++step) advance();
		require(heap.phase() == GcPhase::Atomic && !heap.isAlive(weakTarget),
			"the last weak value is still unmarked just before the final root pass");
		cpu.setGlobalByKey(finalRoot, valueTable(weakTarget));
		for (int step = 0; heap.active() && step < 30; ++step) advance();
		require(!heap.active() && memory.readRamRecordWord(control + GC_ROOT_CURSOR) == 0u
			&& heap.tableRecordAddress(late) == late && heap.tableRecordAddress(lastTarget) == lastTarget,
			"remark preserves a global written behind the initial root cursor");
		require(heap.tableRecordAddress(weakTarget) == weakTarget && weak.getInteger(1) == valueTable(weakTarget),
			"the final pass observes a newly rooted existing Table before clearing weak values");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "restore resumes root scanning and replays later roots exactly");
}

void resumesLargeClosureCaptures() {
	constexpr u32 captures = 9000;
	test::Blua32TestImage program;
	program.text.resize(7 * INSTRUCTION_BYTES);
	writeInstruction(program.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(program.text, 1, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
	writeInstruction(program.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(program.text, 3, static_cast<u8>(OpCode::CLOSURE), 3, 0, 0);
	writeInstruction(program.text, 4, static_cast<u8>(OpCode::JMP), 1, 0, 0);
	writeInstruction(program.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(program.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	program.functions = {{.firstWord=0, .wordCount=6, .maxStack=8},
		{.firstWord=6, .wordCount=1, .upvalues={{true, 0}, {true, 1}}},
		{.firstWord=6, .wordCount=1, .upvalues=std::vector<Blua32UpvalueRecord>(captures, {true, 0})}};
	program.functions.back().upvalues.back().index = 1;
	program.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{3, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	Machine machine(program, true);
	auto& cpu = machine.cpu;
	auto& memory = machine.memory;
	auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.createTable().address()));
	const auto lastTarget = cpu.createTable().address();
	frame.registers.set(1, valueTable(lastTarget));
	frame.setTop(2);
	require(cpu.runUntilDepth(0, 20000) == RunResult::Halted, "guest creates and closes both capture cells");
	frame.registers.clear(0, 3);
	const u32 closure = valuePayload(frame.registers.get(3));
	const u32 cell = ClosureRecord::captureAddress(memory, closure, 0);
	require(!Upvalue::isOpen(memory, cell), "the test updates a genuinely closed cell");

	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	require(advance() == GC_STEP_WORDS && heap.phase() == GcPhase::Mark
		&& memory.readRamRecordWord(control + GC_TRACE_RECORD) == closure,
		"the first grant stops within the Closure instead of scanning its complete vector");
	const u32 next = memory.readRamRecordWord(control + GC_TRACE_CURSOR);
	require(next > 0 && next < captures && !heap.isAlive(lastTarget), "the final capture has not been marked");

	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		const auto replacement = cpu.createTable().address();
		Upvalue::store(heap, cell, valueTable(replacement));
		require(advance() == GC_STEP_WORDS
			&& memory.readRamRecordWord(control + GC_TRACE_CURSOR) > next,
			"the next grant resumes from the saved capture word");
		for (int step = 0; heap.active() && step < 20; ++step) advance();
		require(!heap.active() && memory.readRamRecordWord(control + GC_TRACE_RECORD) == 0u,
			"the queue and cursor drain before collection completes");
		require(heap.tableRecordAddress(lastTarget) == lastTarget && heap.tableRecordAddress(replacement) == replacement,
			"both the unscanned suffix and a mutation of a previously scanned cell retain their live targets");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "a RAM save and restore replay the suspended closure exactly");
}

void resumesOpenThreadAfterClosingInstruction() {
	constexpr u32 captures = 3000;
	test::Blua32TestImage program;
	program.text.resize(9 * INSTRUCTION_BYTES);
	writeInstruction(program.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(program.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(program.text, 2, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(program.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(program.text, 4, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(program.text, 5, static_cast<u8>(OpCode::CLOSURE), 3, 0, 0);
	writeInstruction(program.text, 6, static_cast<u8>(OpCode::JMP), 1, 0, 0);
	writeInstruction(program.text, 7, static_cast<u8>(OpCode::RET), 3, 2, 0);
	writeInstruction(program.text, 8, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	program.functions = {{.firstWord=0, .wordCount=4, .maxStack=8},
		{.firstWord=4, .wordCount=4, .numParams=1, .maxStack=8},
		{.firstWord=8, .wordCount=1, .upvalues=std::vector<Blua32UpvalueRecord>(captures, {true, 1})}};
	program.functions.back().upvalues.back().index = 0;
	program.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{5, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	Machine generated(program), scalar(program, true);
	const auto setup = [](Machine& machine) {
		const auto target = machine.cpu.createTable().address();
		auto& frame = *machine.cpu.rootThread()->currentFrame;
		frame.registers.set(1, valueTable(target));
		frame.setTop(2);
		return target;
	};
	const u32 target = setup(generated);
	require(setup(scalar) == target, "the test shares the same physical operands across modes");
	constexpr auto cycles = [](OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; };
	require(test::runCpuParity(generated.cpu, scalar.cpu, 2 * cycles(OpCode::CLOSURE) + cycles(OpCode::CALL) + captures) == RunResult::Yielded,
		"the child remains at its closing JMP after creating a large open chain");
	const u32 control = generated.cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto step = [](Machine& machine) { return machine.cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const auto firstWork = step(generated);
	require(step(scalar) == firstWork && firstWork >= GC_STEP_WORDS && firstWork <= GC_STEP_WORDS + 4
		&& generated.memory.readRamRecordWord(control + GC_TRACE_RECORD) == generated.cpu.rootThread()->address
		&& !generated.cpu.gcHeap().isAlive(target), "marking stops within the open chain ahead of the distinct live tail");
	const u32 open = generated.memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN);
	require(Upvalue::isOpen(generated.memory, open), "the live cursor points to an open capture before guest execution");
	const auto state = generated.cpu.captureRuntimeState();
	const auto ram = generated.memory.captureSaveState();

	require(test::runCpuParity(generated.cpu, scalar.cpu, cycles(OpCode::JMP) + captures) == RunResult::Yielded
		&& !Upvalue::isOpen(generated.memory, open) && generated.cpu.getFrameDepth() == 2,
		"the guest closes the saved cell without replacing the activation");
	require(step(generated) == step(scalar), "resuming a closed cursor is deterministic in both execution modes");
	require(test::runCpuParity(generated.cpu, scalar.cpu, cycles(OpCode::RET) + 1) == RunResult::Yielded
		&& generated.cpu.getFrameDepth() == 1, "RET transfers the real capture owner into the caller's window");
	for (int i = 0; generated.cpu.collecting() && i < 30; ++i)
		require(step(generated) == step(scalar), "mark and cleanup work stay paired");
	const u32 returned = valuePayload(generated.cpu.readFrameRegister(0, 0));
	const auto expected = generated.memory.captureSaveState();
	require(!generated.cpu.collecting() && test::sameLanguageRam(generated.cpu, scalar.cpu)
		&& generated.cpu.gcHeap().tableRecordAddress(target) == target
		&& Upvalue::load(generated.memory, ClosureRecord::captureAddress(generated.memory, returned, captures - 1)) == valueTable(target),
		"the returned closed Closure preserves the only path to the originally unvisited capture");

	generated.memory.restoreSaveState(ram);
	generated.cpu.restoreRuntimeState(state);
	generated.cpu.runUntilDepth(0, cycles(OpCode::JMP) + captures);
	step(generated);
	generated.cpu.runUntilDepth(0, cycles(OpCode::RET) + 1);
	for (int i = 0; generated.cpu.collecting() && i < 30; ++i) step(generated);
	require(generated.memory.captureSaveState().ram == expected.ram, "save/load resumes a real Thread's open capture frontier");
}

void resumesTableAfterPrimitiveDisplacement() {
	constexpr u32 count = 4096, occupiedTail = 1000;
	std::array<i32, count> keys{};
	i32 victimKey = 0;
	for (i32 key = -1, remaining = count; remaining != 0 || victimKey == 0; --key) {
		const u32 home = hashCanonicalTableKey(valueInteger(key)) & (count - 1u);
		if (keys[home] == 0) { keys[home] = key; --remaining; }
		else if (home == 0 && victimKey == 0) victimKey = key;
	}
	Machine machine(image(), true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	auto table = cpu.createTable(0, count);
	const u32 victim = cpu.createTable().address();
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(table.address()));
	frame.setTop(1);
	table.setInteger(keys[0], valueInteger(0));
	table.setInteger(victimKey, valueTable(victim)); // chained at the last node
	for (u32 home = occupiedTail; home < count - 1; ++home) table.setInteger(keys[home], valueInteger(0));
	Value key, value;
	require(table.loadStoredEntry(count - 1, key, value) && key == valueInteger(victimKey),
		"the real hash insertion placed the live edge at its unvisited high node");
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const auto work = advance();
	require(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 1
		&& memory.readRamRecordWord(control + GC_TRACE_RECORD) == table.address()
		&& memory.readRamRecordWord(control + GC_TRACE_CURSOR) > occupiedTail
		&& !heap.isAlive(victim), "the first grant suspends a hash scan ahead of the new spill destination");

	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		table.setInteger(keys.back(), valueInteger(1)); // neither operand is a GC edge
		require(table.loadStoredEntry(occupiedTail - 1, key, value) && key == valueInteger(victimKey)
			&& value == valueTable(victim), "primitive insertion moved the unvisited reference behind the old cursor");
		require(memory.readRamRecordWord(control + GC_TRACE_RECORD) == 0u, "a physical move withdraws the old scan frontier");
		for (int step = 0; heap.active() && step < 20; ++step) advance();
		require(!heap.active() && heap.tableRecordAddress(victim) == victim, "the next pass retains the displaced live reference");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "restore captures the exact hash scan frontier and replays structural invalidation");
}

void weakKeysTraceStrongValues() {
	Machine machine(image(), true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	const auto modeKey = cpu.stringPool().intern("__mode");
	auto entries = cpu.createTable(), both = cpu.createTable();
	auto weakKeys = cpu.createTable(), weakBoth = cpu.createTable();
	weakKeys.setStringKey(modeKey, valueString(cpu.stringPool().intern("k")));
	weakBoth.setStringKey(modeKey, valueString(cpu.stringPool().intern("kv")));
	entries.setMetatableAddress(weakKeys.address());
	both.setMetatableAddress(weakBoth.address());
	frame.registers.set(0, valueTable(entries.address()));
	frame.registers.set(1, valueTable(both.address()));
	frame.setTop(2);

	auto key = cpu.createTable(), value = cpu.createTable();
	value.setInteger(1, valueTable(key.address()));
	entries.set(valueTable(key.address()), valueTable(value.address()));
	auto dropKey = cpu.createTable(), dropValue = cpu.createTable();
	dropValue.setInteger(1, valueTable(dropKey.address()));
	both.set(valueTable(dropKey.address()), valueTable(dropValue.address()));
	cpu.collectHeap();
	require(heap.tableRecordAddress(key.address()) == key.address()
		&& entries.get(valueTable(key.address())) == valueTable(value.address()),
		"the strong value in a weak-key entry keeps its own key alive");
	require(heap.tableRecordAddress(dropKey.address()) == 0u && heap.tableRecordAddress(dropValue.address()) == 0u
		&& isNil(both.get(valueTable(dropKey.address()))), "weak-key-and-value entries do not retain the same cycle");

	value.setInteger(1, valueNil());
	cpu.collectHeap();
	require(heap.tableRecordAddress(key.address()) == 0u && heap.tableRecordAddress(value.address()) == value.address()
		&& isNil(entries.get(valueTable(key.address()))), "the dead key drops its entry after its value was marked");
	cpu.collectHeap();
	require(heap.tableRecordAddress(value.address()) == 0u, "the dropped entry cannot retain its value in the next cycle");
}

void incrementalSharedWeakMode() {
	Machine machine(image());
	auto& cpu = machine.cpu;
	auto roots = cpu.createTable(1024, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(roots.address()));
	frame.writeControl(bmsx::FrameField::Top, 1);
	for (int i = 1; i <= 1000; ++i) roots.setInteger(i, valueTable(cpu.createTable().address()));
	const auto modeKey = cpu.stringPool().intern("__mode");
	auto metatable = cpu.createTable(0, 1);
	metatable.setStringKey(modeKey, valueString(cpu.stringPool().intern("v")));
	auto weak = asTable(roots.getInteger(1000), cpu.gcHeap());
	auto following = asTable(roots.getInteger(999), cpu.gcHeap());
	weak.setMetatableAddress(metatable.address());
	following.setMetatableAddress(metatable.address());
	auto child = cpu.createTable();
	const Value childValue = valueTable(child.address());
	weak.setInteger(1, childValue);
	cpu.stepHeap(valueNil(), valueNil(), valueNil());
	const auto index = [](u32 address) { return (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT; };
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	require(cpu.gcHeap().phase() == GcPhase::Mark && (machine.memory.readRamRecordByte(weak.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3
		&& (machine.memory.readRamRecordByte(child.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == cpu.gcHeap().white()
		&& machine.memory.readRamRecordWord(control + GC_WEAK_VISITS) == index(weak.address())
		&& machine.memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL) == index(following.address())
		&& machine.memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT) == 2,
		"the weak visit list records the two Tables in discovery order without keeping the weak value alive");
	require(machine.memory.readRamRecordWord(control + GC_THREAD_VISITS) == index(cpu.rootThread()->address)
		&& machine.memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT) == 1,
		"the scanned Thread is pending its next remark");
	const u32 weakAddress = weak.address(), metaAddress = metatable.address();
	const auto saved = cpu.captureRuntimeState();
	const auto ram = machine.memory.captureSaveState();
	machine.memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	require(machine.memory.captureSaveState().ram == ram.ram, "RAM restores both pending visit lists without rewriting them");
	require(cpu.gcHeap().tableRecordAddress(metaAddress) == metatable.address()
		&& cpu.gcHeap().tableRecordAddress(weakAddress) == weak.address(), "restore preserves both live physical table records");
	metatable.setStringKey(modeKey, valueNil());
	while (cpu.collecting()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(weak.getInteger(1) == childValue && cpu.gcHeap().tableRecordAddress(valuePayload(childValue)),
		"atomic remark observes the shared metatable change after restore");
	require(machine.memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT) == 0
		&& machine.memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT) == 0,
		"both physical lists are empty after collection");
	cpu.collectHeap();
	require(weak.getInteger(1) == childValue, "the newly strong entry retains its child in the next cycle");
}

void resumesMetatableModeProbe() {
	Machine machine(image(), true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	constexpr u32 capacity = 2 * GC_STEP_WORDS;
	const auto mode = cpu.stringPool().intern("__mode");
	const auto home = hashCanonicalTableKey(valueString(mode)) & (capacity - 1u);
	auto target = cpu.createTable(1, 0), meta = cpu.createTable(0, capacity);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(target.address()));
	frame.setTop(1);
	target.setMetatableAddress(meta.address());
	for (i32 key = -1, count = 0; count < static_cast<i32>(GC_STEP_WORDS + 64); --key) {
		if ((hashCanonicalTableKey(valueInteger(key)) & (capacity - 1u)) != home) continue;
		meta.setInteger(key, valueInteger(1));
		if (count++ == 0) meta.setStringKey(mode, valueString(cpu.stringPool().intern("v")));
	}
	auto watched = cpu.createTable();
	target.setInteger(1, valueTable(watched.address()));
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(control + field); };
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	for (int step = 0; read(GC_MODE_META) == 0u && step < 20; ++step) advance();
	require(read(GC_MODE_META) == meta.address() && read(GC_TRACE_RECORD) == target.address()
		&& read(GC_MODE_NODE) != home && !heap.isAlive(watched.address()), "a real colliding metatable search is suspended");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&](bool move) {
		if (move) {
			meta.clear();
			require(read(GC_MODE_META) == 0u && read(GC_TRACE_RECORD) == 0u, "an owning metatable shape write cancels its probe");
		}
		for (int step = 0; heap.active() && step < 50; ++step) advance();
		require(!heap.active() && heap.tableRecordAddress(watched.address()) == (move ? watched.address() : 0u),
			"both the completed weak lookup and the withdrawn strong lookup produce exact liveness");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish(false);
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish(false) == expected, "rewind resumes the same metatable topology");
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	finish(true);
}

void resumesFinalWeakCleanup() {
	Machine machine(image(), true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	constexpr u32 slots = 3 * GC_STEP_WORDS;
	auto weak = cpu.createTable(slots, 0), strong = cpu.createTable(1, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(weak.address()));
	frame.registers.set(1, valueTable(strong.address()));
	frame.setTop(2);
	const auto mode = cpu.stringPool().intern("__mode");
	auto weakMeta = cpu.createTable(0, 1), strongMeta = cpu.createTable(0, 1);
	weakMeta.setStringKey(mode, valueString(cpu.stringPool().intern("v")));
	strongMeta.setStringKey(mode, valueString(cpu.stringPool().intern("very")));
	weak.setMetatableAddress(weakMeta.address());
	strong.setMetatableAddress(strongMeta.address());
	auto onlyStrong = cpu.createTable(), first = cpu.createTable(), last = cpu.createTable();
	strong.setInteger(1, valueTable(onlyStrong.address()));
	weak.setInteger(1, valueTable(first.address()));
	weak.setInteger(slots, valueTable(last.address()));
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	for (int step = 0; heap.phase() != GcPhase::Atomic && step < 30; ++step) advance();
	require(heap.phase() == GcPhase::Atomic, "the last mark pass is ready");
	for (int step = 0; !isNil(weak.getInteger(1)) && step < 30; ++step) heap.stepFinalMark();
	require(heap.phase() == GcPhase::Atomic && isNil(weak.getInteger(1))
		&& weak.getInteger(slots) == valueTable(last.address())
		&& heap.tableRecordAddress(first.address()) == first.address(),
		"the final pass can suspend after clearing only a prefix and before object reclamation");
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	require(memory.readRamRecordWord(control + GC_TRACE_RECORD) == weak.address(), "a weak slot frontier is present in RAM");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		for (int step = 0; heap.phase() == GcPhase::Atomic && step < 30; ++step) heap.stepFinalMark();
		require(heap.phase() == GcPhase::Sweep && isNil(weak.getInteger(slots)), "all weak entries are resolved before sweep starts");
		for (int step = 0; heap.active() && step < 40; ++step) advance();
		require(!heap.active() && heap.tableRecordAddress(first.address()) == 0u && heap.tableRecordAddress(last.address()) == 0u
			&& heap.tableRecordAddress(onlyStrong.address()) == onlyStrong.address(),
			"the two weak values die; a String merely containing v selects strong entries");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "partly cleared weak entries replay to identical RAM");
}

void resumesWeakTableRemark() {
	Machine machine(image(), true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	constexpr u32 count = GC_STEP_WORDS + 256;
	auto roots = cpu.createTable(count, 0), changed = cpu.createTable();
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(roots.address()));
	frame.registers.set(1, valueTable(changed.address()));
	frame.setTop(2);
	const auto modeKey = cpu.stringPool().intern("__mode");
	auto meta = cpu.createTable(0, 1);
	meta.setStringKey(modeKey, valueString(cpu.stringPool().intern("v")));
	auto watcher = cpu.createTable(1, 0);
	watcher.setMetatableAddress(meta.address());
	roots.setInteger(count, valueTable(watcher.address()));
	for (u32 slot = 1; slot < count; ++slot) {
		auto child = cpu.createTable();
		child.setMetatableAddress(meta.address());
		roots.setInteger(slot, valueTable(child.address()));
	}
	auto watched = cpu.createTable();
	watcher.setInteger(1, valueTable(watched.address()));
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(control + field); };
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const u32 head = (watcher.address() & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	for (int step = 0; read(GC_REMARK_VISIT_INDEX) == 0u && step < 100; ++step) advance();
	const auto cursor = read(GC_REMARK_VISIT_INDEX);
	require(cursor != 0u && cursor != head && read(GC_REMARK_VISIT_STATE) != 0u
		&& read(GC_WEAK_VISITS) == head && read(GC_WEAK_VISITS + GC_VISIT_COUNT) == count
		&& heap.phase() == GcPhase::Mark && !heap.isAlive(watched.address()),
		"a partially clocked weak-table remark retains the original list");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		require(read(GC_REMARK_VISIT_INDEX) == cursor, "remark resumes from the saved visit");
		auto late = cpu.createTable();
		changed.setInteger(1, valueTable(late.address()));
		meta.setStringKey(modeKey, valueNil());
		require(!heap.isAlive(late.address()), "the intervening write is not marked eagerly");
		for (int step = 0; heap.active() && step < 100; ++step) advance();
		require(!heap.active() && read(GC_REMARK_VISIT_STATE) == 0u
			&& heap.tableRecordAddress(watched.address()) == watched.address()
			&& heap.tableRecordAddress(late.address()) == late.address(),
			"remark uses the current weak mode and retains intervening writes");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "partially visited weak list replays to identical RAM");
}

void consumesSelfLinkedGrayEdge() {
	Machine machine(image()); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap();
	auto rooted = cpu.createTable();
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(rooted.address()));
	frame.writeControl(FrameField::Top, 1);
	const u32 index = (rooted.address() & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	machine.memory.writeRamRecordByte(rooted.address() + GC_COLOR_OFFSET, 2);
	machine.memory.writeRamRecordWord(rooted.address() + GC_RECORD_LINK, index);
	machine.memory.writeRamRecordWord(gc.changedHeadOffset(), index);
	gc.step(valueNil(), valueNil(), valueNil());
	require(gc.phase() == GcPhase::Atomic && (machine.memory.readRamRecordByte(rooted.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3
		&& machine.memory.readRamRecordWord(rooted.address() + GC_RECORD_LINK) == 0,
		"consuming the mark and link terminates a circular physical queue");
	while (gc.active()) gc.step(valueNil(), valueNil(), valueNil());
	require(gc.tableRecordAddress(rooted.address()) == rooted.address(), "the already visited Table remains reachable");
}

void secondMarkPassAndCredit() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.createTable(4096, 0).address()));
	frame.registers.set(1, valueTable(cpu.createTable().address()));
	frame.registers.set(2, valueTable(cpu.createTable().address()));
	frame.writeControl(bmsx::FrameField::Top, 3);
	const auto before = cpu.luaHeap().usedBytes();
	cpu.luaHeap().setCollectionTarget(before); cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	require(cpu.instructionBudgetRemaining == 0 && cpu.luaHeap().collectionTarget() == before + GC_ASSIST_BYTES
		&& cpu.memory().readRamRecordWord(control + GC_TRACE_RECORD) == valuePayload(frame.registers.get(0)),
		"a partial Table scan keeps the grant intact and earns the fixed logical credit before admission");
	u32 phases = 0;
	for (int i = 0; i < 12; ++i) {
		auto target = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
		target.setInteger(1, cpu.rootThread()->currentFrame->registers.get(1 + (i & 1)));
		cpu.stepHeap(valueNil(), valueNil(), valueNil());
		const auto state = cpu.captureRuntimeState(); phases |= 1u << static_cast<u32>(cpu.gcHeap().phase());
		const auto ram = cpu.memory().captureSaveState();
		cpu.memory().restoreSaveState(ram); cpu.restoreRuntimeState(state);
		require(cpu.memory().captureSaveState().ram == ram.ram,
			"restore leaves both physical gray queues in RAM unchanged");
		if (cpu.gcHeap().phase() == GcPhase::Atomic) break;
	}
	require((phases & 12u) == 12u, "continuous stores do not restart either incremental mark pass indefinitely");
	auto target = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
	auto late = cpu.createTable(); target.setInteger(2, valueTable(late.address()));
	while (cpu.collecting()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(target.getInteger(2) == valueTable(late.address()), "final remark retains writes after the second pass");
}

void automaticAssistDefersScopedRoots() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	auto& strings = cpu.stringPool();
	auto& frame = *cpu.rootThread()->currentFrame;
	u32 published = 0u, temporary = 0u;
	StringId publishedText = 0u, temporaryText = 0u;
	std::string deadName;
	{
		auto scope = cpu.acquireLocalRoots();
		for (u32 index = 0; index < GC_STEP_WORDS + 64u; ++index) {
			temporary = published;
			temporaryText = publishedText;
			published = cpu.createTable().address();
			publishedText = strings.intern("scoped-root-" + std::to_string(index));
		}
		const u8 oldEpoch = memory.readRamRecordByte(publishedText + 1u);
		const auto assist = [&] {
			cpu.luaHeap().setCollectionTarget(0);
			cpu.luaHeap().admit(0);
			require(heap.finalMarkPending() && !heap.isAlive(published),
				"one assist reaches the safepoint without traversing the host Value scope");
		};
		assist();
		require(memory.readRamRecordByte(publishedText + 1u) == oldEpoch, "the assist did not traverse the String scope");
		cpu.luaHeap().collectRuntime();
		deadName = strings.toString(temporaryText);
		require(heap.tableRecordAddress(temporary) == temporary && strings.find(deadName) == temporaryText,
			"a synchronous collection visits the active host scope");

		assist();
		frame.registers.set(0, valueTable(published));
		frame.registers.set(1, valueString(publishedText));
		frame.setTop(2);
	}
	for (int step = 0; heap.finalMarkPending() && step < 20; ++step) heap.stepFinalMark();
	for (int step = 0; heap.active() && step < 20; ++step) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(!heap.active() && heap.tableRecordAddress(published) == published
		&& strings.find(strings.toString(publishedText)) == publishedText,
		"final guest roots include the late publication");
	require(heap.tableRecordAddress(temporary) == 0u && !strings.find(deadName),
		"a preliminary assist does not keep released host roots alive");
}

void explicitAtomicCreditIgnoresPhysicalWork() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto weak = cpu.createTable(2 * GC_STEP_WORDS, 0), meta = cpu.createTable(0, 1);
	meta.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
	weak.setMetatableAddress(meta.address());
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(weak.address())); frame.setTop(1);
	for (int i = 0; !heap.finalMarkPending() && i < 20; ++i) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(heap.finalMarkPending(), "the final pass is ready");
	const auto state = cpu.captureRuntimeState();
	const auto ram = machine.memory.captureSaveState();
	require(heap.finishFinalMark() > GC_STEP_WORDS, "the synchronous final step spans several physical quanta");
	machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	const auto occupied = cpu.luaHeap().usedBytes();
	cpu.instructionBudgetRemaining = 7;
	require(!cpu.luaHeap().stepRuntime() && heap.phase() == GcPhase::Sweep
		&& cpu.luaHeap().collectionTarget() == occupied + GC_ASSIST_BYTES && cpu.instructionBudgetRemaining == 7,
		"explicit final work earns only fixed logical credit and does not debit the guest");
}

void collectUnattachedThreadRecord() {
	Machine machine(image()); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap(); auto& memory = machine.memory;
	const size_t baselineWork = gc.collect();
	const size_t baselineBytes = cpu.heapAllocator().occupiedBytes();
	const u32 address = cpu.luaHeap().allocateThreadRecord(0u);
	constexpr u32 capacity = 64u;
	const u32 block = cpu.heapAllocator().allocate(capacity * THREAD_STACK_SLOT_BYTES, true);
	require(block != 0u, "a large unviewed stack fits the test heap");
	ThreadRecord::replaceStack(gc, address, block, capacity);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::Status), static_cast<u32>(ThreadStatus::Suspended));
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameDepth), 1u);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::StackTop), 1u);
	const auto layout = ThreadRecord::storageLayout(memory, address);
	const u32 frame = layout.frameAddress(0);
	memory.writeRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity), THREAD_INITIAL_VALUES);
	memory.writeRamRecordWord(frame + static_cast<u32>(FrameField::Top), 1u);
	const u32 child = cpu.createTable().address();
	memory.writeRamRecordWord(block, child);
	memory.writeRamRecordByte(block + capacity * sizeof(u32), static_cast<u8>(ValueTag::Table));
	const size_t bytes = layout.allocationBytes();
	require(layout.block == block && gc.threadRecordAddress(address) == address && gc.allocationBytes(address) == bytes,
		"an issued raw Thread has its physical header and backing without an execution view");
	require(cpu.heapAllocator().occupiedBytes() == baselineBytes + bytes + TableRecord::HEADER_BYTES,
		"the raw Thread and its sole table edge own only their guest allocations");
	const size_t liveWork = gc.collect(valueThread(address), valueNil(), valueNil(), address);
	require(liveWork == baselineWork + 4 * (bytes / sizeof(u32)) + TableRecord::HEADER_BYTES / sizeof(u32) + 1,
		"three raw Thread traces and its sweep charge the physical allocation, plus one table trace and visit");
	require(gc.threadRecordAddress(address) == address && gc.tableRecordAddress(child) == child
		&& memory.readRamRecordWord(block) == child,
		"a raw Thread root retains its unviewed frame's table slot");
	require(gc.collect(valueThread(address), valueNil(), valueNil(), address) == liveWork,
		"repeated collection follows the same RAM frame and charges no host attachment work");
	const size_t shrinkWork = gc.collect(valueThread(address));
	const auto reduced = ThreadRecord::storageLayout(memory, address);
	const size_t reducedBytes = reduced.allocationBytes();
	require(reduced.valueCapacity == capacity / 2 && reduced.block != block && reduced.frameBlock == layout.frameBlock
		&& reduced.slots(memory).get(0) == valueTable(child)
		&& memory.readRamRecordWord(reduced.frameAddress(0) + static_cast<u32>(FrameField::Top)) == 1u,
		"shrinking relocates the live tagged slot, not its frame control");
	require(shrinkWork == liveWork + 2 * (reduced.valueBytes() / sizeof(u32))
		&& cpu.heapAllocator().occupiedBytes() == baselineBytes + reducedBytes + TableRecord::HEADER_BYTES,
		"relocation charges the new physical copy and releases the old backing");
	size_t deadWork = 0;
	while (gc.phase() != GcPhase::Sweep) deadWork += gc.step(valueNil(), valueNil(), valueNil());
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(gc.threadRecordAddress(address) == address
		&& ThreadRecord::storageLayout(memory, address).block == reduced.block,
		"restore preserves the sweep victim's issued RAM record and owned backing");
	while (gc.active()) deadWork += gc.step(valueNil(), valueNil(), valueNil());
	require(deadWork == baselineWork + reducedBytes / sizeof(u32) + 1,
		"removing the raw Thread root leaves only its physical sweep and the table visit");
	require(gc.threadRecordAddress(address) == 0u && gc.tableRecordAddress(child) == 0u
		&& memory.readRamRecordByte(address) == 0u && cpu.heapAllocator().occupiedBytes() == baselineBytes,
		"reclamation releases the unviewed Thread header, its owned backing and its sole child");
}

void sweepCoroutineRecord() {
	test::Blua32TestImage program;
	program.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(program.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
	writeInstruction(program.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(program.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(program.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(program.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(program.text, 5, static_cast<u8>(OpCode::RET), 0, 1, 0);
	program.functions = {{.firstWord=0, .wordCount=5, .maxStack=8}, {.firstWord=5, .wordCount=1, .maxStack=2}};
	program.systemGlobalNames = {"create"};
	program.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	Machine machine(program); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap();
	cpu.setSystemGlobalByKey(cpu.stringPool().intern("create"), cpu.createBuiltinFunction(BuiltinFunctionId::CoroutineCreate));
	require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "coroutine fixture reaches HALT");
	auto& frame = *cpu.rootThread()->currentFrame;
	const u32 address = valuePayload(frame.registers.get(0));
	require(gc.threadRecordAddress(address) == address, "coroutine builtin published a physical Thread reference");
	const auto bytes = gc.allocationBytes(address);
	frame.registers.set(1, valueClosure(ThreadRecord::read(cpu.memory(), address, ThreadField::Entry)));
	frame.writeControl(FrameField::Top, 2);
	const auto sweep = [&] {
		while (gc.phase() != GcPhase::Sweep) gc.step(valueNil(), valueNil(), valueNil());
		size_t work = 0;
		while (gc.active()) work += gc.step(valueNil(), valueNil(), valueNil());
		return work;
	};
	const auto liveWork = sweep();
	const auto occupied = cpu.heapAllocator().occupiedBytes();
	require(gc.threadRecordAddress(address) == address, "reachable coroutine survives a page sweep");
	frame.registers.set(0, valueNil());
	require(sweep() == liveWork, "an occupied Thread slot has the same visit charge whether retained or released");
	require(gc.threadRecordAddress(address) == 0u && cpu.memory().readRamRecordByte(address) == 0
		&& cpu.heapAllocator().occupiedBytes() == occupied - bytes, "sweep frees both the coroutine slot and its owned stack");
	require(sweep() == liveWork - (bytes / sizeof(u32) - 1), "root Thread keeps the page and a vacant Thread slot still costs one visit");
}

void stackShrinkAndAdmission() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto* thread = cpu.rootThread(); auto& frame = *thread->currentFrame;
	thread->resizeStack(1024);
	frame.registers.set(0, valueInteger(123)); frame.writeControl(bmsx::FrameField::Top, 1);
	const u32 values = thread->stackOffset();
	do { cpu.stepHeap(valueNil(), valueNil(), valueNil()); } while (cpu.collecting());
	require(thread->stackCapacity == 1024 && thread->stackOffset() == values,
		"incremental collection reclaims objects without relocating a surviving stack");
	const size_t before = cpu.luaHeap().usedBytes();
	cpu.collectHeap();
	require(thread->stackCapacity == 512 && cpu.luaHeap().usedBytes() == before - 512 * THREAD_STACK_SLOT_BYTES,
		"sweep halves the cold stack and releases 512 logical Value slots");
	frame.registers.set(0, valueInteger(456));
	require(thread->stack.get(frame.stackBase()) == valueInteger(456), "frame register view is rebound by the Thread owner");
	frame.writeControl(bmsx::FrameField::StackCapacity, 200);
	thread->reserveFrame(thread->stackCapacity);
	auto* child = thread->acquireFrame();
	child->writeControl(bmsx::FrameField::StackBase, 2); child->writeControl(bmsx::FrameField::StackCapacity, 8); child->writeControl(bmsx::FrameField::Top, 0);
	child->writeControl(bmsx::FrameField::Closure, frame.readControl(bmsx::FrameField::Closure)); child->executionImage = frame.executionImage;
	child->registers = thread->stack.subspan(2, 8);
	thread->enterFrame(child); thread->setStackTop(10);
	cpu.collectHeap();
	require(thread->stackCapacity == 512, "all caller windows participate in the shrink hysteresis");
	thread->leaveFrame(); frame.writeControl(bmsx::FrameField::StackCapacity, 8); thread->setStackTop(8);
	cpu.luaHeap().collectRuntime(valueNil(), valueNil(), valueNil(), thread->address);
	require(thread->stackCapacity == 512, "growth admission keeps the allocation being grown stable");
	cpu.luaHeap().setCollectionTarget(0);
	thread->resizeStack(2048);
	require(frame.registers.get(0) == valueInteger(456), "growth preserves values after prior shrink");
	const auto state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	require(state == cpu.captureRuntimeState(),
		"shrunken and regrown stack storage survives snapshot replay");
}

void highRetainedPacing() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto retained = cpu.createTable(419430, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(retained.address())); frame.writeControl(bmsx::FrameField::Top, 1);
	cpu.collectHeap();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto before = cpu.diagnosticGcProfile();
#endif
		int pauses = 0;
	for (int i = 0; i < 2400; ++i) {
		const auto before = cpu.instructionBudgetRemaining;
		cpu.createTable(384, 0);
		require(before == cpu.instructionBudgetRemaining, "ordinary allocation advances collection without debiting the guest grant");
		if (!cpu.gcHeap().finalMarkPending()) continue;
		++pauses;
		for (int step = 0; cpu.gcHeap().finalMarkPending() && step < 256; ++step) cpu.gcHeap().stepFinalMark();
		require(!cpu.gcHeap().finalMarkPending(), "the stopped final pass drains in bounded quanta");
	}
	require(pauses >= 2, "retained data survives repeated automatically paced cycles");
	require(cpu.luaHeap().usedBytes() <= cpu.luaHeap().capacity() && frame.registers.get(0) == valueTable(retained.address()),
		"retained pool and transient allocation coexist inside the physical capacity");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto after = cpu.diagnosticGcProfile();
	require(after.fullCollections == before.fullCollections && after.collections > before.collections,
		"headroom and allocation assists complete cycles without emergency full collection");
#endif
}

}

int main(int argc, char** argv) {
	try {
		if (argc > 1 && std::string_view(argv[1]) == "--raw-thread-only") {
			collectUnattachedThreadRecord();
			std::cout << "raw Thread GC work test passed\n";
			return 0;
		}
		canonicalPoolAndRootRanges();
		allocationAdmissionUsesLogicalBytes(); explicitCollectionAndNoReplay();
		allocationCollectionAndFailure(); collectionPrimitiveCyclesIgnoreHeapShape();
		constantBankUsesGuestRam(); allActivatedImagesAndUniqueGlobals(); temporaryRootsAndUnreachablePool();
		incrementalStateAndBarriers();
		resumesRootBanksBeforeTracing(); resumesCompletionRootBank(); resumesLargeClosureCaptures(); resumesOpenThreadAfterClosingInstruction();
		resumesTableAfterPrimitiveDisplacement(); weakKeysTraceStrongValues(); incrementalSharedWeakMode();
		resumesFinalWeakCleanup(); resumesMetatableModeProbe(); resumesWeakTableRemark(); consumesSelfLinkedGrayEdge();
		secondMarkPassAndCredit(); automaticAssistDefersScopedRoots(); explicitAtomicCreditIgnoresPhysicalWork();
		collectUnattachedThreadRecord(); sweepCoroutineRecord(); stackShrinkAndAdmission(); highRetainedPacing();
		std::cout << "guest GC work tests passed\n";
		return 0;
	} catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
