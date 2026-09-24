#include <algorithm>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"

class FrameEvaluationInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
};

int main(int argc, char** argv) {
	try {
		for (int index = 1; index < argc; ++index) {
			std::ifstream file(argv[index], std::ios::binary);
			if (!file) throw std::runtime_error("cannot read firmware frame fixture");
			std::vector<bmsx::u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
			FrameEvaluationInput input;
			bmsx::Runtime runtime({rom, {}, bmsx::PSX_MACHINE_SPEC}, input);
			runtime.boot();
			auto& cpu = runtime.machine.cpu;
			auto result = bmsx::RunResult::Yielded;
			int suspensions = 0;
			for (int grant = 0; grant < 300 && result == bmsx::RunResult::Yielded; ++grant) {
				result = cpu.runUntilDepth(0, 100000);
				if (cpu.readExceptionReturnFrameDepth() != -1) throw std::runtime_error("unhandled frame evaluation fault");
				const auto state = cpu.captureRuntimeState();
				cpu.restoreRuntimeState(state);
				if (!std::ranges::equal(cpu.captureRuntimeState().snapshot.words(), state.snapshot.words())) {
					throw std::runtime_error("frame scope snapshot did not round-trip");
				}
				if (result == bmsx::RunResult::Halted && cpu.isHaltedUntilIrq()) {
					const auto bytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
					const auto saved = bmsx::decodeRuntimeSaveState(bytes, bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
					if (bmsx::encodeRuntimeSaveState(saved) != bytes) throw std::runtime_error("frame scope codec did not round-trip");
					bmsx::applyRuntimeSaveState(runtime, saved);
					if (!std::ranges::equal(cpu.captureRuntimeState().snapshot.words(), saved.cpuState.snapshot.words())) {
						throw std::runtime_error("active frame scope did not survive the full codec");
					}
					std::ofstream output(std::string(argv[index]) + ".suspended-" + std::to_string(suspensions++) + ".state", std::ios::binary);
					output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
					cpu.clearHaltUntilIrq();
					result = bmsx::RunResult::Yielded;
				}
			}
			const auto values = runtime.readCompletionValues();
			if (result != bmsx::RunResult::Halted || values.size() != 2
				|| values[0] != bmsx::valueBool(true) || values[1] != bmsx::valueBool(true)) {
				throw std::runtime_error("firmware frame evaluation assertion failed");
			}
			const auto bytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
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
