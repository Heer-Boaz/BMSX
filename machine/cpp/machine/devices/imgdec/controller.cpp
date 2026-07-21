#include "machine/devices/imgdec/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {
namespace {
constexpr u32 DecodeMagic = 0u;
constexpr u32 DecodeTextureWordCount = 1u;
constexpr u32 DecodeClutWordCount = 2u;
constexpr u32 DecodeToken = 3u;
constexpr u32 DecodeLiteral = 4u;
constexpr u32 DecodeRepeatWord = 5u;
constexpr u32 DecodeRepeat = 6u;
constexpr u32 DecodeBackReference = 7u;
constexpr u32 DecodeZero = 8u;

constexpr u32 OutputTextureHeader = 0u;
constexpr u32 OutputTexturePayload = 1u;
constexpr u32 OutputClutHeader = 2u;
constexpr u32 OutputClutPayload = 3u;
constexpr u32 OutputComplete = 4u;

constexpr u32 ClutSizeWord = 16u | (1u << 16u);
}

ImgDecController::ImgDecController(
	Memory& memory,
	CPU& cpu,
	IrqController& irq,
	DeviceScheduler& scheduler,
	DmaController& dma,
	GxGpu& gpu,
	i64 cyclesPerOutputWord
)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_dma(dma)
	, m_gpu(gpu)
	, m_cyclesPerOutputWord(cyclesPerOutputWord) {
	m_memory.mapIoRead(IO_IMGDEC_INPUT_WORDS_RECEIVED, this, &ImgDecController::readProgressThunk);
	m_memory.mapIoRead(IO_IMGDEC_DECODED_WORD_COUNT, this, &ImgDecController::readProgressThunk);
	for (u32 address : IO_IMGDEC_CONFIG_ADDRS) {
		m_memory.mapIoWrite(address, this, &ImgDecController::writeConfigThunk);
		m_memory.mapIoWriteReady(address, &ImgDecController::configWriteReadyThunk);
	}
	m_memory.mapIoWrite(IO_IMGDEC_DATA, this, &ImgDecController::writeDataThunk);
	m_memory.mapIoWriteReady(IO_IMGDEC_DATA, &ImgDecController::dataWriteReadyThunk);
}

void ImgDecController::reset() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	m_gpu.setImgDecGp0Request(false);
	m_dma.setImgDecDmaWriteReady(false);
	resetStreamState();
	m_supervisorQuiesceRequested = false;
	m_memory.writeIoValue(IO_IMGDEC_INPUT_WORD_COUNT, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_TEXTURE_DESTINATION, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_TEXTURE_SIZE, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_CLUT_DESTINATION, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_CONTROL, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_STATUS, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_DATA, valueNumber(0.0));
}

void ImgDecController::resetStreamState() {
	m_inputFifo.reset();
	m_outputFifo.reset();
	m_historyWriteIndex = 0u;
	m_historyWordCount = 0u;
	m_active = false;
	m_inputWordsReceived = 0u;
	m_decodedWordCount = 0u;
	m_textureWordCount = 0u;
	m_clutWordCount = 0u;
	m_decodePhase = DecodeMagic;
	m_outputStage = OutputTextureHeader;
	m_runWordsRemaining = 0u;
	m_repeatWord = 0u;
	m_backReferenceDistance = 0u;
	m_scheduledDecodeWords = 0u;
	m_decodeDeadline = -1;
}

auto ImgDecController::captureState() const -> ImgDecControllerState {
	ImgDecControllerState state;
	state.inputWordCountWord = m_memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT);
	state.textureDestinationWord = m_memory.readIoU32(IO_IMGDEC_TEXTURE_DESTINATION);
	state.textureSizeWord = m_memory.readIoU32(IO_IMGDEC_TEXTURE_SIZE);
	state.clutDestinationWord = m_memory.readIoU32(IO_IMGDEC_CLUT_DESTINATION);
	state.controlWord = m_memory.readIoU32(IO_IMGDEC_CONTROL);
	state.statusWord = m_memory.readIoU32(IO_IMGDEC_STATUS);
	state.dataWord = m_memory.readIoU32(IO_IMGDEC_DATA);
	state.inputWordsReceived = m_inputWordsReceived;
	state.decodedWordCount = m_decodedWordCount;
	state.textureWordCount = m_textureWordCount;
	state.clutWordCount = m_clutWordCount;
	state.decodePhase = m_decodePhase;
	state.outputStage = m_outputStage;
	state.runWordsRemaining = m_runWordsRemaining;
	state.repeatWord = m_repeatWord;
	state.backReferenceDistance = m_backReferenceDistance;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	state.inputWords = m_inputFifo.captureWords();
	state.outputWords = m_outputFifo.captureWords();
	state.historyWords.resize(m_historyWordCount);
	const size_t historyStart = (m_historyWriteIndex - m_historyWordCount) & IMGDEC_HISTORY_WORD_MASK;
	for (size_t index = 0u; index < m_historyWordCount; index += 1u) {
		state.historyWords[index] = m_history[(historyStart + index) & IMGDEC_HISTORY_WORD_MASK];
	}
	state.scheduledDecodeWords = m_scheduledDecodeWords;
	state.scheduledDecodeCycles = m_scheduledDecodeWords == 0u
		? 0
		: m_decodeDeadline - m_scheduler.currentNowCycles();
	return state;
}

void ImgDecController::restoreState(const ImgDecControllerState& state) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	m_memory.writeIoValue(IO_IMGDEC_INPUT_WORD_COUNT, valueNumber(static_cast<f64>(state.inputWordCountWord)));
	m_memory.writeIoValue(IO_IMGDEC_TEXTURE_DESTINATION, valueNumber(static_cast<f64>(state.textureDestinationWord)));
	m_memory.writeIoValue(IO_IMGDEC_TEXTURE_SIZE, valueNumber(static_cast<f64>(state.textureSizeWord)));
	m_memory.writeIoValue(IO_IMGDEC_CLUT_DESTINATION, valueNumber(static_cast<f64>(state.clutDestinationWord)));
	m_memory.writeIoValue(IO_IMGDEC_CONTROL, valueNumber(static_cast<f64>(state.controlWord)));
	m_memory.writeIoValue(IO_IMGDEC_STATUS, valueNumber(static_cast<f64>(state.statusWord)));
	m_memory.writeIoValue(IO_IMGDEC_DATA, valueNumber(static_cast<f64>(state.dataWord)));
	m_inputWordsReceived = state.inputWordsReceived;
	m_decodedWordCount = state.decodedWordCount;
	m_textureWordCount = state.textureWordCount;
	m_clutWordCount = state.clutWordCount;
	m_decodePhase = state.decodePhase;
	m_outputStage = state.outputStage;
	m_runWordsRemaining = state.runWordsRemaining;
	m_repeatWord = state.repeatWord;
	m_backReferenceDistance = state.backReferenceDistance;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_inputFifo.restoreWords(state.inputWords);
	m_outputFifo.restoreWords(state.outputWords);
	const size_t historyWordCount = state.historyWords.size();
	m_historyWriteIndex = historyWordCount & IMGDEC_HISTORY_WORD_MASK;
	m_historyWordCount = historyWordCount;
	for (size_t index = 0u; index < historyWordCount; index += 1u) {
		m_history[index] = state.historyWords[index];
	}
	m_scheduledDecodeWords = state.scheduledDecodeWords;
	m_decodeDeadline = m_scheduledDecodeWords == 0u
		? -1
		: m_scheduler.currentNowCycles() + state.scheduledDecodeCycles;
	m_active = (state.statusWord & IMGDEC_STATUS_BUSY) != 0u;
	m_gpu.setImgDecGp0Request(m_active);
	updateInputRequest();
	if (m_gpu.imgDecGp0AbortPending()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, m_scheduler.currentNowCycles());
	} else if ((state.statusWord & IMGDEC_STATUS_OUTPUT_BLOCKED) != 0u
		&& m_gpu.armImgDecGp0WritableWake()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, m_scheduler.currentNowCycles());
	} else if (m_scheduledDecodeWords != 0u) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, m_decodeDeadline);
	}
}

void ImgDecController::beginSupervisorQuiesce() {
	m_supervisorQuiesceRequested = true;
	notifySupervisorBoundary();
}

void ImgDecController::enterSupervisorFaultContext() {
	reset();
	m_supervisorQuiesceRequested = true;
}

void ImgDecController::leaveSupervisorContext() {
	m_supervisorQuiesceRequested = false;
	resumeConfigWrites();
}

void ImgDecController::onService(i64 nowCycles) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	if (m_gpu.imgDecGp0AbortPending()) {
		fail(IMGDEC_STATUS_OUTPUT_ABORTED);
		return;
	}
	if (m_scheduledDecodeWords != 0u && nowCycles >= m_decodeDeadline) {
		decodeScheduledWords();
	}
	drainOutput(nowCycles);
	if (m_active) {
		scheduleDecode(nowCycles);
	}
	updateInputRequest();
	if (m_scheduledDecodeWords != 0u) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, m_decodeDeadline);
	}
}

void ImgDecController::start() {
	resetStreamState();
	m_active = true;
	m_memory.writeIoValue(IO_IMGDEC_CONTROL, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMGDEC_STATUS, valueNumber(static_cast<f64>(IMGDEC_STATUS_BUSY)));
	m_gpu.setImgDecGp0Request(true);
	scheduleDecode(m_scheduler.currentNowCycles());
	updateInputRequest();
}

void ImgDecController::advanceOutputStage() {
	if (m_outputStage == OutputTexturePayload && m_decodedWordCount == m_textureWordCount) {
		m_outputStage = m_clutWordCount == 0u ? OutputComplete : OutputClutHeader;
	}
	if (m_outputStage == OutputClutPayload
		&& m_decodedWordCount == m_textureWordCount + m_clutWordCount) {
		m_outputStage = OutputComplete;
	}
}

void ImgDecController::prepareDecodeRun() {
	while (m_active && (m_decodePhase == DecodeToken || m_decodePhase == DecodeRepeatWord)) {
		if (m_inputFifo.empty()) {
			failIfInputExhausted();
			return;
		}
		if (m_decodePhase == DecodeRepeatWord) {
			m_repeatWord = m_inputFifo.pop();
			m_decodePhase = DecodeRepeat;
			return;
		}
		const u32 token = m_inputFifo.pop();
		m_runWordsRemaining = (token & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1u;
		switch (token >> IMGDEC_TOKEN_KIND_SHIFT) {
		case IMGDEC_TOKEN_KIND_LITERAL:
			m_decodePhase = DecodeLiteral;
			return;
		case IMGDEC_TOKEN_KIND_REPEAT:
			m_decodePhase = DecodeRepeatWord;
			break;
		case IMGDEC_TOKEN_KIND_BACK_REFERENCE:
			m_runWordsRemaining = ((token >> IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
				& IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK) + IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH;
			m_backReferenceDistance = (token & IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK) + 1u;
			if (m_backReferenceDistance > m_historyWordCount) {
				fail(IMGDEC_STATUS_FORMAT_FAULT);
				return;
			}
			m_decodePhase = DecodeBackReference;
			return;
		case IMGDEC_TOKEN_KIND_ZERO:
			m_decodePhase = DecodeZero;
			return;
		}
	}
}

auto ImgDecController::scheduleDecode(i64 anchorCycle) -> bool {
	if (!m_active || m_scheduledDecodeWords != 0u) {
		return false;
	}
	while (m_decodePhase <= DecodeClutWordCount && !m_inputFifo.empty()) {
		const u32 word = m_inputFifo.pop();
		if (m_decodePhase == DecodeMagic) {
			if (word != IMGDEC_STREAM_MAGIC) {
				fail(IMGDEC_STATUS_FORMAT_FAULT);
				return false;
			}
			m_decodePhase = DecodeTextureWordCount;
		} else if (m_decodePhase == DecodeTextureWordCount) {
			m_textureWordCount = word;
			m_decodePhase = DecodeClutWordCount;
		} else {
			m_clutWordCount = word;
			m_decodePhase = DecodeToken;
		}
	}
	if (m_decodePhase <= DecodeClutWordCount) {
		failIfInputExhausted();
		return false;
	}
	advanceOutputStage();
	const u32 outputFree = static_cast<u32>(m_outputFifo.free());
	if (outputFree == 0u) {
		return false;
	}
	if (m_outputStage == OutputTextureHeader || m_outputStage == OutputClutHeader) {
		if (outputFree < 3u) {
			return false;
		}
		m_scheduledDecodeWords = 3u;
	} else if (m_outputStage == OutputComplete) {
		if (!streamComplete()) {
			if (!m_inputFifo.empty() || m_decodePhase != DecodeToken) {
				fail(IMGDEC_STATUS_FORMAT_FAULT);
			} else {
				failIfInputExhausted();
			}
		}
		return false;
	} else {
		prepareDecodeRun();
		if (!m_active || m_decodePhase == DecodeToken || m_decodePhase == DecodeRepeatWord) {
			return false;
		}
		const u32 stageTarget = m_outputStage == OutputTexturePayload
			? m_textureWordCount
			: m_textureWordCount + m_clutWordCount;
		const u32 stageWordsRemaining = stageTarget - m_decodedWordCount;
		u32 decodeWords = m_runWordsRemaining < stageWordsRemaining
			? m_runWordsRemaining
			: stageWordsRemaining;
		if (decodeWords > outputFree) {
			decodeWords = outputFree;
		}
		if (decodeWords > IMGDEC_DECODE_BATCH_WORDS) {
			decodeWords = IMGDEC_DECODE_BATCH_WORDS;
		}
		if (m_decodePhase == DecodeLiteral && decodeWords > m_inputFifo.count()) {
			decodeWords = static_cast<u32>(m_inputFifo.count());
		}
		if (decodeWords == 0u) {
			failIfInputExhausted();
			return false;
		}
		m_scheduledDecodeWords = decodeWords;
	}
	m_decodeDeadline = anchorCycle + static_cast<i64>(m_scheduledDecodeWords) * m_cyclesPerOutputWord;
	return true;
}

void ImgDecController::decodeScheduledWords() {
	const u32 decodeWords = m_scheduledDecodeWords;
	m_scheduledDecodeWords = 0u;
	m_decodeDeadline = -1;
	if (m_outputStage == OutputTextureHeader) {
		m_outputFifo.writeWord(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
		m_outputFifo.writeWord(m_memory.readIoU32(IO_IMGDEC_TEXTURE_DESTINATION));
		m_outputFifo.writeWord(m_memory.readIoU32(IO_IMGDEC_TEXTURE_SIZE));
		m_outputStage = OutputTexturePayload;
		return;
	}
	if (m_outputStage == OutputClutHeader) {
		m_outputFifo.writeWord(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
		m_outputFifo.writeWord(m_memory.readIoU32(IO_IMGDEC_CLUT_DESTINATION));
		m_outputFifo.writeWord(ClutSizeWord);
		m_outputStage = OutputClutPayload;
		return;
	}
	for (u32 index = 0u; index < decodeWords; index += 1u) {
		switch (m_decodePhase) {
		case DecodeLiteral:
			emitPayloadWord(m_inputFifo.pop());
			break;
		case DecodeRepeat:
			emitPayloadWord(m_repeatWord);
			break;
		case DecodeBackReference:
			emitPayloadWord(m_history[(m_historyWriteIndex - m_backReferenceDistance) & IMGDEC_HISTORY_WORD_MASK]);
			break;
		case DecodeZero:
			emitPayloadWord(0u);
			break;
		}
		completeRunWord();
	}
	advanceOutputStage();
}

void ImgDecController::drainOutput(i64 nowCycles) {
	while (m_active && !m_outputFifo.empty()) {
		const u32 writableWords = m_gpu.imgDecGp0WritableWordCount(nowCycles);
		if (writableWords == 0u) {
			setStatusBit(IMGDEC_STATUS_OUTPUT_BLOCKED, true);
			m_gpu.armImgDecGp0WritableWake();
			return;
		}
		const u32 outputWords = m_outputFifo.count() < writableWords
			? static_cast<u32>(m_outputFifo.count())
			: writableWords;
		for (u32 index = 0u; index < outputWords; index += 1u) {
			const bool finalWord = m_outputFifo.count() == 1u && streamComplete();
			m_gpu.writeImgDecGp0BlockWord(
				m_outputFifo.pop(),
				index + 1u == outputWords,
				nowCycles
			);
			if (finalWord) {
				finish();
				return;
			}
		}
	}
	setStatusBit(IMGDEC_STATUS_OUTPUT_BLOCKED, false);
}

void ImgDecController::emitPayloadWord(u32 word) {
	m_outputFifo.writeWord(word);
	m_history[m_historyWriteIndex] = word;
	m_historyWriteIndex = (m_historyWriteIndex + 1u) & IMGDEC_HISTORY_WORD_MASK;
	if (m_historyWordCount < IMGDEC_HISTORY_WORD_CAPACITY) {
		m_historyWordCount += 1u;
	}
	m_decodedWordCount += 1u;
}

void ImgDecController::completeRunWord() {
	m_runWordsRemaining -= 1u;
	if (m_runWordsRemaining == 0u) {
		m_decodePhase = DecodeToken;
	}
}

void ImgDecController::updateInputRequest() {
	const u32 inputWordCount = m_memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT);
	const u32 remaining = inputWordCount - m_inputWordsReceived;
	const u32 blockWords = remaining < IMGDEC_DMA_BLOCK_WORDS ? remaining : IMGDEC_DMA_BLOCK_WORDS;
	const bool ready = m_active && remaining != 0u && m_inputFifo.free() >= blockWords;
	m_dma.setImgDecDmaWriteReady(ready);
	setStatusBit(IMGDEC_STATUS_INPUT_REQUEST, ready);
	if (ready && !m_dma.ownsImgDecDataPort()) {
		m_cpu.resumeMemoryWrite(IO_IMGDEC_DATA);
	}
}

auto ImgDecController::streamComplete() const -> bool {
	return m_outputStage == OutputComplete
		&& m_decodePhase == DecodeToken
		&& m_inputWordsReceived == m_memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT)
		&& m_inputFifo.empty();
}

void ImgDecController::failIfInputExhausted() {
	if (m_inputWordsReceived == m_memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT)) {
		fail(IMGDEC_STATUS_FORMAT_FAULT);
	}
}

void ImgDecController::finish() {
	m_active = false;
	m_scheduledDecodeWords = 0u;
	m_decodeDeadline = -1;
	m_dma.setImgDecDmaWriteReady(false);
	m_gpu.setImgDecGp0Request(false);
	m_memory.writeIoValue(IO_IMGDEC_STATUS, valueNumber(static_cast<f64>(IMGDEC_STATUS_DONE)));
	resumeConfigWrites();
	m_irq.raise(IRQ_IMGDEC);
	notifySupervisorBoundary();
}

void ImgDecController::fail(u32 statusWord) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
	m_active = false;
	m_scheduledDecodeWords = 0u;
	m_decodeDeadline = -1;
	m_dma.setImgDecDmaWriteReady(false);
	m_gpu.abortImgDecGp0Packet();
	m_gpu.setImgDecGp0Request(false);
	m_memory.writeIoValue(IO_IMGDEC_STATUS, valueNumber(static_cast<f64>(statusWord)));
	resumeConfigWrites();
	m_irq.raise(IRQ_IMGDEC);
	notifySupervisorBoundary();
}

void ImgDecController::setStatusBit(u32 bit, bool set) {
	const u32 status = m_memory.readIoU32(IO_IMGDEC_STATUS);
	const u32 nextStatus = set ? status | bit : status & ~bit;
	if (nextStatus != status) {
		m_memory.writeIoValue(IO_IMGDEC_STATUS, valueNumber(static_cast<f64>(nextStatus)));
	}
}

void ImgDecController::resumeConfigWrites() {
	for (u32 address : IO_IMGDEC_CONFIG_ADDRS) {
		m_cpu.resumeMemoryWrite(address);
	}
}

void ImgDecController::notifySupervisorBoundary() {
	if (m_supervisorQuiesceRequested && !m_active) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

u64 ImgDecController::readProgressThunk(void* context, u32 address, MappedBusSignals) {
	auto& controller = *static_cast<ImgDecController*>(context);
	return valueNumber(static_cast<f64>(address == IO_IMGDEC_INPUT_WORDS_RECEIVED
		? controller.m_inputWordsReceived
		: controller.m_decodedWordCount));
}

void ImgDecController::writeConfigThunk(void* context, u32 address, u64 value, MappedBusSignals) {
	auto& controller = *static_cast<ImgDecController*>(context);
	if (address == IO_IMGDEC_CONTROL && (toU32(value) & IMGDEC_CONTROL_START) != 0u) {
		controller.start();
	}
}

bool ImgDecController::configWriteReadyThunk(void* context, u32) {
	auto& controller = *static_cast<ImgDecController*>(context);
	return !controller.m_active && !controller.m_supervisorQuiesceRequested;
}

void ImgDecController::writeDataThunk(void* context, u32, u64 value, MappedBusSignals busSignals) {
	auto& controller = *static_cast<ImgDecController*>(context);
	controller.m_inputFifo.writeBusWord(toU32(value));
	controller.m_inputWordsReceived += 1u;
	if ((busSignals & MAPPED_BUS_MASTER_DMA) != 0u
		&& (busSignals & MAPPED_BUS_DMA_BLOCK_END) == 0u) {
		return;
	}
	if (controller.scheduleDecode(controller.m_scheduler.currentNowCycles())) {
		controller.m_scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, controller.m_decodeDeadline);
	}
	controller.updateInputRequest();
}

bool ImgDecController::dataWriteReadyThunk(void* context, u32) {
	auto& controller = *static_cast<ImgDecController*>(context);
	return controller.m_active
		&& controller.m_inputWordsReceived < controller.m_memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT)
		&& controller.m_inputFifo.free() != 0u
		&& !controller.m_dma.ownsImgDecDataPort();
}

} // namespace bmsx
