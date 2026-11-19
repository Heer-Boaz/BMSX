#include <algorithm>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <unordered_set>
#include "machine/cpu/thread_record.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/history/ram_history.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"

class CoroutineInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

static void exerciseCompletionBoundary(bmsx::CPU& cpu, bool fault) {
	if (cpu.runUntilDepth(0, 100000) != bmsx::RunResult::Halted || !cpu.isHaltedUntilIrq()) throw std::runtime_error("completion fixture did not HALT");
	const bmsx::u32 thread = cpu.activeThread()->address;
	const int depth = cpu.getFrameDepth();
	const auto protectedDepth = bmsx::ThreadRecord::count(cpu.memory(), thread, bmsx::ThreadField::ProtectedDepth);
	cpu.beginCompletionCall(bmsx::asClosure(cpu.getGlobalByKey(cpu.stringPool().intern("probe")), cpu.gcHeap()));
	for (int grant = 0; grant < 10000 && cpu.completionCallPending() && cpu.readExceptionReturnFrameDepth() == -1; ++grant) {
		cpu.runUntilDepth(depth, 1, thread);
	}
	if (cpu.activeThread()->address != thread
		|| bmsx::ThreadRecord::read(cpu.memory(), thread, bmsx::ThreadField::Status) != static_cast<bmsx::u32>(bmsx::ThreadStatus::Running)
		|| bmsx::ThreadRecord::count(cpu.memory(), thread, bmsx::ThreadField::ProtectedDepth) != protectedDepth) throw std::runtime_error("completion changed interrupted coroutine/protected caller");
	if (fault) {
		if (cpu.readExceptionReturnFrameDepth() == -1 || !cpu.completionCallPending()) throw std::runtime_error("completion fault did not retain its physical root");
	} else {
		const auto values = cpu.readCompletionValues();
		if (cpu.readExceptionReturnFrameDepth() != -1 || cpu.completionCallPending() || cpu.getFrameDepth() != depth
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
	RuntimeSaveState mid, final;
	std::unordered_set<u32> observedThreads;
	bool capturedMid = false;
	auto result = RunResult::Yielded;
	for (int grant = 0; grant < 10000 && result == RunResult::Yielded; ++grant) {
		result = cpu.runUntilDepth(0, 17);
		if (cpu.activeThread()->address != root) observedThreads.insert(cpu.activeThread()->address);
		if (cpu.readExceptionReturnFrameDepth() != -1) throw std::runtime_error("nested history entered a machine fault");
		if (!capturedMid && observedThreads.size() == 3) {
			if (result != RunResult::Yielded || cpu.activeThread()->address == root) throw std::runtime_error("nested history lost its active third coroutine");
			captureRuntimeCheckpointState(runtime, mid);
			mid.ram.assign(memory.ramData(), memory.ramData() + memory.ramByteCount());
			history.capture(memory, &initialPages, midPages);
			capturedMid = true;
		}
	}
	const auto values = runtime.readCompletionValues();
	if (!capturedMid || observedThreads.size() != 3 || result != RunResult::Halted
		|| cpu.activeThread()->address != root || cpu.activeThread()->status() != ThreadStatus::Running
		|| cpu.getFrameDepth() != 0 || values.size() != 1 || values.get(0) != valueBool(true))
		throw std::runtime_error("nested history did not finish all three uninterrupted coroutine records");
	const int finalRemaining = cpu.instructionBudgetRemaining;
	captureRuntimeCheckpointState(runtime, final);
	final.ram.assign(memory.ramData(), memory.ramData() + memory.ramByteCount());
	history.capture(memory, &midPages, finalPages);

	history.restore(memory, finalPages, midPages);
	applyRuntimeCheckpointState(runtime, mid, RuntimeRestoreOrigin::HistorySeek);
	if (cpu.captureRuntimeState() != mid.cpuState
		|| !std::equal(memory.ramData(), memory.ramData() + memory.ramByteCount(), mid.ram.begin()))
		throw std::runtime_error("dirty history backward restore differs from the CPU/RAM oracle");
	history.restore(memory, midPages, finalPages);
	applyRuntimeCheckpointState(runtime, final, RuntimeRestoreOrigin::HistorySeek);
	if (cpu.captureRuntimeState() != final.cpuState
		|| !std::equal(memory.ramData(), memory.ramData() + memory.ramByteCount(), final.ram.begin()))
		throw std::runtime_error("dirty history forward restore differs from the CPU/RAM oracle");

	history.restore(memory, finalPages, midPages);
	applyRuntimeCheckpointState(runtime, mid, RuntimeRestoreOrigin::HistorySeek);
	if (cpu.runUntilDepth(0, 17) != RunResult::Yielded) throw std::runtime_error("uncaptured coroutine prefix did not remain runnable");
	if (std::equal(memory.ramData(), memory.ramData() + memory.ramByteCount(), mid.ram.begin()))
		throw std::runtime_error("uncaptured coroutine prefix made no physical RAM writes");
	history.restore(memory, midPages, midPages);
	applyRuntimeCheckpointState(runtime, mid, RuntimeRestoreOrigin::HistorySeek);
	if (cpu.captureRuntimeState() != mid.cpuState
		|| !std::equal(memory.ramData(), memory.ramData() + memory.ramByteCount(), mid.ram.begin()))
		throw std::runtime_error("same-map dirty restore differs from the CPU/RAM oracle");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	cpu.prepareSystemNativeCode();
#endif
	result = RunResult::Yielded;
	for (int grant = 0; grant < 10000 && result == RunResult::Yielded; ++grant) result = cpu.runUntilDepth(0, 17);
	if (result != RunResult::Halted || cpu.instructionBudgetRemaining != finalRemaining
		|| cpu.activeThread()->address != root || cpu.activeThread()->status() != ThreadStatus::Running
		|| cpu.captureRuntimeState() != final.cpuState
		|| !std::equal(memory.ramData(), memory.ramData() + memory.ramByteCount(), final.ram.begin()))
		throw std::runtime_error("dirty history suffix replay differs from the original final CPU/RAM or debt");
	std::cout << "COROUTINE-DIRTY-HISTORY:PASS\n";
}

int main(int argc, char** argv) {
	try {
		for (int index = 1; index < argc; ++index) {
			std::ifstream file(argv[index], std::ios::binary);
			if (!file) throw std::runtime_error("cannot open fixture");
			std::vector<bmsx::u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
			CoroutineInput input;
			bmsx::Runtime runtime({rom, {}, bmsx::PSX_MACHINE_SPEC}, input);
			runtime.boot();
			auto& cpu = runtime.machine.cpu;
			const bmsx::u32 rootThread = cpu.rootThread()->address;
			if (std::string(argv[index]).find("completion_") != std::string::npos) {
				exerciseCompletionBoundary(cpu, std::string(argv[index]).find("completion_fault_") != std::string::npos);
			} else if (std::string(argv[index]).find("nested_three_banks-") != std::string::npos) {
				exerciseNestedHistory(runtime);
			} else {
				if (std::string(argv[index]).find("halted_tooling_call-") != std::string::npos) {
					if (cpu.runUntilDepth(0, 100000) != bmsx::RunResult::Halted || !cpu.isHaltedUntilIrq()) throw std::runtime_error("root did not HALT");
					const int depth = cpu.getFrameDepth();
					cpu.beginCompletionCall(bmsx::asClosure(cpu.getGlobalByKey(cpu.stringPool().intern("probe")), cpu.gcHeap()));
					for (int grant = 0; grant < 10000; ++grant) {
						const auto status = cpu.runUntilDepth(depth, 17, rootThread);
						const auto snapshot = cpu.captureRuntimeState();
						cpu.restoreRuntimeState(snapshot);
						if (cpu.captureRuntimeState().haltedUntilIrqThreadAddress != snapshot.haltedUntilIrqThreadAddress) throw std::runtime_error("HALT owner not restored");
						if (status != bmsx::RunResult::Yielded) break;
					}
					if (cpu.activeThread()->address != rootThread || cpu.getFrameDepth() != depth
						|| cpu.getGlobalByKey(cpu.stringPool().intern("entered")) != bmsx::valueBool(true)
						|| !cpu.isHaltedUntilIrq()) throw std::runtime_error("HALT affected another thread or did not survive tooling call");
					bmsx::applyRuntimeSaveState(runtime, bmsx::decodeRuntimeSaveState(bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime)), bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes));
					if (!cpu.isHaltedUntilIrq()) throw std::runtime_error("HALT owner did not survive full codec");
					cpu.clearHaltUntilIrq();
				}
				auto result = bmsx::RunResult::Yielded;
				const bool interruptVector = std::string(argv[index]).find("interrupted-") != std::string::npos;
				bool interrupted = false;
				for (int grant = 0; grant < 10000 && result == bmsx::RunResult::Yielded; ++grant) {
					if (interruptVector && !interrupted && cpu.activeThread()->address != rootThread
						&& cpu.getGlobalByKey(cpu.stringPool().intern("interrupt_ready")) == bmsx::valueBool(true)) {
						cpu.requestNonMaskableInterrupt();
						if (!cpu.enterPendingInterrupt()) throw std::runtime_error("NMI was not admitted");
						cpu.restoreRuntimeState(cpu.captureRuntimeState());
						interrupted = true;
					}
					result = cpu.runUntilDepth(0, 17);
					const auto state = cpu.captureRuntimeState();
					cpu.restoreRuntimeState(state);
					if (cpu.captureRuntimeState() != state) throw std::runtime_error("thread snapshot round trip");
					if (!interruptVector && cpu.readExceptionReturnFrameDepth() != -1) throw std::runtime_error("unexpected machine fault");
				}
				const auto values = runtime.readCompletionValues();
				if (result != bmsx::RunResult::Halted || cpu.getFrameDepth() != 0 || values.size() != 1 || values.get(0) != bmsx::valueBool(true)) throw std::runtime_error("coroutine assertion failed");
			}
			if (std::string(argv[index]).find("protected_and_failed-") != std::string::npos) {
				using namespace bmsx;
				const auto value = cpu.getGlobalByKey(*cpu.stringPool().find("failed_thread"));
				const u32 thread = asThread(value, cpu.gcHeap());
				const auto& memory = cpu.memory();
				if (valuePayload(value) != thread
					|| cpu.gcHeap().threadRecordAddress(thread) != thread
					|| memory.readRamRecordByte(thread) != THREAD_RECORD_KIND
					|| ThreadRecord::read(memory, thread, ThreadField::Status) != static_cast<u32>(ThreadStatus::Failed)
					|| ThreadRecord::read(memory, thread, ThreadField::ErrorWord) != valuePayload(ThreadRecord::error(memory, thread))) {
					throw std::runtime_error("a failed Thread value must refer to its physical record");
				}
			}
			const auto bytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
			const auto decoded = bmsx::decodeRuntimeSaveState(bytes, bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
			if (bmsx::encodeRuntimeSaveState(decoded) != bytes) throw std::runtime_error("runtime codec round trip");
			bmsx::applyRuntimeSaveState(runtime, decoded);
			if (cpu.captureRuntimeState() != decoded.cpuState) throw std::runtime_error("runtime thread restore");
			std::ofstream output(std::string(argv[index]) + ".state", std::ios::binary);
			output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
			std::cout << argv[index] << " passed\n";
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
