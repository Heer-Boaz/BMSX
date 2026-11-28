#include "common/endian.h"
#include "support/heap_allocator_reference.h"
#include "machine/machine.h"
#include "spec/bmsx/model.h"
#include "spec/gx/gp0.h"
#include "spec/gx/gp1.h"
#include "spec/gx/pcrtc.h"
#include "spec/imgdec/registers.h"
#include "spec/imgdec/stream.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <chrono>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {
using namespace bmsx;

class Input final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

enum class Stream { Literal, Repeat, BackReference, Zero };

void measure(Stream kind, const char* name, bool cartridgeSource = false) {
	constexpr u32 words = 320u * 240u / 2u;
	constexpr u32 patternWords = 16u;
	const u32 sourceAddress = cartridgeSource ? CART_ROM_BASE : DYNAMIC_RAM_BASE + 0x1000u;
	constexpr u32 repeatedWord = 0x137b2468u;
	std::vector<u32> source;
	if (kind == Stream::Literal || kind == Stream::BackReference) {
		const u32 literalWords = kind == Stream::Literal ? words : patternWords;
		source.push_back((IMGDEC_TOKEN_KIND_LITERAL << IMGDEC_TOKEN_KIND_SHIFT) | (literalWords - 1u));
		for (u32 i = 0; i < literalWords; ++i) source.push_back(0x80010001u + (i & 15u) * 0x00010001u);
		if (kind == Stream::BackReference) {
			source.push_back((IMGDEC_TOKEN_KIND_BACK_REFERENCE << IMGDEC_TOKEN_KIND_SHIFT)
				| ((words - patternWords - IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH) << IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
				| (patternWords - 1u));
		}
	} else {
		const u32 token = kind == Stream::Repeat ? IMGDEC_TOKEN_KIND_REPEAT : IMGDEC_TOKEN_KIND_ZERO;
		source.push_back((token << IMGDEC_TOKEN_KIND_SHIFT) | (words - 1u));
		if (kind == Stream::Repeat) source.push_back(repeatedWord);
	}
	std::vector<u8> cartRom(source.size() * 4u);
	for (u32 i = 0; i < source.size(); ++i) writeLE32(cartRom.data() + 4u * i, source[i]);
	Input input;
	Memory memory(MemoryInit{{}, test::cartridgeSlots(cartRom)}, PSX_MACHINE_SPEC.ramBytes);
	Machine machine(memory, input, PSX_MACHINE_SPEC);
	if (!cartridgeSource) {
		const u32 staticEnd = sourceAddress + static_cast<u32>(source.size()) * sizeof(u32);
		if (!bmsx::HeapAllocator(machine.cpu.memory()).setFloor(staticEnd)) throw std::runtime_error("Could not reserve the public RAM fixture.");
		for (u32 i = 0; i < source.size(); ++i) memory.writeMappedU32LE(sourceAddress + 4u * i, source[i]);
	}
	for (int round = -1; round < 6; ++round) {
		machine.scheduler.reset();
		machine.resetDevices();
		const u32 smode1 = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(smode1, memory.readIoU32(smode1) | GX_GPU_PCRTC_SMODE1_SINT);
		machine.gxGpu.onService(0);
		memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, static_cast<u32>(source.size()));
		memory.writeMappedU32LE(IO_IMGDEC_OUTPUT_WORD_COUNT, words);
		for (u32 word : {0xa0000000u, 0u, 320u | (240u << 16u)}) memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
		machine.gxGpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24u) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
		memory.writeMappedU32LE(IO_DMA1_READ_ADDR, IO_IMGDEC_DATA);
		memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, IO_GX_GPU_GP0);
		memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, words);
		memory.writeMappedU32LE(IO_DMA1_CONTROL, 0x00000005u);
		memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
		memory.writeMappedU32LE(IO_DMA0_READ_ADDR, sourceAddress);
		memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, IO_IMGDEC_DATA);
		memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, static_cast<u32>(source.size()));
		memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00000003u);
		memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
		std::array<u32, DeviceServiceKindCount> services{};
		const auto start = std::chrono::steady_clock::now();
		memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
		while (memory.readIoU32(IO_IMGDEC_STATUS) != IMGDEC_STATUS_DONE) {
			const i64 deadline = machine.scheduler.nextDeadline();
			if (deadline == std::numeric_limits<i64>::max()) throw std::runtime_error("IMGDEC transfer lost its pending event.");
			machine.scheduler.advanceTo(deadline);
			while (machine.scheduler.hasDueTimer()) {
				const u8 device = machine.scheduler.popDueTimer();
				services[device] += 1u;
				machine.runDeviceService(device);
			}
		}
		const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count();
		const auto& commands = machine.gxGpu.readDeviceOutput().commandBuffer;
		if (memory.readIoU32(IO_DMA0_STATUS) != DMA_STATUS_DONE || memory.readIoU32(IO_DMA1_STATUS) != DMA_STATUS_DONE
			|| commands.commandCount != 1u || commands.commandKind[0] != GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM
			|| commands.commandWordCount[0] != words + 3u) throw std::runtime_error("Incomplete IMGDEC/DMA/GP0 transport.");
		const size_t first = commands.commandWordStart[0] + 3u;
		for (u32 i = 0; i < words; ++i) {
			const u32 expected = kind == Stream::Zero ? 0u : kind == Stream::Repeat ? repeatedWord : 0x80010001u + (i & 15u) * 0x00010001u;
			if (commands.words[first + i] != expected) throw std::runtime_error("IMGDEC transport changed a payload word.");
		}
		if (round >= 0) {
			std::cout << "[imgdec-throughput] stream=" << name << " round=" << round << " words=" << words
				<< " input_words=" << source.size() << " guest_cycles=" << machine.scheduler.nowCycles()
				<< " wall_ms=" << static_cast<double>(ns) / 1000000.0
				<< " dma_events=" << services[DEVICE_SERVICE_DMA] << " imgdec_events=" << services[DEVICE_SERVICE_IMGDEC]
				<< " gpu_events=" << services[DEVICE_SERVICE_GPU] << " apu_events=" << services[DEVICE_SERVICE_APU]
				<< " payload_ok=1" << std::endl;
		}
	}
}
} // namespace

int main() {
	try {
		std::cout << std::fixed << std::setprecision(3);
		measure(Stream::Literal, "literal-rom", true); measure(Stream::Literal, "literal-ram"); measure(Stream::Repeat, "repeat");
		measure(Stream::BackReference, "backref"); measure(Stream::Zero, "zero");
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
