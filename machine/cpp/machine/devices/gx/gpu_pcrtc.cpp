#include "machine/devices/gx/gpu_pcrtc.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {

constexpr std::array<u32, GX_GPU_PCRTC_WORD_COUNT> resetWords{
	0u,
	0u,
	GX_GPU_PCRTC_RESET_DISPFB_LOW,
	0u,
	GX_GPU_PCRTC_RESET_DISPLAY_LOW,
	GX_GPU_PCRTC_RESET_DISPLAY_HIGH,
	GX_GPU_PCRTC_RESET_DISPFB_LOW,
	0u,
	GX_GPU_PCRTC_RESET_DISPLAY_LOW,
	GX_GPU_PCRTC_RESET_DISPLAY_HIGH,
	0u,
	0u,
};

constexpr u32 circuitDispFbLowIndex(u32 circuit) {
	return circuit == 0u ? GX_GPU_PCRTC_DISPFB1_LOW : GX_GPU_PCRTC_DISPFB2_LOW;
}

constexpr u32 circuitDisplayLowIndex(u32 circuit) {
	return circuit == 0u ? GX_GPU_PCRTC_DISPLAY1_LOW : GX_GPU_PCRTC_DISPLAY2_LOW;
}

bool gxGpuPcrtcCircuitEnabled(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return (words[GX_GPU_PCRTC_PMODE_LOW] & (1u << circuit)) != 0u;
}

u32 gxGpuPcrtcFramebufferBaseWord(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return (words[circuitDispFbLowIndex(circuit)] & 0x1ffu) << 12u;
}

u32 gxGpuPcrtcFramebufferWidth(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return ((words[circuitDispFbLowIndex(circuit)] >> 9u) & 0x3fu) * 64u;
}

u32 gxGpuPcrtcFramebufferPsm(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return (words[circuitDispFbLowIndex(circuit)] >> 15u) & 0x1fu;
}

u32 gxGpuPcrtcFramebufferX(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return words[circuitDispFbLowIndex(circuit) + 1u] & 0x7ffu;
}

u32 gxGpuPcrtcFramebufferY(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return (words[circuitDispFbLowIndex(circuit) + 1u] >> 11u) & 0x7ffu;
}

u32 gxGpuPcrtcDisplayX(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return words[circuitDisplayLowIndex(circuit)] & 0xfffu;
}

u32 gxGpuPcrtcDisplayY(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return (words[circuitDisplayLowIndex(circuit)] >> 12u) & 0x7ffu;
}

u32 gxGpuPcrtcMagnificationX(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return ((words[circuitDisplayLowIndex(circuit)] >> 23u) & 0x0fu) + 1u;
}

u32 gxGpuPcrtcMagnificationY(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return ((words[circuitDisplayLowIndex(circuit)] >> 27u) & 0x03u) + 1u;
}

u32 gxGpuPcrtcDisplayWidth(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return (words[circuitDisplayLowIndex(circuit) + 1u] & 0xfffu) + 1u;
}

u32 gxGpuPcrtcDisplayHeight(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words, u32 circuit) {
	return ((words[circuitDisplayLowIndex(circuit) + 1u] >> 12u) & 0x7ffu) + 1u;
}

} // namespace

void GxGpuPcrtcScanout::update(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& words) {
	for (u32 index = 0u; index < circuits.size(); index += 1u) {
		GxGpuPcrtcCircuit& circuit = circuits[index];
		circuit.enabled = gxGpuPcrtcCircuitEnabled(words, index);
		circuit.framebufferBaseWord = gxGpuPcrtcFramebufferBaseWord(words, index);
		circuit.framebufferWidth = gxGpuPcrtcFramebufferWidth(words, index);
		circuit.framebufferPsm = gxGpuPcrtcFramebufferPsm(words, index);
		circuit.framebufferX = gxGpuPcrtcFramebufferX(words, index);
		circuit.framebufferY = gxGpuPcrtcFramebufferY(words, index);
		circuit.displayX = gxGpuPcrtcDisplayX(words, index);
		circuit.displayY = gxGpuPcrtcDisplayY(words, index);
		circuit.displayWidth = gxGpuPcrtcDisplayWidth(words, index);
		circuit.displayHeight = gxGpuPcrtcDisplayHeight(words, index);
		circuit.displayRight = circuit.displayX + circuit.displayWidth;
		circuit.displayBottom = circuit.displayY + circuit.displayHeight;
		circuit.magnificationX = gxGpuPcrtcMagnificationX(words, index);
		circuit.magnificationY = gxGpuPcrtcMagnificationY(words, index);
	}
	const u32 pmode = words[GX_GPU_PCRTC_PMODE_LOW];
	backgroundColor = words[GX_GPU_PCRTC_BGCOLOR_LOW] & 0x00ffffffu;
	constantAlpha = (pmode >> GX_GPU_PCRTC_PMODE_ALP_SHIFT) & 0xffu;
	constantAlphaEnabled = (pmode & GX_GPU_PCRTC_PMODE_MMOD) != 0u;
	circuit2UnderlayEnabled = circuits[1u].enabled && (pmode & GX_GPU_PCRTC_PMODE_SLBG) == 0u;

	const GxGpuPcrtcCircuit& primaryCircuit = circuits[1u].enabled && !circuits[0u].enabled
		? circuits[1u]
		: circuits[0u];
	outputWidth = primaryCircuit.displayRight;
	outputHeight = primaryCircuit.displayBottom;
	if (circuits[0u].enabled && circuits[1u].enabled) {
		if (circuits[1u].displayRight > outputWidth) {
			outputWidth = circuits[1u].displayRight;
		}
		if (circuits[1u].displayBottom > outputHeight) {
			outputHeight = circuits[1u].displayBottom;
		}
	}
	revision += 1u;
}

GxGpuPcrtc::GxGpuPcrtc(Memory& memory) {
	for (u32 index = 0u; index < GX_GPU_PCRTC_WORD_COUNT; index += 1u) {
		const u32 address = IO_GX_PCRTC_BASE + index * IO_WORD_SIZE;
		memory.mapIoRead(address, this, &GxGpuPcrtc::readWordThunk);
		memory.mapIoWrite(address, this, &GxGpuPcrtc::writeWordThunk);
	}
}

void GxGpuPcrtc::reset() {
	m_registerWords = resetWords;
	m_presentWords = resetWords;
	scanout.update(m_presentWords);
}

void GxGpuPcrtc::resetActiveWords() {
	m_registerWords = resetWords;
}

bool GxGpuPcrtc::latchPresentationWords() {
	if (m_registerWords == m_presentWords) {
		return false;
	}
	m_presentWords = m_registerWords;
	scanout.update(m_presentWords);
	return true;
}

GxGpuPcrtcState GxGpuPcrtc::captureState() const {
	return {m_registerWords, m_presentWords};
}

void GxGpuPcrtc::restoreState(const GxGpuPcrtcState& state) {
	m_registerWords = state.registerWords;
	m_presentWords = state.presentWords;
	scanout.update(m_presentWords);
}

void GxGpuPcrtc::captureContext(
	std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& registerWords,
	std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& presentWords) const {
	registerWords = m_registerWords;
	presentWords = m_presentWords;
}

void GxGpuPcrtc::restoreContext(
	const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& registerWords,
	const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& presentWords) {
	m_registerWords = registerWords;
	m_presentWords = presentWords;
	scanout.update(m_presentWords);
}

void GxGpuPcrtc::enterSupervisorContext(const std::array<u32, GX_GPU_PCRTC_WORD_COUNT>& userPresentWords) {
	resetActiveWords();
	m_registerWords[GX_GPU_PCRTC_PMODE_LOW] = (userPresentWords[GX_GPU_PCRTC_PMODE_LOW] & GX_GPU_PCRTC_PMODE_EN1) << 1u;
	m_registerWords[GX_GPU_PCRTC_DISPFB2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPFB1_LOW];
	m_registerWords[GX_GPU_PCRTC_DISPFB2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPFB1_HIGH];
	m_registerWords[GX_GPU_PCRTC_DISPLAY2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_LOW];
	m_registerWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_HIGH];
	m_registerWords[GX_GPU_PCRTC_BGCOLOR_LOW] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_LOW];
	m_registerWords[GX_GPU_PCRTC_BGCOLOR_HIGH] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_HIGH];
	m_presentWords = m_registerWords;
	scanout.update(m_presentWords);
}

u64 GxGpuPcrtc::readWordThunk(void* context, u32 address, MappedBusSignals) {
	const GxGpuPcrtc& pcrtc = *static_cast<GxGpuPcrtc*>(context);
	return valueNumber(static_cast<double>(pcrtc.m_registerWords[(address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE]));
}

void GxGpuPcrtc::writeWordThunk(void* context, u32 address, u64 value, MappedBusSignals) {
	GxGpuPcrtc& pcrtc = *static_cast<GxGpuPcrtc*>(context);
	pcrtc.m_registerWords[(address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE] = toU32(value);
}

} // namespace bmsx
