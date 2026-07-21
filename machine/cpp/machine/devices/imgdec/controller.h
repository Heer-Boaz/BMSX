#pragma once

#include "common/primitives.h"
#include "machine/devices/imgdec/contracts.h"
#include "machine/devices/imgdec/word_fifo.h"
#include "machine/memory/bus_signals.h"

#include <array>
#include <vector>

namespace bmsx {

class CPU;
class DeviceScheduler;
class DmaController;
class GxGpu;
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
		GxGpu& gpu,
		i64 cyclesPerOutputWord
	);

	void reset();
	[[nodiscard]] auto captureState() const -> ImgDecControllerState;
	void restoreState(const ImgDecControllerState& state);
	void onService(i64 nowCycles);
	void beginSupervisorQuiesce();
	[[nodiscard]] auto supervisorQuiescent() const -> bool { return !m_active; }
	void enterSupervisorFaultContext();
	void leaveSupervisorContext();

private:
	void resetStreamState();
	void start();
	void advanceOutputStage();
	void prepareDecodeRun();
	auto scheduleDecode(i64 anchorCycle) -> bool;
	void decodeScheduledWords();
	void drainOutput(i64 nowCycles);
	void emitPayloadWord(u32 word);
	void completeRunWord();
	void updateInputRequest();
	[[nodiscard]] auto streamComplete() const -> bool;
	void failIfInputExhausted();
	void finish();
	void fail(u32 statusWord);
	void setStatusBit(u32 bit, bool set);
	void resumeConfigWrites();
	void notifySupervisorBoundary();

	static u64 readProgressThunk(void* context, u32 address, MappedBusSignals busSignals);
	static void writeConfigThunk(void* context, u32 address, u64 value, MappedBusSignals busSignals);
	static bool configWriteReadyThunk(void* context, u32 address);
	static void writeDataThunk(void* context, u32 address, u64 value, MappedBusSignals busSignals);
	static bool dataWriteReadyThunk(void* context, u32 address);

	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	DmaController& m_dma;
	GxGpu& m_gpu;
	i64 m_cyclesPerOutputWord;
	ImgDecWordFifo<IMGDEC_INPUT_FIFO_WORD_CAPACITY> m_inputFifo;
	ImgDecWordFifo<IMGDEC_OUTPUT_FIFO_WORD_CAPACITY> m_outputFifo;
	std::array<u32, IMGDEC_HISTORY_WORD_CAPACITY> m_history{};
	size_t m_historyWriteIndex = 0u;
	size_t m_historyWordCount = 0u;
	bool m_active = false;
	u32 m_inputWordsReceived = 0u;
	u32 m_decodedWordCount = 0u;
	u32 m_textureWordCount = 0u;
	u32 m_clutWordCount = 0u;
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
