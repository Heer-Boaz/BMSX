#pragma once

#include "common/primitives.h"
#include "spec/imgdec/registers.h"
#include "spec/imgdec/stream.h"
#include "machine/devices/word_fifo.h"
#include "machine/memory/bus_signals.h"

#include <array>
#include <vector>

namespace bmsx {

class CPU;
class DeviceScheduler;
class DmaController;
class IrqController;
class Memory;

struct ImgDecControllerState {
	u32 inputWordCountWord = 0;
	u32 outputWordCountWord = 0;
	u32 controlWord = 0;
	u32 statusWord = 0;
	u32 dataWord = 0;
	u32 inputWordsReceived = 0;
	u32 assembledWordCount = 0;
	u32 decodedWordCount = 0;
	u32 outputWordsRead = 0;
	u32 decodePhase = 0;
	u32 runWordsRemaining = 0;
	u32 repeatWord = 0;
	u32 backReferenceDistance = 0;
	u32 blockPhase = 0;
	i64 blockCyclesRemaining = 0;
	bool supervisorQuiesceRequested = false;
	std::vector<u32> inputWords;
	std::vector<u32> historyWords;
};

class ImgDecController final {
public:
	ImgDecController(Memory&, CPU&, IrqController&, DeviceScheduler&, DmaController&, i64 cyclesPerOutputWord);
	void reset();
	ImgDecControllerState captureState() const;
	void restoreState(const ImgDecControllerState& state);
	void onService(i64 nowCycles);
	void beginSupervisorQuiesce();
	bool supervisorQuiescent() const;
	void leaveSupervisorContext();

private:
	void resetStreamState();
	void start();
	void execute(i64 nowCycles);
	void preparePayloadWords(u32 count);
	void updateDmaRequests();
	void stop(u32 statusWord);
	void resumeConfigWrites();
	void notifySupervisorBoundary();
	void mirrorRegisters();

	static u32 readProgressThunk(void*, u32, MappedBusSignals);
	static void writeConfigThunk(void*, u32, u32, MappedBusSignals);
	static bool configWriteReadyThunk(void*, u32, MappedBusSignals);
	static const u32* readDataPrefixThunk(void*, u32 count);
	static void writeMappedDataPrefixThunk(void*, Span<const u8>);
	static u32 readDataThunk(void*, u32, MappedBusSignals);
	static void writeDataThunk(void*, u32, u32, MappedBusSignals);
	static bool dataWriteReadyThunk(void*, u32, MappedBusSignals);

	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	DmaController& m_dma;
	i64 m_cyclesPerOutputWord;
	WordFifo<IMGDEC_INPUT_FIFO_WORD_CAPACITY> m_inputFifo;
	// The consumer drains a published block before assembly can reuse the ring.
	std::array<u32, IMGDEC_HISTORY_WORD_CAPACITY> m_history{};
	u32 m_inputWordCountWord = 0;
	u32 m_outputWordCountWord = 0;
	u32 m_controlWord = 0;
	u32 m_statusWord = 0;
	u32 m_dataWord = 0;
	u32 m_inputWordsReceived = 0;
	u32 m_assembledWordCount = 0;
	u32 m_decodedWordCount = 0;
	u32 m_outputWordsRead = 0;
	u32 m_decodePhase = 0;
	u32 m_runWordsRemaining = 0;
	u32 m_repeatWord = 0;
	u32 m_backReferenceDistance = 0;
	u32 m_blockPhase = 0;
	i64 m_blockDeadline = -1;
	bool m_supervisorQuiesceRequested = false;
};

} // namespace bmsx
