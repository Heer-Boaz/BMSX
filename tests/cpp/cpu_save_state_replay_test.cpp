#include "machine/runtime/runtime.h"
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
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
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
	bmsx::writeInstruction(code, 5, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 3, 0);
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
	require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "program completes");
	const auto values = cpu.readCompletionValues();
	const std::array expectedIds{
		bmsx::asTable(values[0])->hashId,
		bmsx::asClosure(values[1])->hashId,
		bmsx::asClosure(values[2])->hashId,
	};
	const auto expected = cpu.captureRuntimeState();
	for (int pass = 0; pass < 4; ++pass) {
		cpu.stringPool().restoreState(strings);
		cpu.restoreRuntimeState(anchor);
		require(cpu.captureRuntimeState().nextObjectHashId == anchor.nextObjectHashId, "allocator sequence is restored");
		require(cpu.runUntilDepth(0, 1000) == bmsx::RunResult::Halted, "replay completes");
		const auto replay = cpu.readCompletionValues();
		require(bmsx::asTable(replay[0])->hashId == expectedIds[0], "table identity must replay");
		require(bmsx::asClosure(replay[1])->hashId == expectedIds[1], "cold canonical closure identity must replay");
		require(bmsx::asClosure(replay[2])->hashId == expectedIds[2], "dynamic closure identity must replay");
		const auto actual = cpu.captureRuntimeState();
		require(actual.nextObjectHashId == expected.nextObjectHashId, "next allocation matches");
		require(actual.luaHeap.trackedBytes == expected.luaHeap.trackedBytes, "replay heap accounting matches");
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
	const auto* closure = bmsx::asClosure(cpu.readCompletionValues()[1]);
	require(closure->upvalues[0]->hashId == closure->hashId + 1u, "closure allocation precedes its new upvalue");
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
	weak->setInteger(1, bmsx::valueTable(cpu.createTable()));
	cpu.globals->setStringKey(weakKey, bmsx::valueTable(weak));
	for (int index = 0; index < 17; ++index) cpu.createTable(256, 0);
	const auto anchor = cpu.captureRuntimeState();
	const auto strings = cpu.stringPool().captureState();
	const auto allocateUntilCollected = [&]() {
		auto* current = bmsx::asTable(cpu.globals->getStringKey(weakKey));
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
	bmsx::writeInstruction(code, 4, static_cast<bmsx::u8>(bmsx::OpCode::RET), 0, 1, 0);
	const auto address = bmsx::test::blua32TestFunctionAddress(bmsx::RomImageDomain::System, 1u);
	image.closureRelocations = {{1u, address}};
	SnapshotMachine machine(image);
	auto& cpu = machine.runtime.machine.cpu;
	const auto cold = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, 2);
	const auto warm = cpu.captureRuntimeState();
	require(warm.snapshot.word(warm.frames[0].registers[0]) == static_cast<bmsx::u32>(bmsx::CpuSnapshotValueTag::Nil), "static closure is no longer a guest root");
	bool captured = false;
	for (bmsx::u32 offset : warm.snapshot.objectWords()) {
		if (warm.snapshot.word(offset) == static_cast<bmsx::u32>(bmsx::CpuSnapshotObjectKind::Closure)
			&& warm.snapshot.word(offset + bmsx::SNAP_CLOSURE_CANONICAL) == 1u
			&& warm.snapshot.word(offset + bmsx::SNAP_CLOSURE_FUNCTION_ADDRESS) == address) captured = true;
	}
	require(captured, "snapshot must retain unrooted canonical cache entries");
	cpu.runUntilDepth(0, 1000);
	const auto expectedId = bmsx::asTable(cpu.readCompletionValues()[0])->hashId;
	cpu.restoreRuntimeState(cold);
	cpu.restoreRuntimeState(warm);
	cpu.runUntilDepth(0, 1000);
	require(bmsx::asTable(cpu.readCompletionValues()[0])->hashId == expectedId, "warm cache restore must preserve the next guest allocation identity");
}

void captureDoesNotSynchronizeGlobals() {
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
	require(bmsx::isNil(cpu.globals->getStringKey(key)), "backing table starts without the registerfile write");
	const auto snapshot = cpu.captureRuntimeState();
	require(bmsx::isNil(cpu.globals->getStringKey(key)), "capture must not mutate global table storage");
	cpu.restoreRuntimeState(snapshot);
	require(bmsx::isNil(cpu.globals->getStringKey(key)), "restore keeps the backing table independent of the registerfile");
	require(bmsx::asNumber(cpu.getGlobalByKey(cpu.stringPool().intern("answer"))) == 1.0, "restore retains the newer registerfile value independently");
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
	require(after.hardHalted && after.frames[0].pc == halted.frames[0].pc, "restored hard halt does not execute further instructions");
}

void reuseSnapshotStorage() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("graph");
	auto* root = cpu.createTable(130, 0);
	cpu.globals->setStringKey(key, bmsx::valueTable(root));
	for (int index = 1; index <= 130; ++index) {
		auto* child = cpu.createTable(1, 0);
		child->hashId = 0xffffffffu;
		child->setInteger(1, bmsx::valueTable(root));
		root->setInteger(index, bmsx::valueTable(child));
	}
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
	cpu.globals->setStringKey(key, bmsx::valueNil());
	recycled = cpu.captureRuntimeState(std::move(recycled.snapshot));
	require(recycled.snapshot.words().data() == words, "shorter capture retains word storage");
	require(recycled.snapshot.objectWords().data() == objects, "shorter capture retains object index storage");
	require(recycled.snapshot.capacityBytes() == capacity, "shorter capture retains capacity");
	require(recycled.snapshot.words().size() < retained.snapshot.words().size(), "unused words are not active state");
	require(recycled.snapshot.objectCount() < retained.snapshot.objectCount(), "unused object records are not active state");
	const auto fresh = cpu.captureRuntimeState();
	require(std::ranges::equal(recycled.snapshot.words(), fresh.snapshot.words()), "recycled storage has no stale active words");
	require(std::ranges::equal(recycled.snapshot.objectWords(), fresh.snapshot.objectWords()), "recycled index has no stale object records");
	cpu.restoreRuntimeState(retained);
	auto* restored = bmsx::asTable(cpu.globals->getStringKey(key));
	require(restored->getInteger(1) != restored->getInteger(2), "equal allocation ids do not merge snapshot identities");
	require(bmsx::asTable(restored->getInteger(130))->getInteger(1) == bmsx::valueTable(restored), "cycle survives graph growth and restore");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), retained.snapshot.words()), "the retained checkpoint remains intact");
	require(std::ranges::equal(after.snapshot.objectWords(), retained.snapshot.objectWords()), "the retained object index remains intact");
}

void preserveSnapshotValueBits() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("values");
	const std::array values{
		bmsx::valueNumber(-0.0), bmsx::valueNumber(0.0), bmsx::valueNumber(1.25),
		bmsx::valueNumber(std::numeric_limits<double>::quiet_NaN()),
		bmsx::valueNumber(std::numeric_limits<double>::infinity()),
		bmsx::valueNumber(-std::numeric_limits<double>::infinity()),
		bmsx::valueNumber(std::numeric_limits<double>::denorm_min()),
		bmsx::valueNumber(std::numeric_limits<double>::max()),
		bmsx::valueBool(false), bmsx::valueBool(true),
		bmsx::valueString(cpu.stringPool().intern("saved")),
		cpu.createBuiltinFunction(bmsx::BuiltinFunctionId::Next), bmsx::valueNil(),
	};
	auto* table = cpu.createTable(values.size(), 0);
	cpu.globals->setStringKey(key, bmsx::valueTable(table));
	for (size_t index = 0; index < values.size(); ++index) table->setInteger(index + 1, values[index]);
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const auto* restored = bmsx::asTable(cpu.globals->getStringKey(key));
	for (size_t index = 0; index < values.size(); ++index) require(restored->getInteger(index + 1) == values[index], "raw native value bits survive restore");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), state.snapshot.words()), "all primitive tags and payload words survive restore");
}

void preserveDeepGraph() {
	SnapshotMachine machine(allocationImage());
	auto& cpu = machine.runtime.machine.cpu;
	const auto key = cpu.stringPool().intern("deep");
	auto* root = cpu.createTable(1, 0);
	cpu.globals->setStringKey(key, bmsx::valueTable(root));
	auto* tail = root;
	for (int index = 1; index < 4096; ++index) {
		auto* child = cpu.createTable(1, 0);
		tail->setInteger(1, bmsx::valueTable(child));
		tail = child;
	}
	tail->setInteger(1, bmsx::valueTable(root));
	const auto state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	auto* restored = bmsx::asTable(cpu.globals->getStringKey(key));
	auto* current = restored;
	for (int index = 0; index < 4096; ++index) current = bmsx::asTable(current->getInteger(1));
	require(current == restored, "deep cyclic graph restores every edge");
	const auto after = cpu.captureRuntimeState();
	require(std::ranges::equal(after.snapshot.words(), state.snapshot.words()), "deep graph preserves every word");
	require(std::ranges::equal(after.snapshot.objectWords(), state.snapshot.objectWords()), "deep graph preserves ordinals");
}

} // namespace

int main() {
	try {
		replayAllocationIdentities();
		mirroredAllocationOrder();
		restoreAllocationWordWrap();
		replayWeakCollectionSchedule();
		restoreUnrootedCanonicalClosure();
		captureDoesNotSynchronizeGlobals();
		restoreHardHalt();
		reuseSnapshotStorage();
		preserveSnapshotValueBits();
		preserveDeepGraph();
		std::cout << "CPU save-state replay tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
