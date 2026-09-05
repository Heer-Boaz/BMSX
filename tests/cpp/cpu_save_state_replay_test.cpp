#include "machine/runtime/runtime.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"

#include <array>
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
	require(warm.frames[0].registers[0].tag == bmsx::CpuValueStateTag::Nil, "static closure is no longer a guest root");
	bool captured = false;
	for (const auto& object : warm.objects) {
		if (object.kind == bmsx::CpuObjectState::Kind::Closure && object.closureCanonical && object.functionAddress == address) captured = true;
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
	const auto before = cpu.globals->captureRuntimeState();
	const auto snapshot = cpu.captureRuntimeState();
	require(cpu.globals->captureRuntimeState().hash.size() == before.hash.size(), "capture must not mutate global table storage");
	cpu.restoreRuntimeState(snapshot);
	require(cpu.globals->captureRuntimeState().hash.size() == before.hash.size(), "restore retains backing table capacity");
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
		std::cout << "CPU save-state replay tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
