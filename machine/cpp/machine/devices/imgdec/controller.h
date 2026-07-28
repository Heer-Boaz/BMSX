#pragma once

#include "common/primitives.h"
#include "spec/imgdec/registers.h"
#include "spec/imgdec/stream.h"
#include "machine/devices/word_fifo.h"
#include "machine/memory/bus_signals.h"

#include <array>
#include <vector>

namespace bmsx {

constexpr u32 IMGDEC_DECODE_BATCH_WORDS = 16u;

class CPU;
class DeviceScheduler;
class DmaController;
class IrqController;
class Memory;

struct ImgDecControllerState {
	u32 inputWordCountWord = 0u;
	u32 textureDestinationWord = 0u;
	u32 textureSizeWord = 0u;
	u32 clutDestinationWord = 0u;
	u32 controlWord = 0u;
	u32 statusWord = 0u;
	u32 dataWord = 0u;
	u32 inputWordsReceived = 0u;
	u32 decodedWordCount = 0u;
	u32 textureWordCount = 0u;
	u32 clutWordCount = 0u;
	u32 outputWordsRead = 0u;
	u32 decodePhase = 0u;
	u32 outputStage = 0u;
	u32 runWordsRemaining = 0u;
	u32 repeatWord = 0u;
	u32 backReferenceDistance = 0u;
	bool supervisorQuiesceRequested = false;
	std::vector<u32> inputWords;
	std::vector<u32> outputWords;
	std::vector<u32> historyWords;
	u32 scheduledDecodeWords = 0u;
	i64 scheduledDecodeCycles = 0;
};

class ImgDecController final {
public:
	ImgDecController(
		Memory& memory,
		CPU& cpu,
		IrqController& irq,
		DeviceScheduler& scheduler,
		DmaController& dma,
		i64 cyclesPerOutputWord
	);

	void reset();
	[[nodiscard]] auto captureState() const -> ImgDecControllerState;
	void restoreState(const ImgDecControllerState& state);
	void onService(i64 nowCycles);
	void beginSupervisorQuiesce();
	[[nodiscard]] auto supervisorQuiescent() const -> bool { return m_supervisorQuiesceRequested && m_scheduledDecodeWords == 0u; }
	void leaveSupervisorContext();

private:
	void resetStreamState();
	void start();
	void advanceOutputStage();
	void prepareDecodeRun();
	auto scheduleDecode(i64 anchorCycle) -> bool;
	void decodeScheduledWords();
	void emitPayloadWord(u32 word);
	void updateDmaRequests();
	[[nodiscard]] auto streamComplete() const -> bool;
	void failIfInputExhausted();
	void stop(u32 statusWord);
	void resumeConfigWrites();
	void notifySupervisorBoundary();

	static u32 readProgressThunk(void* context, u32 address, MappedBusSignals busSignals);
	static void writeConfigThunk(void* context, u32 address, u32 value, MappedBusSignals busSignals);
	static bool configWriteReadyThunk(void* context, u32 address, MappedBusSignals busSignals);
	static u32 readDataThunk(void* context, u32 address, MappedBusSignals busSignals);
	static void writeDataThunk(void* context, u32 address, u32 value, MappedBusSignals busSignals);
	static bool dataWriteReadyThunk(void* context, u32 address, MappedBusSignals busSignals);

	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	DmaController& m_dma;
	i64 m_cyclesPerOutputWord;
	WordFifo<IMGDEC_INPUT_FIFO_WORD_CAPACITY> m_inputFifo;
	WordFifo<IMGDEC_OUTPUT_FIFO_WORD_CAPACITY> m_outputFifo;
	std::array<u32, IMGDEC_HISTORY_WORD_CAPACITY> m_history{};
	size_t m_historyWriteIndex = 0u;
	size_t m_historyWordCount = 0u;
	bool m_active = false;
	u32 m_inputWordsReceived = 0u;
	u32 m_decodedWordCount = 0u;
	u32 m_textureWordCount = 0u;
	u32 m_clutWordCount = 0u;
	u32 m_outputWordCount = 0u;
	u32 m_outputWordsRead = 0u;
	u32 m_dataWord = 0u;
	u32 m_decodePhase = 0u;
	u32 m_outputStage = 0u;
	u32 m_runWordsRemaining = 0u;
	u32 m_repeatWord = 0u;
	u32 m_backReferenceDistance = 0u;
	bool m_supervisorQuiesceRequested = false;
	u32 m_scheduledDecodeWords = 0u;
	i64 m_decodeDeadline = -1;
};

} // namespace bmsx
