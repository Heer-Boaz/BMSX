#include "machine/machine.h"
#include "machine/devices/input/contracts.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/memory_map.h"
#include "spec/gx/gp0.h"
#include "spec/gx/gp1.h"
#include "spec/gx/pcrtc.h"
#include "machine/memory/memory.h"
#include "common/endian.h"
#include "support/cartridge_fixture.h"

#include <limits>
#include <stdexcept>
#include <vector>

using namespace bmsx;
namespace {
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
struct Input final : InputControllerInputSource {
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};
struct Harness {
	std::vector<u8> rom;
	Input input;
	Memory memory;
	Machine machine;
	std::array<u32, DeviceServiceKindCount> services{};
	Harness(const std::vector<u32>& stream)
		: rom(stream.size() * 4), memory(MemoryInit{{}, test::cartridgeSlots(rom)}, PSX_MACHINE_SPEC.ramBytes),
		  machine(memory, input, PSX_MACHINE_SPEC) {
		for (size_t i = 0; i < stream.size(); ++i) writeLE32(rom.data() + i * 4, stream[i]);
		machine.scheduler.reset();
		machine.resetDevices();
		const u32 address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(address, memory.readIoU32(address) | GX_GPU_PCRTC_SMODE1_SINT);
		machine.gxGpu.onService(0);
	}
	void pump() {
		const i64 deadline = machine.scheduler.nextDeadline();
		require(deadline != std::numeric_limits<i64>::max(), "pipeline retains its next hardware event");
		if (!machine.scheduler.hasDueTimer()) machine.scheduler.advanceTo(deadline);
		while (machine.scheduler.hasDueTimer()) {
			const u8 kind = machine.scheduler.popDueTimer();
			++services[kind];
			machine.runDeviceService(kind);
		}
	}
	void configure(u32 inputWords, u32 outputWords) {
		memory.writeMappedU32LE(IO_IMGDEC_INPUT_WORD_COUNT, inputWords);
		memory.writeMappedU32LE(IO_IMGDEC_OUTPUT_WORD_COUNT, outputWords);
	}
	void inputDma() {
		memory.writeMappedU32LE(IO_DMA0_READ_ADDR, CART_ROM_BASE);
		memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, IO_IMGDEC_DATA);
		memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, static_cast<u32>(rom.size() / 4));
		memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00000003);
		memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	}
	void outputDma(u32 count) {
		memory.writeMappedU32LE(IO_DMA1_READ_ADDR, IO_IMGDEC_DATA);
		memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, IO_GX_GPU_GP0);
		memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, count);
		memory.writeMappedU32LE(IO_DMA1_CONTROL, 0x00000005);
		memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
	}
	void header(u32 destination, u32 size) {
		machine.gxGpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
		for (u32 word : {0xa0000000u, destination, size}) memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
	}
	std::vector<u32> drain() {
		std::vector<u32> words;
		for (u32 step = 0; step < 100000 && (memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_BUSY) != 0; ++step) {
			if ((memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_REQUEST) != 0) words.push_back(memory.readMappedU32LE(IO_IMGDEC_DATA));
			else pump();
		}
		require(memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_DONE, "raw decoder reaches DONE after draining every output word");
		return words;
	}
};

void testBlocksPublishOnlyAtCompletion() {
	Harness h({});
	h.configure(2, 273);
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, 0x80000001u);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, (IMGDEC_TOKEN_KIND_REPEAT << 30) | 272);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 0xfedcba98);
	const auto pending = h.machine.imgDecController.captureState();
	require(pending.controlWord == 0x80000000u, "START retains all uninterpreted control bits as a raw word");
	require(pending.blockWords.size() == 256 && pending.decodedWordCount == 0 && pending.blockCyclesRemaining == 512, "one full work block has one charged completion edge");
	h.machine.scheduler.advanceTo(511);
	require(!h.machine.scheduler.hasDueTimer(), "no per-run or per-sixteen-word decode event");
	require(h.memory.readMappedU32LE(IO_IMGDEC_DECODED_WORD_COUNT) == 0, "unpublished words do not advance progress");
	require((h.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_REQUEST) == 0, "unpublished data has no DMA request");
	h.pump();
	require(h.memory.readMappedU32LE(IO_IMGDEC_DECODED_WORD_COUNT) == 256, "whole block becomes visible at its deadline");
	for (u32 i = 0; i < 256; ++i) require(h.memory.readMappedU32LE(IO_IMGDEC_DATA) == 0xfedcba98, "raw block contains no GPU header");
	require(h.machine.imgDecController.captureState().blockCyclesRemaining == 34, "short final block charges its actual word count");
	h.pump();
	for (u32 i = 0; i < 17; ++i) require(h.memory.readMappedU32LE(IO_IMGDEC_DATA) == 0xfedcba98, "last raw block is exact");
	require(h.memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_DONE, "DONE follows the final DATA read");
	require(h.services[DEVICE_SERVICE_IMGDEC] == 2, "273 output words require exactly two decoder completions");
	require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMGDEC) != 0, "completion raises IMGDEC IRQ");
}

void testCpuBuildsHeadersAndDmaSplitsAtAvailableWords() {
	std::vector<u32> stream{517};
	for (u32 i = 0; i < 518; ++i) stream.push_back(0x80010001u + i * 0x00010001u);
	Harness h(stream);
	h.configure(static_cast<u32>(stream.size()), 518);
	h.header(0x00200040, 30 | (34 << 16));
	h.outputDma(510);
	h.inputDma();
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	for (u32 i = 0; i < 1000 && h.memory.readIoU32(IO_DMA1_STATUS) != DMA_STATUS_DONE; ++i) h.pump();
	require(h.memory.readIoU32(IO_DMA1_STATUS) == DMA_STATUS_DONE, "texture subtransfer completes independently of CLUT");
	require(h.machine.imgDecController.captureState().outputWordsRead == 510, "DMA consumes no CLUT word as texture payload");
	h.header(0x00400100, 16 | (1 << 16));
	h.outputDma(8);
	for (u32 i = 0; i < 1000 && h.memory.readIoU32(IO_IMGDEC_STATUS) != IMGDEC_STATUS_DONE; ++i) h.pump();
	for (u32 i = 0; i < 1000 && h.machine.gxGpu.readDeviceOutput().commandBuffer.commandCount != 2; ++i) h.pump();
	require(h.memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_DONE, "split CLUT transfer drains the final block");
	const auto& commands = h.machine.gxGpu.readDeviceOutput().commandBuffer;
	require(commands.commandCount == 2 && commands.commandWordCount[0] == 513 && commands.commandWordCount[1] == 11, "software-supplied headers frame both complete GPU uploads");
	for (u32 i = 0; i < 518; ++i) {
		const u32 command = i < 510 ? 0 : 1;
		const u32 offset = i < 510 ? i : i - 510;
		require(commands.words[commands.commandWordStart[command] + 3 + offset] == stream[i + 1], "cross-block partial DMA has neither repeated nor dropped words");
	}
	require(h.services[DEVICE_SERVICE_IMGDEC] == 3 && h.services[DEVICE_SERVICE_DMA] == 8, "bulk transport stops at input, output-block and programmed count boundaries");
}

void testHistoryWrapAndAllRunKinds() {
	constexpr u32 prefix = 8187, run = 333;
	for (u32 mode = 0; mode < 7; ++mode) {
		std::vector<u32> stream{(IMGDEC_TOKEN_KIND_REPEAT << 30) | (prefix - 17), 0x7e813579, 15};
		std::vector<u32> expected(prefix - 16, 0x7e813579);
		for (u32 i = 0; i < 16; ++i) { stream.push_back(0x80010001 + i * 0x01010101); expected.push_back(stream.back()); }
		if (mode == 0) {
			stream.push_back(run - 1);
			for (u32 i = 0; i < run; ++i) { stream.push_back(0xfedc0000 + i); expected.push_back(stream.back()); }
		} else if (mode < 3) {
			const u32 word = mode == 1 ? 0xf000ffff : 0;
			stream.push_back(((mode == 1 ? IMGDEC_TOKEN_KIND_REPEAT : IMGDEC_TOKEN_KIND_ZERO) << 30) | (run - 1));
			if (mode == 1) stream.push_back(word);
			expected.insert(expected.end(), run, word);
		} else {
			const u32 distance = std::array<u32, 4>{1, 3, 16, 4096}[mode - 3];
			stream.push_back((IMGDEC_TOKEN_KIND_BACK_REFERENCE << 30) | ((run - 3) << 12) | (distance - 1));
			for (u32 i = 0; i < run; ++i) expected.push_back(expected[expected.size() - distance]);
		}
		stream.push_back(3);
		for (u32 word : {0xffffffffu, 0u, 0x8001ffffu, 0x01234567u}) { stream.push_back(word); expected.push_back(word); }
		Harness h(stream);
		h.configure(static_cast<u32>(stream.size()), static_cast<u32>(expected.size()));
		h.inputDma();
		h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
		require(h.drain() == expected, "all token kinds remain exact across output blocks and history wrap");
		require(h.machine.imgDecController.captureState().historyWords == std::vector<u32>(expected.end() - 4096, expected.end()), "retained history is chronological and exact");
	}
}

void testRestoreAndQuiesce() {
	Harness h({});
	h.configure(301, 300);
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 299);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 0x12345678);
	const auto partial = h.machine.imgDecController.captureState();
	require(partial.blockWords.size() == 1 && partial.decodedWordCount == 0, "partial input has private prepared data without a timer");
	h.machine.imgDecController.beginSupervisorQuiesce();
	require(h.machine.imgDecController.supervisorQuiescent(), "partial filling pauses without waiting for new input");
	h.machine.imgDecController.restoreState(partial);
	std::vector<u32> literal{0x12345678};
	for (u32 i = 1; i < 300; ++i) { literal.push_back(i * 0x10203); h.memory.writeMappedU32LE(IO_IMGDEC_DATA, literal.back()); }
	require(h.drain() == literal, "restored partial filling resumes after more compressed input");
	// Use one compressed zero run for the actual restore sequence.
	h.machine.imgDecController.reset();
	h.configure(1, 300);
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, (IMGDEC_TOKEN_KIND_ZERO << 30) | 299);
	h.machine.scheduler.advanceTo(h.machine.scheduler.currentNowCycles() + 100);
	const auto pending = h.machine.imgDecController.captureState();
	require(pending.blockCyclesRemaining == 412, "capture retains elapsed decode work");
	h.machine.imgDecController.beginSupervisorQuiesce();
	require(!h.machine.imgDecController.supervisorQuiescent(), "an admitted block reaches its publication boundary");
	for (u32 i = 0; i < 8 && !h.machine.imgDecController.supervisorQuiescent(); ++i) h.pump();
	require(h.machine.imgDecController.supervisorQuiescent(), "publication completes quiescence without draining guest words");
	h.machine.imgDecController.restoreState(pending);
	require(h.machine.imgDecController.captureState().blockCyclesRemaining == 412, "restored block keeps exact remaining latency");
	for (u32 i = 0; i < 8 && (h.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_REQUEST) == 0; ++i) h.pump();
	for (u32 i = 0; i < 13; ++i) require(h.memory.readMappedU32LE(IO_IMGDEC_DATA) == 0, "ready block before partial restore");
	const auto ready = h.machine.imgDecController.captureState();
	h.memory.readMappedU32LE(IO_IMGDEC_DATA);
	h.machine.imgDecController.restoreState(ready);
	require(h.drain() == std::vector<u32>(287, 0), "partially drained block resumes with exactly the remaining words");
}

void testFaultsAndEmptyJob() {
	for (const auto& stream : std::vector<std::vector<u32>>{{(IMGDEC_TOKEN_KIND_BACK_REFERENCE << 30)}, {0}, {(IMGDEC_TOKEN_KIND_REPEAT << 30)}, {(IMGDEC_TOKEN_KIND_ZERO << 30) | 1}, {(IMGDEC_TOKEN_KIND_ZERO << 30), 0}}) {
		Harness h(stream);
		h.configure(static_cast<u32>(stream.size()), 1);
		h.inputDma();
		h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
		for (u32 i = 0; i < 100 && (h.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_BUSY) != 0; ++i) h.pump();
		require(h.memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_FORMAT_FAULT, "unavailable history, short input, overshoot and trailing tokens fault deterministically");
		require(h.machine.imgDecController.captureState().decodedWordCount == 0, "malformed private work is never published");
	}
	Harness h({});
	h.configure(0, 0);
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	require(h.memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_DONE, "empty raw job completes without a fabricated header");
}
} // namespace

int main() {
	testBlocksPublishOnlyAtCompletion();
	testCpuBuildsHeadersAndDmaSplitsAtAvailableWords();
	testHistoryWrapAndAllRunKinds();
	testRestoreAndQuiesce();
	testFaultsAndEmptyJob();
}
