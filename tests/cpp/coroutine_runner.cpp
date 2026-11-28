#include <tuple>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string_view>
#include <unordered_set>
#include "support/string_pool_reference.h"
#include "machine/cpu/thread_record.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/history/ram_history.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/cpu_execution_budget.h"
#include "support/global_bank_reference.h"

using bmsx::test::NativeGlobalBankReference;

class CoroutineInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

static void exerciseCompletionBoundary(bmsx::CPU& cpu, bool fault) {
	if (bmsx::test::runCpuWithinBudget(cpu, 500000) != bmsx::RunResult::Halted || !cpu.isHaltedUntilIrq())
		throw std::runtime_error("completion fixture did not HALT");
	const bmsx::u32 thread = cpu.activeThread()->address;
	const int depth = cpu.getFrameDepth();
	const auto interruptedFrame = [&] {
		const auto layout = bmsx::ThreadRecord::storageLayout(cpu.memory(), thread);
		const auto address = layout.frameAddress(depth - 1);
		return std::tuple{
			cpu.memory().readRamRecordWord(address + static_cast<bmsx::u32>(bmsx::FrameField::Function)),
			cpu.memory().readRamRecordWord(address + static_cast<bmsx::u32>(bmsx::FrameField::Pc)),
		};
	};
	const auto interrupted = interruptedFrame();
	cpu.beginCompletionCall(bmsx::test::asClosure(NativeGlobalBankReference::getGlobalByKey(cpu, bmsx::test::StringPoolReference(cpu).intern("probe")), bmsx::test::GcHeap(cpu)));
	for (int grant = 0; grant < 10000 && cpu.completionCallPending(); ++grant) {
		cpu.runUntilDepth(depth, 1, thread);
		if (fault && cpu.fixedInterruptActive() && cpu.readCauseWord() == bmsx::CPU_CAUSE_CODE_TRAP) break;
	}
	if (bmsx::ThreadRecord::read(cpu.memory(), thread, bmsx::ThreadField::Status) != static_cast<bmsx::u32>(bmsx::ThreadStatus::Running)
		|| interruptedFrame() != interrupted) throw std::runtime_error("completion changed interrupted coroutine frame");
	if (fault) {
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() != bmsx::CPU_CAUSE_CODE_TRAP || !cpu.completionCallPending()
			|| cpu.memory().readRamRecordWord(bmsx::CPU_INTERRUPTED_CONTEXT_ADDRESS) != thread)
			throw std::runtime_error("completion fault did not retain its physical root");
	} else {
		const auto values = cpu.readCompletionValues();
		if (cpu.activeThread()->address != thread || cpu.readExceptionReturnFrameDepth() != -1
			|| cpu.completionCallPending() || cpu.getFrameDepth() != depth
			|| values.size() != 1 || values.get(0) != bmsx::valueBool(true)) throw std::runtime_error("nested completion pcall/coroutine failed");
	}
}

static void exerciseNestedHistory(bmsx::Runtime& runtime) {
	using namespace bmsx;
	auto& cpu = runtime.machine.cpu;
	auto& memory = runtime.machine.memory;
	const u32 root = cpu.rootThread()->address;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	cpu.setNativeCompilationProfiling(true);
	cpu.prepareSystemNativeCode();
	if (cpu.readNativeCompilationProfile().entriesPublished == 0) throw std::runtime_error("nested history has no prepared native entries");
#endif
	RamHistory history;
	RamHistory::PageMap initialPages, midPages, finalPages;
	history.capture(memory, nullptr, initialPages);
	const auto marker = *bmsx::test::StringPoolReference(cpu).find("nested_progress");
	const auto observe = [&] {
		const int depth = cpu.getFrameDepth();
		return std::tuple{cpu.activeThread()->address, depth, depth == 0 ? 0u : cpu.readFramePc(depth - 1),
			NativeGlobalBankReference::getGlobalByKey(cpu, marker)};
	};
	int grants = 0;
	const auto step = [&] {
		const auto result = cpu.runUntilDepth(0, 257);
		if (cpu.readLuaFaultReasonWord() != 0 || ++grants >= 40000) throw std::runtime_error("nested history failed to progress");
		return result;
	};
	std::unordered_set<u32> threads;
	auto result = RunResult::Yielded;
	while (result == RunResult::Yielded && threads.size() < 3) {
		result = step();
		if (cpu.activeThread()->address != root && !cpu.fixedInterruptActive() && cpu.getFrameDepth() != 0)
			threads.insert(cpu.activeThread()->address);
	}
	if (result != RunResult::Yielded || threads.size() != 3 || cpu.activeThread()->address == root)
		throw std::runtime_error("all three coroutine banks must execute before the first restore");
	const auto middle = observe();
	RuntimeSaveState midState, finalState;
	captureRuntimeCheckpointState(runtime, midState);
	history.capture(memory, &initialPages, midPages);

	const auto finish = [&] {
		while (result == RunResult::Yielded) result = step();
		const auto values = runtime.readCompletionValues();
		if (result != RunResult::Halted || cpu.activeThread()->address != root || cpu.activeThread()->status() != ThreadStatus::Running
			|| cpu.getFrameDepth() != 0 || values.size() != 1 || values.get(0) != valueBool(true))
			throw std::runtime_error("nested history must finish in the root thread");
	};
	finish();
	const int remaining = cpu.instructionBudgetRemaining;
	const auto final = observe();
	captureRuntimeCheckpointState(runtime, finalState);
	history.capture(memory, &midPages, finalPages);

	history.restore(memory, finalPages, midPages);
	applyRuntimeCheckpointState(runtime, midState, RuntimeRestoreOrigin::HistorySeek);
	if (observe() != middle) throw std::runtime_error("rewind must reinstate the active child bank");
	history.restore(memory, midPages, finalPages);
	applyRuntimeCheckpointState(runtime, finalState, RuntimeRestoreOrigin::HistorySeek);
	if (observe() != final) throw std::runtime_error("forward restore must reinstate root completion");

	history.restore(memory, finalPages, midPages);
	applyRuntimeCheckpointState(runtime, midState, RuntimeRestoreOrigin::HistorySeek);
	do { result = step(); } while (result == RunResult::Yielded && NativeGlobalBankReference::getGlobalByKey(cpu, marker) == std::get<3>(middle));
	if (result != RunResult::Yielded) throw std::runtime_error("the uncaptured prefix must write the guest marker");
	history.restore(memory, midPages, midPages);
	applyRuntimeCheckpointState(runtime, midState, RuntimeRestoreOrigin::HistorySeek);
	if (observe() != middle) throw std::runtime_error("same-map rewind must restore the uncaptured guest write");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	cpu.prepareSystemNativeCode();
#endif
	result = RunResult::Yielded;
	finish();
	if (observe() != final || cpu.instructionBudgetRemaining != remaining) throw std::runtime_error("the replayed suffix must retain the same boundary and grant remainder");
}

int main(int argc, char** argv) {
	using namespace bmsx;
	try {
		for (int index = 1; index < argc; index += 2) {
			const std::string_view mode = argv[index + 1];
			std::ifstream file(argv[index], std::ios::binary);
			if (!file) throw std::runtime_error("cannot open coroutine fixture");
			std::vector<u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
			CoroutineInput input;
			Runtime runtime({rom, {}, PSX_MACHINE_SPEC}, input);
			runtime.boot();
			auto& cpu = runtime.machine.cpu;
			for (int grant = 0; grant < 256 && cpu.rootThread()->address == CPU_RESET_BANK_ADDRESS; ++grant) {
				if (cpu.runUntilDepth(0, 4096) != RunResult::Yielded) throw std::runtime_error("fixture reset did not hand off");
			}
			if (cpu.rootThread()->address == CPU_RESET_BANK_ADDRESS) throw std::runtime_error("fixture did not admit its managed bank");
			if (mode.starts_with("completion_")) {
				exerciseCompletionBoundary(cpu, mode.starts_with("completion_fault_"));
				continue;
			}
			if (mode == "nested_three_banks") {
				exerciseNestedHistory(runtime);
				continue;
			}
			if (mode == "halted_tooling_call") {
				if (test::runCpuWithinBudget(cpu, 500000) != RunResult::Halted || !cpu.isHaltedUntilIrq()) throw std::runtime_error("root did not HALT");
				const int depth = cpu.getFrameDepth();
				const auto pc = cpu.readFramePc(depth - 1);
				cpu.beginCompletionCall(bmsx::test::asClosure(NativeGlobalBankReference::getGlobalByKey(cpu, *bmsx::test::StringPoolReference(cpu).find("probe")), bmsx::test::GcHeap(cpu)));
				auto toolingResult = RunResult::Yielded;
				bool windowFault = false;
				for (int grant = 0; grant < 10000 && toolingResult == RunResult::Yielded; ++grant) {
					toolingResult = cpu.runUntilDepth(depth, 17);
					windowFault |= cpu.fixedInterruptActive() && cpu.readCauseWord() == CPU_CAUSE_CODE_REGISTER_WINDOW;
				}
				if (toolingResult != RunResult::Halted || !windowFault || cpu.readLuaFaultReasonWord() != 0
					|| !cpu.isHaltedUntilIrq() || cpu.activeThread() != cpu.rootThread() || cpu.getFrameDepth() != depth
					|| cpu.readFramePc(depth - 1) != pc || NativeGlobalBankReference::getGlobalByKey(cpu, *bmsx::test::StringPoolReference(cpu).find("entered")) != valueBool(true))
					throw std::runtime_error("tooling must not consume the root HALT");
				const auto bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
				runtime.rebootSystem();
				applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
				if (!cpu.isHaltedUntilIrq() || cpu.activeThread() != cpu.rootThread()) throw std::runtime_error("codec lost the HALT owner");
				cpu.clearHaltUntilIrq();
			}
			auto result = RunResult::Yielded;
			if (mode == "interrupted") {
				bool admitted = false;
				const auto ready = *bmsx::test::StringPoolReference(cpu).find("interrupt_ready");
				for (int grant = 0; grant < 20000 && result == RunResult::Yielded; ++grant) {
					if (!admitted && cpu.activeThread() != cpu.rootThread() && cpu.getFrameDepth() != 0
						&& !cpu.fixedInterruptActive() && NativeGlobalBankReference::getGlobalByKey(cpu, ready) == valueBool(true)) {
						cpu.requestNonMaskableInterrupt();
						if (!cpu.enterPendingInterrupt()) throw std::runtime_error("NMI was not admitted");
						admitted = true;
					}
					result = cpu.runUntilDepth(0, 17);
				}
				if (!admitted || cpu.readLuaFaultReasonWord() != 0) throw std::runtime_error("NMI did not interrupt and restore the live coroutine");
			} else {
				const int grants = mode == "suite" ? 32 : 1;
				for (int grant = 0; grant < grants && result == RunResult::Yielded; ++grant)
					result = test::runCpuWithinBudget(cpu, 1000000);
			}
			const auto values = runtime.readCompletionValues();
			const bool suite = mode == "suite";
			if (result != RunResult::Halted || cpu.captureRuntimeState().hardHalted || cpu.getFrameDepth() != 0
				|| values.size() != (suite ? 2u : 1u) || values.get(0) != valueBool(true) || (suite && values.get(1) != valueBool(true))) {
				std::cerr << mode << ": stopped with " << static_cast<int>(result) << ", frame depth " << cpu.getFrameDepth()
					<< ", completion values " << values.size() << '\n';
				throw std::runtime_error("coroutine assertion failed");
			}
			if (suite) {
				const auto value = NativeGlobalBankReference::getGlobalByKey(cpu, *bmsx::test::StringPoolReference(cpu).find("failed_thread"));
				const u32 thread = valuePayload(value);
				const auto& memory = cpu.memory();
				if (!valueIsThread(value) || bmsx::test::GcHeap(cpu).threadRecordAddress(thread) != thread
					|| memory.readRamRecordByte(thread) != THREAD_RECORD_KIND
					|| ThreadRecord::read(memory, thread, ThreadField::Status) != static_cast<u32>(ThreadStatus::Failed)
					|| ThreadRecord::read(memory, thread, ThreadField::ErrorWord) != valuePayload(ThreadRecord::error(memory, thread)))
					throw std::runtime_error("a failed Thread value must refer to its physical record");
			}
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
