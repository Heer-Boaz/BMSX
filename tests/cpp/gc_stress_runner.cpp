#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"

#include <algorithm>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string_view>
#include <vector>

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

int main(int argc, char** argv) {
	try {
		if (argc != 4) throw std::runtime_error("expected ROM, scalar/native, and plain/restore");
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
		const bool restore = std::string_view(argv[3]) == "restore";
		stressEnabled = true;
		auto result = bmsx::RunResult::Yielded;
		for (int call = 0; call < 50000 && result == bmsx::RunResult::Yielded; ++call) {
			result = cpu.runUntilDepth(0, call % 3 == 0 ? 1 : call % 3 == 1 ? 17 : 2048);
			if (cpu.readExceptionReturnFrameDepth() != -1) throw std::runtime_error("unexpected guest fault during GC stress");
			if (restore && call % 23 == 0) {
				const auto ram = cpu.memory().captureSaveState();
				const auto state = cpu.captureRuntimeState();
				cpu.memory().restoreSaveState(ram);
				cpu.restoreRuntimeState(state);
				if (!std::ranges::equal(cpu.captureRuntimeState().snapshot.words(), state.snapshot.words()))
					throw std::runtime_error("GC stress snapshot round trip changed values");
			}
		}
		stressEnabled = false;
		const auto values = runtime.readCompletionValues();
		if (result != bmsx::RunResult::Halted || values.size() != 1 || values.get(0) != bmsx::valueBool(true)
			|| stressedAllocations <= 32) throw std::runtime_error("GC stress fixture did not finish successfully");
		const auto bytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
		std::ofstream output(std::string(argv[1]) + ".state", std::ios::binary);
		output.exceptions(std::ios::failbit | std::ios::badbit);
		output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
		output.close();
		std::cout << "GC stress passed: " << stressedAllocations << " allocation boundaries\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
