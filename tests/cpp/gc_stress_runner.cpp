#include "support/gc_heap_reference.h"
#include "machine/runtime/runtime.h"
#include "machine/cpu/upvalue.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/bmsx/model.h"

#include <array>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string_view>
#include <vector>
#include <tuple>

namespace {
bool stressEnabled = false;
size_t stressedAllocations = 0;
}

namespace bmsx {
void stressHeapAllocation(LuaHeap& heap) {
	if (!stressEnabled) return;
	heap.setCollectionTarget(0);
	++stressedAllocations;
}
}

class GcStressInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

namespace {
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int runPressureStage(bmsx::CPU& cpu) {
	bmsx::test::GcHeap collector(cpu);
	int finalSteps = 0;
	for (int call = 0; call < 12000; ++call) {
		if (collector.finalMarkPending()) { collector.stepFinalMark(); ++finalSteps; continue; }
		const auto result = cpu.runUntilDepth(0, call % 3 == 0 ? 1 : call % 3 == 1 ? 17 : 2048);
		require(cpu.readExceptionReturnFrameDepth() == -1 && cpu.readLuaFaultReasonWord() == 0, "unexpected guest fault in allocation pressure fixture");
		if (result != bmsx::RunResult::Yielded) {
			require(result == bmsx::RunResult::Halted && cpu.isHaltedUntilIrq(), "the guest reaches its actual phase barrier");
			return finalSteps;
		}
	}
	throw std::runtime_error("allocation pressure fixture exceeded its bounded grants");
}

void exercisePressure(bmsx::CPU& cpu, bool compiled) {
	using namespace bmsx;
	bmsx::test::GcHeap collector(cpu);
	auto& memory = cpu.memory();
	const auto global = [&](std::string_view name) { return cpu.getGlobalByKey(*cpu.stringPool().find(name)); };
	runPressureStage(cpu);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (compiled) for (std::string_view name : {"assign", "change"}) {
		const auto prototype = cpu.readClosureBinding(valuePayload(global(name)));
		MappedPageBinding binding{};
		memory.bindMappedPage(prototype.entry.codeAddress & ~MAPPED_PAGE_BYTE_MASK, MAPPED_BUS_MASTER_CPU, binding);
		auto& page = *cpu.rootThread()->currentFrame->executionImage->decodedPages.find(binding.key);
		const u32 word = (prototype.entry.codeAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		require(page.nativeBlocks && page.nativeBlocks->entries[word], "both mutations execute a real native entry");
	}
#endif
	constexpr std::array<std::string_view, 7> names{"owner", "array_owner", "change", "read", "weak", "entries", "old_text"};
	std::array<Value, names.size()> oldValues{};
	for (size_t i = 0; i < names.size(); ++i) oldValues[i] = global(names[i]);
	const u32 cell = ClosureRecord::captureAddress(memory, valuePayload(global("change")), 0u);
	require(!Upvalue::isOpen(memory, cell), "the mutation targets an actual closed cell");
	cpu.clearHaltUntilIrq(); runPressureStage(cpu);
	const auto childKey = *cpu.stringPool().find("child"), textKey = *cpu.stringPool().find("text");
	const u32 owner = valuePayload(global("owner")), arrayOwner = valuePayload(global("array_owner"));
	const Value child = TableRecord(cpu.memory(), owner).getStringKey(childKey);
	const Value text = TableRecord(cpu.memory(), owner).getStringKey(textKey);
	const Value arrayChild = TableRecord(cpu.memory(), arrayOwner).getInteger(1), cellChild = Upvalue::load(memory, cell);
	const u32 textId = valuePayload(text);
	const auto observe = [&] {
		const int depth = cpu.getFrameDepth();
		return std::tuple{depth, cpu.readFramePc(depth - 1), global("pressure"),
			cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget(),
			collector.phase(),
			cpu.stringPool().find("pressure-retired:é😀:37")};
	};
	const auto parked = observe();
	const auto state = cpu.captureRuntimeState();
	RamHistory history; RamHistory::PageMap midPages, finalPages;
	history.capture(memory, nullptr, midPages);
	const auto verify = [&] {
		for (size_t i = 0; i < names.size(); ++i) require(global(names[i]) == oldValues[i], "retained identities remain at their original addresses");
		require(TableRecord(cpu.memory(), owner).getStringKey(childKey) == child
			&& TableRecord(cpu.memory(), owner).getStringKey(textKey) == text, "field edges retain the exact addresses");
		require(TableRecord(cpu.memory(), arrayOwner).getInteger(1) == arrayChild && Upvalue::load(memory, cell) == cellChild,
			"independent array and closed-cell edges retain their exact children");
		require(cpu.stringPool().find("pressure-live:é😀:37") == textId, "the canonical String survives in place");
		require(!cpu.stringPool().find("pressure-retired:é😀:37"), "the unreachable String is unlinked and retired");
	};
	cpu.clearHaltUntilIrq();
	require(runPressureStage(cpu) > 0, "ordinary allocation advances to scheduled final marking");
	verify();
	const auto finished = observe();
	const int remaining = cpu.instructionBudgetRemaining;
	history.capture(memory, &midPages, finalPages);
	history.restore(memory, finalPages, midPages); cpu.restoreRuntimeState(state);
	require(observe() == parked, "collector frontier, retained values and allocation target rewind together");
	cpu.clearHaltUntilIrq();
	for (int step = 0; global("pressure") == std::get<2>(parked) && step < 16; ++step)
		require(cpu.runUntilDepth(0, 2048) == RunResult::Yielded, "the uncaptured suffix has not completed");
	require(global("pressure") != std::get<2>(parked), "the uncaptured prefix writes a fresh pressure object");
	history.restore(memory, midPages, midPages); cpu.restoreRuntimeState(state);
	require(observe() == parked, "same-map seek restores the uncaptured allocation");
	cpu.clearHaltUntilIrq();
	require(runPressureStage(cpu) > 0, "rewind repeats scheduled final marking");
	verify();
	require(observe() == finished && cpu.instructionBudgetRemaining == remaining,
		"replaying the automatic collection suffix reproduces the observed heap, caller and grant remainder");
	cpu.clearHaltUntilIrq();
	require(cpu.runUntilDepth(0, 2048) == RunResult::Halted, "the final phase returns normally");
}
}

int main(int argc, char** argv) {
	try {
		if (argc != 4) throw std::runtime_error("expected ROM, scalar/native, and stress/pressure");
		const std::string_view mode = argv[3];
		if (mode != "stress" && mode != "pressure") throw std::runtime_error("invalid GC fixture mode");
		std::ifstream file(argv[1], std::ios::binary);
		if (!file) throw std::runtime_error("cannot open GC fixture");
		std::vector<bmsx::u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
		GcStressInput input;
		bmsx::Runtime runtime({rom, {}, bmsx::PSX_MACHINE_SPEC}, input);
		runtime.boot();
		auto& cpu = runtime.machine.cpu;
		if (std::string_view(argv[2]) == "scalar") {
			cpu.setExecutionHook({[](void*, bmsx::ExecutionDomainId, bmsx::u32) { return false; }, nullptr, bmsx::ALL_EXECUTION_DOMAINS_MASK, 0});
		} else {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			cpu.prepareSystemNativeCode();
#else
			throw std::runtime_error("native GC stress requires native blocks");
#endif
		}
		if (mode == "pressure") {
			exercisePressure(cpu, std::string_view(argv[2]) == "native");
			const auto values = runtime.readCompletionValues();
			require(cpu.readLuaFaultReasonWord() == 0 && values.size() == 1 && values.get(0) == bmsx::valueBool(true),
				"GC pressure fixture must complete without a fault");
			return 0;
		}

		stressEnabled = true;
		bmsx::test::GcHeap collector(cpu);
		auto result = bmsx::RunResult::Yielded;
		bool restored = false;
		for (int call = 0; call < 50000 && result == bmsx::RunResult::Yielded; ++call) {
			result = cpu.runUntilDepth(0, call % 3 == 0 ? 1 : call % 3 == 1 ? 17 : 2048);
			require(cpu.readLuaFaultReasonWord() == 0, "unexpected guest fault during GC stress");
			if (!restored && result == bmsx::RunResult::Yielded && collector.active()) {
				const auto phase = collector.phase();
				const auto depth = cpu.getFrameDepth();
				const auto pc = cpu.readFramePc(depth - 1);
				const auto ram = cpu.memory().captureSaveState();
				const auto state = cpu.captureRuntimeState();
				cpu.runUntilDepth(0, 2048);
				require(cpu.readLuaFaultReasonWord() == 0, "unexpected fault in the rewind suffix");
				require(collector.phase() != phase || cpu.getFrameDepth() != depth || cpu.readFramePc(depth - 1) != pc,
					"the live collector or program counter must advance before rewind");
				cpu.memory().restoreSaveState(ram);
				cpu.restoreRuntimeState(state);
				require(collector.phase() == phase && cpu.getFrameDepth() == depth && cpu.readFramePc(depth - 1) == pc,
					"restore must reinstate the in-flight major collection and its caller");
				restored = true;
			}
		}
		stressEnabled = false;
		const auto values = runtime.readCompletionValues();
		require(result == bmsx::RunResult::Halted && values.size() == 2
			&& values.get(0) == bmsx::valueBool(true) && values.get(1) == bmsx::valueBool(true)
			&& restored && stressedAllocations > 32, "GC stress fixture must complete after rewinding an active collection");
		std::cout << stressedAllocations << '\n';
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
