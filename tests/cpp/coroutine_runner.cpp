#include <algorithm>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"

class CoroutineInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
};

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
			if (std::string(argv[index]).find("halted_tooling_call-") != std::string::npos) {
				if (cpu.runUntilDepth(0, 100000) != bmsx::RunResult::Halted || !cpu.isHaltedUntilIrq()) throw std::runtime_error("root did not HALT");
				const int depth = cpu.getFrameDepth();
				cpu.beginCompletionCall(*bmsx::asClosure(cpu.getGlobalByKey(cpu.stringPool().intern("probe"))));
				for (int grant = 0; grant < 10000; ++grant) {
					const auto status = cpu.runUntilDepth(depth, 17, cpu.rootThread());
					const auto snapshot = cpu.captureRuntimeState();
					cpu.restoreRuntimeState(snapshot);
					if (cpu.captureRuntimeState().haltedUntilIrqThreadRef != snapshot.haltedUntilIrqThreadRef) throw std::runtime_error("HALT owner not restored");
					if (status != bmsx::RunResult::Yielded) break;
				}
				if (cpu.activeThread() != cpu.rootThread() || cpu.getFrameDepth() != depth
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
				if (interruptVector && !interrupted && cpu.activeThread() != cpu.rootThread()
					&& cpu.getGlobalByKey(cpu.stringPool().intern("interrupt_ready")) == bmsx::valueBool(true)) {
					cpu.requestNonMaskableInterrupt();
					if (!cpu.enterPendingInterrupt()) throw std::runtime_error("NMI was not admitted");
					cpu.restoreRuntimeState(cpu.captureRuntimeState());
					interrupted = true;
				}
				result = cpu.runUntilDepth(0, 17);
				const auto state = cpu.captureRuntimeState();
				cpu.restoreRuntimeState(state);
				if (!std::ranges::equal(cpu.captureRuntimeState().snapshot.words(), state.snapshot.words())) throw std::runtime_error("thread snapshot round trip");
				if (!interruptVector && cpu.readExceptionReturnFrameDepth() != -1) throw std::runtime_error("unexpected machine fault");
			}
			const auto values = runtime.readCompletionValues();
			if (result != bmsx::RunResult::Halted || cpu.getFrameDepth() != 0 || values.size() != 1 || values[0] != bmsx::valueBool(true)) throw std::runtime_error("coroutine assertion failed");
			const auto bytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
			const auto decoded = bmsx::decodeRuntimeSaveState(bytes, bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
			if (bmsx::encodeRuntimeSaveState(decoded) != bytes) throw std::runtime_error("runtime codec round trip");
			bmsx::applyRuntimeSaveState(runtime, decoded);
			if (!std::ranges::equal(cpu.captureRuntimeState().snapshot.words(), decoded.cpuState.snapshot.words())) throw std::runtime_error("runtime thread restore");
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
