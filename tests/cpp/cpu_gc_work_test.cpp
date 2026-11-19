#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
#include <iostream>
#include <stdexcept>

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
// + Closure16 + 14 machine Strings occupying 648 bytes
// and their 16 four-byte intern buckets. Each live String marks once,
// and every issued object block and intern bucket is visited once.
constexpr int bootBytes = 224 + 16 + 648 + 64;
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
	frame.registers.set(0, valueTable(cpu.gcHeap().reference(cpu.createTable(2, 3)))); //32+S(10+56)=112.
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
	require(cpu.luaHeap().usedBytes() == bootBytes, "retired closures and readonly image payloads do not inflate the live pool");
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
	Table* table = cpu.createTable(); //32; retained only by the reserve temporary root.
	const auto id = cpu.stringPool().intern("é😀"); //6; another temporary root.
	const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
	require(before.first == bootBytes + 32 + 24, "precollection includes currently unreachable allocations");
	cpu.luaHeap().setCollectionTarget(0);
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().admit(0, valueTable(cpu.gcHeap().reference(table)), valueString(id));
	// First marking + live Table8 + String1; atomic and reclamation remain.
	require(cpu.instructionBudgetRemaining == 1 - bootMarkWork - 8 - 1 && cpu.luaHeap().usedBytes() == bootBytes + 32 + 24
		&& cpu.stringPool().toString(id) == "é😀", "all reserve temporary roots survive the first incremental pass");
	while (cpu.collecting()) cpu.stepHeap(valueTable(cpu.gcHeap().reference(table)), valueString(id), valueNil());
	cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap().collectRuntime();
	require(cpu.instructionBudgetRemaining == 1 - bootCollectionWork - 2 && cpu.luaHeap().usedBytes() == bootBytes,
		"dead Table incurs one block visit, not another mark pass; its String incurs one visit, not a scan of its bytes");
}

void incrementalStateAndBarriers() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto* roots = cpu.createTable(1024, 0);
	cpu.rootThread()->currentFrame->registers.set(0, valueTable(cpu.gcHeap().reference(roots)));
	cpu.rootThread()->currentFrame->writeControl(bmsx::FrameField::Top, 1);
	const auto field = cpu.stringPool().intern("child");
	for (int i = 1; i <= 1000; ++i) {
		auto* item = cpu.createTable(1, 1);
		item->setStringKey(field, valueBool(false)); roots->setInteger(i, valueTable(cpu.gcHeap().reference(item)));
		auto* dead = cpu.createTable(1, 0);
		dead->setInteger(1, valueTable(cpu.gcHeap().reference(cpu.createTable())));
	}
	for (int i = 0; i < 4200; ++i) cpu.stringPool().intern("dead-" + std::to_string(i) + std::string(16, 'x'));
	auto* target = asTable(roots->getInteger(1000), cpu.gcHeap());
	require(cpu.stepHeap(valueNil(), valueNil(), valueNil()) >= GC_STEP_WORDS && target->gcColor() == 3,
		"mutations target a black allocation while marking is incomplete");
	auto* child = cpu.createTable();
	target->setInteger(1, valueTable(cpu.gcHeap().reference(child)));
	target->setStringKey(field, valueTable(cpu.gcHeap().reference(child)));
	target->setMetatable(cpu.createTable());
	const auto childId = child->hashId;
	u32 phases = 0, bornId = 0;
	for (int step = 0; step < 1000; ++step) {
		auto state = cpu.captureRuntimeState();
		phases |= 1u << static_cast<u32>(cpu.gcHeap().phase());
		if (cpu.gcHeap().phase() == GcPhase::Sweep && bornId == 0) {
			auto* born = cpu.createTable(); bornId = born->hashId;
			auto* frame = cpu.rootThread()->currentFrame;
			frame->registers.set(1, valueTable(cpu.gcHeap().reference(born))); frame->writeControl(bmsx::FrameField::Top, 2);
			state = cpu.captureRuntimeState();
		}
		const auto ram = cpu.memory().captureSaveState();
		cpu.memory().restoreSaveState(ram); cpu.restoreRuntimeState(state);
		const auto after = cpu.captureRuntimeState();
		require(std::ranges::equal(state.snapshot.words(), after.snapshot.words())
			&& state.gc.allocations == after.gc.allocations,
			"restore preserves collector cursors, queues and dead allocation work, not dead graph pointers");
		require(cpu.memory().captureSaveState().ram == ram.ram, "restoration never rewrites raw mark colors or phase");
		if (!cpu.collecting()) break;
		cpu.stepHeap(valueNil(), valueNil(), valueNil());
	}
	require(phases == 59, "snapshot/restore exercised Mark, Atomic, Sweep, Strings and Pause");
	roots = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
	target = asTable(roots->getInteger(1000), cpu.gcHeap());
	require(asTable(target->getInteger(1), cpu.gcHeap())->hashId == childId
		&& asTable(target->getStringKey(field), cpu.gcHeap())->hashId == childId && target->metatable(),
		"barriers preserve changed array, hash and metatable edges");
	require(asTable(cpu.rootThread()->currentFrame->registers.get(1), cpu.gcHeap())->hashId == bornId,
		"an allocation born during sweep is retained");
	require(!cpu.stringPool().find("dead-0" + std::string(16, 'x')), "incremental String sweep reclaims dead text");
	cpu.collectHeap();
	require(cpu.captureRuntimeState().gc.allocations.size() == 1006,
		"full collection retains root Thread, closure, roots Table, 1000 children and three new live Tables");
}

void incrementalSharedWeakMode() {
	Machine machine(image());
	auto& cpu = machine.cpu;
	auto* roots = cpu.createTable(1024, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.gcHeap().reference(roots)));
	frame.writeControl(bmsx::FrameField::Top, 1);
	for (int i = 1; i <= 1000; ++i) roots->setInteger(i, valueTable(cpu.gcHeap().reference(cpu.createTable())));
	const auto modeKey = cpu.stringPool().intern("__mode");
	auto* metatable = cpu.createTable(0, 1);
	metatable->setStringKey(modeKey, valueString(cpu.stringPool().intern("v")));
	auto* weak = asTable(roots->getInteger(1000), cpu.gcHeap());
	auto* following = asTable(roots->getInteger(999), cpu.gcHeap());
	weak->setMetatable(metatable);
	following->setMetatable(metatable);
	auto* child = cpu.createTable();
	const Value childValue = valueTable(child->address());
	weak->setInteger(1, childValue);
	cpu.stepHeap(valueNil(), valueNil(), valueNil());
	const auto index = [](u32 address) { return (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT; };
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	require(cpu.gcHeap().phase() == GcPhase::Mark && weak->gcColor() == 3 && child->gcColor() != 3
		&& machine.memory.readRamRecordWord(control + GC_WEAK_VISITS) == index(weak->address())
		&& machine.memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL) == index(following->address())
		&& machine.memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT) == 2,
		"the weak visit list records the two Tables in discovery order without keeping the weak value alive");
	require(machine.memory.readRamRecordWord(control + GC_THREAD_VISITS) == index(cpu.rootThread()->address)
		&& machine.memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT) == 1,
		"the scanned Thread is pending its next remark");
	const u32 weakAddress = weak->address(), metaAddress = metatable->address();
	const auto saved = cpu.captureRuntimeState();
	const auto ram = machine.memory.captureSaveState();
	machine.memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(saved);
	require(machine.memory.captureSaveState().ram == ram.ram, "RAM restores both pending visit lists without rewriting them");
	metatable = cpu.gcHeap().tableAt(metaAddress);
	weak = cpu.gcHeap().tableAt(weakAddress);
	metatable->setStringKey(modeKey, valueNil());
	while (cpu.collecting()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(weak->getInteger(1) == childValue && cpu.gcHeap().tableAt(valuePayload(childValue)),
		"atomic remark observes the shared metatable change after restore");
	require(machine.memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT) == 0
		&& machine.memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT) == 0,
		"both physical lists are empty after collection");
	cpu.collectHeap();
	require(weak->getInteger(1) == childValue, "the newly strong entry retains its child in the next cycle");
}

void consumesSelfLinkedGrayEdge() {
	Machine machine(image()); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap();
	auto* rooted = cpu.createTable();
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(rooted->address()));
	frame.writeControl(FrameField::Top, 1);
	const u32 index = (rooted->address() & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	rooted->setGcColor(2);
	machine.memory.writeRamRecordWord(rooted->address() + GC_RECORD_LINK, index);
	machine.memory.writeRamRecordWord(gc.changedHeadOffset(), index);
	gc.step(valueNil(), valueNil(), valueNil());
	require(gc.phase() == GcPhase::Atomic && rooted->gcColor() == 3
		&& machine.memory.readRamRecordWord(rooted->address() + GC_RECORD_LINK) == 0,
		"consuming the mark and link terminates a circular physical queue");
	while (gc.active()) gc.step(valueNil(), valueNil(), valueNil());
	require(gc.tableAt(rooted->address()) == rooted, "the already visited Table remains reachable");
}

void secondMarkPassAndCredit() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.gcHeap().reference(cpu.createTable(4096, 0)))); frame.writeControl(bmsx::FrameField::Top, 1);
	const auto before = cpu.luaHeap().usedBytes();
	cpu.luaHeap().setCollectionTarget(before); cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	const size_t work = static_cast<size_t>(-cpu.instructionBudgetRemaining);
	require(work > GC_STEP_WORDS && cpu.luaHeap().collectionTarget() == before + work / 16,
		"oversized marking earns its actual allocation credit before the pending request");
	u32 phases = 0;
	for (int i = 0; i < 12; ++i) {
		auto* target = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
		target->setInteger(1, valueInteger(i));
		cpu.stepHeap(valueNil(), valueNil(), valueNil());
		const auto state = cpu.captureRuntimeState(); phases |= 1u << static_cast<u32>(cpu.gcHeap().phase());
		const auto ram = cpu.memory().captureSaveState();
		cpu.memory().restoreSaveState(ram); cpu.restoreRuntimeState(state);
		require(cpu.memory().captureSaveState().ram == ram.ram,
			"restore leaves both physical gray queues in RAM unchanged");
		if (cpu.gcHeap().phase() == GcPhase::Atomic) break;
	}
	require((phases & 12u) == 12u, "continuous stores do not restart either incremental mark pass indefinitely");
	auto* target = asTable(cpu.rootThread()->currentFrame->registers.get(0), cpu.gcHeap());
	auto* late = cpu.createTable(); target->setInteger(2, valueTable(cpu.gcHeap().reference(late)));
	while (cpu.collecting()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(target->getInteger(2) == valueTable(cpu.gcHeap().reference(late)), "final remark retains writes after the second pass");
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
	const auto bytes = gc.allocationBytes(thread);
	frame.registers.set(1, valueClosure(thread->entry()->address));
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
	cpu.luaHeap().collectRuntime(valueNil(), valueNil(), valueNil(), thread);
	require(thread->stackCapacity == 512, "growth admission keeps the allocation being grown stable");
	cpu.luaHeap().setCollectionTarget(0);
	thread->resizeStack(2048);
	require(frame.registers.get(0) == valueInteger(456), "growth preserves values after prior shrink");
	const auto state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	require(std::ranges::equal(state.snapshot.words(), cpu.captureRuntimeState().snapshot.words()),
		"shrunken and regrown stack storage survives snapshot replay");
}

void highRetainedPacing() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto* retained = cpu.createTable(419430, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(cpu.gcHeap().reference(retained))); frame.writeControl(bmsx::FrameField::Top, 1);
	cpu.collectHeap();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto before = cpu.diagnosticGcProfile();
#endif
	for (int i = 0; i < 24000; ++i) cpu.createTable(8, 0);
	require(cpu.luaHeap().usedBytes() <= cpu.luaHeap().capacity() && frame.registers.get(0) == valueTable(cpu.gcHeap().reference(retained)),
		"retained pool and transient allocation coexist inside the physical capacity");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto after = cpu.diagnosticGcProfile();
	require(after.fullCollections == before.fullCollections && after.collections > before.collections,
		"headroom and allocation assists complete cycles without emergency full collection");
#endif
}

}

int main() {
	try {
		canonicalPoolAndRootRanges(); explicitCollectionAndNoReplay();
		allocationCollectionAndFailure(); allActivatedImagesAndUniqueGlobals(); temporaryRootsAndUnreachablePool();
		incrementalStateAndBarriers(); incrementalSharedWeakMode(); consumesSelfLinkedGrayEdge();
		secondMarkPassAndCredit(); sweepCoroutineRecord(); stackShrinkAndAdmission(); highRetainedPacing();
		std::cout << "guest GC work tests passed\n";
		return 0;
	} catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
