#include "common/mmap_file.h"
#include "cartridge_media.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "render/backend/backend.h"
#include "rompack/image.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"

#include "support/runtime_replay_observation.h"

#include <array>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>

namespace {

class ReplayInput final : public bmsx::InputControllerInputSource {
public:
	bmsx::i64 tick = 0;
	bool rejectLiveInput = false;
	bool branched = false;
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot& snapshot, bmsx::InputControllerSampleContext) override {
		if (rejectLiveInput) throw std::runtime_error("replay sampled live input");
		snapshot.pads[0].buttons = branched ? 2u : tick % 6 < 3 ? 1u : 1u << 15;
	}
	bool supervisorRequestLineHigh() const override {
		if (rejectLiveInput) throw std::runtime_error("replay read the live supervisor line");
		return false;
	}
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {
		if (rejectLiveInput) throw std::runtime_error("replay repeated host vibration");
	}
};

using bmsx::test::ReplayObservation;
using bmsx::test::observeReplay;

std::ostream& operator<<(std::ostream& output, const ReplayObservation& probe) {
	return output << "{\"cycles\":" << probe.cycles << ",\"tick\":" << probe.tick
		<< ",\"domain\":" << probe.domain << ",\"background\":" << probe.background
		<< ",\"inputSequence\":" << probe.inputSequence << ",\"buttons\":" << probe.buttons
		<< ",\"sampleSequence\":" << probe.sampleSequence << ",\"voices\":" << probe.voices << '}';
}

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

} // namespace

int main(int argc, char** argv) {
	try {
		require(argc == 4, "Usage: bmsx_runtime_replay_conformance_runner SYSTEM_ROM CART_ROM OUTPUT_JSON");
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
				backend.captureGxGpuVramSnapshot(gpu);
				runtime.history.captureCheckpoint();
			}
		};
		const auto capture = [&]() {
			backend.captureGxGpuVramSnapshot(gpu);
			return bmsx::captureRuntimeSaveState(runtime);
		};
		runtime.boot();
		for (int frame = 0; frame < 75 && observeReplay(runtime).voices == 0; ++frame) tick();
		const auto booted = observeReplay(runtime);
		require(booted.domain == 0 && booted.voices == (1u << 4), "fixture has started the APU voice");
		auto* pendingLookup = runtime.machine.cpu.rootThread()->currentFrame;
		while (pendingLookup && !pendingLookup->hasControlFlag(bmsx::FRAME_EXTEND_RESULT_TOP))
			pendingLookup = pendingLookup->previous;
		require(pendingLookup != nullptr, "the checkpoint includes a suspended implicit table read");
		const auto anchor = capture();
		const auto payload = bmsx::encodeRuntimeSaveState(anchor);
		for (int frame = 0; frame < 6; ++frame) tick();
		const auto forward = observeReplay(runtime);
		require(forward.background != booted.background, "guest produced a different scanout");
		require(forward.inputSequence > booted.inputSequence && forward.sampleSequence > booted.sampleSequence,
			"fixture samples input and advances the audio clock");
		bmsx::applyRuntimeSaveState(runtime, anchor);
		for (int frame = 0; frame < 6; ++frame) tick();
		require(observeReplay(runtime) == forward, "in-memory restore repeats visible machine behavior");
		bmsx::applyRuntimeSaveState(runtime, bmsx::decodeRuntimeSaveState(
			payload, runtime.machine.memory.ramByteCount(), gpu.readVramSnapshotBytes().size()));
		for (int frame = 0; frame < 6; ++frame) tick();
		require(observeReplay(runtime) == forward, "serialized restore repeats the same behavior");

		auto& history = runtime.history;
		history.start({3, 12, runtime.timing.cycleBudgetPerFrame * 4});
		backend.captureGxGpuVramSnapshot(gpu);
		history.captureCheckpoint();
		const auto initialCycles = history.earliestCycles();
		std::map<int, ReplayObservation> references;
		for (int index = 1; index <= 22; ++index) {
			tick(true);
			if (index == 16 || index == 19 || index == 22) references.emplace(index, observeReplay(runtime));
		}
		require(history.checkpointCount() == 3 && history.earliestCycles() > initialCycles, "checkpoint ring wraps");
		require(history.inputJournal.endSequence > static_cast<bmsx::i64>(history.inputJournal.capacity()), "input ring wraps");
		const auto retainedEnd = history.latestCycles();
		input.rejectLiveInput = true;
		constexpr std::array seeks{std::pair{22, false}, std::pair{16, false}, std::pair{22, true}, std::pair{19, false}};
		std::array<ReplayObservation, seeks.size()> replay;
		for (size_t sample = 0; sample < seeks.size(); ++sample) {
			const auto [index, playback] = seeks[sample];
			const auto& expected = references.at(index);
			if (playback) history.beginPlayback();
			else history.beginSeek(expected.cycles);
			for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) {
				if (playback) history.advancePlayback(1000.0 / 60);
				else require(history.advanceSeek(16384) != bmsx::HistorySeekResult::Stopped, "recorded replay must progress");
				while (gpu.backendServicePending()) {
					if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
					else backend.executeGxGpuReadback(gpu);
				}
				backend.executeGxGpuCommandDrain(gpu);
				gpu.retirePresentedCommands();
				runtime.machine.audioController.synchronizeOutput().clear();
			}
			require(history.mode == bmsx::HistoryMode::Reviewing, "seek reaches its target");
			require(history.latestCycles() == retainedEnd, "seek retains the recorded future");
			replay[sample] = observeReplay(runtime);
			require(replay[sample] == expected, "history reproduces recorded input and output");
		}
		const auto reviewCycles = runtime.machine.scheduler.nowCycles();
		runtime.frameScheduler.run(runtime, 80.0);
		require(runtime.machine.scheduler.nowCycles() == reviewCycles, "review does not advance on host time");
		history.input.applyInputControllerVibrationEffect(0, 10, 1);
		history.resumeRecording();
		require(history.inputJournal.endSequence == 19 && history.latestCycles() == reviewCycles, "live takeover truncates future input");
		backend.captureGxGpuVramSnapshot(gpu);
		history.captureCheckpoint();
		input.rejectLiveInput = false;
		input.branched = true;
		for (int index = 0; index < 3; ++index) tick();
		auto branch = observeReplay(runtime);
		require(history.inputJournal.endSequence == 22 && branch.buttons == 2, "branch records the new live input");
		// The fixture writes the input into the green channel when its
		// collectgarbage continuation returns, not on each device tick.
		for (int wait = 0; wait < 8 && ((branch.background >> 8u) & 0x7fu) != 2u; ++wait) {
			tick();
			branch = observeReplay(runtime);
		}
		require(((branch.background >> 8u) & 0x7fu) == 2u, "the guest displays the newly sampled input");
		std::ofstream output;
		output.exceptions(std::ios::failbit | std::ios::badbit);
		output.open(argv[3]);
		output << "{\"forward\":" << forward << ",\"replay\":[";
		for (size_t i = 0; i < replay.size(); ++i) {
			if (i != 0) output << ',';
			output << replay[i];
		}
		output << "],\"branch\":" << branch << "}\n";
		output.close();
		bmsx::applyRuntimeSaveState(runtime, capture());
		require(history.mode == bmsx::HistoryMode::Disabled, "external load ends history");
		std::cout << "RUNTIME-REPLAY:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
