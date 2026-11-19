#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/thread_record.h"
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

// Thread224 (64-byte header and the 160-byte class for 40 Value bytes plus two 48-byte frames)
// + Closure16, a 16-byte constant bank (three slots), 14 machine Strings occupying 648 bytes
// and their 16 four-byte intern buckets, two 160-byte global banks and a 16-byte image map. Each live String marks once,
// and every issued object block and intern bucket is visited once.
constexpr int bootBytes = 224 + 16 + 16 + 648 + 64 + 16 + 2 * 160;
constexpr int bootMarkWork = 2 * 56 + 3 + 2 * 12 + 14;
constexpr int bootCollectionWork = 4 * 56 + 3 + 1 + 3 * 12 + 2 * 14 + 16;

void canonicalPoolAndRootRanges() {
	Machine machine(image()); auto& cpu = machine.cpu;
	require(cpu.luaHeap().usedBytes() == bootBytes, "boot pool is the literal canonical allocation sum, not host object sizes");
	cpu.instructionBudgetRemaining = 7;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == 7 - bootCollectionWork, "runtime collection charges object passes, three root passes and String work");
	require(cpu.luaHeap().usedBytes() == bootBytes, "readonly ROM String bytes are not charged as allocated text");
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.createTable(2, 3).address())); //32+S(10+56)=112.
	frame.registers.set(1, valueString(cpu.stringPool().intern("é😀"))); //6 UTF8 bytes.
	frame.writeControl(bmsx::FrameField::Top, 2);
	require(cpu.luaHeap().usedBytes() == bootBytes + 112 + 24, "canonical reserved table capacity and UTF8 text bytes agree");
	cpu.instructionBudgetRemaining = 7;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == 7 - bootCollectionWork - (8 + 2 + 8 + 1) - 2 && cpu.luaHeap().usedBytes() == bootBytes + 112 + 24,
		"table scans reserved slots; the String is marked and visited without reading its bytes");
	const auto threshold = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
	require(threshold.second == 1048576, "the existing minimum collection threshold is unchanged");
	cpu.instructionBudgetRemaining = 123;
	cpu.collectHeap();
	require(cpu.instructionBudgetRemaining == 123, "host/reset raw collection does not bill guest work");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == bootBytes + 112 + 24,
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
		require(test::runCpuParity(generated.cpu, scalar.cpu, 1) == RunResult::Yielded
			&& generated.cpu.instructionBudgetRemaining == 1 - 32 - 4 - bootCollectionWork,
			"explicit primitive retains CALL32+primitive4+collection work after short grant, without receiving slots");
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
			&& generated.cpu.instructionBudgetRemaining == 1 - 24 - 4 - bootMarkWork,
			"automatic GC bills first marking plus NEWT24 and four initialized Values exactly once");
		require(generated.cpu.luaHeap().usedBytes() == bootBytes + 56 && valueIsTable(generated.cpu.readFrameRegister(0, 0))
			&& isNil(generated.cpu.readFrameRegister(0, 7)), "request56 is admitted after collection, not included in its bill");
		test::runCpuParity(generated.cpu, scalar.cpu, 2);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 7) == valueInteger(37),
			"allocation and GC are not replayed on the next grant");
	}
	Machine failure(image()); auto& cpu = failure.cpu;
	cpu.instructionBudgetRemaining = 1;
	bool failed = false;
	try { cpu.luaHeap().admit(4 * 1024 * 1024); }
	catch (const LuaOutOfMemorySignal&) { failed = true; }
	require(failed && cpu.instructionBudgetRemaining == 1 - bootCollectionWork && cpu.luaHeap().usedBytes() == bootBytes,
		"failed oversized admission retains complete collection charge, not pending request bytes");
	cpu.runUntilDepth(0, 1);
	require(cpu.instructionBudgetRemaining == -1, "out-of-run reserve debt is transient and overwritten by the next run grant");
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
			require(page && page->nativeBlocks, "the bank's immediate has been specialized in a native block");
		}
#endif
		// Change both the payload and the kind of the baked operand.
		machine.memory.writeRamRecordWord(base + 4, 0x3fa00000u);
		machine.memory.writeRamRecordByte(tag, static_cast<u8>(ValueTag::Float));
		cpu.runUntilDepth(0, 1000);
		require(cpu.readFrameRegister(0, 1) == valueFloatBits(0x40200000u), "a RAM write makes native code observe the new constant tag and payload");
		const auto ram = machine.memory.captureSaveState();
		const auto state = cpu.captureRuntimeState();
		const auto occupied = cpu.heapAllocator().occupiedBytes();
		machine.memory.writeRamRecordWord(base + 4, 0x40000000u);
		cpu.runUntilDepth(0, 1000);
		require(cpu.readFrameRegister(0, 1) == valueFloatBits(0x40800000u), "a published bank can change twice");
		machine.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(state);
		cpu.runUntilDepth(0, 1000);
		require(cpu.readFrameRegister(0, 1) == valueFloatBits(0x40200000u) && cpu.heapAllocator().occupiedBytes() == occupied,
			"restore attaches the saved bank, without decoding the ROM or charging another allocation");
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
	require(cpu.luaHeap().usedBytes() == bootBytes + (24 + 24) + (8 + 16), "each card allocates one constant bank and one name-slot map");
	cpu.instructionBudgetRemaining = 5;
	cpu.luaHeap().collectRuntime();
	// C=3+4+1, S=1, G=3; all activated images remain roots. The two
	// retired cartridge closure slots still cost one visit each on the system closure's page.
	require(cpu.instructionBudgetRemaining == 5 - bootCollectionWork - 3 * (2 * 5 + 3 * 2) - 2,
		"work includes three root passes over all resident images and two vacant closure slots");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	cpu.instructionBudgetRemaining = 5;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == 5 - bootCollectionWork - 3 * (2 * 5 + 3 * 2) - 2, "restored residency and registered ranges reproduce the same collection bill");
}

void temporaryRootsAndUnreachablePool() {
	Machine machine(image()); auto& cpu = machine.cpu;
	TableRecord table = cpu.createTable(); //32; retained only by the reserve temporary root.
	const auto id = cpu.stringPool().intern("é😀"); //6; another temporary root.
	const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
	require(before.first == bootBytes + 32 + 24, "precollection includes currently unreachable allocations");
	cpu.luaHeap().setCollectionTarget(0);
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().admit(0, valueTable(table.address()), valueString(id));
	// First marking + live Table8 + String1; atomic and reclamation remain.
	require(cpu.instructionBudgetRemaining == 1 - bootMarkWork - 8 - 1 && cpu.luaHeap().usedBytes() == bootBytes + 32 + 24
		&& cpu.stringPool().toString(id) == "é😀", "all reserve temporary roots survive the first incremental pass");
	while (cpu.collecting()) cpu.stepHeap(valueTable(table.address()), valueString(id), valueNil());
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == 1 - bootCollectionWork - 2 && cpu.luaHeap().usedBytes() == bootBytes,
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
	require(cpu.stepHeap(valueNil(), valueNil(), valueNil()) >= GC_STEP_WORDS && machine.memory.readRamRecordByte(target.address() + GC_COLOR_OFFSET) == 3,
		"mutations target a black allocation while marking is incomplete");
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
	require(cpu.gcHeap().phase() == GcPhase::Mark && machine.memory.readRamRecordByte(weak.address() + GC_COLOR_OFFSET) == 3 && machine.memory.readRamRecordByte(child.address() + GC_COLOR_OFFSET) != 3
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
	require(gc.phase() == GcPhase::Atomic && machine.memory.readRamRecordByte(rooted.address() + GC_COLOR_OFFSET) == 3
		&& machine.memory.readRamRecordWord(rooted.address() + GC_RECORD_LINK) == 0,
		"consuming the mark and link terminates a circular physical queue");
	while (gc.active()) gc.step(valueNil(), valueNil(), valueNil());
	require(gc.tableRecordAddress(rooted.address()) == rooted.address(), "the already visited Table remains reachable");
}

void secondMarkPassAndCredit() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.createTable(4096, 0).address())); frame.writeControl(bmsx::FrameField::Top, 1);
	const auto before = cpu.luaHeap().usedBytes();
	cpu.luaHeap().setCollectionTarget(before); cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	const size_t work = static_cast<size_t>(-cpu.instructionBudgetRemaining);
	require(work > GC_STEP_WORDS && cpu.luaHeap().collectionTarget() == before + work / 16,
		"oversized marking earns its actual allocation credit before the pending request");
	u32 phases = 0;
	for (int i = 0; i < 12; ++i) {
		auto target = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
		target.setInteger(1, valueInteger(i));
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

void collectUnattachedThreadRecord() {
	Machine machine(image()); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap(); auto& memory = machine.memory;
	const size_t baselineWork = gc.collect();
	const size_t baselineBytes = cpu.heapAllocator().occupiedBytes();
	const u32 address = cpu.luaHeap().allocateRecord(THREAD_HEAP_BYTES, false, THREAD_INITIAL_BACKING_BYTES,
		static_cast<u32>(ThreadField::StackBlock));
	ThreadRecord::initialize(gc, address, 0u);
	ThreadStackLayout wide{0u, 64u, THREAD_INITIAL_FRAMES, 0u};
	wide.block = cpu.heapAllocator().allocate(wide.byteLength(), true);
	require(wide.block != 0u, "a large unviewed stack fits the test heap");
	ThreadRecord::relocateStack(gc, address, ThreadRecord::stackLayout(memory, address), wide);
	const u32 block = wide.block;
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::Status), static_cast<u32>(ThreadStatus::Suspended));
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameDepth), 1u);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::StackTop), 1u);
	const auto layout = ThreadRecord::stackLayout(memory, address);
	const u32 frame = layout.frameAddress(0);
	memory.writeRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity), THREAD_INITIAL_VALUES);
	memory.writeRamRecordWord(frame + static_cast<u32>(FrameField::Top), 1u);
	const u32 child = cpu.createTable().address();
	memory.writeRamRecordWord(block, child);
	memory.writeRamRecordByte(block + wide.valueCapacity * sizeof(u32), static_cast<u8>(ValueTag::Table));
	const size_t bytes = THREAD_HEAP_BYTES + heapAllocationBytes(layout.byteLength());
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
	const auto reduced = ThreadRecord::stackLayout(memory, address);
	const size_t reducedBytes = THREAD_HEAP_BYTES + heapAllocationBytes(reduced.byteLength());
	require(reduced.valueCapacity == wide.valueCapacity / 2 && reduced.block != block
		&& reduced.slots(memory).get(0) == valueTable(child)
		&& memory.readRamRecordWord(reduced.frameAddress(0) + static_cast<u32>(FrameField::Top)) == 1u,
		"shrinking relocates the frame and its live tagged slot without a host view");
	require(shrinkWork == liveWork + 2 * (reduced.byteLength() / sizeof(u32))
		&& cpu.heapAllocator().occupiedBytes() == baselineBytes + reducedBytes + TableRecord::HEADER_BYTES,
		"relocation charges the new physical copy and releases the old backing");
	size_t deadWork = 0;
	while (gc.phase() != GcPhase::Sweep) deadWork += gc.step(valueNil(), valueNil(), valueNil());
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(gc.threadAt(address) == nullptr && gc.threadRecordAddress(address) == address,
		"restore leaves the sweep victim as an issued RAM record without reattaching it");
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
	auto* thread = gc.threadAt(address);
	require(thread != nullptr, "coroutine builtin published a physical Thread reference");
	const auto bytes = gc.allocationBytes(address);
	frame.registers.set(1, valueClosure(thread->entry()));
	frame.writeControl(FrameField::Top, 2);
	const auto sweep = [&] {
		while (gc.phase() != GcPhase::Sweep) gc.step(valueNil(), valueNil(), valueNil());
		size_t work = 0;
		while (gc.active()) work += gc.step(valueNil(), valueNil(), valueNil());
		return work;
	};
	const auto liveWork = sweep();
	const auto occupied = cpu.heapAllocator().occupiedBytes();
	require(gc.threadAt(address) == thread, "reachable coroutine survives a page sweep");
	frame.registers.set(0, valueNil());
	require(sweep() == liveWork, "an occupied Thread slot has the same visit charge whether retained or released");
	require(gc.threadAt(address) == nullptr && cpu.memory().readRamRecordByte(address) == 0
		&& cpu.heapAllocator().occupiedBytes() == occupied - bytes, "sweep frees both the coroutine slot and its owned stack");
	require(sweep() == liveWork - (bytes / sizeof(u32) - 1), "root Thread keeps the page and a vacant Thread slot still costs one visit");
}

void stackShrinkAndAdmission() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto* thread = cpu.rootThread(); auto& frame = *thread->currentFrame;
	thread->resizeStack(1024);
	frame.registers.set(0, valueInteger(123)); frame.writeControl(bmsx::FrameField::Top, 1);
	const size_t before = cpu.luaHeap().usedBytes();
	cpu.collectHeap();
	require(thread->stackCapacity == 512 && cpu.luaHeap().usedBytes() == before - HEAP_PAGE_SIZE,
		"sweep halves the cold stack and releases exactly one physical page");
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
	for (int i = 0; i < 24000; ++i) cpu.createTable(8, 0);
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
		canonicalPoolAndRootRanges(); explicitCollectionAndNoReplay();
		allocationCollectionAndFailure(); constantBankUsesGuestRam(); allActivatedImagesAndUniqueGlobals(); temporaryRootsAndUnreachablePool();
		incrementalStateAndBarriers(); incrementalSharedWeakMode(); consumesSelfLinkedGrayEdge();
		secondMarkPassAndCredit(); collectUnattachedThreadRecord(); sweepCoroutineRecord(); stackShrinkAndAdmission(); highRetainedPacing();
		std::cout << "guest GC work tests passed\n";
		return 0;
	} catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
