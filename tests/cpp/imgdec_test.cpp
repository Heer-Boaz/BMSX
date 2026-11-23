#include "machine/machine.h"
#include "machine/save_state.h"
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
	Harness(const std::vector<u32>& stream, std::span<const u8> secondSocket = {})
		: rom(stream.size() * 4),
		  memory(MemoryInit{{}, secondSocket.empty() ? test::cartridgeSlots(rom)
		      : test::cartridgeSlots(rom, secondSocket)}, PSX_MACHINE_SPEC.ramBytes),
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
	require(pending.assembledWordCount == 256 && pending.decodedWordCount == 0 && pending.blockCyclesRemaining == 512, "one full work block has one charged completion edge");
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

void testDmaMappedInputAndBackedTerminalWord() {
	constexpr u32 inputCount = 256, outputCount = inputCount - 1;
	std::array<u8, 1u + inputCount * sizeof(u32)> slot1{};
	writeLE32(slot1.data() + 1, outputCount - 1); // One unaligned literal run.
	std::array<u32, outputCount> expected{};
	for (u32 i = 0; i < outputCount - 1; ++i) {
		expected[i] = 0x87654321u ^ (i << 12u);
		writeLE32(slot1.data() + 1 + (i + 1) * sizeof(u32), expected[i]);
	}
	// The complete unaligned input span is backed, including its terminal word.
	expected.back() = 0x6d5aa5c3u;
	writeLE32(slot1.data() + slot1.size() - sizeof(u32), expected.back());
	Harness h({0u, 0u}, slot1);
	auto& memory = h.memory;
	auto& dma = h.machine.dmaController;
	auto& scheduler = h.machine.scheduler;
	const auto faults = memory.readBusFaultSequence();
	memory.writeMappedU32LE(IO_CART_SELECT, 0u);
	require(memory.readMappedU32LE(CART_ROM_BASE + 1) == 0, "CPU selects unrelated socket 0");
	h.configure(inputCount, outputCount);
	h.header(0x00200040, (2 * outputCount) | (1u << 16u));
	h.outputDma(outputCount);
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, CART_ROM_BASE + 1);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, inputCount);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, DMA_ROUTE_TO_IMGDEC | (1u << DMA_CONTROL_READ_SLOT_SHIFT));
	memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	const auto admitted = dma.captureState();
	const auto before = scheduler.currentNowCycles();
	const auto inputEdge = before + admitted.scheduledBlockCycles;
	require(admitted.activeChannel == 0 && admitted.scheduledBlockWords == inputCount
		&& admitted.scheduledBlockCycles > 0 && memory.readMappedU32LE(IO_IMGDEC_INPUT_WORDS_RECEIVED) == 0,
		"START admits the complete input burst without taking a source snapshot");
	for (u32 i = 0; i < 16 && scheduler.currentNowCycles() < inputEdge; ++i) h.pump();
	const auto decoder = h.machine.imgDecController.captureState();
	require(scheduler.currentNowCycles() == inputEdge && decoder.inputWordsReceived == inputCount
		&& decoder.dataWord == expected.back() && decoder.decodedWordCount == 0
		&& decoder.blockCyclesRemaining == outputCount * PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord,
		"only the scalar terminal word starts work and latches the last backed cartridge word");
	require(memory.readIoU32(IO_DMA0_STATUS) == DMA_STATUS_DONE
		&& memory.readIoU32(IO_DMA1_STATUS) == DMA_STATUS_BUSY
		&& memory.readIoU32(IO_DMA0_READ_ADDR) == CART_ROM_BASE + 1 + inputCount * sizeof(u32)
		&& memory.readBusFaultSequence() == faults, "the original route publishes address and DONE without a bus fault");
	for (u32 i = 0; i < 16 && h.machine.gxGpu.readDeviceOutput().commandBuffer.commandCount == 0; ++i) h.pump();
	const auto& commands = h.machine.gxGpu.readDeviceOutput().commandBuffer;
	require(commands.commandCount == 1 && commands.commandWordCount[0] == 3 + outputCount
		&& std::equal(expected.begin(), expected.end(), commands.words.data() + commands.commandWordStart[0] + 3),
		"borrowed byte order and the terminal word reach the actual GPU packet from DMA socket 1");
}

void testCpuBuildsHeadersAndDmaSplitsAtAvailableWords() {
	constexpr u32 textureWords = 4200, clutWords = 8, total = textureWords + clutWords;
	std::vector<u32> stream{total - 1u};
	for (u32 i = 0; i < total; ++i) stream.push_back(0x80010001u + i * 0x00010001u);
	Harness h(stream);
	h.configure(static_cast<u32>(stream.size()), total);
	h.header(0x00200040, 84u | (100u << 16));
	h.outputDma(textureWords);
	h.inputDma();
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	constexpr u32 beforeWrap = IMGDEC_HISTORY_WORD_CAPACITY - IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY;
	for (u32 i = 0; i < 1000; ++i) {
		if (h.memory.readIoU32(IO_DMA1_TRANSFER_COUNT) == textureWords - beforeWrap
			&& h.machine.dmaController.captureState().activeChannel == 1) break;
		h.pump();
	}
	const auto saved = captureMachineState(h.machine);
	require(saved.imgDec.outputWordsRead == beforeWrap && saved.dma.activeChannel == 1
		&& saved.dma.scheduledBlockWords == IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY
		&& saved.dma.scheduledBlockCycles > 0, "checkpoint retains an admitted burst at the end of decoder history");
	Harness replay(stream);
	replay.machine.scheduler.advanceTo(h.machine.scheduler.currentNowCycles());
	restoreMachineState(replay.machine, saved);

	const auto finish = [&](Harness& job) {
		const auto decoderEvents = job.services[DEVICE_SERVICE_IMGDEC], dmaEvents = job.services[DEVICE_SERVICE_DMA];
		for (u32 i = 0; i < 1000 && job.memory.readIoU32(IO_DMA1_STATUS) != DMA_STATUS_DONE; ++i) job.pump();
		require(job.memory.readIoU32(IO_DMA1_STATUS) == DMA_STATUS_DONE, "texture completes independently of the CLUT");
		require(job.machine.imgDecController.captureState().outputWordsRead == textureWords, "texture DMA consumes no CLUT word");
		require(job.machine.gxGpu.captureState().gp0Word == stream[textureWords], "the texture retains its last GP0 word");
		job.header(0x00400100, 16u | (1u << 16));
		job.outputDma(clutWords);
		for (u32 i = 0; i < 1000 && job.memory.readIoU32(IO_IMGDEC_STATUS) != IMGDEC_STATUS_DONE; ++i) job.pump();
		const auto& commands = job.machine.gxGpu.readDeviceOutput().commandBuffer;
		for (u32 i = 0; i < 1000 && commands.commandCount != 2; ++i) job.pump();
		require(job.memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_DONE
			&& job.memory.readIoU32(IO_DMA1_STATUS) == DMA_STATUS_DONE, "the CLUT drains the final decoder block");
		constexpr u32 irqs = IRQ_IMGDEC | IRQ_DMA0_DONE | IRQ_DMA1_DONE;
		require((job.memory.readIoU32(IO_IRQ_FLAGS) & irqs) == irqs, "both DMA channels and the decoder complete with IRQs");
		require(job.memory.readIoU32(IO_IMGDEC_DATA) == stream[total]
			&& job.machine.gxGpu.captureState().gp0Word == stream[total], "both ports retain the last CLUT word");
		require(commands.commandCount == 2 && commands.commandWordCount[0] == textureWords + 3u
			&& commands.commandWordCount[1] == clutWords + 3u, "software-supplied headers frame both GPU uploads");
		for (u32 i = 0; i < total; ++i) {
			const u32 command = i < textureWords ? 0u : 1u;
			const u32 offset = i < textureWords ? i : i - textureWords;
			require(commands.words[commands.commandWordStart[command] + 3u + offset] == stream[i + 1u],
				"wrapped history and partial DMA neither repeat nor drop words");
		}
		return std::array<i64, 3>{job.services[DEVICE_SERVICE_IMGDEC] - decoderEvents,
			job.services[DEVICE_SERVICE_DMA] - dmaEvents, job.machine.scheduler.currentNowCycles()};
	};
	const auto uninterrupted = finish(h);
	require(finish(replay) == uninterrupted, "restored DMA publishes blocks on identical cycles");
	require(h.services[DEVICE_SERVICE_IMGDEC] == 17, "decoder event cadence still follows output blocks");
}

void testAdmittedOutputDmaSurvivesQuiesce() {
	Harness h({});
	constexpr u32 first = 0xc0051234u, last = 0x1f009087u;
	h.configure(3u, 2u);
	h.header(0x00200040, 4u | (1u << 16));
	h.outputDma(2u);
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	for (const u32 word : {1u, first, last}) h.memory.writeMappedU32LE(IO_IMGDEC_DATA, word);
	for (u32 i = 0; i < 16 && h.machine.dmaController.captureState().activeChannel != 1; ++i) h.pump();
	const auto admitted = h.machine.dmaController.captureState();
	require(admitted.activeChannel == 1 && admitted.scheduledBlockWords == 2, "DMA holds both published words");
	const i64 dmaEdge = h.machine.scheduler.nowCycles() + admitted.scheduledBlockCycles;
	h.machine.imgDecController.beginSupervisorQuiesce();
	h.machine.gxGpu.beginSupervisorQuiesce();
	require((h.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_REQUEST) == 0, "quiesce withdraws the request line");
	require(h.machine.dmaController.captureState().scheduledBlockCycles == admitted.scheduledBlockCycles, "quiesce keeps the admitted edge");
	h.machine.scheduler.advanceTo(dmaEdge - 1);
	const auto before = h.machine.gxGpu.captureState();
	require(before.commandBuffer.commandCount == 0 && before.commandBuffer.words.size() == 3
		&& before.gp0Word == (4u | (1u << 16)), "neither upload nor GP0 terminal is visible before delivery");
	const auto& commands = h.machine.gxGpu.readDeviceOutput().commandBuffer;
	for (u32 i = 0; i < 16 && commands.commandCount == 0; ++i) h.pump();
	require(h.machine.scheduler.nowCycles() == dmaEdge
		&& commands.commandCount == 1 && commands.commandWordCount[0] == 5, "the admitted block completes at its original edge");
	const auto after = h.machine.gxGpu.captureState();
	require(after.gp0Word == last && after.pendingCommandCycles > 0 && commands.executedCommandCount == 0
		&& !h.machine.gxGpu.backendServicePending()
		&& (h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0, "GP0 latches the terminal payload without executing it as an IRQ");
	const i64 gpuEdge = dmaEdge + after.pendingCommandCycles;
	while (h.machine.scheduler.nextDeadline() <= gpuEdge) h.pump();
	require(h.machine.scheduler.nowCycles() == gpuEdge && commands.executedCommandCount == 1,
		"the admitted upload still completes at its separate GPU deadline");
	const u32 start = commands.commandWordStart[0] + 3u;
	require(commands.words[start] == first && commands.words[start + 1u] == last, "prefix and terminal output are consumed in order");
	require(h.memory.readIoU32(IO_DMA1_STATUS) == DMA_STATUS_DONE, "DMA completes independently of decoder quiesce");
	h.machine.imgDecController.leaveSupervisorContext();
	require(h.machine.imgDecController.captureState().outputWordsRead == 2u
		&& h.memory.readIoU32(IO_IMGDEC_DATA) == last && h.memory.readIoU32(IO_IMGDEC_STATUS) == IMGDEC_STATUS_DONE,
		"decoder completes without consuming or changing another word after resume");
}

void testAdmittedImageWaitsForReadback() {
	constexpr u32 first = 0xc0051234u, last = 0x1f009087u;
	std::array<std::vector<u32>, 2> uploads;
	for (bool blocked : {false, true}) {
		Harness h({1u, first, last});
		auto& gpu = h.machine.gxGpu;
		if (blocked) {
			for (const u32 word : {0xc0000000u, 0u, 0x00010002u}) gpu.writeGp0(word);
			for (u32 i = 0; i < 16 && !gpu.backendServicePending(); ++i) h.pump();
			require(gpu.backendServicePending(), "a real C0 fence blocks GP0 execution");
		}
		h.configure(3u, 2u);
		h.header(0x00200040u, 0x00010004u);
		h.outputDma(2u);
		h.inputDma();
		h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
		for (u32 i = 0; i < 16 && h.memory.readIoU32(IO_DMA1_STATUS) != DMA_STATUS_DONE; ++i) h.pump();
		require(h.memory.readIoU32(IO_DMA1_STATUS) == DMA_STATUS_DONE && h.memory.readIoU32(IO_IMGDEC_DATA) == last,
			"the whole admitted burst is accepted while readback is held");
		const auto& output = gpu.readDeviceOutput();
		const auto& commands = output.commandBuffer;
		if (blocked) {
			const auto queued = gpu.captureState();
			require(queued.gp0Word == last && queued.gp0ImageLoadWordsRemaining == 0 && commands.commandCount == 1u
				&& queued.gp0FifoWords == std::vector<u32>{0xa0000000u, 0x00200040u, 0x00010004u, first, last},
				"the complete packet waits in the ordinary FIFO, outside the scheduled image");
			auto& readback = output.readbackPort;
			require(readback.claimReadback(commands.executedCommandCount), "the backend owns the preceding readback");
			writeLE32(readback.pixelBytes(), 0x34561234u);
			readback.completeReadback(readback.token());
			require(gpu.readGp0() == 0x34561234u, "draining the preceding readback releases the upload");
		}
		require(commands.commandCount == (blocked ? 2u : 1u), "a single upload is emitted at the true command boundary");
		const size_t start = commands.commandWordStart[blocked ? 1u : 0u];
		uploads[blocked].assign(commands.words.begin() + start, commands.words.begin() + start + 5u);
		require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "queued and direct data do not execute the payload as IRQ");
	}
	require(uploads[0] == uploads[1], "queueing behind readback does not change the image packet");
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
	require(partial.historyWords == std::vector<u32>{0x12345678} && partial.decodedWordCount == 0, "partial input has private prepared data without a timer");
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

void testRestoreAfterHistoryWrap() {
	Harness h({});
	constexpr u32 prefix = IMGDEC_HISTORY_WORD_CAPACITY;
	h.configure(12, prefix + 34);
	h.memory.writeMappedU32LE(IO_IMGDEC_CONTROL, IMGDEC_CONTROL_START);
	for (u32 word : {3u, 11u, 22u, 33u, 44u, (IMGDEC_TOKEN_KIND_REPEAT << 30) | (prefix - 5), 99u}) {
		h.memory.writeMappedU32LE(IO_IMGDEC_DATA, word);
	}
	for (u32 i = 0; i < prefix; ++i) {
		while ((h.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_REQUEST) == 0) h.pump();
		require(h.memory.readMappedU32LE(IO_IMGDEC_DATA) == (i < 4 ? (i + 1) * 11 : 99), "prefix fills the ring");
	}
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 2);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 101);
	const auto filling = h.machine.imgDecController.captureState();
	require(filling.assembledWordCount == prefix + 1 && filling.historyWords.back() == 101, "one unpublished word wrapped the ring");
	h.machine.imgDecController.restoreState(filling);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 102);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, 103);
	h.memory.writeMappedU32LE(IO_IMGDEC_DATA, (IMGDEC_TOKEN_KIND_BACK_REFERENCE << 30) | (28u << 12) | (prefix - 1));
	while ((h.memory.readIoU32(IO_IMGDEC_STATUS) & IMGDEC_STATUS_OUTPUT_REQUEST) == 0) h.pump();
	require(h.memory.readMappedU32LE(IO_IMGDEC_DATA) == 101, "unpublished word survived restore");
	const auto ready = h.machine.imgDecController.captureState();
	require(h.memory.readMappedU32LE(IO_IMGDEC_DATA) == 102, "first partial read after wrap");
	h.machine.imgDecController.restoreState(ready);
	std::vector<u32> expected{102, 103, 44};
	expected.insert(expected.end(), 30, 99);
	require(h.drain() == expected, "chronological history restores both the wrapped dictionary and unread output");
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
	testDmaMappedInputAndBackedTerminalWord();
	testCpuBuildsHeadersAndDmaSplitsAtAvailableWords();
	testAdmittedOutputDmaSurvivesQuiesce();
	testAdmittedImageWaitsForReadback();
	testHistoryWrapAndAllRunKinds();
	testRestoreAndQuiesce();
	testRestoreAfterHistoryWrap();
	testFaultsAndEmptyJob();
}
