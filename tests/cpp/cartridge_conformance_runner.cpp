#include "common/mmap_file.h"
#include "cartridge_media.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/system/controller.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"

#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr std::string_view transcriptPrefix = "CART-CONFORMANCE:";
std::vector<std::string> transcript;

class IdleInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(
		bmsx::InputControllerSnapshot& snapshot
	) override {
		snapshot = bmsx::createInputControllerSnapshot();
	}

	auto supervisorRequestLineHigh() const -> bool override {
		return false;
	}

	void applyInputControllerVibrationEffect(
		bmsx::i32,
		bmsx::f64,
		bmsx::f32
	) override {
	}
};

size_t transcriptCount(std::string_view entry) {
	size_t count = 0u;
	for (const std::string& value : transcript) {
		if (value == entry) {
			count += 1u;
		}
	}
	return count;
}

void captureSystemOutput(bmsx::Runtime& runtime) {
	bmsx::SystemDebugTransmit& output = runtime.machine.systemDebugTransmit;
	const bmsx::u32 byteCount = output.availableByteCount();
	std::string line;
	for (bmsx::u32 index = 0u; index < byteCount; ++index) {
		const char byte = static_cast<char>(output.readByte());
		if (byte == '\n') {
			if (line.starts_with(transcriptPrefix)) {
				transcript.emplace_back(line.substr(transcriptPrefix.size()));
			}
			line.clear();
		} else {
			line.push_back(byte);
		}
	}
}

void runUntil(
	bmsx::Runtime& runtime,
	std::string_view entry,
	size_t count
) {
	for (bmsx::u32 frame = 0u; frame < 240u; ++frame) {
		if (transcriptCount(entry) >= count) {
			return;
		}
		runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs);
		captureSystemOutput(runtime);
	}
	throw std::runtime_error("Guest conformance transcript did not complete.");
}

} // namespace

int main(int argc, char** argv) {
	if (argc != 4) {
		std::cerr << "Usage: bmsx_cartridge_conformance_runner SYSTEM_ROM DATA_CART_ROM BOOTABLE_CART_ROM\n";
		return 2;
	}

	bmsx::MmapFile systemFile;
	bmsx::MmapFile dataCartFile;
	bmsx::MmapFile bootableCartFile;
	if (!systemFile.open(argv[1])
		|| !dataCartFile.open(argv[2])
		|| !bootableCartFile.open(argv[3])) {
		throw std::runtime_error("Cartridge conformance media did not map.");
	}
	const bmsx::RomImage systemImage = bmsx::parseSystemRomImage(
		systemFile.data(),
		systemFile.size());
	const bmsx::CartridgePackage dataCartImage = bmsx::parseCartridgePackage(
		dataCartFile.data(),
		dataCartFile.size());
	const bmsx::CartridgePackage bootableCartImage = bmsx::parseCartridgePackage(
		bootableCartFile.data(),
		bootableCartFile.size());
	const bmsx::CartridgeSocketMediaPair cartridgeMedia{{
		bmsx::cartridgeMediaFromPackage(dataCartImage),
		bmsx::cartridgeMediaFromPackage(bootableCartImage),
	}};
	IdleInput input;
	bmsx::Runtime runtime(
		bmsx::RuntimeOptions{
			systemImage.bytes,
			cartridgeMedia,
			bmsx::PSX_MACHINE_SPEC,
		},
		input);
	runtime.resetForSystemBoot();
	runtime.boot();
	runtime.frameScheduler.clearQueuedTime();
	captureSystemOutput(runtime);

	runUntil(runtime, "READY", 1u);
	const std::vector<bmsx::u8> saved = bmsx::encodeRuntimeSaveState(
		bmsx::captureRuntimeSaveState(runtime));
	const bmsx::u32 mailboxControl =
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	for (size_t occurrence = 1u; occurrence <= 2u; ++occurrence) {
		if (occurrence == 2u) {
			bmsx::applyRuntimeSaveState(
				runtime,
				bmsx::decodeRuntimeSaveState(
					saved,
					runtime.machine.memory.ramByteCount(),
					runtime.machine.gxGpu.readVramSnapshotBytes().size()));
		}
		runtime.machine.memory.writeMappedU32LE(
			mailboxControl,
			bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
		runUntil(runtime, "STEP1", occurrence);
	}

	std::cout << "BMSX-CARTRIDGE-CONFORMANCE=";
	for (size_t index = 0u; index < transcript.size(); ++index) {
		if (index != 0u) {
			std::cout << '|';
		}
		std::cout << transcript[index];
	}
	std::cout << '\n';
	return 0;
}
