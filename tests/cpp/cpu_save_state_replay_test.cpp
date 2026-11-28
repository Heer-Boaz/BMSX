#include "machine/cpu/upvalue.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"

#include <algorithm>
#include <array>
#include <limits>
#include <iostream>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class SnapshotInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

struct SnapshotMachine {
	bmsx::test::Blua32TestRom rom;
	SnapshotInput input;
	bmsx::Runtime runtime;

	explicit SnapshotMachine(const bmsx::test::Blua32TestImage& image, bmsx::u32 bssBytes = 0u)
		: rom(bmsx::test::encodeBlua32TestRom(bmsx::RomImageDomain::System, image, bssBytes))
		, runtime(bmsx::RuntimeOptions{rom.bytes, {}, bmsx::PSX_MACHINE_SPEC}, input) {
		bmsx::test::seedManagedFixture(runtime.machine.cpu, runtime.machine.executionAddressSpace);
	}
};

bmsx::test::Blua32TestImage allocationImage() {
	bmsx::test::Blua32TestImage image;
	image.text.resize(8u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 1, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 2, 0, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 4, 0);
	bmsx::writeInstruction(code, 6, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	bmsx::writeInstruction(code, 7, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	image.functions = {
		{.firstWord = 0u, .wordCount = 6u, .maxStack = 3u},
		{.firstWord = 6u, .wordCount = 1u},
		{.firstWord = 7u, .wordCount = 1u, .staticClosure = false},
	};
	image.closureRelocations = {
		{2u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u)},
		{4u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 2u)},
	};
	return image;
}

void replayAllocationIdentities() {
	auto image = allocationImage();
	image.closureRelocations[0].functionAddress = bmsx::DYNAMIC_RAM_BASE;
	constexpr auto dynamicPrototype = bmsx::DYNAMIC_RAM_BASE + bmsx::BLUA32_FUNCTION_RECORD_SIZE;
	image.closureRelocations.pop_back();
	bmsx::writeInstruction(image.text, 3, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 2, 2, 0);
	bmsx::writeInstruction(image.text, 4, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 2, 2, 0);
	SnapshotMachine machine(image, 2u * bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	auto& cpu = machine.runtime.machine.cpu;
	cpu.memory().writeBytes(dynamicPrototype, machine.rom.bytes.data() + machine.rom.functionAddresses[2] - bmsx::SYSTEM_ROM_BASE,
		bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	cpu.memory().writeBytes(bmsx::DYNAMIC_RAM_BASE, machine.rom.bytes.data() + machine.rom.functionAddresses[1] - bmsx::SYSTEM_ROM_BASE,
		bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	cpu.activeThread()->currentFrame->registers.set(0, bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address()));
	const auto anchor = cpu.captureRuntimeState();
	const auto anchorRam = cpu.memory().captureSaveState();

	const auto publishInputs = [&]() {
		bmsx::test::seedTestMappedClosure(cpu, bmsx::DYNAMIC_RAM_BASE);
		const auto dynamic = bmsx::test::seedTestMappedClosure(cpu, dynamicPrototype, false);
		cpu.activeThread()->currentFrame->registers.set(2, bmsx::valueClosure(dynamic));
	};
	const auto anchorBytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime));
	publishInputs();
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "program completes");
	const auto values = cpu.readCompletionValues();
	const std::array expectedIds{
		bmsx::valuePayload(values.get(0)),
		bmsx::valuePayload(values.get(1)),
		bmsx::valuePayload(values.get(2)),
	};
	const auto expected = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime));
	for (const int budget : {1001, 2001, 4001, 8001}) {

		cpu.memory().restoreSaveState(anchorRam);
		cpu.restoreRuntimeState(anchor);
		require(bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime)) == anchorBytes, "full CPU state is restored independently of the previous grant");
		publishInputs();
		require(cpu.runUntilDepth(0, 1) == bmsx::RunResult::Yielded, "the next call consumes only its newly supplied grant");
		require(cpu.runUntilDepth(0, budget) == bmsx::RunResult::Halted, "replay completes with a fresh grant");
		const auto replay = cpu.readCompletionValues();
		require(bmsx::valuePayload(replay.get(0)) == expectedIds[0], "table identity must replay");
		require(bmsx::valuePayload(replay.get(1)) == expectedIds[1], "cold canonical closure identity must replay");
		require(bmsx::valuePayload(replay.get(2)) == expectedIds[2], "dynamic closure identity must replay");
		require(bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime)) == expected, "replay reproduces every state field without normalizing a grant");
	}
}

void preserveCallerPrefixAcrossOpenResultCall() {
	for (const bool table : {false, true}) {
		bmsx::test::Blua32TestImage image;
		image.text.resize(6u * bmsx::INSTRUCTION_BYTES);
		std::span<bmsx::u8> code(image.text);
		bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(table ? bmsx::OpCode::MOV : bmsx::OpCode::K1), 0, 0, 0);
		bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
		bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 4, 0, 0);
		bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 4, 1, 0);
		bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
		bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
		image.functions = {{.firstWord = 0u, .wordCount = 5u, .maxStack = 8u}, {.firstWord = 5u, .wordCount = 1u}};
		image.closureRelocations = {{2u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u)}};
		SnapshotMachine machine(image);
		auto& cpu = machine.runtime.machine.cpu;
		bmsx::test::seedTestRomClosure(cpu, machine.rom.functionAddresses[1]);
		if (table) cpu.activeThread()->currentFrame->registers.set(0, bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address()));
		auto returnPc = machine.rom.textAddress + 4u * bmsx::INSTRUCTION_BYTES;
		cpu.setExecutionHook({
			.hook = [](void* context, bmsx::ExecutionDomainId, bmsx::u32 pc) { return pc == *static_cast<bmsx::u32*>(context); },
			.context = &returnPc,
			.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
			.preMaskableInterruptDomainMask = 0u,
		});
		require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::ExecutionStopped, "stop after zero-result CALL");
		require(cpu.getFrameRegisterCount(0) == 4, "open result top stays exact");
		if (table) {
			auto weak = bmsx::test::allocateTableReference(cpu, 1, 0);
			auto mode = bmsx::test::allocateTableReference(cpu, 0, 1);
			mode.setStringKey(cpu.stringPool().intern("__mode"), bmsx::valueString(cpu.stringPool().intern("v")));
			weak.setMetatableAddress(mode.address());
			weak.setInteger(1, cpu.readFrameRegister(0, 0));
			cpu.setGlobalByKey(cpu.stringPool().intern("weak"), bmsx::valueTable(weak.address()));
			bmsx::test::GcHeap(cpu).collect();
			require(weak.getInteger(1) == cpu.readFrameRegister(0, 0), "live caller locals remain heap roots across calls");
		}
		const auto saved = cpu.captureRuntimeState();
		cpu.setExecutionHook({});
		cpu.restoreRuntimeState(saved);
		const auto restored = cpu.readFrameRegister(0, 0);
		require(table ? bmsx::valueIsTable(restored) : bmsx::valueIsInteger(restored),
			"snapshot preserves the caller local below its call area");
		require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "restored frame returns");
		const auto values = cpu.readCompletionValues();
		require(values.size() == 1u, "explicit RET returns its reserved register");
		if (!table) require(values.get(0) == bmsx::valueInteger(1), "numeric register survives restore");
		else require(values.get(0) == bmsx::TableRecord(cpu.memory(), bmsx::valuePayload(cpu.getGlobalByKey(cpu.stringPool().intern("weak")))).getInteger(1), "reference identity survives restore");
	}
}

void capturesUsePhysicalRecords() {
	auto image = allocationImage();
	image.functions[1].staticClosure = false;
	image.functions[1].upvalues = {{true, 0u}};
	image.closureRelocations.clear();
	bmsx::writeInstruction(image.text, 3, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 2, 2, 0);
	bmsx::writeInstruction(image.text, 4, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 2, 2, 0);
	bmsx::writeInstruction(image.text, 1, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 1, 1, 0);
	bmsx::writeInstruction(image.text, 2, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 1, 1, 0);
	SnapshotMachine machine(image, 2u * bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	auto& cpu = machine.runtime.machine.cpu;
	auto& definition = *cpu.activeThread()->currentFrame;
	definition.registers.set(0, bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address()));
	std::array<bmsx::u32, 1> cells{};
	const auto seeded = bmsx::test::seedTestCapturedClosure(cpu, machine.rom.functionAddresses[1], cells);
	bmsx::Upvalue::bindOpen(cpu.memory(), cells[0], definition.thread->address, definition.stackBase(), 0u);
	definition.writeControl(bmsx::FrameField::OpenHead, cells[0]);
	definition.registers.set(1, bmsx::valueClosure(seeded));
	cpu.runUntilDepth(0, 1000);
	const auto closure = bmsx::test::asClosure(cpu.readCompletionValues().get(1), bmsx::test::GcHeap(cpu));
	const auto address = bmsx::ClosureRecord::captureAddress(cpu.memory(), closure, 0);
	require(address != closure && bmsx::test::GcHeap(cpu).cellRecordAddress(address) == address
		&& !bmsx::Upvalue::isOpen(cpu.memory(), address)
		&& bmsx::Upvalue::load(cpu.memory(), address) == cpu.readCompletionValues().get(0),
		"closure points to a distinct closed record retaining its table");
}

void inspectOpenAndClosedClosure() {
	auto image = allocationImage();
	image.functions[1].staticClosure = false;
	image.functions[1].upvalues = {{true, 0u}};
	image.closureRelocations.clear();
	bmsx::writeInstruction(image.text, 3, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 2, 2, 0);
	bmsx::writeInstruction(image.text, 4, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 2, 2, 0);
	bmsx::writeInstruction(image.text, 1, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 1, 1, 0);
	bmsx::writeInstruction(image.text, 2, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 1, 1, 0);
	SnapshotMachine machine(image, 2u * bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	auto& cpu = machine.runtime.machine.cpu;
	auto& definition = *cpu.activeThread()->currentFrame;
	definition.registers.set(0, bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address()));
	std::array<bmsx::u32, 1> cells{};
	const auto seeded = bmsx::test::seedTestCapturedClosure(cpu, machine.rom.functionAddresses[1], cells);
	bmsx::Upvalue::bindOpen(cpu.memory(), cells[0], definition.thread->address, definition.stackBase(), 0u);
	definition.writeControl(bmsx::FrameField::OpenHead, cells[0]);
	definition.registers.set(1, bmsx::valueClosure(seeded));
	auto stopPc = machine.rom.textAddress + 5u * bmsx::INSTRUCTION_BYTES;
	cpu.setExecutionHook({
		.hook = [](void* context, bmsx::ExecutionDomainId, bmsx::u32 pc) { return pc == *static_cast<bmsx::u32*>(context); },
		.context = &stopPc,
		.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
		.preMaskableInterruptDomainMask = 0u,
	});
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::ExecutionStopped, "stop after capture, before the defining frame returns");
	const auto open = cpu.captureRuntimeState();
	const auto openRam = cpu.memory().captureSaveState();
	auto closure = bmsx::test::asClosure(cpu.readFrameRegister(0, 1), bmsx::test::GcHeap(cpu));
	const auto capture = bmsx::ClosureRecord::captureAddress(cpu.memory(), closure, 0);
	require(bmsx::Upvalue::isOpen(cpu.memory(), capture), "fixture capture is open");
	const auto table = cpu.readFrameRegister(0, 0);
	require(cpu.readClosureUpvalue(closure, 0) == table, "read the live defining register without calling the closure");
	const auto afterRead = cpu.captureRuntimeState();
	require(afterRead == open && cpu.memory().captureSaveState().ram == openRam.ram, "inspection does not change the open cell or heap");
	cpu.setExecutionHook({});
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "defining frame returns normally");
	closure = bmsx::test::asClosure(cpu.readCompletionValues().get(1), bmsx::test::GcHeap(cpu));
	require(bmsx::ClosureRecord::captureAddress(cpu.memory(), closure, 0) == capture && !bmsx::Upvalue::isOpen(cpu.memory(), capture),
		"closing the capture preserves its address");
	require(cpu.readClosureUpvalue(closure, 0) == table, "closed cell keeps the same value");
	cpu.memory().restoreSaveState(openRam);
	cpu.restoreRuntimeState(open);
	closure = bmsx::test::asClosure(cpu.readFrameRegister(0, 1), bmsx::test::GcHeap(cpu));
	require(bmsx::ClosureRecord::captureAddress(cpu.memory(), closure, 0) == capture && bmsx::Upvalue::isOpen(cpu.memory(), capture),
		"restoring the same capture address restores its open state");
	require(cpu.readClosureUpvalue(closure, 0) == cpu.readFrameRegister(0, 0), "restored read follows the restored frame");
}

void replayWeakCollectionSchedule() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto weakKey = cpu.stringPool().intern("weak");
	auto weak = bmsx::test::allocateTableReference(cpu, 1, 0);
	auto metatable = bmsx::test::allocateTableReference(cpu, 0, 1);
	metatable.setStringKey(cpu.stringPool().intern("__mode"), bmsx::valueString(cpu.stringPool().intern("v")));
	weak.setMetatableAddress(metatable.address());
	weak.setInteger(1, bmsx::valueTable(bmsx::test::allocateTableReference(cpu).address()));
	cpu.setGlobalByKey(weakKey, bmsx::valueTable(weak.address()));
	for (int index = 0; index < 17; ++index) bmsx::test::allocateTableReference(cpu, 256, 0);
	const auto savedRam = cpu.memory().captureSaveState();
	const auto anchor = cpu.captureRuntimeState();
	const auto anchorBytes = cpu.luaHeap().usedBytes();

	const auto allocateUntilCollected = [&]() {
		auto current = bmsx::TableRecord(cpu.memory(), bmsx::valuePayload(cpu.getGlobalByKey(weakKey)));
		require(bmsx::valueIsTable(current.getInteger(1)), "restore must not collect a weak referent");
		for (int count = 1; count < 4096; ++count) {
			bmsx::test::allocateTableReference(cpu, 256, 0);
			if (bmsx::isNil(current.getInteger(1))) return count;
		}
		throw std::runtime_error("allocation did not reach the guest collection threshold");
	};
	const int expectedCount = allocateUntilCollected();
	const auto expected = cpu.captureRuntimeState();
	const auto expectedRam = cpu.memory().captureSaveState();
	const auto expectedBytes = cpu.luaHeap().usedBytes();
	const auto expectedTarget = cpu.luaHeap().collectionTarget();
	for (int pass = 0; pass < 3; ++pass) {

		cpu.memory().restoreSaveState(savedRam);
		cpu.restoreRuntimeState(anchor);
		require(cpu.luaHeap().usedBytes() == anchorBytes, "unreachable allocation debt survives restore");
		require(allocateUntilCollected() == expectedCount, "collection must happen after the same allocation");
		const auto actual = cpu.captureRuntimeState();
		require(actual == expected && cpu.memory().captureSaveState().ram == expectedRam.ram, "GC replay retains allocator state and every RAM record");
		require(cpu.luaHeap().usedBytes() == expectedBytes, "GC recomputes actual live bytes after restore");
		require(cpu.luaHeap().collectionTarget() == expectedTarget, "next GC threshold matches");
	}
}

void restoreUnrootedCanonicalClosure() {
	auto image = allocationImage();
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::KNIL), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::MOV), 0, 0, 0);
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	constexpr auto address = bmsx::DYNAMIC_RAM_BASE;
	constexpr auto dynamicPrototype = address + bmsx::BLUA32_FUNCTION_RECORD_SIZE;
	image.closureRelocations = {{1u, address}};
	SnapshotMachine machine(image, 2u * bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	auto& cpu = machine.runtime.machine.cpu;
	cpu.memory().writeBytes(dynamicPrototype, machine.rom.bytes.data() + machine.rom.functionAddresses[2] - bmsx::SYSTEM_ROM_BASE,
		bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	cpu.memory().writeBytes(address, machine.rom.bytes.data() + machine.rom.functionAddresses[1] - bmsx::SYSTEM_ROM_BASE,
		bmsx::BLUA32_FUNCTION_RECORD_SIZE);
	const auto cold = cpu.captureRuntimeState();
	const auto coldRam = cpu.memory().captureSaveState();
	bmsx::test::seedTestMappedClosure(cpu, address);
	cpu.runUntilDepth(0, bmsx::BASE_CYCLES[static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE)]
		+ bmsx::BASE_CYCLES[static_cast<bmsx::u8>(bmsx::OpCode::KNIL)]);
	const auto warm = cpu.captureRuntimeState();
	const auto warmRam = cpu.memory().captureSaveState();
	require(cpu.readFrameRegister(0, 0) == bmsx::valueNil(), "static closure is no longer a guest root");
	struct Probe { bmsx::Memory& memory; bmsx::u32 function; bmsx::u32 record = 0; } probe{cpu.memory(), address};
	bmsx::test::GcHeap(cpu).visitObjectRecords(&probe, [](void* context, bmsx::u32 record) {
		auto& probe = *static_cast<Probe*>(context);
		if (probe.memory.readRamRecordByte(record) == static_cast<bmsx::u8>(bmsx::ValueTag::Closure)
			&& probe.memory.readRamRecordWord(record + bmsx::CLOSURE_PROTOTYPE_ADDRESS) == probe.function)
			probe.record = record;
	});
	require(probe.record != 0u, "unrooted canonical closure is still physically allocated");
	const auto supplyDynamic = [&]() {
		const auto record = bmsx::test::seedTestMappedClosure(cpu, dynamicPrototype, false);
		cpu.activeThread()->currentFrame->registers.set(0, bmsx::valueClosure(record));
	};
	supplyDynamic();
	cpu.runUntilDepth(0, 1000);
	const auto expectedId = bmsx::valuePayload(cpu.readCompletionValues().get(0));
	cpu.memory().restoreSaveState(coldRam);
	cpu.restoreRuntimeState(cold);
	cpu.memory().restoreSaveState(warmRam);
	cpu.restoreRuntimeState(warm);
	require(bmsx::test::GcHeap(cpu).closureRecordAddress(probe.record) == probe.record, "restore retains the physical canonical record without a host object list");
	supplyDynamic();
	cpu.runUntilDepth(0, 1000);
	require(bmsx::valuePayload(cpu.readCompletionValues().get(0)) == expectedId, "warm cache restore must preserve the next guest allocation identity");

	cpu.memory().restoreSaveState(warmRam);
	cpu.restoreRuntimeState(warm);
	while (bmsx::test::GcHeap(cpu).phase() != bmsx::test::GcPhase::Sweep) bmsx::test::GcHeap(cpu).step(bmsx::valueNil(), bmsx::valueNil(), bmsx::valueNil());
	require(bmsx::test::GcHeap(cpu).sweepGarbage(probe.record),
		"fixture has a physically allocated but retired canonical closure");
	const auto sweep = cpu.captureRuntimeState();
	const auto sweepRam = cpu.memory().captureSaveState();
	const auto build = [&] {
		bmsx::test::seedTestMappedClosure(cpu, address);
		cpu.writeFrameExecution(0, bmsx::SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		cpu.runUntilDepth(0, bmsx::BASE_CYCLES[static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE)]);
		return bmsx::valuePayload(cpu.readFrameRegister(0, 0));
	};
	const auto replacement = build();
	require(replacement != probe.record, "interrupted sweep does not reuse a retired closure before freeing its storage");
	cpu.memory().restoreSaveState(sweepRam);
	cpu.restoreRuntimeState(sweep);
	require(build() == replacement, "restoring the in-flight sweep does not republish an already retired closure");
}

void capturePreservesGlobalRegisters() {
	auto image = allocationImage();
	image.globalNames = {"answer"};
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::K1), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::SETGL), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
	image.closureRelocations.clear();
	SnapshotMachine machine(image);
	auto& cpu = machine.runtime.machine.cpu;
	cpu.runUntilDepth(0, 1000);
	const auto key = cpu.stringPool().intern("answer");
	require(cpu.getGlobalByKey(key) == bmsx::valueInteger(1), "SETGL writes the named owner");
	const auto ram = cpu.memory().captureSaveState();
	const auto snapshot = cpu.captureRuntimeState();
	cpu.setGlobalByKey(key, bmsx::valueInteger(99));
	cpu.memory().restoreSaveState(ram);
	cpu.restoreRuntimeState(snapshot);
	require(cpu.getGlobalByKey(key) == bmsx::valueInteger(1), "restore retains the authoritative register value");
}

void restoreHardHalt() {
	auto image = allocationImage();
	image.closureRelocations.clear();
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	SnapshotMachine machine(image);
	auto& cpu = machine.runtime.machine.cpu;
	const auto start = cpu.captureRuntimeState();
	const auto startRam = cpu.memory().captureSaveState();
	cpu.runUntilDepth(0, 1000);
	const auto halted = cpu.captureRuntimeState();
	const auto haltedRam = cpu.memory().captureSaveState();
	const auto haltedPc = cpu.readFramePc(0);
	require(halted.hardHalted, "invalid WIDE body latches hard halt");
	cpu.memory().restoreSaveState(startRam);
	cpu.restoreRuntimeState(start);
	require(!cpu.captureRuntimeState().hardHalted, "restoring before halt clears the latch");
	cpu.memory().restoreSaveState(haltedRam);
	cpu.restoreRuntimeState(halted);
	cpu.runUntilDepth(0, 1000);
	const auto after = cpu.captureRuntimeState();
	require(after.hardHalted && cpu.readFramePc(0) == haltedPc, "restored hard halt does not execute further instructions");
}

void saveLayoutDoesNotScaleWithHeapObjects() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("graph");
	cpu.setGlobalByKey(key, bmsx::valueNil()); // Keep the same global-bank extent.
	const size_t emptySize = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime)).size();
	auto root = bmsx::test::allocateTableReference(cpu, 1024, 0);
	const auto rootValue = bmsx::valueTable(root.address());
	cpu.setGlobalByKey(key, rootValue);
	for (int index = 1; index <= 1024; ++index) {
		auto child = bmsx::test::allocateTableReference(cpu, 1, 0);
		child.setInteger(1, rootValue);
		root.setInteger(index, bmsx::valueTable(child.address()));
	}
	const auto saved = bmsx::captureRuntimeSaveState(machine.runtime);
	const auto bytes = bmsx::encodeRuntimeSaveState(saved);
	require(bytes.size() == emptySize, "hundreds of additional guest objects add no serialized attachment bytes");
	SnapshotMachine other(allocationImage());
	bmsx::applyRuntimeSaveState(other.runtime, bmsx::decodeRuntimeSaveState(bytes, bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes));
	auto& restoredCpu = other.runtime.machine.cpu;
	auto restored = bmsx::TableRecord(restoredCpu.memory(), bmsx::valuePayload(restoredCpu.getGlobalByKey(key)));
	require(restored.address() == root.address() && restored.getInteger(1) != restored.getInteger(2),
		"different physical blocks keep separate identities in a fresh runtime");
	require(bmsx::TableRecord(restoredCpu.memory(), bmsx::valuePayload(restored.getInteger(1024))).getInteger(1) == rootValue,
		"cycle survives via the restored guest bytes alone");
	require(restoredCpu.captureRuntimeState() == saved.cpuState
		&& restoredCpu.memory().captureSaveState().ram == saved.ram,
		"rebuilding attachments does not mutate any saved CPU latch or RAM byte");
}

void preserveSnapshotValueBits() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("values");
	const std::array values{
		bmsx::valueInteger(0), bmsx::valueInteger(INT32_MIN), bmsx::valueInteger(INT32_MAX),
		bmsx::valueFloatBits(0x80000000u), bmsx::valueFloat(0.0f), bmsx::valueFloat(1.25f),
		bmsx::valueFloatBits(0xffc12345u), bmsx::valueFloatBits(0x7f800001u),
		bmsx::valueFloatBits(0x7f800000u), bmsx::valueFloatBits(0xff800000u),
		bmsx::valueFloatBits(1u), bmsx::valueFloatBits(0x7f7fffffu),
		bmsx::valueBool(false), bmsx::valueBool(true),
		bmsx::valueString(cpu.stringPool().intern("saved")),
		cpu.createBuiltinFunction(bmsx::BuiltinFunctionId::Next), bmsx::valueNil(),
	};
	auto table = bmsx::test::allocateTableReference(cpu, values.size(), 0);
	cpu.setGlobalByKey(key, bmsx::valueTable(table.address()));
	for (size_t index = 0; index < values.size(); ++index) table.setInteger(index + 1, values[index]);
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const auto restored = bmsx::TableRecord(cpu.memory(), bmsx::valuePayload(cpu.getGlobalByKey(key)));
	for (size_t index = 0; index < values.size(); ++index) require(restored.getInteger(index + 1) == values[index], "raw native value bits survive restore");
	const auto after = cpu.captureRuntimeState();
	require(after == state, "all primitive tags and payload words survive restore");
}

void preserveDeepGraph() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("deep");
	auto root = bmsx::test::allocateTableReference(cpu, 1, 0);
	cpu.setGlobalByKey(key, bmsx::valueTable(root.address()));
	bmsx::u32 tail = root.address();
	const bmsx::test::GcHeap heap(cpu);
	for (int index = 1; index < 4096; ++index) {
		auto child = bmsx::test::allocateTableReference(cpu, 1, 0);
		bmsx::test::NativeTableReference(heap, tail).setInteger(1, bmsx::valueTable(child.address()));
		tail = child.address();
	}
	bmsx::test::NativeTableReference(heap, tail).setInteger(1, bmsx::valueTable(root.address()));
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	auto restored = bmsx::TableRecord(cpu.memory(), bmsx::valuePayload(cpu.getGlobalByKey(key)));
	auto current = restored;
	for (int index = 0; index < 4096; ++index) current = bmsx::TableRecord(cpu.memory(), bmsx::valuePayload(current.getInteger(1)));
	require(current.address() == restored.address(), "deep cyclic graph restores every edge");
	const auto after = cpu.captureRuntimeState();
	require(after == state, "deep graph preserves every word");
}

void preserveDynamicGlobalRegisters() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto count = cpu.globalSlotCount();
	const auto capacity = cpu.heapAllocator().managementOffset() + bmsx::GLOBAL_BANK_OFFSET + static_cast<bmsx::u32>(bmsx::GlobalBankField::Capacity);
	bool grewBank = false;
	for (int index = 0; index < 257; ++index) {
		const auto key = cpu.stringPool().intern("dynamic" + std::to_string(index));
		const auto logical = cpu.luaHeap().usedBytes();
		const auto physical = cpu.heapAllocator().occupiedBytes();
		const auto previous = cpu.memory().readRamRecordWord(capacity);
		cpu.setGlobalByKey(key, bmsx::valueInteger(index));
		require(cpu.luaHeap().usedBytes() == logical + 9u, "every newly registered name costs nine bytes");
		if (cpu.memory().readRamRecordWord(capacity) != previous) {
			grewBank = true;
			require(cpu.heapAllocator().occupiedBytes() > physical, "the physical index reserve grows separately");
		} else require(cpu.heapAllocator().occupiedBytes() == physical, "growing membership need not grow the reserve");
	}
	require(grewBank, "the names cross an actual capacity boundary");
	const auto key = cpu.stringPool().intern("held");
	auto object = bmsx::test::allocateTableReference(cpu, 1, 0);
	object.setInteger(1, bmsx::valueInteger(42));
	cpu.setGlobalByKey(key, bmsx::valueTable(object.address()));
	const auto nilKey = cpu.stringPool().intern("nil-name");
	cpu.setGlobalByKey(nilKey, bmsx::valueNil());
	bmsx::test::GcHeap(cpu).collect();

	const auto ram = cpu.memory().captureSaveState();
	const auto state = cpu.captureRuntimeState();
	const auto usage = cpu.luaHeap().usedBytes();
	cpu.setGlobalByKey(key, bmsx::valueNil());
	cpu.setGlobalByKey(cpu.stringPool().intern("future"), bmsx::valueInteger(100));
	bmsx::test::GcHeap(cpu).collect();

	cpu.memory().restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(cpu.luaHeap().usedBytes() == usage, "restore retains logical occupancy, not capacity-derived accounting");
	require(cpu.globalSlotCount() == count + 259, "dynamic register membership restores exactly");
	for (int index = 0; index < 257; ++index) {
		require(cpu.getGlobalByKey(cpu.stringPool().intern("dynamic" + std::to_string(index))) == bmsx::valueInteger(index),
			"growth and restore preserve every global register");
	}
	require(bmsx::TableRecord(cpu.memory(), bmsx::valuePayload(cpu.getGlobalByKey(key))).getInteger(1) == bmsx::valueInteger(42), "dynamic global is a heap root");
	require(cpu.stringPool().toString(nilKey) == "nil-name", "nil-valued registers retain their names");
	const auto after = cpu.captureRuntimeState();
	require(after == state, "dynamic roots retain exact snapshot words");
}

} // namespace

int main() {
	try {
		replayAllocationIdentities();
		preserveCallerPrefixAcrossOpenResultCall();
		capturesUsePhysicalRecords();
		inspectOpenAndClosedClosure();
		replayWeakCollectionSchedule();
		restoreUnrootedCanonicalClosure();
		capturePreservesGlobalRegisters();
		restoreHardHalt();
		saveLayoutDoesNotScaleWithHeapObjects();
		preserveSnapshotValueBits();
		preserveDeepGraph();
		preserveDynamicGlobalRegisters();
		std::cout << "CPU save-state replay tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
