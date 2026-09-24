#include "common/mmap_file.h"
#include "cartridge_media.h"
#include "machine/runtime/runtime.h"
#include "render/backend/backend.h"
#include "rompack/image.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"

#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
class TerminalInput final : public InputControllerInputSource {
public:
	u32 usage = 0, shifted = 0, supervisor = 0;
	void sampleInputControllerSnapshot(InputControllerSnapshot& snapshot, InputControllerSampleContext) override {
		snapshot.keyWords.fill(0);
		if (usage != 0) snapshot.keyWords[usage >> 5] = 1u << (usage & 31u);
		if (shifted != 0) snapshot.keyWords[7] |= 1u << 1; // USB HID Left Shift, 225.
	}
	bool supervisorRequestLineHigh() const override { return supervisor != 0; }
	void applyInputControllerVibrationEffect(i32, f64, f32) override {}
};
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

int main(int argc, char** argv) {
	try {
		require(argc == 4, "Usage: terminal_conformance_runner SYSTEM_ROM CART_ROM INPUT_EVENTS");
		bmsx::MmapFile bios, cartFile;
		require(bios.open(argv[1]) && cartFile.open(argv[2]), "media must map");
		const auto system = bmsx::parseSystemRomImage(bios.data(), bios.size());
		const auto cart = bmsx::parseCartridgePackage(cartFile.data(), cartFile.size());
		TerminalInput input;
		bmsx::Runtime runtime(bmsx::RuntimeOptions{system.bytes,
			{bmsx::cartridgeMediaFromPackage(cart), std::nullopt}, bmsx::PSX_MACHINE_SPEC}, input);
		auto& gpu = runtime.machine.gxGpu;
		bmsx::SoftwareBackend backend(256, 212, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
		runtime.boot();
		std::ifstream events(argv[3]);
		require(events.is_open(), "input fixture must open");
		unsigned frames;
		while (events >> frames >> input.usage >> input.shifted >> input.supervisor) {
			for (unsigned frame = 0; frame < frames; ++frame) {
				bool completed = false;
				for (int attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; ++attempt) {
					if (gpu.backendServicePending()) {
						if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
						else backend.executeGxGpuReadback(gpu);
					}
					if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick(runtime);
				}
				require(completed, "physical video boundary");
				backend.executeGxGpuCommandDrain(gpu); gpu.retirePresentedCommands();
				runtime.machine.audioController.synchronizeOutput().clear();
				require(runtime.machine.memory.readIoU32(bmsx::IO_SYS_SUPERVISOR_FAULT_SEQUENCE) == 0, "no physical Lua fault");
				auto& output = runtime.machine.systemDebugTransmit;
				while (output.availableByteCount() != 0) std::cout.put(static_cast<char>(output.readByte()));
			}
		}
		require((runtime.machine.memory.readIoU32(bmsx::IO_SYS_STATUS) & bmsx::SYS_STATUS_SUPERVISOR_ACTIVE) != 0, "actual BIOS monitor retained");
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
