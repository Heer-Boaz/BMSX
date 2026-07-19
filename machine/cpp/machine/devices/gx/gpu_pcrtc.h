#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_local_memory.h"

#include <array>

namespace bmsx {

constexpr u32 GX_GPU_PCRTC_WORD_COUNT = 26u;
constexpr u32 GX_GPU_PCRTC_CONFIG_WORD_COUNT = 22u;
constexpr u32 GX_GPU_PCRTC_COMPOSITION_WORD_COUNT = 12u;
constexpr u32 GX_GPU_PCRTC_PMODE_LOW = 0u;
constexpr u32 GX_GPU_PCRTC_PMODE_HIGH = 1u;
constexpr u32 GX_GPU_PCRTC_DISPFB1_LOW = 2u;
constexpr u32 GX_GPU_PCRTC_DISPFB1_HIGH = 3u;
constexpr u32 GX_GPU_PCRTC_DISPLAY1_LOW = 4u;
constexpr u32 GX_GPU_PCRTC_DISPLAY1_HIGH = 5u;
constexpr u32 GX_GPU_PCRTC_DISPFB2_LOW = 6u;
constexpr u32 GX_GPU_PCRTC_DISPFB2_HIGH = 7u;
constexpr u32 GX_GPU_PCRTC_DISPLAY2_LOW = 8u;
constexpr u32 GX_GPU_PCRTC_DISPLAY2_HIGH = 9u;
constexpr u32 GX_GPU_PCRTC_BGCOLOR_LOW = 10u;
constexpr u32 GX_GPU_PCRTC_BGCOLOR_HIGH = 11u;
constexpr u32 GX_GPU_PCRTC_SMODE1_LOW = 12u;
constexpr u32 GX_GPU_PCRTC_SMODE1_HIGH = 13u;
constexpr u32 GX_GPU_PCRTC_SMODE2_LOW = 14u;
constexpr u32 GX_GPU_PCRTC_SMODE2_HIGH = 15u;
constexpr u32 GX_GPU_PCRTC_SYNCH1_LOW = 16u;
constexpr u32 GX_GPU_PCRTC_SYNCH1_HIGH = 17u;
constexpr u32 GX_GPU_PCRTC_SYNCH2_LOW = 18u;
constexpr u32 GX_GPU_PCRTC_SYNCH2_HIGH = 19u;
constexpr u32 GX_GPU_PCRTC_SYNCV_LOW = 20u;
constexpr u32 GX_GPU_PCRTC_SYNCV_HIGH = 21u;
constexpr u32 GX_GPU_PCRTC_CSR_LOW = 22u;
constexpr u32 GX_GPU_PCRTC_CSR_HIGH = 23u;
constexpr u32 GX_GPU_PCRTC_IMR_LOW = 24u;
constexpr u32 GX_GPU_PCRTC_IMR_HIGH = 25u;

constexpr u32 GX_GPU_PCRTC_PMODE_EN1 = 1u << 0u;
constexpr u32 GX_GPU_PCRTC_PMODE_EN2 = 1u << 1u;
constexpr u32 GX_GPU_PCRTC_PMODE_MMOD = 1u << 5u;
constexpr u32 GX_GPU_PCRTC_PMODE_AMOD = 1u << 6u;
constexpr u32 GX_GPU_PCRTC_PMODE_SLBG = 1u << 7u;
constexpr u32 GX_GPU_PCRTC_PMODE_ALP_SHIFT = 8u;
constexpr u32 GX_GPU_PCRTC_SMODE1_PRST = 1u << 16u;
constexpr u32 GX_GPU_PCRTC_SMODE1_SINT = 1u << 17u;
constexpr u32 GX_GPU_PCRTC_SMODE2_INT = 1u << 0u;
constexpr u32 GX_GPU_PCRTC_SMODE2_FFMD = 1u << 1u;
constexpr u32 GX_GPU_PCRTC_CSR_SIGNAL = 1u << 0u;
constexpr u32 GX_GPU_PCRTC_CSR_FINISH = 1u << 1u;
constexpr u32 GX_GPU_PCRTC_CSR_HSINT = 1u << 2u;
constexpr u32 GX_GPU_PCRTC_CSR_VSINT = 1u << 3u;
constexpr u32 GX_GPU_PCRTC_CSR_EDWINT = 1u << 4u;
constexpr u32 GX_GPU_PCRTC_CSR_EVENT_MASK = 0x1fu;
constexpr u32 GX_GPU_PCRTC_CSR_FLUSH = 1u << 8u;
constexpr u32 GX_GPU_PCRTC_CSR_RESET = 1u << 9u;
constexpr u32 GX_GPU_PCRTC_CSR_FIELD = 1u << 13u;
constexpr u32 GX_GPU_PCRTC_CSR_ACTION_MASK = GX_GPU_PCRTC_CSR_FLUSH | GX_GPU_PCRTC_CSR_RESET;
constexpr u32 GX_GPU_PCRTC_IMR_EVENT_MASK = 0x1f00u;
constexpr u32 GX_GPU_PCRTC_IMR_FIXED_BITS = 0x6000u;

constexpr u32 GX_GPU_PCRTC_COMPOSE_GENERIC = 0u;
constexpr u32 GX_GPU_PCRTC_COMPOSE_GX16 = 1u;
constexpr u32 GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1 = 2u;

constexpr u32 GX_GPU_PCRTC_RESET_DISPFB_LOW = (16u << 9u) | (GX_GPU_PSMGX16 << 15u);
constexpr u32 GX_GPU_PCRTC_RESET_DISPLAY_LOW = 0x018252a8u;
constexpr u32 GX_GPU_PCRTC_RESET_DISPLAY_HIGH = 0x000ef4ffu;
constexpr u32 GX_GPU_PCRTC_RESET_CSR_WORD = 0x551b4000u;
constexpr u32 GX_GPU_PCRTC_RESET_IMR_WORD = 0x00007f00u;
constexpr i64 GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED = 49'761'146;
constexpr u32 GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES = 628u;
constexpr u32 GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES = 576u;
constexpr u32 GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT = 18u;

constexpr u32 GX_GPU_PCRTC_RUNTIME_EDGE_NONE = 0u;
constexpr u32 GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN = 1u;
constexpr u32 GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END = 2u;
constexpr u32 GX_GPU_PCRTC_SERVICE_RUNTIME_EDGE_MASK = 0x3u;
constexpr u32 GX_GPU_PCRTC_SERVICE_IRQ = 1u << 2u;

u32 gxGpuPcrtcRegisterAddress(u32 index);

struct GxGpuPcrtcState {
	std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> registerWords{};
	std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> presentWords{};
	u32 csrWord = GX_GPU_PCRTC_RESET_CSR_WORD;
	u32 imrWord = GX_GPU_PCRTC_RESET_IMR_WORD;
	i64 beamCycleOffset = 0;
	u32 beamRemainder = 0u;
	u32 beamHalfLine = 0u;
	u32 nextHsyncHalfLine = 2u;
	u32 verticalStage = 0u;
	bool vblankActive = false;
};

struct GxGpuPcrtcCircuit {
	bool enabled = false;
	u32 framebufferBaseWord = 0u;
	u32 framebufferWidth = 0u;
	u32 framebufferPagesPerRow = 0u;
	u32 framebufferPsm = 0u;
	u32 framebufferX = 0u;
	u32 framebufferY = 0u;
	u32 displayX = 0u;
	u32 displayY = 0u;
	u32 displaySignalX = 0u;
	u32 displaySignalY = 0u;
	u32 displayWidth = 0u;
	u32 displayHeight = 0u;
	u32 displayRight = 0u;
	u32 displayBottom = 0u;
	u32 sourcePhaseX = 0u;
	u32 sourcePhaseY = 0u;
	u32 sourceStepX = 1u;
	u32 sourceStepY = 1u;
	u32 sourceAdvanceX = 1u;
	u32 sourceRemainderStepX = 0u;
	u32 sourceDivisionMultiplierX = 1u << GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT;
	u32 sourceDivisionMultiplierY = 1u << GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT;
	u32 interlacedSourceDivisionMultiplierY = 1u << (GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT - 1u);
	u32 fieldSourcePhase = 0u;
	u32 fieldSourceStride = 1u;
	u32 magnificationX = 1u;
	u32 magnificationY = 1u;
	bool linearSampling = true;
};

struct GxGpuPcrtcTiming {
	u32 signalStepX = 4u;
	u32 halfLineClockNumerator = 27'648u;
	u32 halfLineClockDenominator = 864'000'000u;
	u32 totalHalfLines = GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES;
	u32 activeDisplayHalfLines = GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES;
	u32 vsyncHalfLine = 585u;
	i64 nextVblankCycleBudget = 1;
	i64 refreshUfpsScaled = GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED;
	bool fieldToggles = true;
	bool running = true;
	u32 revision = 0u;

	void update(const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& words);
};

struct GxGpuPcrtcScanout {
	std::array<GxGpuPcrtcCircuit, 2u> circuits{};
	u32 backgroundColor = 0u;
	u32 blendAlpha = 0u;
	bool blendAlphaFromRegister = false;
	bool preserveUnderlayAlpha = false;
	bool circuit2SampleRequired = false;
	bool circuit2CoversOutput = false;
	bool interlaced = false;
	bool frameMode = false;
	u32 field = 0u;
	u32 cropSignalX = 0u;
	u32 cropSignalY = 0u;
	u32 compositionPath = GX_GPU_PCRTC_COMPOSE_GENERIC;
	u32 outputWidth = 0u;
	u32 outputHeight = 0u;
	u32 revision = 0u;

	void setField(u32 value);
	void update(
		const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& words,
		const GxGpuPcrtcTiming& timing);
};

class GxGpuPcrtc {
public:
	void reset(i64 nowCycles);
	u32 readRegisterWord(u32 index) const;
	bool writeConfigWord(u32 index, u32 word, i64 nowCycles);
	bool setCpuHz(i64 cpuHz, i64 nowCycles);
	u32 readCsr() const { return m_csrWord; }
	u32 readImr() const { return m_imrWord; }
	u32 writeCsr(u32 word, i64 nowCycles);
	bool writeImr(u32 word);
	bool hsyncPending() const { return (m_csrWord & GX_GPU_PCRTC_CSR_HSINT) != 0u; }
	bool vblankActive() const { return m_beamVblankActive; }
	u32 field() const { return (m_csrWord >> 13u) & 1u; }
	u32 currentHalfLine(i64 nowCycles) const;
	i64 nextDeadlineCycle() const;
	u32 service(i64 nowCycles);
	bool latchPresentationWords();
	GxGpuPcrtcState captureState(i64 nowCycles) const;
	void restoreState(const GxGpuPcrtcState& state, i64 nowCycles);
	void captureContext(
		std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& registerWords,
		std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& presentWords) const;
	void restoreContext(
		const std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& registerWords,
		const std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& presentWords);
	void enterSupervisorContext(const std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& userPresentWords);
	const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& presentWords() const { return m_presentWords; }
	GxGpuPcrtcTiming timing{};
	GxGpuPcrtcScanout scanout{};

private:
	std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> m_registerWords{};
	std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> m_presentWords{};
	GxGpuPcrtcTiming m_presentationTiming{};
	u32 m_csrWord = GX_GPU_PCRTC_RESET_CSR_WORD;
	u32 m_imrWord = GX_GPU_PCRTC_RESET_IMR_WORD;
	i64 m_cpuHz = 1;
	i64 m_halfLineSystemNumerator = 0;
	i64 m_halfLineBaseCycles = 0;
	u32 m_halfLineRemainderCycles = 0u;
	i64 m_beamCycle = 0;
	u32 m_beamRemainder = 0u;
	u32 m_beamHalfLine = 0u;
	u32 m_nextHsyncHalfLine = 2u;
	u32 m_verticalStage = 0u;
	bool m_beamVblankActive = false;
	bool m_presentationWordsDirty = false;
	bool m_presentationTimingDirty = false;

	void resetCompositionWords();
	void refreshPresentationDirtyState();
	void publishConfiguration();
	void configureHalfLinePeriod();
	void restartBeam(i64 nowCycles);
	u32 verticalEventHalfLine() const;
	i64 deadlineAtHalfLine(u32 halfLine) const;
	void advanceBeam(u32 halfLine);
	void resumeHsync(i64 nowCycles);
	u32 elapsedHalfLines(i64 nowCycles) const;
	void skipSuppressedHsyncs(u32 halfLine);
	u32 periodicEventCount(u32 firstHalfLine, u32 targetHalfLine) const;
	bool raiseEvent(u32 event);
};

} // namespace bmsx
