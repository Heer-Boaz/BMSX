#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"

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

	explicit SnapshotMachine(const bmsx::test::Blua32TestImage& image)
		: rom(bmsx::test::encodeBlua32TestRom(bmsx::RomImageDomain::System, image))
		, runtime(bmsx::RuntimeOptions{rom.bytes, {}, bmsx::PSX_MACHINE_SPEC}, input) {
		runtime.machine.cpu.reset();
	}
};

bmsx::test::Blua32TestImage allocationImage() {
	bmsx::test::Blua32TestImage image;
	image.text.resize(8u * bmsx::INSTRUCTION_BYTES);
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::NEWT), 0, 0, 0);
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
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto anchor = cpu.captureRuntimeState();
	const auto strings = cpu.stringPool().captureState();
	const auto anchorBytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime));
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "program completes");
	const auto values = cpu.readCompletionValues();
	const std::array expectedIds{
		bmsx::asTable(values.get(0), cpu.gcHeap())->hashId,
		bmsx::asClosure(values.get(1), cpu.gcHeap())->hashId,
		bmsx::asClosure(values.get(2), cpu.gcHeap())->hashId,
	};
	const auto expected = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime));
	for (const int budget : {1001, 2001, 4001, 8001}) {
		cpu.stringPool().restoreState(strings);
		cpu.restoreRuntimeState(anchor);
		require(bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime)) == anchorBytes, "full CPU state is restored independently of the previous grant");
		require(cpu.runUntilDepth(0, 1) == bmsx::RunResult::Yielded, "the next call consumes only its newly supplied grant");
		require(cpu.runUntilDepth(0, budget) == bmsx::RunResult::Halted, "replay completes with a fresh grant");
		const auto replay = cpu.readCompletionValues();
		require(bmsx::asTable(replay.get(0), cpu.gcHeap())->hashId == expectedIds[0], "table identity must replay");
		require(bmsx::asClosure(replay.get(1), cpu.gcHeap())->hashId == expectedIds[1], "cold canonical closure identity must replay");
		require(bmsx::asClosure(replay.get(2), cpu.gcHeap())->hashId == expectedIds[2], "dynamic closure identity must replay");
		require(bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime)) == expected, "replay reproduces every state field without normalizing a grant");
	}
}

void preserveCallerPrefixAcrossOpenResultCall() {
	for (const auto op : {bmsx::OpCode::K1, bmsx::OpCode::NEWT}) {
		bmsx::test::Blua32TestImage image;
		image.text.resize(6u * bmsx::INSTRUCTION_BYTES);
		std::span<bmsx::u8> code(image.text);
		bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(op), 0, 0, 0);
		bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
		bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 4, 0, 0);
		bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::CALL), 4, 1, 0);
		bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
		bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 0, 0);
		image.functions = {{.firstWord = 0u, .wordCount = 5u, .maxStack = 8u}, {.firstWord = 5u, .wordCount = 1u}};
		image.closureRelocations = {{2u, bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u)}};
		SnapshotMachine machine(image);
		auto& cpu = machine.runtime.machine.cpu;
		auto returnPc = machine.rom.textAddress + 4u * bmsx::INSTRUCTION_BYTES;
		cpu.setExecutionHook({
			.hook = [](void* context, bmsx::ExecutionDomainId, bmsx::u32 pc) { return pc == *static_cast<bmsx::u32*>(context); },
			.context = &returnPc,
			.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
			.preMaskableInterruptDomainMask = 0u,
		});
		require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::ExecutionStopped, "stop after zero-result CALL");
		require(cpu.getFrameRegisterCount(0) == 4, "open result top stays exact");
		if (op == bmsx::OpCode::NEWT) {
			auto* weak = cpu.createTable(1, 0);
			auto* mode = cpu.createTable(0, 1);
			mode->setStringKey(cpu.stringPool().intern("__mode"), bmsx::valueString(cpu.stringPool().intern("v")));
			weak->metatable = mode;
			weak->setInteger(1, cpu.readFrameRegister(0, 0));
			cpu.setGlobalByKey(cpu.stringPool().intern("weak"), bmsx::valueTable(cpu.gcHeap().reference(weak)));
			cpu.collectHeap();
			require(weak->getInteger(1) == cpu.readFrameRegister(0, 0), "live caller locals remain heap roots across calls");
		}
		const auto saved = cpu.captureRuntimeState();
		cpu.setExecutionHook({});
		cpu.restoreRuntimeState(saved);
		const auto restored = cpu.readFrameRegister(0, 0);
		require(op == bmsx::OpCode::K1 ? bmsx::valueIsInteger(restored) : bmsx::valueIsTable(restored),
			"snapshot preserves the caller local below its call area");
		require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "restored frame returns");
		const auto values = cpu.readCompletionValues();
		require(values.size() == 1u, "explicit RET returns its reserved register");
		if (op == bmsx::OpCode::K1) require(values.get(0) == bmsx::valueInteger(1), "numeric register survives restore");
		else require(values.get(0) == bmsx::asTable(cpu.getGlobalByKey(cpu.stringPool().intern("weak")), cpu.gcHeap())->getInteger(1), "reference identity survives restore");
	}
}

void mirroredAllocationOrder() {
	auto image = allocationImage();
	image.functions[1].staticClosure = false;
	image.functions[1].upvalues = {{true, 0u}};
	SnapshotMachine machine(image);
	auto& cpu = machine.runtime.machine.cpu;
	require(cpu.stringPool().intern("error in error handling", false) == 2u, "mirrored protected-call error string id");
	require(cpu.stringPool().intern("Attempted to get length of an unsupported value.", false) == 3u, "mirrored fault error string id");
	cpu.runUntilDepth(0, 1000);
	const auto* closure = bmsx::asClosure(cpu.readCompletionValues().get(1), cpu.gcHeap());
	require(static_cast<bmsx::Upvalue*>(cpu.gcHeap().object(closure->upvalues[0]))->hashId == closure->hashId + 1u, "closure allocation precedes its new upvalue");
}

void inspectOpenAndClosedClosure() {
	auto image = allocationImage();
	image.functions[1].staticClosure = false;
	image.functions[1].upvalues = {{true, 0u}};
	SnapshotMachine machine(image);
	auto& cpu = machine.runtime.machine.cpu;
	auto stopPc = machine.rom.textAddress + 5u * bmsx::INSTRUCTION_BYTES;
	cpu.setExecutionHook({
		.hook = [](void* context, bmsx::ExecutionDomainId, bmsx::u32 pc) { return pc == *static_cast<bmsx::u32*>(context); },
		.context = &stopPc,
		.domainMask = bmsx::SYSTEM_EXECUTION_DOMAIN_MASK,
		.preMaskableInterruptDomainMask = 0u,
	});
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::ExecutionStopped, "stop after capture, before the defining frame returns");
	const auto open = cpu.captureRuntimeState();
	const auto* closure = bmsx::asClosure(cpu.readFrameRegister(0, 1), cpu.gcHeap());
	require(static_cast<bmsx::Upvalue*>(cpu.gcHeap().object(closure->upvalues[0]))->open, "fixture capture is open");
	const auto table = cpu.readFrameRegister(0, 0);
	require(cpu.readClosureUpvalue(closure, 0) == table, "read the live defining register without calling the closure");
	const auto afterRead = cpu.captureRuntimeState();
	require(std::ranges::equal(afterRead.snapshot.words(), open.snapshot.words()), "inspection does not change the open cell or heap");
	cpu.setExecutionHook({});
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "defining frame returns normally");
	closure = bmsx::asClosure(cpu.readCompletionValues().get(1), cpu.gcHeap());
	require(!static_cast<bmsx::Upvalue*>(cpu.gcHeap().object(closure->upvalues[0]))->open, "fixture capture is closed");
	require(cpu.readClosureUpvalue(closure, 0) == table, "closed cell keeps the same value");
	cpu.restoreRuntimeState(open);
	closure = bmsx::asClosure(cpu.readFrameRegister(0, 1), cpu.gcHeap());
	require(static_cast<bmsx::Upvalue*>(cpu.gcHeap().object(closure->upvalues[0]))->open, "restore replaces the closure with its open capture");
	require(cpu.readClosureUpvalue(closure, 0) == cpu.readFrameRegister(0, 0), "restored read follows the restored frame");
}

void restoreAllocationWordWrap() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	auto state = cpu.captureRuntimeState();
	state.nextObjectHashId = 0xffffffffu;
	cpu.restoreRuntimeState(state);
	require(cpu.createTable()->hashId == 0xffffffffu, "restored allocator retains the full u32 word");
	require(cpu.createTable()->hashId == 0u, "allocation sequence wraps as a u32 word");
	require(cpu.createTable()->hashId == 1u, "wrapped sequence advances deterministically");
}

void replayWeakCollectionSchedule() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto weakKey = cpu.stringPool().intern("weak");
	auto* weak = cpu.createTable(1, 0);
	auto* metatable = cpu.createTable(0, 1);
	metatable->setStringKey(cpu.stringPool().intern("__mode"), bmsx::valueString(cpu.stringPool().intern("v")));
	weak->metatable = metatable;
	weak->setInteger(1, bmsx::valueTable(cpu.gcHeap().reference(cpu.createTable())));
	cpu.setGlobalByKey(weakKey, bmsx::valueTable(cpu.gcHeap().reference(weak)));
	for (int index = 0; index < 17; ++index) cpu.createTable(256, 0);
	const auto savedRam = cpu.memory().captureSaveState();
	const auto anchor = cpu.captureRuntimeState();
	const auto strings = cpu.stringPool().captureState();
	const auto allocateUntilCollected = [&]() {
		auto* current = bmsx::asTable(cpu.getGlobalByKey(weakKey), cpu.gcHeap());
		require(bmsx::valueIsTable(current->getInteger(1)), "restore must not collect a weak referent");
		for (int count = 1; count < 4096; ++count) {
			cpu.createTable(256, 0);
			if (bmsx::isNil(current->getInteger(1))) return count;
		}
		throw std::runtime_error("allocation did not reach the guest collection threshold");
	};
	const int expectedCount = allocateUntilCollected();
	const auto expected = cpu.captureRuntimeState();
	for (int pass = 0; pass < 3; ++pass) {
		cpu.stringPool().restoreState(strings);
		cpu.memory().restoreSaveState(savedRam);
		cpu.restoreRuntimeState(anchor);
		require(cpu.captureRuntimeState().luaHeap.trackedBytes == anchor.luaHeap.trackedBytes, "unreachable allocation debt survives restore");
		require(allocateUntilCollected() == expectedCount, "collection must happen after the same allocation");
		const auto actual = cpu.captureRuntimeState();
		require(actual.nextObjectHashId == expected.nextObjectHashId, "GC replay retains the allocator sequence");
		require(actual.luaHeap.trackedBytes == expected.luaHeap.trackedBytes, "GC recomputes actual live bytes after restore");
		require(actual.luaHeap.nextCollectionBytes == expected.luaHeap.nextCollectionBytes, "next GC threshold matches");
	}
}

void restoreUnrootedCanonicalClosure() {
	auto image = allocationImage();
	std::span<bmsx::u8> code(image.text);
	bmsx::writeInstruction(code, 0, static_cast<bmsx::u8>(bmsx::OpCode::WIDE), 0, 0, 0);
	bmsx::writeInstruction(code, 1, static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE), 0, 0, 0);
	bmsx::writeInstruction(code, 2, static_cast<bmsx::u8>(bmsx::OpCode::KNIL), 0, 0, 0);
	bmsx::writeInstruction(code, 3, static_cast<bmsx::u8>(bmsx::OpCode::NEWT), 0, 0, 0);
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 2, 0);
	const auto address = bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u);
	image.closureRelocations = {{1u, address}};
	SnapshotMachine machine(image);
	auto& cpu = machine.runtime.machine.cpu;
	const auto cold = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, bmsx::BASE_CYCLES[static_cast<bmsx::u8>(bmsx::OpCode::CLOSURE)]
		+ bmsx::BASE_CYCLES[static_cast<bmsx::u8>(bmsx::OpCode::KNIL)]);
	const auto warm = cpu.captureRuntimeState();
	require(warm.snapshot.word(warm.threads[0].stack[warm.threads[0].frames[0].stackBase]) == static_cast<bmsx::u32>(bmsx::CpuSnapshotValueTag::Nil), "static closure is no longer a guest root");
	bool captured = false;
	for (bmsx::u32 offset : warm.snapshot.objectWords()) {
		if (warm.snapshot.word(offset) == static_cast<bmsx::u32>(bmsx::CpuSnapshotObjectKind::Closure)
			&& warm.snapshot.word(offset + bmsx::SNAP_CLOSURE_CANONICAL) == 1u
			&& warm.snapshot.word(offset + bmsx::SNAP_CLOSURE_FUNCTION_ADDRESS) == address) captured = true;
	}
	require(captured, "snapshot must retain unrooted canonical cache entries");
	cpu.runUntilDepth(0, 1000);
	const auto expectedId = bmsx::asTable(cpu.readCompletionValues().get(0), cpu.gcHeap())->hashId;
	cpu.restoreRuntimeState(cold);
	cpu.restoreRuntimeState(warm);
	cpu.runUntilDepth(0, 1000);
	require(bmsx::asTable(cpu.readCompletionValues().get(0), cpu.gcHeap())->hashId == expectedId, "warm cache restore must preserve the next guest allocation identity");
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
	const auto snapshot = cpu.captureRuntimeState();
	cpu.setGlobalByKey(key, bmsx::valueInteger(99));
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
	cpu.runUntilDepth(0, 1000);
	const auto halted = cpu.captureRuntimeState();
	require(halted.hardHalted, "invalid WIDE body latches hard halt");
	cpu.restoreRuntimeState(start);
	require(!cpu.captureRuntimeState().hardHalted, "restoring before halt clears the latch");
	cpu.restoreRuntimeState(halted);
	cpu.runUntilDepth(0, 1000);
	const auto after = cpu.captureRuntimeState();
	require(after.hardHalted && after.threads[0].frames[0].pc == halted.threads[0].frames[0].pc, "restored hard halt does not execute further instructions");
}

void reuseSnapshotStorage() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("graph");
	auto* root = cpu.createTable(130, 0);
	cpu.setGlobalByKey(key, bmsx::valueTable(cpu.gcHeap().reference(root)));
	for (int index = 1; index <= 130; ++index) {
		auto* child = cpu.createTable(1, 0);
		child->hashId = 0xffffffffu;
		child->setInteger(1, bmsx::valueTable(cpu.gcHeap().reference(root)));
		root->setInteger(index, bmsx::valueTable(cpu.gcHeap().reference(child)));
	}
	const auto savedRam = cpu.memory().captureSaveState();
	const auto retained = cpu.captureRuntimeState();
	auto recycled = cpu.captureRuntimeState();
	const auto* words = recycled.snapshot.words().data();
	const auto* objects = recycled.snapshot.objectWords().data();
	const auto capacity = recycled.snapshot.capacityBytes();
	require(recycled.snapshot.objectCount() > 130, "graph exceeds initial object-index capacity");
	for (int pass = 0; pass < 4; ++pass) {
		recycled = cpu.captureRuntimeState(std::move(recycled.snapshot));
		require(recycled.snapshot.words().data() == words, "word storage is retained");
		require(recycled.snapshot.objectWords().data() == objects, "object index storage is retained");
		require(recycled.snapshot.capacityBytes() == capacity, "stable capture does not grow storage");
		require(std::ranges::equal(recycled.snapshot.words(), retained.snapshot.words()), "word state matches an independent checkpoint");
		require(std::ranges::equal(recycled.snapshot.objectWords(), retained.snapshot.objectWords()), "object index matches an independent checkpoint");
	}
	cpu.setGlobalByKey(key, bmsx::valueNil());
	cpu.collectHeap(); // Uncollected allocations are now part of incremental-GC state.
	recycled = cpu.captureRuntimeState(std::move(recycled.snapshot));
	require(recycled.snapshot.words().data() == words, "shorter capture retains word storage");
	require(recycled.snapshot.objectWords().data() == objects, "shorter capture retains object index storage");
	require(recycled.snapshot.capacityBytes() == capacity, "shorter capture retains capacity");
	require(recycled.snapshot.words().size() < retained.snapshot.words().size(), "unused words are not active state");
	require(recycled.snapshot.objectCount() < retained.snapshot.objectCount(), "unused object records are not active state");
	const auto fresh = cpu.captureRuntimeState();
	require(std::ranges::equal(recycled.snapshot.words(), fresh.snapshot.words()), "recycled storage has no stale active words");
	require(std::ranges::equal(recycled.snapshot.objectWords(), fresh.snapshot.objectWords()), "recycled index has no stale object records");
	cpu.memory().restoreSaveState(savedRam);
	cpu.restoreRuntimeState(retained);
	auto* restored = bmsx::asTable(cpu.getGlobalByKey(key), cpu.gcHeap());
	require(restored->getInteger(1) != restored->getInteger(2), "equal allocation ids do not merge snapshot identities");
	require(bmsx::asTable(restored->getInteger(130), cpu.gcHeap())->getInteger(1) == bmsx::valueTable(cpu.gcHeap().reference(restored)), "cycle survives graph growth and restore");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), retained.snapshot.words()), "the retained checkpoint remains intact");
	require(std::ranges::equal(after.snapshot.objectWords(), retained.snapshot.objectWords()), "the retained object index remains intact");
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
	auto* table = cpu.createTable(values.size(), 0);
	cpu.setGlobalByKey(key, bmsx::valueTable(cpu.gcHeap().reference(table)));
	for (size_t index = 0; index < values.size(); ++index) table->setInteger(index + 1, values[index]);
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const auto* restored = bmsx::asTable(cpu.getGlobalByKey(key), cpu.gcHeap());
	for (size_t index = 0; index < values.size(); ++index) require(restored->getInteger(index + 1) == values[index], "raw native value bits survive restore");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), state.snapshot.words()), "all primitive tags and payload words survive restore");
}

void preserveDeepGraph() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("deep");
	auto* root = cpu.createTable(1, 0);
	cpu.setGlobalByKey(key, bmsx::valueTable(cpu.gcHeap().reference(root)));
	auto* tail = root;
	for (int index = 1; index < 4096; ++index) {
		auto* child = cpu.createTable(1, 0);
		tail->setInteger(1, bmsx::valueTable(cpu.gcHeap().reference(child)));
		tail = child;
	}
	tail->setInteger(1, bmsx::valueTable(cpu.gcHeap().reference(root)));
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	auto* restored = bmsx::asTable(cpu.getGlobalByKey(key), cpu.gcHeap());
	auto* current = restored;
	for (int index = 0; index < 4096; ++index) current = bmsx::asTable(current->getInteger(1), cpu.gcHeap());
	require(current == restored, "deep cyclic graph restores every edge");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), state.snapshot.words()), "deep graph preserves every word");
	require(std::ranges::equal(after.snapshot.objectWords(), state.snapshot.objectWords()), "deep graph preserves ordinals");
}

void preserveDynamicGlobalRegisters() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto count = cpu.globalSlotCount();
	for (int index = 0; index < 257; ++index) {
		cpu.setGlobalByKey(cpu.stringPool().intern("dynamic" + std::to_string(index)), bmsx::valueInteger(index));
	}
	const auto key = cpu.stringPool().intern("held");
	auto* object = cpu.createTable(1, 0);
	object->setInteger(1, bmsx::valueInteger(42));
	cpu.setGlobalByKey(key, bmsx::valueTable(cpu.gcHeap().reference(object)));
	const auto nilKey = cpu.stringPool().intern("nil-name");
	cpu.setGlobalByKey(nilKey, bmsx::valueNil());
	cpu.collectHeap();
	const auto strings = cpu.stringPool().captureState();
	const auto ram = cpu.memory().captureSaveState();
	const auto state = cpu.captureRuntimeState();
	cpu.setGlobalByKey(key, bmsx::valueNil());
	cpu.setGlobalByKey(cpu.stringPool().intern("future"), bmsx::valueInteger(100));
	cpu.collectHeap();
	cpu.stringPool().restoreState(strings);
	cpu.memory().restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	require(cpu.globalSlotCount() == count + 259, "dynamic register membership restores exactly");
	for (int index = 0; index < 257; ++index) {
		require(cpu.getGlobalByKey(cpu.stringPool().intern("dynamic" + std::to_string(index))) == bmsx::valueInteger(index),
			"growth and restore preserve every global register");
	}
	require(bmsx::asTable(cpu.getGlobalByKey(key), cpu.gcHeap())->getInteger(1) == bmsx::valueInteger(42), "dynamic global is a heap root");
	require(cpu.stringPool().toString(nilKey) == "nil-name", "nil-valued registers retain their names");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), state.snapshot.words()), "dynamic roots retain exact snapshot words");
}

#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
void diagnosticGcPhasesDoNotBecomeMachineState() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	auto& strings = cpu.stringPool();
	const auto weakKey = strings.intern("weak");
	auto* weak = cpu.createTable(1, 0);
	auto* mode = cpu.createTable(0, 1);
	mode->setStringKey(strings.intern("__mode"), bmsx::valueString(strings.intern("v")));
	weak->metatable = mode;
	weak->setInteger(1, bmsx::valueTable(cpu.gcHeap().reference(cpu.createTable(64, 0))));
	cpu.setGlobalByKey(weakKey, bmsx::valueTable(cpu.gcHeap().reference(weak)));
	strings.intern("unrooted diagnostic text");
	const auto anchor = bmsx::captureRuntimeSaveState(machine.runtime);
	const auto before = cpu.diagnosticGcProfile();
	cpu.collectHeap();
	const auto after = cpu.diagnosticGcProfile();
	require(after.collections == before.collections + 1u, "one collection increments its lifetime counter once");
	require(bmsx::isNil(weak->getInteger(1)) && !strings.find("unrooted diagnostic text"),
		"phase measurements retain real weak cleanup and string reclamation");
	const auto phaseNanoseconds = (after.rootsNanoseconds - before.rootsNanoseconds)
		+ (after.traceNanoseconds - before.traceNanoseconds)
		+ (after.weakNanoseconds - before.weakNanoseconds)
		+ (after.sweepNanoseconds - before.sweepNanoseconds)
		+ (after.stringReclaimNanoseconds - before.stringReclaimNanoseconds);
	require(after.totalNanoseconds > before.totalNanoseconds
		&& after.totalNanoseconds - before.totalNanoseconds >= phaseNanoseconds,
		"the complete collection interval encloses every disjoint phase and final accounting");
	const auto expected = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime));
	strings.restoreState(anchor.machineState.machine.stringPool);
	cpu.restoreRuntimeState(anchor.cpuState);
	require(cpu.diagnosticGcProfile().collections == after.collections
		&& cpu.diagnosticGcProfile().totalNanoseconds == after.totalNanoseconds,
		"restore-time object retirement is not a guest collection and never rewinds host measurements");
	cpu.collectHeap();
	require(cpu.diagnosticGcProfile().collections == after.collections + 1u,
		"replayed collections accumulate rather than restoring an old profile");
	require(bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(machine.runtime)) == expected,
		"GC diagnostic history cannot change a single serialized machine byte");
	const auto preReset = cpu.diagnosticGcProfile();
	cpu.reset();
	require(cpu.diagnosticGcProfile().collections == preReset.collections + 1u
		&& cpu.diagnosticGcProfile().totalNanoseconds >= preReset.totalNanoseconds,
		"CPU reset retains profile history and counts its actual collection");
}
#endif

} // namespace

int main() {
	try {
		replayAllocationIdentities();
		preserveCallerPrefixAcrossOpenResultCall();
		mirroredAllocationOrder();
		inspectOpenAndClosedClosure();
		restoreAllocationWordWrap();
		replayWeakCollectionSchedule();
		restoreUnrootedCanonicalClosure();
		capturePreservesGlobalRegisters();
		restoreHardHalt();
		reuseSnapshotStorage();
		preserveSnapshotValueBits();
		preserveDeepGraph();
		preserveDynamicGlobalRegisters();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		diagnosticGcPhasesDoNotBecomeMachineState();
#endif
		std::cout << "CPU save-state replay tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
