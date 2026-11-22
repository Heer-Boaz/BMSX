#include "machine/devices/imgdec/controller.h"

#include <algorithm>

#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {
namespace {
constexpr u32 DecodeToken = 0;
constexpr u32 DecodeLiteral = 1;
constexpr u32 DecodeRepeatWord = 2;
constexpr u32 DecodeRepeat = 3;
constexpr u32 DecodeBackReference = 4;
constexpr u32 DecodeZero = 5;
constexpr u32 BlockFilling = 0;
constexpr u32 BlockDecoding = 1;
constexpr u32 BlockReady = 2;
static_assert(IMGDEC_HISTORY_WORD_CAPACITY % IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY == 0);
}

ImgDecController::ImgDecController(Memory& memory, CPU& cpu, IrqController& irq,
	DeviceScheduler& scheduler, DmaController& dma, i64 cyclesPerOutputWord)
	: m_memory(memory), m_cpu(cpu), m_irq(irq), m_scheduler(scheduler), m_dma(dma),
	  m_cyclesPerOutputWord(cyclesPerOutputWord) {
	m_memory.mapIoRead(IO_IMGDEC_INPUT_WORDS_RECEIVED, this, &readProgressThunk);
	m_memory.mapIoRead(IO_IMGDEC_DECODED_WORD_COUNT, this, &readProgressThunk);
	for (u32 address : IO_IMGDEC_CONFIG_ADDRS) {
		m_memory.mapIoWrite(address, this, &writeConfigThunk);
		m_memory.mapIoWriteReady(address, &configWriteReadyThunk);
	}
	m_memory.mapIoRead(IO_IMGDEC_DATA, this, &readDataThunk);
	m_memory.mapIoWrite(IO_IMGDEC_DATA, this, &writeDataThunk);
	m_memory.mapIoWriteReady(IO_IMGDEC_DATA, &dataWriteReadyThunk);
	m_memory.mapIoDmaReadPrefix(IO_IMGDEC_DATA, &readDataPrefixThunk);
	m_memory.mapIoDmaWritePrefix(IO_IMGDEC_DATA, &writeDataPrefixThunk);
}

void ImgDecController::resetStreamState() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	m_inputFifo.reset();
	m_inputWordsReceived = m_assembledWordCount = m_decodedWordCount = m_outputWordsRead = 0;
	m_decodePhase = DecodeToken;
	m_runWordsRemaining = m_repeatWord = m_backReferenceDistance = 0;
	m_blockPhase = BlockFilling;
	m_blockDeadline = -1;
	m_dataWord = 0;
}

void ImgDecController::reset() {
	resetStreamState();
	m_supervisorQuiesceRequested = false;
	m_inputWordCountWord = m_outputWordCountWord = 0;
	m_controlWord = m_statusWord = 0;
	mirrorRegisters();
	updateDmaRequests();
}

ImgDecControllerState ImgDecController::captureState() const {
	ImgDecControllerState state;
	state.inputWordCountWord = m_inputWordCountWord;
	state.outputWordCountWord = m_outputWordCountWord;
	state.controlWord = m_controlWord;
	state.statusWord = m_statusWord;
	state.dataWord = m_dataWord;
	state.inputWordsReceived = m_inputWordsReceived;
	state.assembledWordCount = m_assembledWordCount;
	state.decodedWordCount = m_decodedWordCount;
	state.outputWordsRead = m_outputWordsRead;
	state.decodePhase = m_decodePhase;
	state.runWordsRemaining = m_runWordsRemaining;
	state.repeatWord = m_repeatWord;
	state.backReferenceDistance = m_backReferenceDistance;
	state.blockPhase = m_blockPhase;
	state.blockCyclesRemaining = m_blockPhase == BlockDecoding
		? m_blockDeadline - m_scheduler.currentNowCycles() : 0;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	state.inputWords = m_inputFifo.captureWords();
	const size_t count = std::min<size_t>(m_assembledWordCount, IMGDEC_HISTORY_WORD_CAPACITY);
	state.historyWords.resize(count);
	const size_t start = (m_assembledWordCount - count) & IMGDEC_HISTORY_WORD_MASK;
	const size_t first = std::min(count, IMGDEC_HISTORY_WORD_CAPACITY - start);
	std::copy_n(m_history.begin() + start, first, state.historyWords.begin());
	std::copy_n(m_history.begin(), count - first, state.historyWords.begin() + first);
	return state;
}

void ImgDecController::restoreState(const ImgDecControllerState& state) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	m_inputWordCountWord = state.inputWordCountWord;
	m_outputWordCountWord = state.outputWordCountWord;
	m_controlWord = state.controlWord;
	m_statusWord = state.statusWord;
	m_dataWord = state.dataWord;
	m_inputWordsReceived = state.inputWordsReceived;
	m_assembledWordCount = state.assembledWordCount;
	m_decodedWordCount = state.decodedWordCount;
	m_outputWordsRead = state.outputWordsRead;
	m_decodePhase = state.decodePhase;
	m_runWordsRemaining = state.runWordsRemaining;
	m_repeatWord = state.repeatWord;
	m_backReferenceDistance = state.backReferenceDistance;
	m_blockPhase = state.blockPhase;
	m_inputFifo.restoreWords(state.inputWords);
	const size_t count = state.historyWords.size();
	const size_t start = (m_assembledWordCount - count) & IMGDEC_HISTORY_WORD_MASK;
	const size_t first = std::min(count, IMGDEC_HISTORY_WORD_CAPACITY - start);
	std::copy_n(state.historyWords.begin(), first, m_history.begin() + start);
	std::copy_n(state.historyWords.begin() + first, count - first, m_history.begin());
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_blockDeadline = m_blockPhase == BlockDecoding
		? m_scheduler.currentNowCycles() + state.blockCyclesRemaining : -1;
	mirrorRegisters();
	updateDmaRequests();
	if (m_blockPhase == BlockDecoding) m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, m_blockDeadline);
}

bool ImgDecController::supervisorQuiescent() const {
	return m_supervisorQuiesceRequested && m_blockPhase != BlockDecoding;
}

void ImgDecController::beginSupervisorQuiesce() {
	m_supervisorQuiesceRequested = true;
	updateDmaRequests();
	notifySupervisorBoundary();
}

void ImgDecController::leaveSupervisorContext() {
	m_supervisorQuiesceRequested = false;
	execute(m_scheduler.currentNowCycles());
	updateDmaRequests();
	resumeConfigWrites();
}

void ImgDecController::start() {
	resetStreamState();
	m_controlWord &= ~IMGDEC_CONTROL_START;
	m_statusWord = IMGDEC_STATUS_BUSY;
	mirrorRegisters();
	execute(m_scheduler.currentNowCycles());
	updateDmaRequests();
}

void ImgDecController::onService(i64 nowCycles) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	if (m_blockPhase == BlockDecoding && nowCycles >= m_blockDeadline) {
		m_blockPhase = BlockReady;
		m_blockDeadline = -1;
		m_decodedWordCount = m_assembledWordCount;
	}
	updateDmaRequests();
	notifySupervisorBoundary();
}

void ImgDecController::execute(i64 nowCycles) {
	if ((m_statusWord & IMGDEC_STATUS_BUSY) == 0 || m_supervisorQuiesceRequested
		|| m_blockPhase == BlockDecoding) return;
	if (m_blockPhase == BlockReady) {
		if (m_outputWordsRead != m_decodedWordCount) return;
		m_blockPhase = BlockFilling;
	}
	const u32 remaining = m_outputWordCountWord - m_decodedWordCount;
	if (remaining == 0) {
		if (!m_inputFifo.empty() || m_decodePhase != DecodeToken) stop(IMGDEC_STATUS_FORMAT_FAULT);
		else if (m_inputWordsReceived == m_inputWordCountWord) stop(IMGDEC_STATUS_DONE);
		return;
	}
	const u32 blockWords = std::min<u32>(remaining, IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY);
	const u32 target = m_decodedWordCount + blockWords;
	while (m_assembledWordCount < target) {
		if (m_decodePhase == DecodeToken || m_decodePhase == DecodeRepeatWord) {
			if (m_inputFifo.empty()) break;
			const u32 word = m_inputFifo.pop();
			if (m_decodePhase == DecodeRepeatWord) {
				m_repeatWord = word;
				m_decodePhase = DecodeRepeat;
				continue;
			}
			m_runWordsRemaining = (word & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1u;
			switch (word >> IMGDEC_TOKEN_KIND_SHIFT) {
			case IMGDEC_TOKEN_KIND_LITERAL: m_decodePhase = DecodeLiteral; break;
			case IMGDEC_TOKEN_KIND_REPEAT: m_decodePhase = DecodeRepeatWord; break;
			case IMGDEC_TOKEN_KIND_ZERO: m_decodePhase = DecodeZero; break;
			case IMGDEC_TOKEN_KIND_BACK_REFERENCE:
				m_runWordsRemaining = ((word >> IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
					& IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK) + IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH;
				m_backReferenceDistance = (word & IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK) + 1u;
				if (m_backReferenceDistance > m_assembledWordCount) { stop(IMGDEC_STATUS_FORMAT_FAULT); return; }
				m_decodePhase = DecodeBackReference;
				break;
			}
			if (m_runWordsRemaining > m_outputWordCountWord - m_assembledWordCount) { stop(IMGDEC_STATUS_FORMAT_FAULT); return; }
			continue;
		}
		u32 words = std::min(m_runWordsRemaining, target - m_assembledWordCount);
		if (m_decodePhase == DecodeLiteral) words = std::min<u32>(words, m_inputFifo.count());
		if (words == 0) break;
		preparePayloadWords(words);
		m_runWordsRemaining -= words;
		if (m_runWordsRemaining == 0) m_decodePhase = DecodeToken;
	}
	if (m_assembledWordCount != target) {
		if (m_inputWordsReceived == m_inputWordCountWord) stop(IMGDEC_STATUS_FORMAT_FAULT);
		return;
	}
	// The last block is published only after the complete input is accounted for.
	if (target == m_outputWordCountWord) {
		if (!m_inputFifo.empty() || m_decodePhase != DecodeToken) { stop(IMGDEC_STATUS_FORMAT_FAULT); return; }
		if (m_inputWordsReceived != m_inputWordCountWord) return;
	}
	m_blockPhase = BlockDecoding;
	m_blockDeadline = nowCycles + static_cast<i64>(blockWords) * m_cyclesPerOutputWord;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, m_blockDeadline);
}

void ImgDecController::preparePayloadWords(u32 count) {
	// Output blocks are aligned to the ring, including the short final block.
	const size_t start = m_assembledWordCount & IMGDEC_HISTORY_WORD_MASK;
	u32* const output = m_history.data() + start;
	switch (m_decodePhase) {
	case DecodeLiteral: m_inputFifo.readWords(output, count); break;
	case DecodeRepeat: std::fill_n(output, count, m_repeatWord); break;
	case DecodeZero: std::fill_n(output, count, 0u); break;
	case DecodeBackReference: {
		const size_t source = (start - m_backReferenceDistance) & IMGDEC_HISTORY_WORD_MASK;
		const size_t first = std::min<size_t>(count, IMGDEC_HISTORY_WORD_CAPACITY - source);
		// Copy forward: the reference can read words emitted by this run.
		const u32* from = m_history.data() + source;
		for (u32* to = output; to != output + first; ++to) *to = *from++;
		from = m_history.data();
		for (u32* to = output + first; to != output + count; ++to) *to = *from++;
		break;
	}
	}
	m_assembledWordCount += count;
}

void ImgDecController::updateDmaRequests() {
	const bool running = (m_statusWord & IMGDEC_STATUS_BUSY) != 0 && !m_supervisorQuiesceRequested;
	const u32 inputWords = running ? std::min<u32>(m_inputWordCountWord - m_inputWordsReceived, m_inputFifo.free()) : 0;
	const u32 outputWords = running && m_blockPhase == BlockReady ? m_decodedWordCount - m_outputWordsRead : 0;
	m_dma.setEndpointRequests(DmaEndpoint::ImgDecWrite, inputWords, DmaEndpoint::ImgDecRead, outputWords);
	const u32 status = (m_statusWord & ~(IMGDEC_STATUS_INPUT_REQUEST | IMGDEC_STATUS_OUTPUT_REQUEST))
		| (inputWords != 0 ? IMGDEC_STATUS_INPUT_REQUEST : 0u) | (outputWords != 0 ? IMGDEC_STATUS_OUTPUT_REQUEST : 0u);
	if (status != m_statusWord) { m_statusWord = status; m_memory.writeIoU32(IO_IMGDEC_STATUS, status); }
	if (inputWords != 0 && !m_dma.ownsWritePort(IO_IMGDEC_DATA)) m_cpu.resumeMemoryWrite(IO_IMGDEC_DATA);
}

void ImgDecController::stop(u32 statusWord) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	m_statusWord = statusWord;
	m_blockPhase = BlockFilling;
	m_blockDeadline = -1;
	m_memory.writeIoU32(IO_IMGDEC_STATUS, statusWord);
	updateDmaRequests();
	resumeConfigWrites();
	m_irq.raise(IRQ_IMGDEC);
	notifySupervisorBoundary();
}

void ImgDecController::resumeConfigWrites() {
	for (u32 address : IO_IMGDEC_CONFIG_ADDRS) m_cpu.resumeMemoryWrite(address);
}

void ImgDecController::notifySupervisorBoundary() {
	if (supervisorQuiescent()) m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
}

u32 ImgDecController::readProgressThunk(void* context, u32 address, MappedBusSignals) {
	auto& c = *static_cast<ImgDecController*>(context);
	return address == IO_IMGDEC_INPUT_WORDS_RECEIVED ? c.m_inputWordsReceived : c.m_decodedWordCount;
}

void ImgDecController::writeConfigThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	auto& c = *static_cast<ImgDecController*>(context);
	switch (address) {
	case IO_IMGDEC_INPUT_WORD_COUNT: c.m_inputWordCountWord = value; break;
	case IO_IMGDEC_OUTPUT_WORD_COUNT: c.m_outputWordCountWord = value; break;
	case IO_IMGDEC_CONTROL:
		c.m_controlWord = value;
		if ((value & IMGDEC_CONTROL_START) != 0) c.start();
		break;
	}
}

bool ImgDecController::configWriteReadyThunk(void* context, u32, MappedBusSignals) {
	auto& c = *static_cast<ImgDecController*>(context);
	return (c.m_statusWord & IMGDEC_STATUS_BUSY) == 0 && !c.m_supervisorQuiesceRequested;
}

void ImgDecController::readDataPrefixThunk(void* context, u32, u32* words, u32 count, MappedBusSignals) {
	auto& c = *static_cast<ImgDecController*>(context);
	const u32 available = c.m_blockPhase == BlockReady ? std::min(count, c.m_decodedWordCount - c.m_outputWordsRead) : 0;
	std::copy_n(c.m_history.data() + (c.m_outputWordsRead & IMGDEC_HISTORY_WORD_MASK), available, words);
	c.m_outputWordsRead += available;
	if (available != 0) { c.m_dataWord = words[available - 1u]; c.m_memory.writeIoU32(IO_IMGDEC_DATA, c.m_dataWord); }
	std::fill(words + available, words + count, c.m_dataWord);
}

void ImgDecController::writeDataPrefixThunk(void* context, u32, const u32* words, u32 count, MappedBusSignals) {
	auto& c = *static_cast<ImgDecController*>(context);
	c.m_inputFifo.writeWords(words, std::min<size_t>(count, c.m_inputFifo.free()));
	c.m_dataWord = words[count - 1u];
	c.m_inputWordsReceived += count;
	c.m_memory.writeIoU32(IO_IMGDEC_DATA, c.m_dataWord);
}

u32 ImgDecController::readDataThunk(void* context, u32, MappedBusSignals signals) {
	auto& c = *static_cast<ImgDecController*>(context);
	const bool dmaRead = (signals & MAPPED_BUS_MASTER_DMA) != 0;
	if (!dmaRead && c.m_dma.ownsReadPort(IO_IMGDEC_DATA)) return c.m_dataWord;
	if (c.m_blockPhase == BlockReady && c.m_outputWordsRead != c.m_decodedWordCount) {
		c.m_dataWord = c.m_history[c.m_outputWordsRead & IMGDEC_HISTORY_WORD_MASK];
		++c.m_outputWordsRead;
		c.m_memory.writeIoU32(IO_IMGDEC_DATA, c.m_dataWord);
	}
	const u32 word = c.m_dataWord;
	if (!dmaRead || (signals & MAPPED_BUS_DMA_BLOCK_END) != 0) {
		c.execute(c.m_scheduler.currentNowCycles());
		c.updateDmaRequests();
	}
	return word;
}

void ImgDecController::writeDataThunk(void* context, u32, u32 word, MappedBusSignals signals) {
	auto& c = *static_cast<ImgDecController*>(context);
	c.m_dataWord = word;
	if (!c.m_inputFifo.full()) c.m_inputFifo.writeWord(word);
	++c.m_inputWordsReceived;
	if ((signals & MAPPED_BUS_MASTER_DMA) == 0 || (signals & MAPPED_BUS_DMA_BLOCK_END) != 0) {
		c.execute(c.m_scheduler.currentNowCycles());
		c.updateDmaRequests();
	}
}

bool ImgDecController::dataWriteReadyThunk(void* context, u32, MappedBusSignals signals) {
	if ((signals & MAPPED_BUS_MASTER_DMA) != 0) return true;
	auto& c = *static_cast<ImgDecController*>(context);
	return (c.m_statusWord & IMGDEC_STATUS_BUSY) != 0 && !c.m_supervisorQuiesceRequested
		&& c.m_inputWordsReceived < c.m_inputWordCountWord && !c.m_inputFifo.full()
		&& !c.m_dma.ownsWritePort(IO_IMGDEC_DATA);
}

void ImgDecController::mirrorRegisters() {
	m_memory.writeIoU32(IO_IMGDEC_INPUT_WORD_COUNT, m_inputWordCountWord);
	m_memory.writeIoU32(IO_IMGDEC_OUTPUT_WORD_COUNT, m_outputWordCountWord);
	m_memory.writeIoU32(IO_IMGDEC_CONTROL, m_controlWord);
	m_memory.writeIoU32(IO_IMGDEC_STATUS, m_statusWord);
	m_memory.writeIoU32(IO_IMGDEC_DATA, m_dataWord);
}

} // namespace bmsx
