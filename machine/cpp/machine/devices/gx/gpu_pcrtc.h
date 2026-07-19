#pragma once

#include "common/primitives.h"
#include "machine/memory/bus_signals.h"

#include <array>

namespace bmsx {

class Memory;

constexpr u32 GX_GPU_PCRTC_WORD_COUNT = 12u;
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

constexpr u32 GX_GPU_PCRTC_PMODE_EN1 = 1u << 0u;
constexpr u32 GX_GPU_PCRTC_PMODE_EN2 = 1u << 1u;
constexpr u32 GX_GPU_PCRTC_PMODE_MMOD = 1u << 5u;
constexpr u32 GX_GPU_PCRTC_PMODE_AMOD = 1u << 6u;
constexpr u32 GX_GPU_PCRTC_PMODE_SLBG = 1u << 7u;
constexpr u32 GX_GPU_PCRTC_PMODE_ALP_SHIFT = 8u;

constexpr u32 GX_GPU_PCRTC_PSMCT32 = 0u;
constexpr u32 GX_GPU_PCRTC_PSMCT24 = 1u;
constexpr u32 GX_GPU_PCRTC_PSMCT16 = 2u;
constexpr u32 GX_GPU_PCRTC_PSMCT16S = 10u;
constexpr u32 GX_GPU_PCRTC_PSGPU24 = 18u;

constexpr u32 GX_GPU_PCRTC_RESET_DISPFB_LOW = (16u << 9u) | (GX_GPU_PCRTC_PSMCT16 << 15u);
constexpr u32 GX_GPU_PCRTC_RESET_DISPLAY_LOW = 0u;
constexpr u32 GX_GPU_PCRTC_RESET_DISPLAY_HIGH = 319u | (239u << 12u);

struct GxGpuPcrtcState {
	std::array<u32, GX_GPU_PCRTC_WORD_COUNT> registerWords{};
	std::array<u32, GX_GPU_PCRTC_WORD_COUNT> presentWords{};
};

struct GxGpuPcrtcCircuit {
	bool enabled = false;
	u32 framebufferBaseWord = 0u;
	u32 framebufferWidth = 0u;
	u32 framebufferPsm = 0u;
	u32 framebufferX = 0u;
	u32 framebufferY = 0u;
	u32 displayX = 0u;
	u32 displayY = 0u;
	u32 displayWidth = 0u;
	u32 displayHeight = 0u;
	u32 displayRight = 0u;
	u32 displayBottom = 0u;
	u32 magnificationX = 1u;
	u32 magnificationY = 1u;
};

struct GxGpuPcrtcScanout {
	std::array<GxGpuPcrtcCircuit, 2u> circuits{};
	u32 backgroundColor = 0u;
	u32 constantAlpha = 0u;
	bool constantAlphaEnabled = false;
	bool circuit2UnderlayEnabled = false;
	u32 outputWidth = 320u;
	u32 outputHeight = 240u;
	u32 revision = 0u;

	void update(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words);
};

class GxGpuPcrtc {
public:
	explicit GxGpuPcrtc(Memory& memory);
	void reset();
	void resetActiveWords();
	bool latchPresentationWords();
	GxGpuPcrtcState captureState() const;
	void restoreState(const GxGpuPcrtcState& state);
	void captureContext(
		std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& registerWords,
		std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& presentWords) const;
	void restoreContext(
		const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& registerWords,
		const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& presentWords);
	void enterSupervisorContext(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& userPresentWords);
	const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& presentWords() const { return m_presentWords; }
	GxGpuPcrtcScanout scanout{};

private:
	std::array<u32, GX_GPU_PCRTC_WORD_COUNT> m_registerWords{};
	std::array<u32, GX_GPU_PCRTC_WORD_COUNT> m_presentWords{};

	static u64 readWordThunk(void* context, u32 address, MappedBusSignals busSignals);
	static void writeWordThunk(void* context, u32 address, u64 value, MappedBusSignals busSignals);
};

} // namespace bmsx
