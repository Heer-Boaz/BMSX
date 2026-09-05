#include "common/mmap_file.h"
#include "cartridge_media.h"
#include "libretro_state.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "render/backend/backend.h"
#include "rompack/image.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"

#include <chrono>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>

namespace {

class ReplayInput final : public bmsx::InputControllerInputSource {
public:
	bmsx::i64 tick = 0;
	bool rejectLiveInput = false;
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot& snapshot, bmsx::InputControllerSampleContext) override {
		if (rejectLiveInput) throw std::runtime_error("replay sampled live input");
		snapshot.pads[0].buttons = (tick % 40) < 20 ? 1u : 1u << 15;
	}
	bool supervisorRequestLineHigh() const override {
		if (rejectLiveInput) throw std::runtime_error("replay read the live supervisor line");
		return false;
	}
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {
		if (rejectLiveInput) throw std::runtime_error("replay repeated host vibration");
	}
};

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

} // namespace

int main(int argc, char** argv) {
	try {
		require(argc == 3 || argc == 4, "Usage: bmsx_runtime_replay_conformance_runner SYSTEM_ROM CART_ROM [OUTPUT_PREFIX]");
		bmsx::MmapFile systemFile;
		bmsx::MmapFile cartFile;
		require(systemFile.open(argv[1]) && cartFile.open(argv[2]), "media must map");
		const auto system = bmsx::parseSystemRomImage(systemFile.data(), systemFile.size());
		const auto cart = bmsx::parseCartridgePackage(cartFile.data(), cartFile.size());
		ReplayInput input;
		bmsx::Runtime runtime(bmsx::RuntimeOptions{
			system.bytes,
			{bmsx::cartridgeMediaFromPackage(cart), std::nullopt},
			bmsx::PSX_MACHINE_SPEC,
		}, input);
		auto& gpu = runtime.machine.gxGpu;
		bmsx::SoftwareBackend backend(256, 212, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
		using Clock = std::chrono::steady_clock;
		double historyCaptureMs = 0;
		int historyCaptures = 0;
		constexpr double hostDeltas[] = {1.25, 8.5, 16.75};
		const auto tick = [&](bool paced = false) {
			input.tick = runtime.frameScheduler.lastTickSequence;
			bool completed = false;
			for (int attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; ++attempt) {
				if (gpu.backendServicePending()) {
					if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
					else backend.executeGxGpuReadback(gpu);
				}
				if (!completed) {
					completed = paced
						? runtime.frameScheduler.runScheduledToNextLogicalTick(runtime, hostDeltas[attempt % 3])
						: runtime.frameScheduler.runToNextLogicalTick(runtime);
				}
			}
			require(completed, "machine must reach its next PCRTC tick");
			backend.executeGxGpuCommandDrain(gpu);
			gpu.retirePresentedCommands();
			runtime.machine.audioController.synchronizeOutput().clear();
			require(runtime.machine.memory.readIoU32(bmsx::IO_SYS_SUPERVISOR_FAULT_SEQUENCE) == 0u, "guest fault");
			if (runtime.history.checkpointPending) {
				const auto start = Clock::now();
				backend.captureGxGpuVramSnapshot(gpu);
				runtime.history.captureCheckpoint();
				historyCaptureMs += std::chrono::duration<double, std::milli>(Clock::now() - start).count();
				++historyCaptures;
			}
		};
		const auto capture = [&]() {
			backend.captureGxGpuVramSnapshot(gpu);
			return bmsx::captureRuntimeSaveState(runtime);
		};
		runtime.boot();
		for (const int checkpointTick : {2, 400, 1200}) {
			while (runtime.frameScheduler.lastTickSequence < checkpointTick) tick();
			const auto captureStart = Clock::now();
			const auto anchor = capture();
			const auto captureMs = std::chrono::duration<double, std::milli>(Clock::now() - captureStart).count();
			std::vector<bmsx::u8> envelope(bmsx::libretroStateSize(runtime));
			require(bmsx::serializeLibretroState(runtime, envelope), "libretro serialize must succeed");
			for (int count = 0; count < 120; ++count) tick();
			const auto expected = bmsx::encodeRuntimeSaveState(capture());
			if (argc == 4) {
				std::ofstream output;
				output.exceptions(std::ios::failbit | std::ios::badbit);
				output.open(std::string(argv[3]) + "-" + std::to_string(checkpointTick) + ".state", std::ios::binary);
				output.write(reinterpret_cast<const char*>(expected.data()), expected.size());
			}
			const auto restoreStart = Clock::now();
			bmsx::applyRuntimeSaveState(runtime, anchor);
			const auto restoreMs = std::chrono::duration<double, std::milli>(Clock::now() - restoreStart).count();
			const auto replayStart = Clock::now();
			for (int count = 0; count < 120; ++count) tick();
			const auto replayMs = std::chrono::duration<double, std::milli>(Clock::now() - replayStart).count();
			require(bmsx::encodeRuntimeSaveState(capture()) == expected, "trusted replay must reproduce the full runtime state");
			require(bmsx::unserializeLibretroState(runtime, envelope), "libretro unserialize must succeed");
			for (int count = 0; count < 120; ++count) tick();
			require(bmsx::encodeRuntimeSaveState(capture()) == expected, "libretro replay must reproduce the same runtime state");
			std::cout << "{\"host\":\"cpp\",\"checkpointTick\":" << checkpointTick
				<< ",\"captureMs\":" << captureMs << ",\"restoreMs\":" << restoreMs
				<< ",\"replayMs\":" << replayMs << ",\"bytes\":" << bmsx::encodeRuntimeSaveState(anchor).size()
				<< ",\"objects\":" << anchor.cpuState.objects.size() << "}\n";
		}
		auto& history = runtime.history;
		history.start({4, 96, runtime.timing.cycleBudgetPerFrame * 20});
		backend.captureGxGpuVramSnapshot(gpu);
		history.captureCheckpoint();
		const auto initialCycles = history.earliestCycles();
		std::map<int, bmsx::RuntimeSaveState> references;
		for (int index = 1; index <= 111; ++index) {
			tick(true);
			if (index == 55 || index == 77 || index == 111) references.emplace(index, capture());
		}
		require(history.checkpointCount() == 4 && history.earliestCycles() > initialCycles, "checkpoint ring wraps");
		require(history.inputJournal.endSequence > static_cast<bmsx::i64>(history.inputJournal.capacity()), "input ring wraps");
		require(history.inputJournal.storageBytes() == 96 * 176, "fixed journal allocation");
		const auto retainedEnd = history.latestCycles();
		input.rejectLiveInput = true;
		int seekSteps = 0;
		double seekWorkMs = 0;
		double maxSeekStepMs = 0;
		double seekRestoreMs = 0;
		for (int index : {111, 55, 77}) {
			const auto& expected = references.at(index);
			const auto restoreStart = Clock::now();
			history.beginSeek(expected.machineState.schedulerNowCycles);
			seekRestoreMs += std::chrono::duration<double, std::milli>(Clock::now() - restoreStart).count();
			for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 10000; ++step) {
				const auto stepStart = Clock::now();
				const auto result = history.advanceSeek(16384);
				++seekSteps;
				require(result != bmsx::HistorySeekResult::Stopped, "recorded replay must progress");
				while (gpu.backendServicePending()) {
					if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
					else backend.executeGxGpuReadback(gpu);
				}
				backend.executeGxGpuCommandDrain(gpu);
				gpu.retirePresentedCommands();
				runtime.machine.audioController.synchronizeOutput().clear();
				const auto elapsed = std::chrono::duration<double, std::milli>(Clock::now() - stepStart).count();
				seekWorkMs += elapsed;
				if (elapsed > maxSeekStepMs) maxSeekStepMs = elapsed;
			}
			require(history.mode == bmsx::HistoryMode::Reviewing, "seek reaches its target");
			require(history.latestCycles() == retainedEnd, "seek retains the recorded future");
			auto actual = capture();
			require(actual.machineState.schedulerNowCycles == expected.machineState.schedulerNowCycles, "seek reproduces machine cycles");
			require(actual.machineState.frameScheduler.lastTickSequence == expected.machineState.frameScheduler.lastTickSequence, "seek reproduces PCRTC ticks");
			// Exclude host grants/telemetry only. Guest state and identities remain
			// untouched; the complete remaining state uses the existing codec comparison.
			actual.cpuState.instructionBudgetRemaining = expected.cpuState.instructionBudgetRemaining;
			actual.machineState.frameScheduler = expected.machineState.frameScheduler;
			actual.machineState.frameLoop = expected.machineState.frameLoop;
			require(bmsx::encodeRuntimeSaveState(actual) == bmsx::encodeRuntimeSaveState(expected), "history reproduces complete guest state");
		}
		const auto reviewCycles = runtime.machine.scheduler.nowCycles();
		runtime.frameScheduler.run(runtime, 80.0);
		require(runtime.machine.scheduler.nowCycles() == reviewCycles, "review does not advance on host time");
		history.input.applyInputControllerVibrationEffect(0, 10, 1);
		history.resumeRecording();
		require(history.inputJournal.endSequence == 77 && history.latestCycles() == reviewCycles, "live takeover truncates future input");
		backend.captureGxGpuVramSnapshot(gpu);
		history.captureCheckpoint();
		input.rejectLiveInput = false;
		for (int index = 0; index < 10; ++index) tick();
		require(history.inputJournal.endSequence == 87, "new branch records input");
		if (argc == 4) {
			const auto bytes = bmsx::encodeRuntimeSaveState(capture());
			std::ofstream output;
			output.exceptions(std::ios::failbit | std::ios::badbit);
			output.open(std::string(argv[3]) + "-history.state", std::ios::binary);
			output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
		}
		std::cout << "{\"host\":\"cpp-history\",\"seekSteps\":" << seekSteps
			<< ",\"seekWorkMs\":" << seekWorkMs << ",\"maxSeekStepMs\":" << maxSeekStepMs << ",\"seekRestoreMs\":" << seekRestoreMs
			<< ",\"historyCaptures\":" << historyCaptures << ",\"historyCaptureMs\":" << historyCaptureMs
			<< ",\"checkpoints\":" << history.checkpointCount() << ",\"inputBytes\":" << history.inputJournal.storageBytes() << "}\n";
		bmsx::applyRuntimeSaveState(runtime, capture());
		require(history.mode == bmsx::HistoryMode::Disabled, "external load ends history");
		std::cout << "RUNTIME-REPLAY:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
