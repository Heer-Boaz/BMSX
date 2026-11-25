#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

using namespace bmsx;

namespace {
class IdleInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

std::vector<u8> readBytes(const std::string& path) {
	std::ifstream input(path, std::ios::binary);
	return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

void writeBytes(const std::string& path, const std::vector<u8>& bytes) {
	std::ofstream output(path, std::ios::binary);
	output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void trace(Runtime& runtime) {
	auto& machine = runtime.machine;
	const auto state = machine.geometryController.captureState();
	std::cout << machine.scheduler.nowCycles() << ' ' << state.pendingCycles << ' ' << state.overlap.phase
		<< ' ' << state.xform.phase << ' ' << state.sat.phase
		<< ' ' << machine.memory.readMappedWord(IO_GEO_STATUS)
		<< ' ' << machine.memory.readMappedWord(IO_GEO_PROCESSED)
		<< ' ' << machine.memory.readMappedWord(IO_GEO_FAULT)
		<< ' ' << machine.memory.readMappedWord(IO_IRQ_FLAGS);
	const u32 dst0 = machine.memory.readMappedWord(IO_GEO_DST0);
	const u32 dst1 = machine.memory.readMappedWord(IO_GEO_DST1);
	for (u32 i = 0; i < GEO_OVERLAP2D_RESULT_BYTES / IO_WORD_SIZE; ++i) std::cout << ' ' << machine.memory.readU32(dst0 + i * IO_WORD_SIZE);
	for (u32 i = 0; i < GEO_OVERLAP2D_SUMMARY_BYTES / IO_WORD_SIZE; ++i) std::cout << ' ' << machine.memory.readU32(dst1 + i * IO_WORD_SIZE);
	std::cout << '\n';
}

void resume(Runtime& runtime, const std::string& path) {
	const auto bytes = readBytes(path);
	const auto state = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	applyRuntimeSaveState(runtime, state);
	auto& geo = runtime.machine.geometryController;
	trace(runtime);
	while (geo.hasPendingWork()) {
		const auto pending = geo.captureState().pendingCycles;
		if (pending > 1) {
			advanceRuntimeTime(runtime, static_cast<int>(pending - 1));
			trace(runtime);
		}
		if (pending > 0) advanceRuntimeTime(runtime, 1);
		else runDueRuntimeTimers(runtime);
		trace(runtime);
	}
}
}

int main(int argc, char** argv) {
	const std::string mode = argv[1], biosPath = argv[2];
	const auto bios = readBytes(biosPath);
	IdleInput input;
	Runtime runtime({bios, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	runtime.boot();
	if (mode == "resume") {
		resume(runtime, argv[3]);
		return 0;
	}
	const std::string scenario = argc > 5 ? argv[5] : "overlap";
	if (scenario == "sat") {
		auto initial = runtime.machine.geometryController.captureState();
		initial.sat.verticesA[127] = 0xfedcba98u;
		initial.sat.verticesB[126] = 0x89abcdefu;
		runtime.machine.geometryController.restoreState(initial, runtime.machine.scheduler.nowCycles());
	} else if (scenario == "xform") {
		auto initial = runtime.machine.geometryController.captureState();
		initial.xform.vertices[127] = 0xfedcba98u;
		runtime.machine.geometryController.restoreState(initial, runtime.machine.scheduler.nowCycles());
	}
	std::ifstream vector(argv[3]);
	u32 address, word;
	while (vector >> address >> word) runtime.machine.memory.writeMappedWord(address, word);
	runDueRuntimeTimers(runtime);
	auto& geo = runtime.machine.geometryController;
	const auto save = [&](const char* stage) {
		writeBytes(std::string(argv[4]) + "-" + stage + ".state", encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	};
	const auto payAll = [&]() { advanceRuntimeTime(runtime, static_cast<int>(geo.captureState().pendingCycles)); };
	const auto leaveOne = [&]() {
		const auto debt = geo.captureState().pendingCycles;
		require(debt > 0, "positive pending interval");
		if (debt > 1) advanceRuntimeTime(runtime, static_cast<int>(debt - 1));
		require(geo.captureState().pendingCycles == 1, "one cycle remains");
	};
	if (scenario == "indexed") {
		payAll();
		require(geo.captureState().overlap.phase == 0u, "layer index built before outer iteration");
		leaveOne(); save("index-built");
		return 0;
	}
	if (scenario == "sat") {
		require(geo.captureState().sat.phase == 1u && geo.captureState().pendingCycles == 13, "SAT record");
		payAll();
		require(geo.captureState().sat.phase == 2u && geo.captureState().pendingCycles == 8, "SAT A sampled");
		leaveOne(); save("load-a"); payAll();
		require(geo.captureState().sat.phase == 3u && geo.captureState().pendingCycles == 8, "SAT B sampled");
		leaveOne(); save("load-b"); payAll();
		require(geo.captureState().sat.phase == 4u && geo.captureState().pendingCycles > 0, "SAT prepaid result");
		leaveOne(); save("publish");
		return 0;
	}
	if (scenario == "xform") {
		require(geo.captureState().xform.phase == 1u && geo.captureState().pendingCycles > 0, "XFORM prepaid output");
		const auto src = runtime.machine.memory.readMappedWord(IO_GEO_SRC1);
		const auto matrix = runtime.machine.memory.readMappedWord(IO_GEO_SRC2);
		runtime.machine.memory.writeU32(src, 0x90000u);
		runtime.machine.memory.writeU32(matrix + 8u, 0x70000u);
		leaveOne(); save("publish");
		return 0;
	}
	require(scenario == "overlap", "unknown geometry scenario");
	require(geo.captureState().pendingCycles == 4, "expected initialization debt");
	advanceRuntimeTime(runtime, 3);
	require(geo.captureState().pendingCycles == 1, "expected initial debt of one cycle");
	writeBytes(std::string(argv[4]) + "-init.state", encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	advanceRuntimeTime(runtime, 1);
	require(geo.captureState().pendingCycles == 26, "expected header debt");
	advanceRuntimeTime(runtime, 26);
	require(geo.captureState().overlap.phase == 3u && geo.captureState().pendingCycles > 0, "expected computed pending piece");
	writeBytes(std::string(argv[4]) + "-piece.state", encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	advanceRuntimeTime(runtime, static_cast<int>(geo.captureState().pendingCycles));
	require(geo.captureState().overlap.phase == 4u && geo.captureState().pendingCycles == 13, "expected prepaid publication");
	writeBytes(std::string(argv[4]) + "-publish.state", encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
}
