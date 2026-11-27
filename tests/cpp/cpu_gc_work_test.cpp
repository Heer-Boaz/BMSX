#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/thread_record.h"
#include "machine/cpu/upvalue.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/thread_allocation_reference.h"
#include "support/table_allocation_reference.h"
#include "support/upvalue_store_reference.h"

#include <array>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

test::Blua32TestImage image(OpCode operation = OpCode::HALT, bool wide = false) {
	test::Blua32TestImage result;
	result.text.resize(MAPPED_PAGE_BYTE_SIZE);
	u32 word = 0;
	if (wide) writeInstruction(result.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(result.text, word++, static_cast<u8>(operation), 0,
		1, 1);
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
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
};

// Thread232 (80-byte header, 40 Value bytes and two 56-byte frame records)
// + a 4-byte String binding, 17 machine Strings charged 697 bytes
// and two registered globals with a 16-byte image map. Both lookup indexes
// are uncharged. The collector visits allocated objects and intern buckets.
constexpr int bootBytes = 232 + 4 + 697 + 16 + 2 * 9;
// Two Thread traces of its header and one active frame, an atomic trace
// that also clears eight Value slots, two remark visits and a sweep visit.
constexpr int bootCollectionWork = 2 * (20 + 14) + (20 + 14 + 10) + 2 + 1 + 6 + 2 * 17 + 32;

void stringMarkWorkSurvivesCheckpoint() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& strings = cpu.stringPool();
	const auto first = strings.intern("mark-work-before-checkpoint");
	const auto second = strings.intern("mark-work-after-checkpoint");
	const auto workOffset = cpu.heapAllocator().managementOffset() + HEAP_STRING_MARK_WORK_OFFSET;

	strings.beginReachabilityEpoch();
	strings.markReachable(first);
	strings.markReachable(first);
	require(machine.memory.readRamRecordWord(workOffset) == 1u, "only a newly reached String contributes work");
	const auto state = cpu.captureRuntimeState();
	const auto ram = machine.memory.captureSaveState();

	require(strings.takeMarkWork() == 1u, "first mark is charged once");
	strings.markReachable(second);
	require(strings.takeMarkWork() == 1u && strings.takeMarkWork() == 0u, "later work is consumed independently");

	machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	require(strings.takeMarkWork() == 1u, "restoring the mark also restores unconsumed work");
	strings.markReachable(first);
	require(strings.takeMarkWork() == 0u, "the restored String is already marked");
	strings.markReachable(second);
	require(machine.memory.readRamRecordWord(workOffset) == 1u, "a mark beyond the checkpoint is undone");
	strings.resumeMarkWork(0u);
	require(strings.takeMarkWork() == 0u, "returning zero work replaces a previous latch value");
	strings.resumeMarkWork(1u);
	require(strings.takeMarkWork() == 1u, "borrowed work can be returned and consumed once");
}

void allocationAdmissionUsesLogicalBytes() {
	Machine machine(image()); auto& cpu = machine.cpu;
	const size_t logical = cpu.luaHeap().usedBytes();
	const u32 physical = cpu.heapAllocator().occupiedBytes();
	constexpr u32 logicalCharge = (32 + 2 * 5 + 4 * 10) + (32 + 512 * 5);
	cpu.luaHeap().setCollectionTarget(static_cast<u32>(logical) + logicalCharge);
	cpu.instructionBudgetRemaining = 23;
	const auto hash = bmsx::test::allocateTableReference(cpu, 2, 3);
	const auto array = bmsx::test::allocateTableReference(cpu, 512, 0);
	require(cpu.instructionBudgetRemaining == 23, "the allocations fit at the exact logical threshold");
	require(cpu.luaHeap().usedBytes() == logical + logicalCharge, "chunk overhead is not charged to the language budget");
	const auto& arena = cpu.heapAllocator();
	const auto hashBytes = arena.allocationBytes(hash.address() - GC_OBJECT_PREFIX) + arena.allocationBytes(hash.hashAddress()) + arena.allocationBytes(hash.arrayAddress());
	const auto arrayBytes = arena.allocationBytes(array.address() - GC_OBJECT_PREFIX) + arena.allocationBytes(array.arrayAddress());
	require(arena.occupiedBytes() == physical + hashBytes + arrayBytes && hashBytes + arrayBytes > logicalCharge,
		"physical diagnostics add the live chunks, including allocator overhead");
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == logical && cpu.heapAllocator().occupiedBytes() == physical,
		"reclamation returns the corresponding charges to both measurements");
}

void tableReplacementAdmitsOnlyItsLogicalIncrease() {
	for (const bool packArrayIntoHash : {false, true}) {
		Machine machine(image()); auto& cpu = machine.cpu;
		auto table = packArrayIntoHash ? bmsx::test::allocateTableReference(cpu, 8, 0) : bmsx::test::allocateTableReference(cpu, 1, 0);
		auto& frame = *cpu.rootThread()->currentFrame;
		frame.registers.set(0, valueTable(table.address())); frame.setTop(1);
		const int residentKey = packArrayIntoHash ? 8 : 1, trigger = packArrayIntoHash ? 9 : 2;
		table.setInteger(residentKey, valueInteger(100 + residentKey));
		const auto logical = cpu.luaHeap().usedBytes();
		const auto physical = cpu.heapAllocator().occupiedBytes();
		const auto oldStorage = cpu.heapAllocator().allocationBytes(table.arrayAddress());
		const auto target = logical + (packArrayIntoHash ? 0u : 5u);
		cpu.luaHeap().setCollectionTarget(target);
		table.setInteger(trigger, valueInteger(73));
		require(cpu.luaHeap().collectionTarget() == target && !cpu.collecting(),
			"a resize at the exact growth threshold must not assist collection for the outgoing layout");
		require(cpu.luaHeap().usedBytes() == (packArrayIntoHash ? logical - 20u : logical + 5u),
			"the budget commits the resulting capacities only");
		const auto newStorage = cpu.heapAllocator().allocationBytes(packArrayIntoHash ? table.hashAddress() : table.arrayAddress());
		require(cpu.heapAllocator().occupiedBytes() == physical - oldStorage + newStorage,
			"the owner physically retires the old layout");
		require(table.getInteger(residentKey) == valueInteger(100 + residentKey), "redistribution preserves the existing mapping");
		require(table.getInteger(trigger) == valueInteger(73), "the triggering mapping is written once");
	}
}

void tableBackingRecoveryRetriesEachEpoch() {
	enum class Pressure { Reclaimable, Floating, Unavailable, Explicit };
	for (const auto pressure : {Pressure::Reclaimable, Pressure::Floating, Pressure::Unavailable, Pressure::Explicit}) {
		Machine machine(image()); auto& cpu = machine.cpu;
		auto& gc = cpu.gcHeap(); auto& arena = cpu.heapAllocator();
		auto table = bmsx::test::allocateTableReference(cpu, 512, 0);
		auto& frame = *cpu.rootThread()->currentFrame;
		frame.registers.set(0, valueTable(table.address())); frame.setTop(1);
		for (int key = 1; key <= 512; ++key) table.setInteger(key, valueInteger(key));
		const u32 garbage = pressure != Pressure::Unavailable ? bmsx::test::allocateTableReference(cpu, 1024, 0).address() : 0u;
		const u32 spare = arena.allocate(4088u, true);
		require(spare != 0u, "the pressure fixture reserves a live chunk");
		while (arena.allocate(4088u, true) != 0u) {}
		arena.free(spare);
		require(arena.allocate(5 * 1024, true) == 0u && cpu.luaHeap().usedBytes() + 2560u < cpu.luaHeap().capacity(),
			"the replacement is admitted logically but its physical chunk cannot fit");

		const u8 white = gc.white();
		const Value initialRoot = pressure == Pressure::Floating || pressure == Pressure::Explicit ? valueTable(garbage) : valueNil();
		gc.step(initialRoot, valueNil(), valueNil(), 0u, false, 1u);
		require(gc.phase() == GcPhase::Mark, "recovery begins with an incomplete automatic mark");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
		const auto synchronousCollections = cpu.diagnosticGcProfile().fullCollections;
#endif
		cpu.instructionBudgetRemaining = 41;
		if (pressure == Pressure::Explicit) {
			cpu.collectHeap();
			require(gc.white() == white && gc.tableRecordAddress(garbage) == 0u,
				"deliberate full collection still runs a fresh epoch to reclaim floating garbage");
		} else if (pressure == Pressure::Unavailable) {
			bool failed = false;
			try { table.setInteger(513, valueInteger(73)); }
			catch (const LuaOutOfMemorySignal&) { failed = true; }
			require(failed && gc.white() == white && table.arrayCapacity() == 512u && isNil(table.getInteger(513)),
				"an impossible reserve gets one fresh retry and faults before publishing the insertion");
		} else {
			table.setInteger(513, valueInteger(73));
			require(gc.white() == (pressure == Pressure::Reclaimable ? white ^ 1u : white),
				"only a request that still misses after the old epoch starts a fresh one");
			require(table.arrayCapacity() == 1024u && table.getInteger(512) == valueInteger(512)
				&& table.getInteger(513) == valueInteger(73), "the actual replacement keeps the old and new entries");
		}
		require(!gc.active() && cpu.instructionBudgetRemaining == 41 && frame.registers.get(0) == valueTable(table.address()),
			"the recovery retains the live original and doesn't debit the guest instruction grant");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
		require(cpu.diagnosticGcProfile().fullCollections == synchronousCollections + 1u,
			"count synchronous recovery once regardless of the number of epochs it needed");
#endif
	}
}

// Frozen C++ admission reference for kernel/gc_vblank.lua.
void assistPhysicalPressureAtTickReference(Machine& machine) {
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	auto& arena = cpu.heapAllocator();
	const u32 control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	if (cpu.tableRebuild.record) return;
	if (heap.fullEpochs()) return;
	const u32 occupied = arena.occupiedBytes();
	const u32 previousOccupied = memory.readRamRecordWord(control + GC_PHYSICAL_OCCUPIED_AT_TICK);
	if (occupied != previousOccupied) memory.writeRamRecordWord(control + GC_PHYSICAL_OCCUPIED_AT_TICK, occupied);
	// The existing maintenance boundary owns atomic work.
	const auto current = heap.phase();
	if (current == GcPhase::Atomic) return;
	if (memory.readRamRecordWord(control + GC_PHYSICAL_ASSIST) == 0u) {
		if (occupied <= previousOccupied) return;
		const u32 demand = occupied - previousOccupied;
		const u32 completed = heap.epochWork();
		const u32 previous = memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK);
		const u32 remaining = std::max(previous, completed) - completed;
		// Allow the two phase handoffs at atomic entry and exit, plus the
		// next interval's growth. This is an estimate, not a reservation.
		const u64 quanta = remaining / GC_STEP_WORDS + (remaining % GC_STEP_WORDS != 0u) + 3u;
		if (arena.unoccupiedBytes() > demand * quanta) return;
		memory.writeRamRecordWord(control + GC_PHYSICAL_ASSIST, 1u);
	}
	// The interrupt wait lends bandwidth to an existing mark pass, not a new cycle.
	const bool idleMark = (current == GcPhase::Mark || current == GcPhase::MarkAgain) && cpu.isHaltedUntilIrq();
	heap.step(valueNil(), valueNil(), valueNil(), 0u, false, idleMark ? 4u * GC_STEP_WORDS : GC_STEP_WORDS);
}

void physicalPressurePacesLargeLiveHeap() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap(); auto& arena = cpu.heapAllocator();
	auto owner = bmsx::test::allocateTableReference(cpu, 512, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(owner.address())); frame.setTop(1);
	for (int key = 1; key <= 512; ++key) owner.setInteger(key, valueInteger(key));
	frame.registers.set(1, valueTable(bmsx::test::allocateTableReference(cpu, 225280, 0).address())); frame.setTop(2);
	const u32 garbage = bmsx::test::allocateTableReference(cpu, 65536, 0).address();
	frame.registers.set(2, valueTable(garbage)); frame.setTop(3);
	// With its header the request occupies 4096 bytes, so the workload
	// consumes headroom without stranding a smaller hole per chunk.
	constexpr u32 initialIntervals = 140u, pressureBytes = 4088u;
	u32 ballast;
	do {
		const u32 before = arena.occupiedBytes();
		ballast = arena.allocate(pressureBytes, true);
		require(ballast != 0u && arena.occupiedBytes() >= before + pressureBytes,
			"reserve actual allocator storage outside the language budget");
	} while (arena.unoccupiedBytes() > initialIntervals * pressureBytes);
	assistPhysicalPressureAtTickReference(machine);
	cpu.collectHeap(); // calibrate a completed live epoch, then make the large reserve garbage.
	frame.setTop(2);
	const u8 white = heap.white();
	cpu.instructionBudgetRemaining = 89;
	u32 physicalSteps = 0u;
	bool exercisedHalt = false;
	for (u32 tick = 0; tick + 1u < initialIntervals; ++tick) {
		require(arena.allocate(pressureBytes, true) != 0u, "add physical occupancy each interval");
		const u32 control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const u32 before = machine.memory.readRamRecordWord(control + GC_EPOCH_WORK);
		const bool wasActive = heap.active();
		const bool halted = !exercisedHalt && heap.phase() == GcPhase::Mark && physicalSteps >= 2u;
		if (halted) cpu.haltUntilIrq();
		assistPhysicalPressureAtTickReference(machine);
		const auto after = machine.memory.readRamRecordWord(control + (heap.active() ? GC_EPOCH_WORK : GC_LAST_EPOCH_WORK));
		if (halted) {
			require(after - before == 4u * GC_STEP_WORDS && cpu.isHaltedUntilIrq(), "pressure uses idle mark bandwidth without waking the CPU");
			exercisedHalt = true;
			cpu.clearHaltUntilIrq();
		}
		if (wasActive || heap.active()) {
			if (!halted) require(after - before <= GC_STEP_WORDS, "an awake CPU lends only one quantum");
			++physicalSteps;
		}
		for (u32 steps = 0; heap.finalMarkPending(); ++steps) {
			require(steps < 8u, "atomic work uses its regular deferred scheduler boundary");
			heap.stepFinalMark();
		}
	}
	require(exercisedHalt && physicalSteps >= 50u && !heap.active() && heap.white() == (white ^ 1u)
		&& heap.tableRecordAddress(garbage) == 0u && arena.unoccupiedBytes() > 2u * pressureBytes,
		"the larger epoch completed before the allocator exhausted its byte runway");
	assistPhysicalPressureAtTickReference(machine);
	require(!heap.active(), "without additional occupancy an idle collector does not start again");
	arena.free(ballast);
	assistPhysicalPressureAtTickReference(machine);
	require(!heap.active(), "a net release is not positive allocation pressure");
	const u8 recoveredWhite = heap.white();
	owner.setInteger(513, valueInteger(73));
	require(heap.white() == recoveredWhite && owner.getInteger(512) == valueInteger(512)
		&& owner.getInteger(513) == valueInteger(73) && cpu.instructionBudgetRemaining == 89,
		"the table grow needs no synchronous epoch and leaves the guest charge unchanged");
}

void physicalReservationsPayMarkWork() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& heap = cpu.luaHeap(); auto& gc = cpu.gcHeap(); auto& arena = cpu.heapAllocator();
	auto& frame = *cpu.rootThread()->currentFrame;
	const u32 live = bmsx::test::allocateTableReference(cpu, 131072, 0).address();
	frame.registers.set(0, valueTable(live)); frame.setTop(1);
	cpu.collectHeap(); // calibrate a completed epoch with a long mark.
	// The logical budget stays far below its threshold while physical room
	// is short: only the physical pace may advance marking.
	constexpr u32 slots = 1024, runwayRequests = 96u, ballastBytes = 4088u;
	do require(arena.allocate(ballastBytes, true) != 0u, "reserve storage outside the language budget");
	while (arena.unoccupiedBytes() > runwayRequests * (5u * slots + 64u));
	heap.setCollectionTarget(static_cast<u32>(heap.capacity()));
	const u32 roots[] = {bmsx::test::allocateTableReference(cpu).address(), bmsx::test::allocateTableReference(cpu).address(), bmsx::test::allocateTableReference(cpu).address()};
	const u8 white = gc.white();
	const size_t started = gc.step(valueNil(), valueNil(), valueNil(), 0u, false, 1u);
	require(gc.phase() == GcPhase::Mark && started != 0u
		&& machine.memory.readRamRecordWord(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_PACE_PAID) == started,
		"a cycle starts marking and its first quantum pays the new pace");
	const auto block = heap.reserveBacking(2048, 0, valueTable(roots[0]), valueTable(roots[1]), valueTable(roots[2]));
	for (const u32 root : roots) require(gc.isAlive(root), "physical reservation traces each temporary root");
	arena.free(block);
	const u32 runway = arena.unoccupiedBytes();
	cpu.instructionBudgetRemaining = 29;
	for (u32 requests = 0; !gc.finalMarkPending(); ++requests) {
		require(requests < runwayRequests && gc.white() == white,
			"reservations reach the final mark before the physical runway is exhausted");
		bmsx::test::allocateTableReference(cpu, slots, 0);
	}
	require(arena.unoccupiedBytes() >= runway / 4u && heap.collectionTarget() == heap.capacity()
		&& cpu.instructionBudgetRemaining == 29 && frame.registers.get(0) == valueTable(live),
		"marking keeps room for the final mark and reclamation without debiting the guest grant");
}

void physicalReservationsPaySweepWork(GcPhase phase) {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& heap = cpu.luaHeap(); auto& gc = cpu.gcHeap();
	constexpr int slots = 8192;
	const auto beforeLive = heap.usedBytes();
	auto live = bmsx::test::allocateTableReference(cpu, slots, 0);
	const auto reservationCharge = heap.usedBytes() - beforeLive;
	live.setInteger(1, valueInteger(73));
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(live.address()));
	frame.setTop(1);

	// Keep enough distinct garbage for more than one reservation assist in
	// each phase, without having to force a physical allocation failure.
	for (int i = 0; i < 8192; ++i) {
		if (phase == GcPhase::Sweep) bmsx::test::allocateTableReference(cpu);
		else cpu.stringPool().intern("unrooted-sweep-fixture-" + std::to_string(i));
	}
	for (int steps = 0; gc.phase() != phase; ++steps) {
		require(steps < 128, "reach the requested reclamation phase");
		if (gc.finalMarkPending()) gc.stepFinalMark();
		else gc.step(valueNil(), valueNil(), valueNil(), 0u, false, gc.phase() == GcPhase::Sweep ? 1u : GC_STEP_WORDS);
	}
	require(heap.usedBytes() + reservationCharge < heap.capacity(),
		"logical admission alone fits without allocation recovery");
	heap.setCollectionTarget(0u);
	cpu.instructionBudgetRemaining = 43;
	const auto beforeAdmission = machine.memory.captureSaveState();
	const auto beforeAdmissionCpu = cpu.captureRuntimeState();
	heap.admit(reservationCharge);
	require(cpu.captureRuntimeState() == beforeAdmissionCpu
		&& machine.memory.captureSaveState().ram == beforeAdmission.ram,
		"projecting a logical charge does not perform any Sweep or String work");

	const auto reserveUntilReclaimed = [&] {
		for (int requests = 1; requests <= 32; ++requests) {
			const auto before = heap.usedBytes();
			auto table = bmsx::test::allocateTableReference(cpu, slots, 0);
			table.setInteger(1, valueInteger(requests));
			if (heap.usedBytes() < before + reservationCharge)
				return std::pair{requests, table.address()};
		}
		throw std::runtime_error("physical reservations do not advance reclamation");
	};
	const auto white = gc.white();
	reserveUntilReclaimed();
	require(gc.phase() == phase && gc.white() == white,
		"real reservations reclaim garbage without completing or restarting the epoch");
	const auto midRam = machine.memory.captureSaveState();
	const auto midCpu = cpu.captureRuntimeState();
	const auto firstProgress = reserveUntilReclaimed();
	const auto afterRam = machine.memory.captureSaveState();
	const auto afterCpu = cpu.captureRuntimeState();
	machine.memory.restoreSaveState(midRam);
	cpu.restoreRuntimeState(midCpu);
	require(reserveUntilReclaimed() == firstProgress && cpu.captureRuntimeState() == afterCpu
		&& machine.memory.captureSaveState().ram == afterRam.ram,
		"restoring mid-sweep reproduces allocation, reclamation and the next physical progress point");
	require(gc.white() == white && cpu.instructionBudgetRemaining == 43
		&& cpu.readFrameRegister(0, 0) == valueTable(live.address())
		&& live.getInteger(1) == valueInteger(73),
		"allocation assists neither debit the guest grant nor reclaim live Values");
}

void canonicalPoolAndRootRanges() {
	Machine machine(image()); auto& cpu = machine.cpu;
	require(cpu.luaHeap().usedBytes() == bootBytes, "the admitted pool is the literal canonical allocation sum, not host object sizes");
	cpu.instructionBudgetRemaining = 7;
	require(cpu.collectHeap() == bootCollectionWork && cpu.instructionBudgetRemaining == 7,
		"physical collection counts object passes, three root passes and String work without a cycle debit");
	require(cpu.luaHeap().usedBytes() == bootBytes, "readonly ROM String bytes are not charged as allocated text");
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(bmsx::test::allocateTableReference(cpu, 2, 3).address())); //32+10+40=82 logical bytes.
	frame.registers.set(1, valueString(cpu.stringPool().intern("é😀"))); //6 UTF8 bytes.
	frame.writeControl(bmsx::FrameField::Top, 2);
	require(cpu.luaHeap().usedBytes() == bootBytes + 82 + 22, "canonical reserved table capacity and UTF8 text bytes agree");
	require(cpu.collectHeap() == bootCollectionWork + (9 + 2 + 8 + 1) + 2 + 2 * 3
		&& cpu.instructionBudgetRemaining == 7 && cpu.luaHeap().usedBytes() == bootBytes + 82 + 22,
		"table scans reserved slots; the String is marked and visited without reading its bytes");
	const auto threshold = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
	require(threshold.second == 1048576, "the existing minimum collection threshold is unchanged");
	cpu.instructionBudgetRemaining = 123;
	cpu.collectHeap();
	require(cpu.instructionBudgetRemaining == 123, "the explicit oracle collects without billing guest work");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == bootBytes + 82 + 22,
		"snapshot capture/restore does not collect or bill runtime work and preserves canonical accounting");
	const u32 workAddress = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK;
	const auto beforeReset = machine.memory.readRamRecordWord(workAddress);
	cpu.reset();
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == bootBytes + 82 + 22
		&& machine.memory.readRamRecordWord(workAddress) == beforeReset,
		"reset installs the vector without collecting the previous frame's objects");
	// Re-enter the managed reference state explicitly; raw reset has no collector.
	cpu.restoreRuntimeState(state);
	auto& released = *cpu.rootThread()->currentFrame;
	released.registers.set(0, valueNil());
	released.registers.set(1, valueNil());
	released.setTop(0);
	cpu.collectHeap();
	require(cpu.instructionBudgetRemaining == 123 && cpu.luaHeap().usedBytes() == bootBytes,
		"the reference collector reclaims the objects after their roots are gone");
}

void collectorWorkIgnoresInactiveThreadFrames() {
	const auto collect = [](u32 reservedFrames) {
		Machine machine(image()); auto& cpu = machine.cpu; auto& heap = cpu.gcHeap();
		const auto retained = bmsx::test::allocateTableReference(cpu).address();
		auto& thread = *cpu.rootThread();
		const u32 doomed = bmsx::test::allocateThreadRecordReference(cpu, 0u);
		if (reservedFrames != THREAD_INITIAL_FRAMES) {
			cpu.luaHeap().reserveThreadFrameStorage(thread.address, 0u, reservedFrames, valueNil());
			thread.bindStack();
			cpu.luaHeap().reserveThreadFrameStorage(doomed, 0u, reservedFrames, valueThread(doomed));
		}
		auto& frame = *thread.currentFrame;
		frame.registers.set(0, valueTable(retained)); frame.setTop(1);
		cpu.instructionBudgetRemaining = 9;
		std::vector<std::pair<GcPhase, size_t>> steps;
		do {
			const auto phase = heap.phase();
			const size_t work = heap.finalMarkPending()
				? heap.stepFinalMark() : cpu.stepHeap(valueNil(), valueNil(), valueNil());
			steps.emplace_back(phase, work);
			require(steps.size() < 32, "the automatic cycle drains in bounded quanta");
		} while (heap.active());
		require(cpu.instructionBudgetRemaining == 9 && heap.tableRecordAddress(retained) == retained
			&& heap.threadRecordAddress(doomed) == 0u, "live roots and reclamation do not depend on inactive frame reserve");
		require(ThreadRecord::storageLayout(machine.memory, thread.address).frameCapacity == reservedFrames,
			"automatic collection must not shrink the live reservation");
		return steps;
	};
	require(collect(THREAD_INITIAL_FRAMES) == collect(1024u),
		"inactive frame storage must not consume marking, atomic or sweep work");
}

void refusedCensusRetriesAtIssuePc() {
	Machine m(image(OpCode::SETT, true));
	auto& cpu = m.cpu;
	cpu.luaHeap().setCollectionTarget(cpu.luaHeap().capacity());
	auto table = bmsx::test::allocateTableReference(cpu, 1024, 0);
	for (int i = 1; i <= 1024; ++i) table.setInteger(i, valueInteger(i));
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(table.address())); frame.registers.set(1, valueInteger(1025)); frame.setTop(2);
	cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(cpu.collecting(), "start in an existing collector epoch");
	while (cpu.heapAllocator().allocate(4088u, true)) {}
	const auto grant = [&](int n) { return cpu.runUntilDepth(0, n, 0u, CpuRunKind::Scheduled); };
	require(grant(1) == RunResult::Yielded && grant(240) == RunResult::ParkedAllocation, "scan precedes physical refusal");
	for (const auto phase : {TableCensus::RetryCurrent, TableCensus::RetryFresh}) {
		for (int pulses = 0; !cpu.allocationReady(); ++pulses) {
			require(pulses < 128, "recovery must finish an epoch"); cpu.advanceAllocationRecovery();
		}
		cpu.resumeAllocation();
		require(!cpu.allocationParked() && cpu.tableRebuild.census == phase && cpu.tableRebuild.density.cursor == 0,
			"retry waits for an execution grant before scanning again");
		const auto result = grant(240);
		require(result == (phase == TableCensus::RetryCurrent ? RunResult::ParkedAllocation : RunResult::Yielded),
			"only failure after the fresh scan faults");
	}
	require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY && cpu.readEpcWord() == m.rom.textAddress
		&& !cpu.tableRebuild.record && isNil(table.getInteger(1025)), "WIDE store faults at issue without publishing");
}

void scheduledLogicalRefusalParks() {
	Machine m(image(OpCode::SETT));
	auto& cpu = m.cpu;
	auto& budget = cpu.luaHeap();
	budget.setCollectionTarget(budget.capacity());
	constexpr int slots = 8192;
	auto owner = bmsx::test::allocateTableReference(cpu, slots, 0);
	for (int i = 1; i <= slots; ++i) owner.setInteger(i, valueInteger(i));
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(owner.address())); frame.registers.set(1, valueInteger(slots + 1)); frame.setTop(2);
	const auto garbage = bmsx::test::allocateTableReference(cpu, (budget.capacity() - budget.usedBytes() - 32768) / 5, 0).address();
	require(!cpu.collecting() && budget.usedBytes() + 5 * slots > budget.capacity(), "the proposed growth exceeds logical headroom");
	constexpr int scanCycles = (slots - 64) / 4;
	require(cpu.runUntilDepth(0, 1, 0u, CpuRunKind::Scheduled) == RunResult::Yielded && !cpu.allocationParked()
		&& cpu.tableRebuild.density.cursor == 64, "an unfinished census is not a refused allocation");
	require(cpu.runUntilDepth(0, scanCycles, 0u, CpuRunKind::Scheduled) == RunResult::ParkedAllocation,
		"SETT parks before collecting on a logical refusal");
	require(!cpu.collecting() && cpu.gcHeap().tableRecordAddress(garbage) != 0u && isNil(owner.getInteger(slots + 1)),
		"issue neither collects nor publishes the store");
	for (int pulses = 0; !cpu.allocationReady(); ++pulses) {
		require(pulses < 64, "the recovered epoch finishes"); cpu.advanceAllocationRecovery();
	}
	cpu.resumeAllocation();
	require(!cpu.allocationParked() && cpu.gcHeap().tableRecordAddress(garbage) == 0u
		&& cpu.tableRebuild.record == owner.address() && isNil(owner.getInteger(slots + 1)),
		"recovery retries the placement before reserving the destination");
	cpu.runUntilDepth(0, scanCycles + 2 * slots * 5 / 16, 0u, CpuRunKind::Scheduled);
	require(cpu.instructionBudgetRemaining == 0 && owner.getInteger(slots + 1) == valueInteger(slots + 1) && isNil(frame.registers.get(7)),
		"the reclaimed space admits the original store without executing its successor");
}

void concatRecoveryChargesIssuingInstruction() {
	Machine generated(image(OpCode::CONCAT)), scalar(image(OpCode::CONCAT), true);
	for (auto* m : {&generated, &scalar}) {
		auto& frame = *m->cpu.rootThread()->currentFrame;
		frame.registers.set(1, valueInteger(12));
		frame.writeControl(FrameField::Top, 2);
		bmsx::test::allocateTableReference(m->cpu, 2048, 0);
		for (const auto bytes : {4088u, 32u, 8u}) while (m->cpu.heapAllocator().allocate(bytes, true)) {}
	}
	const int issue = BASE_CYCLES[static_cast<u8>(OpCode::CONCAT)] + 4;
	require(test::runCpuParity(generated.cpu, scalar.cpu, issue + 2) == RunResult::Yielded, "recovery exhausts the CONCAT grant");
	const int work = generated.memory.readRamRecordWord(generated.cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK);
	require(work > 0 && generated.cpu.instructionBudgetRemaining == 2 - 3 * work, "charge the recovered epoch exactly once");
	require(valueIsString(generated.cpu.readFrameRegister(0, 0)) && isNil(generated.cpu.readFrameRegister(0, 7)),
		"CONCAT completes after reclamation but its successor has not issued");
	test::runCpuParity(generated.cpu, scalar.cpu, 2);
	require(generated.cpu.readFrameRegister(0, 7) == valueInteger(37), "the fresh grant resumes at the successor");
}

void logicalAdmissionFailure() {
	Machine failure(image()); auto& cpu = failure.cpu;
	const auto doomed = bmsx::test::allocateTableReference(cpu, 16384, 0).address();
	const auto used = cpu.luaHeap().usedBytes();
	cpu.instructionBudgetRemaining = 1;
	for (bool active : {false, true}) {
		if (active) cpu.gcHeap().step(valueNil(), valueNil(), valueNil(), 0u, false, 1u);
		bool failed = false;
		try { cpu.luaHeap().admit(cpu.luaHeap().capacity() + 1); }
		catch (const LuaOutOfMemorySignal&) { failed = true; }
		require(failed && cpu.collecting() == active && cpu.luaHeap().usedBytes() == used
			&& cpu.gcHeap().tableRecordAddress(doomed) == doomed, "an impossible charge leaves the current epoch untouched");
	}
	bool failed = false;
	try { cpu.luaHeap().admit(cpu.luaHeap().capacity()); }
	catch (const LuaOutOfMemorySignal&) { failed = true; }
	require(failed && cpu.instructionBudgetRemaining == 1 && cpu.luaHeap().usedBytes() == bootBytes
		&& cpu.gcHeap().tableRecordAddress(doomed) == 0u, "a capacity-sized request still attempts recovery");
	cpu.runUntilDepth(0, 1);
	require(cpu.instructionBudgetRemaining == -1, "the next grant pays only for HALT");
}

void romLiteralsDoNotUseGuestRam() {
	auto source = image();
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 1);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::ADD), 1, 0, 0);
	writeInstruction(source.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	source.functions[0].wordCount = 3;
	source.globalNames.clear();
	source.systemGlobalNames.clear();
	source.constants = {i32{31}, i32{12}, i32{1024}};
	auto bare = source;
	bare.constants.clear();
	for (bool scalar : {false, true}) {
		Machine machine(source, scalar), empty(bare, scalar);
		auto& cpu = machine.cpu;
		const auto occupied = empty.cpu.heapAllocator().occupiedBytes();
		const u32 installed = executionImageBindingOffset(cpu.heapAllocator().managementOffset(), SYSTEM_EXECUTION_DOMAIN_ID);
		require(cpu.isExecutionDomainResident(SYSTEM_EXECUTION_DOMAIN_ID)
			&& machine.memory.readRamRecordWord(installed) == 0u
			&& machine.memory.readRamRecordWord(installed + EXECUTION_IMAGE_BINDING_SPAN_OFFSET) == 0u
			&& cpu.luaHeap().usedBytes() == empty.cpu.luaHeap().usedBytes()
			&& cpu.heapAllocator().occupiedBytes() == occupied, "numeric ROM literals have no guest binding allocation");
		const auto ram = machine.memory.captureSaveState();
		const auto state = cpu.captureRuntimeState();
		for (int replay = 0; replay < 2; ++replay) {
			cpu.runUntilDepth(0, 1000);
			require(cpu.readFrameRegister(0, 1) == valueInteger(24), "LOADK and ADD use the ROM literal");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (!scalar) {
				const auto* page = cpu.rootThread()->currentFrame->decodedPage;
				const u32 entry = (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
				require(page, "execution has bound a decoded page");
				test::waitForNativeEntry(cpu, *page, entry);
			}
#endif
			machine.memory.restoreSaveState(ram);
			cpu.restoreRuntimeState(state);
			require(machine.memory.captureSaveState().ram == ram.ram && cpu.heapAllocator().occupiedBytes() == occupied,
				"restoring ROM literals writes no guest RAM and reserves no storage");
		}
		cpu.reset(); cpu.reset();
		require(cpu.heapAllocator().occupiedBytes() == occupied, "reset still reserves no constant storage");

		// Even re-installing the exact same buffer retires its decoded key.
		auto* media = machine.rom.bytes.data();
		const u32 recordTable = readLE32(media + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
		writeLE32(media + recordTable + BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET, 41u);
		machine.memory.installSystemRom(machine.rom.bytes);
		cpu.runUntilDepth(0, 1000);
		require(cpu.readFrameRegister(0, 1) == valueInteger(24), "the active image still has its latched values");
		machine.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(state);
		cpu.runUntilDepth(0, 1000);
		require(cpu.readFrameRegister(0, 1) == valueInteger(82), "restore decodes the newly mounted ROM");
	}
}

void replacementRetiresInstalledBindingSpan() {
	auto source = image();
	writeInstruction(source.text, 0, static_cast<u8>(OpCode::GETGL), 0, 0, 0);
	writeInstruction(source.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	source.functions[0].wordCount = 2;
	source.globalNames = {"__index"};
	source.systemGlobalNames.clear();
	source.constants = {std::string("replacement A"), std::string("replacement B"), std::string("replacement C")};
	const auto replacement = test::encodeBlua32TestRom(RomImageDomain::System, source);
	auto previousMedia = replacement.bytes;
	writeLE32(previousMedia.data() + test::BLUA32_TEST_IMAGE_OFFSET + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, 1u);
	Memory memory(MemoryInit{previousMedia, {}}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses);
	test::seedManagedFixture(cpu, addresses);
	const u32 descriptor = executionImageBindingOffset(cpu.heapAllocator().managementOffset(), SYSTEM_EXECUTION_DOMAIN_ID);
	const u32 before = memory.readRamRecordWord(descriptor);
	require(before != 0u && memory.readRamRecordWord(descriptor + EXECUTION_IMAGE_BINDING_SPAN_OFFSET) == 8u,
		"installed namespace and String literal have a charged two-word binding");
	cpu.setGlobalByKey(cpu.stringPool().intern("__index"), valueInteger(73));
	const auto used = cpu.luaHeap().usedBytes();

	memory.installSystemRom(replacement.bytes);
	require(memory.readRamRecordWord(descriptor) == before && memory.readRamRecordWord(descriptor + EXECUTION_IMAGE_BINDING_SPAN_OFFSET) == 8u,
		"mounting media does not rebind the old record");
	cpu.replaceExecutionImage(addresses.resolveSystemDomain());
	require(memory.readRamRecordWord(descriptor) != before
		&& memory.readRamRecordWord(descriptor + EXECUTION_IMAGE_BINDING_SPAN_OFFSET) == 16u
		&& cpu.luaHeap().usedBytes() == used + 16 - 8, "new binding is allocated before draining the old exact span");
	const auto ram = memory.captureSaveState();
	const auto state = cpu.captureRuntimeState();
	for (int replay = 0; replay < 2; ++replay) {
		cpu.runUntilDepth(0, 4096);
		require(cpu.readFrameRegister(0, 0) == valueInteger(73), "decoded global reads through the replacement binding");
		memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(state);
		require(memory.captureSaveState().ram == ram.ram, "rebinding to restored operands does not rewrite guest RAM");
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
	test::seedManagedFixture(cpu, addresses);
	cpu.writeFrameExecution(0, 0, card0.functionAddresses[0], card0.textAddress);
	cpu.writeFrameExecution(0, 1, card1.functionAddresses[0], card1.textAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.functionAddresses[0], system.textAddress);
	cpu.collectHeap();
	require(cpu.luaHeap().usedBytes() == bootBytes + (4 + 20) + (4 + 16) + 2 * 9,
		"each card charges its String bindings, name-slot map and new unique global");
	cpu.instructionBudgetRemaining = 5;
	// Only the two new globals add work to the initial root pass.
	const size_t work = bootCollectionWork + 3 * 2;
	require(cpu.collectHeap() == work && cpu.instructionBudgetRemaining == 5,
		"all resident images omit primitive and ROM-backed constants from the root passes");
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	require(cpu.collectHeap() == work && cpu.instructionBudgetRemaining == 5,
		"restored residency and registered ranges reproduce the same physical work");
}

void temporaryRootsAndUnreachablePool() {
	Machine machine(image()); auto& cpu = machine.cpu;
	TableRecord table = bmsx::test::allocateTableReference(cpu); //32; retained only by the reserve temporary root.
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
	require(cpu.collectHeap() == bootCollectionWork + 2 && cpu.instructionBudgetRemaining == 1
		&& cpu.luaHeap().usedBytes() == bootBytes,
		"dead Table incurs one block visit, not another mark pass; its String incurs one visit, not a scan of its bytes");
}

void incrementalStateAndBarriers() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto roots = bmsx::test::allocateTableReference(cpu, 1024, 0);
	cpu.rootThread()->currentFrame->registers.set(0, valueTable(roots.address()));
	cpu.rootThread()->currentFrame->writeControl(bmsx::FrameField::Top, 1);
	const auto field = cpu.stringPool().intern("child");
	for (int i = 1; i <= 1000; ++i) {
		auto item = bmsx::test::allocateTableReference(cpu, 1, 1);
		item.setStringKey(field, valueBool(false)); roots.setInteger(i, valueTable(item.address()));
		auto dead = bmsx::test::allocateTableReference(cpu, 1, 0);
		dead.setInteger(1, valueTable(bmsx::test::allocateTableReference(cpu).address()));
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
	auto child = bmsx::test::allocateTableReference(cpu);
	target.setInteger(1, valueTable(child.address()));
	target.setStringKey(field, valueTable(child.address()));
	target.setMetatableAddress(bmsx::test::allocateTableReference(cpu).address());
	const auto childId = child.address();
	u32 phases = 0, bornId = 0;
	for (int step = 0; step < 1000; ++step) {
		auto state = cpu.captureRuntimeState();
		phases |= 1u << static_cast<u32>(cpu.gcHeap().phase());
		if (cpu.gcHeap().phase() == GcPhase::Sweep && bornId == 0) {
			auto born = bmsx::test::allocateTableReference(cpu); bornId = born.address();
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
	require(test::allocatedObjectRecords(cpu) == 1005,
		"full collection retains root Thread, roots Table, 1000 children and three new live Tables");
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
	test::seedTestRomClosure(machine.cpu, machine.rom.functionAddresses[1]);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	require(cpu.runUntilDepth(0, 1000) == RunResult::Halted, "bring back an actual guest vararg closure");
	const auto callee = asClosure(cpu.readCompletionValues().get(0), heap);
	const auto target = bmsx::test::allocateTableReference(cpu).address();
	std::vector<Value> args(GC_STEP_WORDS + 64, valueInteger(7));
	args.back() = valueTable(target);
	cpu.beginCompletionCall(callee, BuiltinArgsView(args.data(), args.size()));
	require(cpu.runUntilDepth(0, static_cast<int>(4 * args.size() + 1000)) == RunResult::Halted
		&& cpu.getFrameDepth() == 0 && cpu.readCompletionValues().size() == args.size()
		&& cpu.readCompletionValues().get(args.size() - 1) == valueTable(target),
		"VARARG and RET leave the real completion latch as the last table's only root");
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const int cycles = cpu.instructionBudgetRemaining;
	require(advance() == GC_STEP_WORDS && memory.readRamRecordWord(control + GC_ROOT_CURSOR) != 0u
		&& !heap.isAlive(target) && cpu.instructionBudgetRemaining == cycles,
		"completion slots use the first collector quantum, not guest cycles");
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
	Machine machine(program, true);
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	const auto first = cpu.stringPool().intern("global");
	const auto weakRoot = cpu.stringPool().intern("root-0");
	const auto finalRoot = cpu.stringPool().intern("root-1");
	const auto last = cpu.stringPool().intern(program.globalNames.back());
	constexpr std::string_view appendedName = "name registered after the global scan";
	const auto appended = cpu.stringPool().intern(appendedName);
	const u32 lastTarget = bmsx::test::allocateTableReference(cpu, GC_STEP_WORDS, 0).address();
	cpu.setGlobalByKey(last, valueTable(lastTarget));
	auto weak = bmsx::test::allocateTableReference(cpu, 1, 0), mode = bmsx::test::allocateTableReference(cpu);
	mode.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
	weak.setMetatableAddress(mode.address());
	auto weakTarget = bmsx::test::allocateTableReference(cpu, 1, 0), child = bmsx::test::allocateTableReference(cpu, 1, 0);
	weakTarget.setInteger(1, valueTable(child.address()));
	child.setInteger(1, valueInteger(73));
	weak.setInteger(1, valueTable(weakTarget.address()));
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
		const u32 late = bmsx::test::allocateTableReference(cpu).address();
		cpu.setGlobalByKey(first, valueTable(late));
		advance();
		require(heap.phase() == GcPhase::Mark && heap.isAlive(lastTarget) && heap.isAlive(late),
			"resuming scans the suffix; the store has already forwarded the amended prefix");
		for (int step = 0; heap.phase() != GcPhase::Atomic && step < 30; ++step) advance();
		require(heap.phase() == GcPhase::Atomic && !heap.isAlive(weakTarget.address()) && !heap.isAlive(child.address()),
			"the last weak value is still unmarked just before the final root pass");
		cpu.setGlobalByKey(finalRoot, valueTable(weakTarget.address()));
		cpu.setGlobalByKey(appended, valueInteger(41));
		require(heap.isAlive(weakTarget.address()) && !heap.isAlive(child.address()),
			"publishing a global only enqueues the new edge");
		const auto stoppedState = cpu.captureRuntimeState();
		const auto stoppedRam = memory.captureSaveState();
		const auto finishStopped = [&] {
			for (int step = 0; heap.active() && step < 30; ++step) advance();
			require(!heap.active() && memory.readRamRecordWord(control + GC_ROOT_CURSOR) == 0u
				&& heap.tableRecordAddress(late) == late && heap.tableRecordAddress(lastTarget) == lastTarget,
				"remark preserves a global written behind the initial root cursor");
			require(heap.tableRecordAddress(weakTarget.address()) == weakTarget.address()
				&& weak.getInteger(1) == valueTable(weakTarget.address()) && heap.tableRecordAddress(child.address()) == child.address()
				&& child.getInteger(1) == valueInteger(73), "the detached gray parent retains its white child before weak cleanup");
			require(cpu.stringPool().find(appendedName) == appended && cpu.getGlobalByKey(appended) == valueInteger(41),
				"a newly registered name is a String root even with a scalar Value");
			return memory.captureSaveState().ram;
		};
		const auto expected = finishStopped();
		memory.restoreSaveState(stoppedRam);
		cpu.restoreRuntimeState(stoppedState);
		require(finishStopped() == expected, "restoring after a root store preserves the detached work");
		return expected;
	};
	const auto expected = finish();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "restore resumes root scanning and replays later roots exactly");
}

void resumesLargeClosureCaptures() {
	constexpr u32 captures = 9000;
	test::Blua32TestImage program;
	program.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(program.text, 0, static_cast<u8>(OpCode::JMP), 1, 0, 0);
	writeInstruction(program.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(program.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	program.functions = {{.firstWord=0, .wordCount=2, .maxStack=8},
		{.firstWord=2, .wordCount=1, .upvalues={{true, 0}, {true, 1}}},
		{.firstWord=2, .wordCount=1, .upvalues=std::vector<Blua32UpvalueRecord>(captures, {true, 0})}};
	program.functions.back().upvalues.back().index = 1;
	Machine machine(program, true);
	auto& cpu = machine.cpu;
	auto& memory = machine.memory;
	auto& heap = cpu.gcHeap();
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	const auto lastTarget = bmsx::test::allocateTableReference(cpu).address();
	frame.registers.set(1, valueTable(lastTarget));
	std::array<u32, 2> cells{};
	frame.registers.set(2, valueClosure(test::seedTestCapturedClosure(cpu, machine.rom.functionAddresses[1], cells)));
	std::vector<u32> references(captures, cells[0]);
	references.back() = cells[1];
	frame.registers.set(3, valueClosure(test::seedTestCapturedClosure(cpu, machine.rom.functionAddresses[2], {}, references)));
	Upvalue::bindOpen(memory, cells[0], frame.thread->address, frame.stackBase(), 0u);
	Upvalue::bindOpen(memory, cells[1], frame.thread->address, frame.stackBase() + 1, cells[0]);
	frame.writeControl(FrameField::OpenHead, cells[1]);
	frame.setTop(4);
	require(cpu.runUntilDepth(0, 20000) == RunResult::Halted, "guest closes both capture cells");
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
		const auto replacement = bmsx::test::allocateTableReference(cpu).address();
		bmsx::test::storeUpvalueReference(cpu, cell, valueTable(replacement));
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
	program.text.resize(7 * INSTRUCTION_BYTES);
	writeInstruction(program.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(program.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(program.text, 2, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(program.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(program.text, 4, static_cast<u8>(OpCode::JMP), 1, 0, 0);
	writeInstruction(program.text, 5, static_cast<u8>(OpCode::RET), 3, 2, 0);
	writeInstruction(program.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	program.functions = {{.firstWord=0, .wordCount=4, .maxStack=8},
		{.firstWord=4, .wordCount=2, .numParams=1, .maxStack=8},
		{.firstWord=6, .wordCount=1, .upvalues=std::vector<Blua32UpvalueRecord>(captures, {true, 1})}};
	program.functions.back().upvalues.back().index = 0;
	program.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	Machine generated(program), scalar(program, true);
	for (auto* machine : {&generated, &scalar}) {
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[1]);
	}
	const auto setup = [](Machine& machine) {
		const auto target = bmsx::test::allocateTableReference(machine.cpu).address();
		auto& frame = *machine.cpu.rootThread()->currentFrame;
		frame.registers.set(1, valueTable(target));
		frame.setTop(2);
		return target;
	};
	const u32 target = setup(generated);
	require(setup(scalar) == target, "the test shares the same physical operands across modes");
	constexpr auto cycles = [](OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; };
	require(test::runCpuParity(generated.cpu, scalar.cpu, cycles(OpCode::CLOSURE) + cycles(OpCode::CALL)) == RunResult::Yielded,
		"both cores stop at the child entry before the closing JMP");
	for (auto* machine : {&generated, &scalar}) {
		auto& frame = *machine->cpu.activeThread()->currentFrame;
		std::vector<u32> cells(captures);
		const auto record = test::seedTestCapturedClosure(machine->cpu, machine->rom.functionAddresses[2], cells);
		Upvalue::bindOpen(machine->memory, cells.back(), frame.thread->address, frame.stackBase(), 0u);
		u32 head = cells.back();
		for (u32 index = 0; index < captures - 1; ++index) {
			Upvalue::bindOpen(machine->memory, cells[index], frame.thread->address, frame.stackBase() + 1, head);
			head = cells[index];
		}
		frame.writeControl(FrameField::OpenHead, head);
		frame.registers.set(3, valueClosure(record));
		frame.setTop(4);
	}
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
	auto table = bmsx::test::allocateTableReference(cpu, 0, count);
	const u32 victim = bmsx::test::allocateTableReference(cpu).address();
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
	auto entries = bmsx::test::allocateTableReference(cpu), both = bmsx::test::allocateTableReference(cpu);
	auto weakKeys = bmsx::test::allocateTableReference(cpu), weakBoth = bmsx::test::allocateTableReference(cpu);
	weakKeys.setStringKey(modeKey, valueString(cpu.stringPool().intern("k")));
	weakBoth.setStringKey(modeKey, valueString(cpu.stringPool().intern("kv")));
	entries.setMetatableAddress(weakKeys.address());
	both.setMetatableAddress(weakBoth.address());
	frame.registers.set(0, valueTable(entries.address()));
	frame.registers.set(1, valueTable(both.address()));
	frame.setTop(2);

	auto key = bmsx::test::allocateTableReference(cpu), value = bmsx::test::allocateTableReference(cpu);
	value.setInteger(1, valueTable(key.address()));
	entries.set(valueTable(key.address()), valueTable(value.address()));
	auto dropKey = bmsx::test::allocateTableReference(cpu), dropValue = bmsx::test::allocateTableReference(cpu);
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

void weakHashClearingOnlyMarksSurvivingStrings() {
	Machine machine(image(), true);
	auto& cpu = machine.cpu;
	auto& strings = cpu.stringPool();
	auto weak = bmsx::test::allocateTableReference(cpu, 0, 8), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(weak.address())); frame.setTop(1);
	meta.setStringKey(strings.intern("__mode"), valueString(strings.intern("kv")));
	weak.setMetatableAddress(meta.address());
	weak.setStringKey(strings.intern("orphan key"), valueTable(bmsx::test::allocateTableReference(cpu).address()));
	weak.set(valueTable(bmsx::test::allocateTableReference(cpu).address()), valueString(strings.intern("orphan value")));
	const auto key = strings.intern("retained key"), value = strings.intern("retained value");
	weak.setStringKey(key, valueString(value));
	cpu.collectHeap();
	require(!strings.find("orphan key") && !strings.find("orphan value"), "dead pairs do not retain either string");
	require(strings.find("retained key") == key && strings.find("retained value") == value
		&& weak.getStringKey(key) == valueString(value), "surviving weak pairs retain both strings");
}

void weakValuesSkipMarkingStorageWithoutStrongEdges() {
	for (bool bothWeak : {false, true}) {
		Machine machine(image(), true);
		auto& cpu = machine.cpu;
		auto& heap = cpu.gcHeap();
		auto& strings = cpu.stringPool();
		constexpr u32 slots = 2 * GC_STEP_WORDS;
		auto weak = bmsx::test::allocateTableReference(cpu, slots, bothWeak ? slots : 1u);
		auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
		meta.setStringKey(strings.intern("__mode"), valueString(strings.intern(bothWeak ? "kv" : "v")));
		weak.setMetatableAddress(meta.address());
		auto& frame = *cpu.rootThread()->currentFrame;
		frame.registers.set(0, valueTable(weak.address())); frame.setTop(1);
		const u32 deadValue = bmsx::test::allocateTableReference(cpu).address(), key = bmsx::test::allocateTableReference(cpu).address();
		const auto text = strings.intern("text held only by a surviving weak entry");
		weak.setInteger(1, valueTable(deadValue));
		weak.setInteger(slots, valueString(text));
		weak.set(valueTable(key), valueInteger(17));

		cpu.stepHeap(valueNil(), valueNil(), valueNil());
		require(heap.finalMarkPending() && !heap.isAlive(deadValue) && heap.isAlive(key) == !bothWeak,
			"one mark quantum skips the weak array, marking only the hash keys when strong");
		require(weak.getInteger(1) == valueTable(deadValue), "marking does not clear weak entries");
		int finalSteps = 0;
		while (heap.finalMarkPending() && finalSteps < 16) { heap.stepFinalMark(); ++finalSteps; }
		require(heap.phase() == GcPhase::Sweep && finalSteps > 1, "real weak clearing remains resumable");
		while (heap.active()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
		require(isNil(weak.getInteger(1)) && heap.tableRecordAddress(deadValue) == 0u,
			"the final pass clears dead weak values");
		require(weak.get(valueTable(key)) == (bothWeak ? valueNil() : valueInteger(17))
			&& heap.tableRecordAddress(key) == (bothWeak ? 0u : key), "only the strong hash key survives");
		require(weak.getInteger(slots) == valueString(text)
			&& strings.find("text held only by a surviving weak entry") == text, "the final pass retains weak Strings");
	}
}

void incrementalSharedWeakMode() {
	Machine machine(image());
	auto& cpu = machine.cpu;
	auto roots = bmsx::test::allocateTableReference(cpu, 1024, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(roots.address()));
	frame.writeControl(bmsx::FrameField::Top, 1);
	for (int i = 1; i <= 1000; ++i) roots.setInteger(i, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	const auto modeKey = cpu.stringPool().intern("__mode");
	auto metatable = bmsx::test::allocateTableReference(cpu, 0, 1);
	metatable.setStringKey(modeKey, valueString(cpu.stringPool().intern("v")));
	auto weak = asTable(roots.getInteger(1000), cpu.gcHeap());
	auto following = asTable(roots.getInteger(999), cpu.gcHeap());
	weak.setMetatableAddress(metatable.address());
	following.setMetatableAddress(metatable.address());
	auto child = bmsx::test::allocateTableReference(cpu);
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
	auto target = bmsx::test::allocateTableReference(cpu, 1, 0), meta = bmsx::test::allocateTableReference(cpu, 0, capacity);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(target.address()));
	frame.setTop(1);
	target.setMetatableAddress(meta.address());
	for (i32 key = -1, count = 0; count < static_cast<i32>(GC_STEP_WORDS + 64); --key) {
		if ((hashCanonicalTableKey(valueInteger(key)) & (capacity - 1u)) != home) continue;
		meta.setInteger(key, valueInteger(1));
		if (count++ == 0) meta.setStringKey(mode, valueString(cpu.stringPool().intern("kv")));
	}
	auto watched = bmsx::test::allocateTableReference(cpu);
	target.setInteger(1, valueTable(watched.address()));
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(control + field); };
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	size_t inspected = 0;
	for (int step = 0; read(GC_MODE_META) == 0u && step < 20; ++step) inspected = advance();
	require(read(GC_MODE_META) == meta.address() && read(GC_TRACE_RECORD) == target.address()
		&& read(GC_MODE_NODE) != home && !heap.isAlive(watched.address()) && inspected == GC_STEP_WORDS,
		"a real colliding metatable search spends its quantum before suspending");
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
	auto weak = bmsx::test::allocateTableReference(cpu, slots, 0), strong = bmsx::test::allocateTableReference(cpu, 1, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(weak.address()));
	frame.registers.set(1, valueTable(strong.address()));
	frame.setTop(2);
	const auto mode = cpu.stringPool().intern("__mode");
	auto weakMeta = bmsx::test::allocateTableReference(cpu, 0, 1), strongMeta = bmsx::test::allocateTableReference(cpu, 0, 1);
	weakMeta.setStringKey(mode, valueString(cpu.stringPool().intern("v")));
	strongMeta.setStringKey(mode, valueString(cpu.stringPool().intern("very")));
	weak.setMetatableAddress(weakMeta.address());
	strong.setMetatableAddress(strongMeta.address());
	auto onlyStrong = bmsx::test::allocateTableReference(cpu), first = bmsx::test::allocateTableReference(cpu), last = bmsx::test::allocateTableReference(cpu);
	strong.setInteger(1, valueTable(onlyStrong.address()));
	weak.setInteger(1, valueTable(first.address()));
	weak.setInteger(slots, valueTable(last.address()));
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	for (int step = 0; heap.phase() != GcPhase::Atomic && step < 30; ++step) advance();
	require(heap.phase() == GcPhase::Atomic, "the last mark pass is ready");
	size_t cleared = 0;
	for (int step = 0; !isNil(weak.getInteger(1)) && step < 30; ++step) cleared = heap.stepFinalMark();
	require(heap.phase() == GcPhase::Atomic && isNil(weak.getInteger(1))
		&& weak.getInteger(slots) == valueTable(last.address())
		&& heap.tableRecordAddress(first.address()) == first.address() && cleared == GC_STEP_WORDS,
		"the final pass spends its reported quantum clearing only a prefix before object reclamation");
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
	const auto globalKey = cpu.stringPool().intern("late remark global");
	cpu.setGlobalByKey(globalKey, valueNil());
	auto roots = bmsx::test::allocateTableReference(cpu, count, 0), changed = bmsx::test::allocateTableReference(cpu);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(roots.address()));
	frame.registers.set(1, valueTable(changed.address()));
	frame.setTop(2);
	const auto modeKey = cpu.stringPool().intern("__mode");
	auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
	meta.setStringKey(modeKey, valueString(cpu.stringPool().intern("v")));
	auto watcher = bmsx::test::allocateTableReference(cpu, 1, 0);
	watcher.setMetatableAddress(meta.address());
	roots.setInteger(count, valueTable(watcher.address()));
	for (u32 slot = 1; slot < count; ++slot) {
		auto child = bmsx::test::allocateTableReference(cpu);
		child.setMetatableAddress(meta.address());
		roots.setInteger(slot, valueTable(child.address()));
	}
	auto watched = bmsx::test::allocateTableReference(cpu);
	watcher.setInteger(1, valueTable(watched.address()));
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto read = [&](u32 field) { return memory.readRamRecordWord(control + field); };
	const auto advance = [&] { return cpu.stepHeap(valueNil(), valueNil(), valueNil()); };
	const u32 head = (watcher.address() & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	size_t visited = 0;
	for (int step = 0; read(GC_REMARK_VISIT_INDEX) == 0u && step < 100; ++step) visited = advance();
	const auto cursor = read(GC_REMARK_VISIT_INDEX);
	require(cursor != 0u && cursor != head && read(GC_REMARK_VISIT_STATE) != 0u
		&& read(GC_WEAK_VISITS) == head && read(GC_WEAK_VISITS + GC_VISIT_COUNT) == count
		&& heap.phase() == GcPhase::Mark && !heap.isAlive(watched.address()) && visited == GC_STEP_WORDS,
		"a partially clocked weak-table remark spends its quantum and retains the original list");
	const auto state = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	const auto finish = [&] {
		require(read(GC_REMARK_VISIT_INDEX) == cursor, "remark resumes from the saved visit");
		auto late = bmsx::test::allocateTableReference(cpu);
		changed.setInteger(1, valueTable(late.address()));
		meta.setStringKey(modeKey, valueNil());
		require(!heap.isAlive(late.address()), "the intervening write is not marked eagerly");
		auto global = bmsx::test::allocateTableReference(cpu, 1, 0), child = bmsx::test::allocateTableReference(cpu);
		global.setInteger(1, valueTable(child.address()));
		cpu.setGlobalByKey(globalKey, valueTable(global.address()));
		require(heap.isAlive(global.address()) && !heap.isAlive(child.address()), "the global queues its new parent during visits");
		for (int step = 0; heap.active() && step < 100; ++step) advance();
		require(!heap.active() && read(GC_REMARK_VISIT_STATE) == 0u
			&& heap.tableRecordAddress(watched.address()) == watched.address()
			&& heap.tableRecordAddress(late.address()) == late.address()
			&& heap.tableRecordAddress(child.address()) == child.address(),
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
	auto rooted = bmsx::test::allocateTableReference(cpu);
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
	frame.registers.set(0, valueTable(bmsx::test::allocateTableReference(cpu, 8192, 0).address()));
	frame.registers.set(1, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	frame.registers.set(2, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	frame.writeControl(bmsx::FrameField::Top, 3);
	const auto before = cpu.luaHeap().usedBytes();
	cpu.luaHeap().setCollectionTarget(before); cpu.instructionBudgetRemaining = 0;
	bmsx::test::allocateTableReference(cpu);
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	require(cpu.instructionBudgetRemaining == 0 && cpu.luaHeap().collectionTarget() == before + 1024
		&& cpu.memory().readRamRecordWord(control + GC_TRACE_RECORD) == valuePayload(frame.registers.get(0)),
		"a small admission earns one baseline quantum of credit and does not debit the guest");
	const auto firstCursor = cpu.memory().readRamRecordWord(control + GC_TRACE_CURSOR);
	bmsx::test::allocateTableReference(cpu, 3200, 0);
	require(cpu.luaHeap().collectionTarget() == before + 1024 + 2 * GC_STEP_WORDS
		&& cpu.luaHeap().collectionTarget() < cpu.luaHeap().usedBytes()
		&& cpu.memory().readRamRecordWord(control + GC_TRACE_CURSOR) == firstCursor + GC_STEP_WORDS,
		"a large admission spends at most one quantum and carries its unpaid debt");
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
	auto late = bmsx::test::allocateTableReference(cpu); target.setInteger(2, valueTable(late.address()));
	while (cpu.collecting()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(target.getInteger(2) == valueTable(late.address()), "final remark retains writes after the second pass");
}

void strongWritesLeaveLargeTablesOutOfFinalRemark(bool grows) {
	Machine machine(image());
	auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto& memory = machine.memory;
	constexpr u32 slots = 2 * GC_STEP_WORDS;
	auto table = bmsx::test::allocateTableReference(cpu, slots, grows ? 0 : 16);
	auto pending = bmsx::test::allocateTableReference(cpu, slots);
	const u32 key = bmsx::test::allocateTableReference(cpu).address(), value = bmsx::test::allocateTableReference(cpu).address();
	const auto text = cpu.stringPool().intern("forward mark across a checkpoint");
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(table.address()));
	frame.registers.set(1, valueTable(pending.address()));
	frame.setTop(2);
	const u32 control = cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const auto phase = [&](u32 offset) { return memory.readRamRecordWord(control + offset); };
	const auto color = [&](u32 record) { return memory.readRamRecordByte(record + GC_COLOR_OFFSET) & GC_COLOR_MASK; };
	const auto step = [&] { return heap.step(valueNil(), valueNil(), valueNil(), 0u, false, 256u); };
	// Revisit one large table in the second pass so that there is a live
	// mutator interval with another large table already completely scanned.
	for (unsigned i = 0; i < 256
		&& (color(pending.address()) != 3u || phase(GC_TRACE_RECORD) == pending.address()); ++i) step();
	require(heap.phase() == GcPhase::Mark && color(pending.address()) == 3u, "first scan leaves a black pending table");
	pending.setInteger(1, valueTable(table.address()));
	for (unsigned i = 0; i < 256 && heap.phase() == GcPhase::Mark; ++i) step();
	require(heap.phase() == GcPhase::MarkAgain && color(table.address()) == 3u
		&& !heap.isAlive(key) && !heap.isAlive(value), "isolated writes start in the live second pass");

	const u32 changed = phase(GC_CHANGED_HEAD), work = phase(GC_EPOCH_WORK);
	const u32 backing = table.hashAddress();
	table.set(valueTable(key), valueTable(value));
	require((table.hashAddress() != backing) == grows,
		"the insertion exercises the intended storage placement path");
	table.setInteger(1, valueString(text));
	require(color(table.address()) == 3u && phase(GC_CHANGED_HEAD) == changed
		&& heap.isAlive(key) && heap.isAlive(value), "both inserted hash edges go to the live trace, not a table rescan");
	require(phase(GC_EPOCH_WORK) == work + 1u && cpu.stringPool().takeMarkWork() == 0u,
		"a new String mark is credited before the host can take a checkpoint");
	const auto snapshot = memory.captureSaveState();
	const auto state = cpu.captureRuntimeState();
	const auto finish = [&] {
		while (heap.phase() == GcPhase::MarkAgain) step();
		const auto stoppedWork = heap.finishFinalMark();
		require(stoppedWork < slots, "the stopped pass does not revisit the large table");
		while (heap.active()) step();
		require(heap.tableRecordAddress(key) == key && heap.tableRecordAddress(value) == value
			&& table.get(valueTable(key)) == valueTable(value) && cpu.stringPool().find("forward mark across a checkpoint") == text,
			"all newly reached objects are retained");
		return memory.captureSaveState().ram;
	};
	const auto expected = finish();
	memory.restoreSaveState(snapshot);
	cpu.restoreRuntimeState(state);
	require(finish() == expected, "late forward marking and accounting replay exactly");
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
			published = bmsx::test::allocateTableReference(cpu).address();
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
		cpu.luaHeap().collectRuntime(valueTable(published), valueTable(temporary));
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

void referenceExplicitAtomicOwnsOnePass() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& heap = cpu.gcHeap();
	auto weak = bmsx::test::allocateTableReference(cpu, 2 * GC_STEP_WORDS, 0), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
	meta.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
	weak.setMetatableAddress(meta.address());
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(weak.address())); frame.setTop(1);
	for (int i = 0; !heap.finalMarkPending() && i < 20; ++i) cpu.stepHeap(valueNil(), valueNil(), valueNil());
	require(heap.finalMarkPending(), "the final pass is ready");
	const auto state = cpu.captureRuntimeState();
	const auto ram = machine.memory.captureSaveState();
	const auto work = heap.finishFinalMark();
	require(work > GC_STEP_WORDS, "the synchronous final step spans several physical quanta");
	machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	require(heap.step(valueNil(), valueNil(), valueNil()) == work && heap.phase() == GcPhase::Sweep,
		"explicit Step's Atomic admission is a whole final pass, not a single atomic quantum");
}

void collectUnattachedThreadRecord() {
	Machine machine(image()); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap(); auto& memory = machine.memory;
	const size_t baselineWork = gc.collect();
	const size_t baselineBytes = cpu.heapAllocator().occupiedBytes();
	const u32 address = bmsx::test::allocateThreadRecordReference(cpu, 0u);
	constexpr u32 capacity = 64u;
	cpu.luaHeap().reserveThreadFrameStorage(address, capacity, 0, valueNil());
	const u32 block = ThreadRecord::read(memory, address, ThreadField::StackBlock);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::Status), static_cast<u32>(ThreadStatus::Suspended));
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameDepth), 1u);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::StackTop), 1u);
	const auto layout = ThreadRecord::storageLayout(memory, address);
	const u32 frame = layout.frameAddress(0);
	memory.writeRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity), THREAD_INITIAL_VALUES);
	memory.writeRamRecordWord(frame + static_cast<u32>(FrameField::Top), 1u);
	const u32 child = bmsx::test::allocateTableReference(cpu).address();
	memory.writeRamRecordWord(block, child);
	memory.writeRamRecordByte(block + capacity * sizeof(u32), static_cast<u8>(ValueTag::Table));
	const auto& arena = cpu.heapAllocator();
	const size_t stackBytes = arena.allocationBytes(block);
	const size_t bytes = stackBytes + arena.allocationBytes(address - GC_OBJECT_PREFIX) + arena.allocationBytes(layout.frameBlock);
	const size_t childBytes = arena.allocationBytes(child - GC_OBJECT_PREFIX);
	require(layout.block == block && gc.threadRecordAddress(address) == address && gc.allocationBytes(address) == bytes,
		"an issued raw Thread has its physical header and backing without an execution view");
	require(arena.occupiedBytes() == baselineBytes + bytes + childBytes,
		"the raw Thread and its sole table edge own only their guest allocations");
	const size_t liveWork = gc.collect(valueThread(address), valueNil(), valueNil(), address);
	const size_t threadWork = 3 * (20 + 14) + 2 * 2 + capacity * THREAD_STACK_SLOT_BYTES / sizeof(u32) + 2 + 1;
	require(liveWork == baselineWork + threadWork + TableRecord::HEADER_BYTES / sizeof(u32) + 1,
		"trace the active frame and live Value, clear the final tail, and sweep each record once");
	require(gc.threadRecordAddress(address) == address && gc.tableRecordAddress(child) == child
		&& memory.readRamRecordWord(block) == child,
		"a raw Thread root retains its unviewed frame's table slot");
	require(gc.collect(valueThread(address), valueNil(), valueNil(), address) == liveWork,
		"repeated collection follows the same RAM frame and charges no host attachment work");
	const size_t shrinkWork = gc.collect(valueThread(address));
	const auto reduced = ThreadRecord::storageLayout(memory, address);
	const size_t reducedBytes = bytes - stackBytes + arena.allocationBytes(reduced.block);
	require(reduced.valueCapacity == capacity / 2 && reduced.block == block && reduced.frameBlock == layout.frameBlock
		&& reduced.slots(memory).get(0) == valueTable(child)
		&& memory.readRamRecordWord(reduced.frameAddress(0) + static_cast<u32>(FrameField::Top)) == 1u,
		"shrinking retains the payload and frame addresses and moves the live tag");
	require(shrinkWork == liveWork + 2 * (reduced.valueBytes() / sizeof(u32))
		&& arena.occupiedBytes() == baselineBytes + reducedBytes + childBytes,
		"compaction charges the retained extent and releases the unused suffix");
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
	require(deadWork == baselineWork + 2,
		"removing the raw Thread root leaves a sweep visit for the Thread and for its table");
	require(gc.threadRecordAddress(address) == 0u && gc.tableRecordAddress(child) == 0u
		&& memory.readRamRecordByte(address) == 0u && cpu.heapAllocator().occupiedBytes() == baselineBytes,
		"reclamation releases the unviewed Thread header, its owned backing and its sole child");
}

void sweepCoroutineRecord() {
	test::Blua32TestImage program;
	program.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(program.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(program.text, 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
	program.functions = {{.firstWord=0, .wordCount=1, .maxStack=8}, {.firstWord=1, .wordCount=1, .maxStack=2}};
	Machine machine(program); auto& cpu = machine.cpu; auto& gc = cpu.gcHeap();
	const u32 entry = test::seedTestRomClosure(cpu, machine.rom.functionAddresses[1]);
	const u32 address = bmsx::test::allocateThreadRecordReference(cpu, entry);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueThread(address));
	require(gc.threadRecordAddress(address) == address, "fixture published a physical Thread reference");
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
	require(gc.threadRecordAddress(address) == address, "reachable coroutine survives collection");
	frame.registers.set(0, valueNil());
	require(sweep() == liveWork, "a Thread has the same visit charge whether retained or released");
	require(gc.threadRecordAddress(address) == 0u && cpu.memory().readRamRecordByte(address) == 0
		&& cpu.heapAllocator().occupiedBytes() == occupied - bytes, "sweep frees both the coroutine slot and its owned stack");
	require(sweep() + 1 == liveWork, "only the surviving Thread is visited at the next collection");
}

void sweepUnselectsSuspendedTransferFrames() {
	constexpr u32 depth = 8u, rootWords = 5u, bodyWords = 4u;
	test::Blua32TestImage program;
	program.text.resize((rootWords + bodyWords * depth) * INSTRUCTION_BYTES);
	const auto emit = [&](u32 word, OpCode op, u32 a = 0u, u32 b = 0u, u32 c = 0u) {
		writeInstruction(program.text, word, static_cast<u8>(op), a, b, c);
	};
	emit(0, OpCode::GETSYS, 2); emit(1, OpCode::MOV, 3);
	emit(2, OpCode::CALL, 2, 2, 3); emit(3, OpCode::HALT); emit(4, OpCode::RET, 0, 1);
	program.functions.push_back({.firstWord=0, .wordCount=rootWords, .maxStack=8});
	program.systemGlobalNames = {"resume", "yield"};
	for (u32 i = 0; i < depth; ++i) {
		const u32 start = rootWords + i * bodyWords;
		program.functions.push_back({.firstWord=start, .wordCount=bodyWords, .maxStack=2});
		if (i + 1u < depth) {
			emit(start, OpCode::WIDE); emit(start + 1, OpCode::CLOSURE);
			emit(start + 2, OpCode::CALL, 0, 1, 1);
			program.closureRelocations.push_back({start + 1, test::blua32TestFunctionAddress(RomImageDomain::System, i + 2u)});
		} else {
			emit(start, OpCode::GETSYS, 0, 0, 1); emit(start + 1, OpCode::KSMI, 1, 0, 37);
			emit(start + 2, OpCode::CALL, 0, 2, 1);
		}
		emit(start + 3, OpCode::RET, 0, 1);
	}
	Machine machine(program); auto& cpu = machine.cpu;
	const std::array primitives{BuiltinFunctionId::CoroutineResume, BuiltinFunctionId::CoroutineYield};
	for (size_t i = 0; i < primitives.size(); ++i)
		cpu.setSystemGlobalByKey(cpu.stringPool().intern(program.systemGlobalNames[i]), cpu.createBuiltinFunction(primitives[i]));
	struct Observation { CPU& cpu; Thread* bank = nullptr; CallFrame* head = nullptr; size_t maxDepth = 0; bool rebound = false; } observation{cpu};
	cpu.setExecutionHook({+[](void* context, ExecutionDomainId, u32) {
		auto& out = *static_cast<Observation*>(context);
		auto* thread = out.cpu.activeThread();
		if (thread == out.cpu.rootThread()) return false;
		if (!out.bank) { out.bank = thread; out.head = thread->firstFrame; }
		if (out.rebound && thread->frameDepth() == 1u) {
			size_t attached = 0;
			for (auto* frame = thread->firstFrame; frame; frame = frame->next) ++attached;
			const u32 reserve = ThreadRecord::count(out.cpu.memory(), thread->address, ThreadField::FrameCapacity);
			require(thread == out.bank && thread->firstFrame == out.head && attached <= reserve && attached < depth,
				"a shallow selection reuses the head without attaching the retired deep tail");
		}
		out.maxDepth = std::max(out.maxDepth, thread->frameDepth());
		return false;
	}, &observation, ALL_EXECUTION_DOMAINS_MASK, 0u});
	const auto run = [&] {
		const u32 entry = test::seedTestRomClosure(cpu, machine.rom.functionAddresses[1]);
		cpu.rootThread()->currentFrame->registers.set(0, valueThread(bmsx::test::allocateThreadRecordReference(cpu, entry)));
		for (const auto& relocation : program.closureRelocations) test::seedTestRomClosure(cpu, relocation.functionAddress);
		for (int i = 0; i < 16; ++i)
			if (cpu.runUntilDepth(0, 1000) == RunResult::Halted && cpu.activeThread() == cpu.rootThread()) return;
		throw std::runtime_error("the real coroutine must yield to its halted resumer");
	};
	run();
	auto& registers = cpu.rootThread()->currentFrame->registers;
	const auto address = valuePayload(registers.get(0));
	require(observation.maxDepth == depth && observation.bank->address == address
		&& registers.get(2) == valueBool(true) && registers.get(3) == valueInteger(37), "a selected deep coroutine is genuinely suspended");
	registers.set(0, valueNil());
	do { cpu.gcHeap().step(valueNil(), valueNil(), valueNil()); } while (cpu.collecting());
	require(cpu.gcHeap().threadRecordAddress(address) == 0u && observation.bank->address == 0u
		&& !observation.bank->firstFrame && !observation.bank->currentFrame && observation.bank->stack.size() == 0u,
		"automatic sweeping withdraws the entire borrowed frame view before freeing the record");
	observation.rebound = true;
	observation.maxDepth = 0u;
	cpu.clearHaltUntilIrq();
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
	run();
	require(observation.maxDepth == depth && registers.get(2) == valueBool(true) && registers.get(3) == valueInteger(37),
		"the cached nodes rebind to the new physical call chain and yield normally");
	cpu.reset();
	require(observation.bank->address == 0u && !observation.bank->firstFrame, "reset also withdraws cached transfers before replacing images");
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

void weakTableAdmissionReplansAfterCollection() {
	for (const bool reuseHome : {false, true}) {
		Machine machine(image()); auto& cpu = machine.cpu; auto& heap = cpu.luaHeap();
		constexpr u32 hash = 8;
		auto weak = bmsx::test::allocateTableReference(cpu, 0, hash), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
		meta.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
		weak.setMetatableAddress(meta.address());
		auto& frame = *cpu.rootThread()->currentFrame;
		frame.registers.set(0, valueTable(weak.address()));
		frame.setTop(1);
		cpu.collectHeap();
		const i32 weakKey = reuseHome ? 3 : 2, strongKey = reuseHome ? 2 : 3, incoming = 4;
		const auto home = [](i32 key) { return hashCanonicalTableKey(valueInteger(key)) & (hash - 1u); };
		require((home(weakKey) == home(incoming)) == reuseHome, "the fixture controls the vacancy at the incoming home");
		const u32 occupant = bmsx::test::allocateTableReference(cpu).address();
		weak.setInteger(weakKey, valueTable(occupant));
		weak.setInteger(strongKey, valueInteger(strongKey));
		u32 occupiedHomes = (1u << home(weakKey)) | (1u << home(strongKey));
		for (i32 key = -1; occupiedHomes != 0xffu; --key) {
			const u32 bit = 1u << home(key);
			if ((occupiedHomes & bit) != 0u) continue;
			weak.setInteger(key, valueInteger(key));
			occupiedHomes |= bit;
		}
		require(weak.arrayCapacity() == 0 && weak.hashSlots() == hash, "distinct homes fill the existing reservation");
		const auto storage = weak.hashAddress();
		// The three positive keys would require four array slots as well as
		// the present hash; the budget has no room for that projection.
		cpu.memory().writeRamRecordWord(cpu.heapAllocator().managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET, static_cast<u32>(heap.capacity()));
		weak.setInteger(incoming, valueInteger(incoming));
		require(weak.arrayCapacity() == 0 && weak.hashSlots() == hash
			&& (weak.hashAddress() == storage) == reuseHome,
			"retry reuses the incoming home or rebuilds after replanning the surviving entries");
		require(cpu.gcHeap().tableRecordAddress(occupant) == 0u && isNil(weak.getInteger(weakKey))
			&& weak.getInteger(strongKey) == valueInteger(strongKey) && weak.getInteger(incoming) == valueInteger(incoming)
			&& heap.usedBytes() == heap.capacity() - TableRecord::HEADER_CHARGE,
			"retry charges no stale capacity and releases only the collected referent");
	}
}

void threadReplacementAdmitsOnlyItsLogicalIncrease() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& thread = *cpu.rootThread(); auto& frame = *thread.currentFrame;
	auto& heap = cpu.luaHeap(); auto& memory = cpu.memory();
	const auto before = ThreadRecord::storageLayout(memory, thread.address);
	const u32 pc = frame.readControl(FrameField::Pc);
	frame.registers.set(0, valueInteger(73)); frame.setTop(1);
	const u32 valueIncrease = (64u - before.valueCapacity) * THREAD_STACK_SLOT_BYTES;
	const u32 frameIncrease = before.frameBytes();
	u32 target = static_cast<u32>(heap.usedBytes()) + valueIncrease + frameIncrease;
	heap.setCollectionTarget(target);
	thread.reserveFrame(64);
	const auto after = ThreadRecord::storageLayout(memory, thread.address);
	require(after.block != before.block && after.frameBlock != before.frameBlock
		&& after.valueCapacity == 64u && after.frameCapacity == 2u * before.frameCapacity,
		"the entering call reserves both new lanes");
	require(heap.usedBytes() == target && heap.collectionTarget() == target && !cpu.collecting(),
		"the combined Value/frame replacement fits its exact logical increase without assisting collection");
	require(frame.readControl(FrameField::Pc) == pc && frame.registers.get(0) == valueInteger(73),
		"growth preserves the published caller and its Values");

	const auto handler = valueBuiltinFunction(BuiltinFunctionId::PCall);
	heap.setCollectionTarget(target += PROTECTED_CALL_BYTES);
	thread.pushProtectedCall(ProtectedCallKind::PCall, false, CallResultPlacement::call(0, 2), handler);
	require(ThreadRecord::storageLayout(memory, thread.address).protectedCapacity == 1, "first continuation is allocated");
	heap.setCollectionTarget(target += PROTECTED_CALL_BYTES);
	thread.pushProtectedCall(ProtectedCallKind::PCall, true, CallResultPlacement::call(1, 5), handler);
	require(ThreadRecord::storageLayout(memory, thread.address).protectedCapacity == 2 && thread.protectedDepth() == 2u
		&& thread.protectedWord(0, ProtectedField::Wanted) == 3u && thread.protectedWord(1, ProtectedField::Wanted) == 6u,
		"protected growth resizes only its lane and retains both continuations");
	require(heap.usedBytes() == target && heap.collectionTarget() == target && !cpu.collecting(),
		"protected growth admits only the one additional continuation");

	heap.setCollectionTarget(target += (128u - 64u) * THREAD_STACK_SLOT_BYTES);
	thread.resizeStack(128);
	require(heap.usedBytes() == target && heap.collectionTarget() == target && !cpu.collecting(),
		"standalone Value-window growth admits just the additional slots");
}

void fullCollectionTrimsWithoutFreeBacking() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& thread = *cpu.rootThread(); auto& arena = cpu.heapAllocator();
	auto& memory = cpu.memory(); auto& frame = *thread.currentFrame;
	cpu.luaHeap().reserveThreadFrameStorage(thread.address, 64, 8, valueNil());
	thread.bindStack();
	for (int i = 0; i < 8; ++i)
		thread.pushProtectedCall(ProtectedCallKind::PCall, false, CallResultPlacement::call(2, 1), valueBuiltinFunction(BuiltinFunctionId::PCall));
	thread.setProtectedDepth(1);
	frame.registers.set(0, valueInteger(73)); frame.setTop(1);
	const auto before = ThreadRecord::storageLayout(memory, thread.address);
	const auto pc = frame.readControl(FrameField::Pc);
	while (arena.allocate(4088, true)) {}
	while (arena.allocate(4 * PROTECTED_CALL_BYTES, true)) {}
	cpu.collectHeap();
	const auto after = ThreadRecord::storageLayout(memory, thread.address);
	require(after.block == before.block && after.frameBlock == before.frameBlock && after.protectedBlock == before.protectedBlock
		&& after.valueCapacity == 32 && after.frameCapacity == 4 && after.protectedCapacity == 4,
		"full collection halves all three reservations without a replacement chunk");
	require(frame.registers.get(0) == valueInteger(73) && frame.readControl(FrameField::Pc) == pc
		&& thread.protectedResult(0).base == 2, "the live Value, frame and protected continuation survive trimming");
	cpu.luaHeap().reserveThreadFrameStorage(thread.address, 0, 8, valueNil());
	thread.bindStack();
	for (int i = 1; i < 5; ++i)
		thread.pushProtectedCall(ProtectedCallKind::PCall, false, CallResultPlacement::call(i, 1), valueBuiltinFunction(BuiltinFunctionId::PCall));
	const auto grown = ThreadRecord::storageLayout(memory, thread.address);
	require(grown.frameBlock == before.frameBlock && grown.protectedBlock == before.protectedBlock
		&& grown.frameCapacity == 8 && grown.protectedCapacity == 8 && frame.readControl(FrameField::Pc) == pc
		&& thread.protectedResult(0).base == 2 && thread.protectedResult(4).base == 4,
		"control stacks reuse their released suffixes and preserve the active prefix");
}

void valueStackGrowsWithOnlyTheIncrementFree() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& thread = *cpu.rootThread(); auto& arena = cpu.heapAllocator();
	thread.resizeStack(1536);
	const auto base = ThreadRecord::read(cpu.memory(), thread.address, ThreadField::StackBlock);
	while (arena.allocate(4096, true)) {}
	thread.resizeStack(1024);
	require(!arena.allocate(1536 * THREAD_STACK_SLOT_BYTES, true), "no full replacement fits");
	const auto raw = valueFloatBits(0xffa12345);
	thread.stack.set(1023, raw);
	thread.resizeStack(1536);
	require(ThreadRecord::read(cpu.memory(), thread.address, ThreadField::StackBlock) == base
		&& thread.stack.get(1023) == raw && thread.stack.get(1024) == valueNil() && thread.stack.get(1535) == valueNil(),
		"growth consumes only adjacent space, moves retained tags, and clears the extension");
}

void failedThreadReplacementLeavesBothOwnedLanes() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto& thread = *cpu.rootThread(); auto& frame = *thread.currentFrame;
	auto& arena = cpu.heapAllocator(); auto& memory = cpu.memory();
	frame.registers.set(0, valueInteger(73)); frame.setTop(1);
	cpu.collectHeap();
	const auto before = ThreadRecord::storageLayout(memory, thread.address);
	const auto used = cpu.luaHeap().usedBytes();
	constexpr u32 newValues = 128u, valueBytes = newValues * THREAD_STACK_SLOT_BYTES;
	const u32 frameBytes = 2u * before.frameBytes();
	const u32 available = arena.allocate(frameBytes, true);
	require(available != 0u && arena.allocate(frameBytes, true) != 0u, "guard one control-sized chunk from coalescing");
	while (arena.allocate(4088u, true) != 0u) {}
	while (arena.allocate(frameBytes, true) != 0u) {}
	arena.free(available);
	const u32 retry = arena.allocate(frameBytes, true);
	require(retry != 0u && arena.allocate(valueBytes, true) == 0u,
		"physical pressure admits the control reservation but not the new Value stack");
	arena.free(retry);
	const auto occupied = arena.occupiedBytes();
	bool failed = false;
	try { thread.reserveFrame(newValues); }
	catch (const LuaOutOfMemorySignal&) { failed = true; }
	const auto after = ThreadRecord::storageLayout(memory, thread.address);
	require(failed && after.block == before.block && after.frameBlock == before.frameBlock
		&& after.valueCapacity == before.valueCapacity && after.frameCapacity == before.frameCapacity
		&& frame.registers.get(0) == valueInteger(73), "neither lane publishes if the second physical reservation fails");
	require(cpu.luaHeap().usedBytes() == used && arena.occupiedBytes() == occupied,
		"the failed request commits no charge and leaves no allocated destination");
}

void highRetainedPacing() {
	Machine machine(image()); auto& cpu = machine.cpu;
	auto retained = bmsx::test::allocateTableReference(cpu, 419430, 0);
	auto& frame = *cpu.rootThread()->currentFrame;
	frame.registers.set(0, valueTable(retained.address())); frame.writeControl(bmsx::FrameField::Top, 1);
	cpu.collectHeap();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto before = cpu.diagnosticGcProfile();
#endif
		int pauses = 0;
	for (int i = 0; i < 2400; ++i) {
		const auto before = cpu.instructionBudgetRemaining;
		bmsx::test::allocateTableReference(cpu, 384, 0);
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
		stringMarkWorkSurvivesCheckpoint();
		collectorWorkIgnoresInactiveThreadFrames();
		allocationAdmissionUsesLogicalBytes(); tableReplacementAdmitsOnlyItsLogicalIncrease();
		tableBackingRecoveryRetriesEachEpoch();
		physicalPressurePacesLargeLiveHeap();
		physicalReservationsPayMarkWork();
		physicalReservationsPaySweepWork(GcPhase::Sweep);
		physicalReservationsPaySweepWork(GcPhase::Strings);
		weakTableAdmissionReplansAfterCollection();
		threadReplacementAdmitsOnlyItsLogicalIncrease(); fullCollectionTrimsWithoutFreeBacking(); valueStackGrowsWithOnlyTheIncrementFree(); failedThreadReplacementLeavesBothOwnedLanes();
		scheduledLogicalRefusalParks(); refusedCensusRetriesAtIssuePc(); concatRecoveryChargesIssuingInstruction(); logicalAdmissionFailure();
		romLiteralsDoNotUseGuestRam(); replacementRetiresInstalledBindingSpan(); allActivatedImagesAndUniqueGlobals(); temporaryRootsAndUnreachablePool();
		incrementalStateAndBarriers();
		resumesRootBanksBeforeTracing(); resumesCompletionRootBank(); resumesLargeClosureCaptures(); resumesOpenThreadAfterClosingInstruction();
		resumesTableAfterPrimitiveDisplacement(); weakKeysTraceStrongValues();
		weakHashClearingOnlyMarksSurvivingStrings(); weakValuesSkipMarkingStorageWithoutStrongEdges(); incrementalSharedWeakMode();
		resumesFinalWeakCleanup(); resumesMetatableModeProbe(); resumesWeakTableRemark(); consumesSelfLinkedGrayEdge();
		secondMarkPassAndCredit(); strongWritesLeaveLargeTablesOutOfFinalRemark(false); strongWritesLeaveLargeTablesOutOfFinalRemark(true);
		automaticAssistDefersScopedRoots(); referenceExplicitAtomicOwnsOnePass();
		collectUnattachedThreadRecord(); sweepCoroutineRecord(); sweepUnselectsSuspendedTransferFrames(); stackShrinkAndAdmission(); highRetainedPacing();
		std::cout << "guest GC work tests passed\n";
		return 0;
	} catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
