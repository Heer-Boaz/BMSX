#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string_view>
#include "support/string_pool_reference.h"
#include "machine/cpu/table.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/cpu_execution_budget.h"

namespace {
using namespace bmsx;

class ProbeInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void restoreSuspended(Runtime& runtime, bool inspectFrame) {
	auto& cpu = runtime.machine.cpu;
	const auto depth = cpu.getFrameDepth();
	const auto pc = cpu.readFramePc(depth - 1);
	const auto bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	runtime.rebootSystem();
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	require(cpu.isHaltedUntilIrq() && cpu.getFrameDepth() == depth && cpu.readFramePc(depth - 1) == pc,
		"restore must recover the original parked activation");
	if (!inspectFrame) {
		const auto table = cpu.getGlobalByKey(*bmsx::test::StringPoolReference(cpu).find("checkpoint_table"));
		const auto key = cpu.getGlobalByKey(*bmsx::test::StringPoolReference(cpu).find("checkpoint_key"));
		require(TableRecord(cpu.memory(), valuePayload(table)).get(key) == valueNil(), "restore must not revive a deleted mapping");
		return;
	}
	if (cpu.getGlobalByKey(*bmsx::test::StringPoolReference(cpu).find("fixture_inject_completion")) != valueBool(true)) return;
	const auto argument = valueInteger(depth - 1);
	const int exceptionDepth = cpu.readExceptionReturnFrameDepth();
	cpu.beginCompletionCall(bmsx::test::asClosure(cpu.getGlobalByKey(*bmsx::test::StringPoolReference(cpu).find("stopped_probe")), bmsx::test::GcHeap(cpu)), {&argument, 1});
	require(test::runCpuWithinBudget(cpu, 1000000, depth) == RunResult::Halted
		&& !cpu.captureRuntimeState().hardHalted && cpu.readExceptionReturnFrameDepth() == exceptionDepth,
		"the named completion call must finish without a fault");
	const auto values = runtime.readCompletionValues();
	require(values.size() == 4 && values.get(0) == valueBool(true) && values.get(1) == valueInteger(43)
		&& values.get(2) == valueNil() && values.get(3) == valueBool(false), "completion returns the live scope values");
	require(cpu.isHaltedUntilIrq() && cpu.getFrameDepth() == depth && cpu.readFramePc(depth - 1) == pc,
		"completion must not advance the selected activation");
}
}

int main(int argc, char** argv) {
	try {
		require(argc == 3, "expected system case ROM and run/frame/table mode");
		const std::string_view mode = argv[2];
		require(mode == "run" || mode == "frame" || mode == "table", "invalid system case mode");
		std::ifstream file(argv[1], std::ios::binary);
		require(file.good(), "cannot open system case ROM");
		const std::vector<bmsx::u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
		ProbeInput input;
		bmsx::Runtime runtime({rom, {}, bmsx::PSX_MACHINE_SPEC}, input);
		runtime.boot();
		auto& cpu = runtime.machine.cpu;
		int suspensions = 0;
		const int maxGrants = mode == "frame" ? 64 : 32;
		for (int grant = 0; grant < maxGrants; ++grant) {
			const auto result = bmsx::test::runCpuWithinBudget(cpu, 1000000);
			if (result == bmsx::RunResult::Yielded) continue;
			require(result == bmsx::RunResult::Halted, "unexpected guest outcome");
			require(!cpu.captureRuntimeState().hardHalted && cpu.readExceptionReturnFrameDepth() == -1, "guest case faulted");
			if (!cpu.isHaltedUntilIrq()) {
				const auto values = runtime.readCompletionValues();
				require(values.size() == 2 && values.get(0) == bmsx::valueBool(true) && values.get(1) == bmsx::valueBool(true),
					"system case ROM did not finish successfully");
				std::cout << suspensions << '\n';
				return 0;
			}
			require(mode != "run", "this ROM must not suspend");
			restoreSuspended(runtime, mode == "frame");
			++suspensions;
			cpu.clearHaltUntilIrq();
		}
		throw std::runtime_error("system case ROM exceeded its cycle grants");
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
