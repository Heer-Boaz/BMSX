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
#include <stdexcept>

namespace {

class ReplayInput final : public bmsx::InputControllerInputSource {
public:
	bmsx::i64 tick = 0;
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot& snapshot, bmsx::InputControllerSampleContext) override {
		snapshot.pads[0].buttons = (tick % 40) < 20 ? 1u : 1u << 15;
	}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
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
		const auto tick = [&]() {
			input.tick = runtime.frameScheduler.lastTickSequence;
			bool completed = runtime.frameScheduler.runToNextLogicalTick(runtime);
			for (int attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; ++attempt) {
				if (gpu.backendServicePending()) {
					if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
					else backend.executeGxGpuReadback(gpu);
				}
				if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick(runtime);
			}
			require(completed, "machine must reach its next PCRTC tick");
			backend.executeGxGpuCommandDrain(gpu);
			gpu.retirePresentedCommands();
			runtime.machine.audioController.synchronizeOutput().clear();
			require(runtime.machine.memory.readIoU32(bmsx::IO_SYS_SUPERVISOR_FAULT_SEQUENCE) == 0u, "guest fault");
		};
		const auto capture = [&]() {
			backend.captureGxGpuVramSnapshot(gpu);
			return bmsx::captureRuntimeSaveState(runtime);
		};
		runtime.boot();
		using Clock = std::chrono::steady_clock;
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
		std::cout << "RUNTIME-REPLAY:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
