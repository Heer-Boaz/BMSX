#include "machine/devices/gx/gpu_pcrtc.h"

#include "machine/bus/io.h"

namespace bmsx {
namespace {

static_assert(GX_GPU_PCRTC_WORD_COUNT == IO_GX_PCRTC_WORD_COUNT + IO_GX_PCRTC_TIMING_WORD_COUNT);

constexpr i64 PCRTC_REFERENCE_CLOCK_HZ = 13'500'000;
constexpr i64 PCRTC_HZ_SCALE = 1'000'000;
constexpr u32 PCRTC_SOURCE_DIVISION_SCALE = 1u << GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT;
constexpr u32 GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN = 0u;
constexpr u32 GX_GPU_PCRTC_VERTICAL_STAGE_VSYNC = 1u;
constexpr u32 GX_GPU_PCRTC_VERTICAL_STAGE_FIELD_END = 2u;

constexpr std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> resetConfigWords{
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
	0x40806504u,
	0x00000007u,
	0u,
	0u,
	0x1fc83030u,
	0x0007f5c2u,
	0x003484bcu,
	0u,
	0x02101404u,
	0x00a90005u,
};

constexpr u32 circuitDispFbLowIndex(u32 circuit) {
	return circuit == 0u ? GX_GPU_PCRTC_DISPFB1_LOW : GX_GPU_PCRTC_DISPFB2_LOW;
}

constexpr u32 circuitDisplayLowIndex(u32 circuit) {
	return circuit == 0u ? GX_GPU_PCRTC_DISPLAY1_LOW : GX_GPU_PCRTC_DISPLAY2_LOW;
}

constexpr u32 sourceDivisionMultiplier(u32 divisor) {
	return (PCRTC_SOURCE_DIVISION_SCALE + divisor - 1u) / divisor;
}

constexpr u32 framebufferStoragePath(u32 psm, u32 circuit) {
	switch (psm) {
	case GX_GPU_PSMCT32: return GX_GPU_PCRTC_STORAGE_CT32;
	case GX_GPU_PSMCT24: return GX_GPU_PCRTC_STORAGE_CT24;
	case GX_GPU_PSMCT16: return GX_GPU_PCRTC_STORAGE_CT16;
	case GX_GPU_PSMCT16S: return GX_GPU_PCRTC_STORAGE_CT16S;
	case GX_GPU_PSGPU24: return circuit == 0u ? GX_GPU_PCRTC_STORAGE_GPU24 : GX_GPU_PCRTC_STORAGE_ZERO;
	case GX_GPU_PSMGX16: return GX_GPU_PCRTC_STORAGE_GX16;
	default: return GX_GPU_PCRTC_STORAGE_ZERO;
	}
}

void updateFieldTraversal(GxGpuPcrtcCircuit& circuit, bool interlaced, u32 field, u32 outputRowStep) {
	circuit.fieldDisplayY = interlaced
		? circuit.displayY + ((circuit.displayY ^ field) & 1u)
		: circuit.displayY;
	circuit.fieldDisplayLineCount = circuit.fieldDisplayY < circuit.displayBottom
		? ((circuit.displayBottom - circuit.fieldDisplayY - 1u) / outputRowStep) + 1u
		: 0u;
	const u32 relativeY = circuit.fieldDisplayY - circuit.displayY;
	circuit.fieldSourceNumeratorY = circuit.sourcePhaseY + relativeY * circuit.sourceStepY;
	circuit.fieldSourceNumeratorStepY = outputRowStep * circuit.sourceStepY;
	circuit.fieldSourceDivisionMultiplierY = interlaced
		? circuit.interlacedSourceDivisionMultiplierY
		: circuit.sourceDivisionMultiplierY;
	circuit.linearFieldSourceY = circuit.framebufferY + (interlaced
		? (relativeY >> 1u) * circuit.fieldSourceStride + circuit.fieldSourcePhase
		: relativeY);
	circuit.linearFieldSourceRowStep = interlaced ? circuit.fieldSourceStride : 1u;
}

constexpr bool isBeamTimingWord(u32 index) {
	return index == GX_GPU_PCRTC_SMODE1_LOW
		|| index == GX_GPU_PCRTC_SMODE1_HIGH
		|| (index >= GX_GPU_PCRTC_SYNCH1_LOW && index <= GX_GPU_PCRTC_SYNCV_HIGH);
}

} // namespace

u32 gxGpuPcrtcRegisterAddress(u32 index) {
	return index < IO_GX_PCRTC_WORD_COUNT
		? IO_GX_PCRTC_BASE + index * IO_WORD_SIZE
		: IO_GX_PCRTC_TIMING_BASE + (index - IO_GX_PCRTC_WORD_COUNT) * IO_WORD_SIZE;
}

void GxGpuPcrtcTiming::update(const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& words) {
	const u32 smode1 = words[GX_GPU_PCRTC_SMODE1_LOW];
	const u32 smode1High = words[GX_GPU_PCRTC_SMODE1_HIGH];
	const u32 synch1Low = words[GX_GPU_PCRTC_SYNCH1_LOW];
	const u32 synch1High = words[GX_GPU_PCRTC_SYNCH1_HIGH];
	const u32 synch2Low = words[GX_GPU_PCRTC_SYNCH2_LOW];
	const u32 syncvLow = words[GX_GPU_PCRTC_SYNCV_LOW];
	const u32 syncvHigh = words[GX_GPU_PCRTC_SYNCV_HIGH];
	const u32 hfp = synch1Low & 0x7ffu;
	const u32 hbp = (synch1Low >> 11u) & 0x7ffu;
	const u32 hs = (synch1High >> 11u) & 0xffffu;
	const u32 hf = synch2Low & 0x7ffu;
	const u32 hb = (synch2Low >> 11u) & 0xffffu;
	const u32 horizontalTotal = hfp + hbp + hs + hf + hb;
	const u32 vfp = syncvLow & 0x3ffu;
	const u32 vfpe = (syncvLow >> 10u) & 0x3ffu;
	const u32 vbp = syncvLow >> 20u;
	const u32 vbpe = syncvHigh & 0x3ffu;
	const u32 vdp = (syncvHigh >> 10u) & 0x7ffu;
	const u32 vs = (syncvHigh >> 21u) & 0x7ffu;
	const u32 cmod = (smode1 >> 13u) & 0x3u;
	const u32 verticalUnitHalfLines = ((smode1High >> 4u) & 1u) != 0u ? 2u : 1u;
	const u32 verticalTotal = vfp + vfpe + vbp + vbpe + vdp + vs;
	const u32 rc = smode1 & 0x7u;
	const u32 lc = (smode1 >> 3u) & 0x7fu;
	const u32 referenceDivider = rc * (((smode1 >> 10u) & 0x3u) + 1u);
	signalStepX = (smode1 >> 21u) & 0x0fu;
	halfLineClockNumerator = horizontalTotal * referenceDivider;
	halfLineClockDenominator = 2u * static_cast<u32>(PCRTC_REFERENCE_CLOCK_HZ) * lc;
	totalHalfLines = verticalTotal * verticalUnitHalfLines;
	activeDisplayHalfLines = vdp * verticalUnitHalfLines;
	vsyncHalfLine = (vdp + vfp + vfpe) * verticalUnitHalfLines;
	running = (smode1 & (GX_GPU_PCRTC_SMODE1_SINT | GX_GPU_PCRTC_SMODE1_PRST)) == 0u
		&& halfLineClockNumerator != 0u
		&& halfLineClockDenominator != 0u
		&& totalHalfLines != 0u;
	if (running) {
		refreshUfpsScaled = static_cast<i64>(halfLineClockDenominator) * PCRTC_HZ_SCALE
			/ (static_cast<i64>(halfLineClockNumerator) * totalHalfLines);
	} else {
		refreshUfpsScaled = 0;
	}
	fieldToggles = cmod != 0u && (vfp & 1u) != 0u;
	revision += 1u;
}

void GxGpuPcrtcScanout::update(
	const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& words,
	const GxGpuPcrtcTiming& timing) {
	const u32 pmode = words[GX_GPU_PCRTC_PMODE_LOW];
	const u32 smode2 = words[GX_GPU_PCRTC_SMODE2_LOW];
	for (u32 index = 0u; index < circuits.size(); index += 1u) {
		GxGpuPcrtcCircuit& circuit = circuits[index];
		const u32 dispFbLowIndex = circuitDispFbLowIndex(index);
		const u32 displayLowIndex = circuitDisplayLowIndex(index);
		const u32 dispFbLow = words[dispFbLowIndex];
		const u32 dispFbHigh = words[dispFbLowIndex + 1u];
		const u32 displayLow = words[displayLowIndex];
		circuit.enabled = (pmode >> index) & 1u;
		circuit.framebufferBaseWord = (dispFbLow & 0x1ffu) << 12u;
		circuit.framebufferWidth = ((dispFbLow >> 9u) & 0x3fu) * 64u;
		circuit.framebufferPagesPerRow = (dispFbLow >> 9u) & 0x3fu;
		const u32 psm = (dispFbLow >> 15u) & 0x1fu;
		circuit.framebufferStoragePath = framebufferStoragePath(psm, index);
		circuit.framebufferX = dispFbHigh & 0x7ffu;
		circuit.framebufferY = (dispFbHigh >> 11u) & 0x7ffu;
		circuit.displaySignalX = displayLow & 0xfffu;
		circuit.displaySignalY = (displayLow >> 12u) & 0x7ffu;
		circuit.magnificationX = ((displayLow >> 23u) & 0x0fu) + 1u;
		circuit.magnificationY = ((displayLow >> 27u) & 0x03u) + 1u;
		circuit.sourceStepX = timing.signalStepX;
		circuit.sourceStepY = 1u;
		circuit.sourceAdvanceX = timing.signalStepX / circuit.magnificationX;
		circuit.sourceRemainderStepX = timing.signalStepX % circuit.magnificationX;
		circuit.sourceDivisionMultiplierX = sourceDivisionMultiplier(circuit.magnificationX);
		circuit.sourceDivisionMultiplierY = sourceDivisionMultiplier(circuit.magnificationY);
		circuit.interlacedSourceDivisionMultiplierY = sourceDivisionMultiplier(circuit.magnificationY << 1u);
	}
	GxGpuPcrtcCircuit& circuit1 = circuits[0u];
	GxGpuPcrtcCircuit& circuit2 = circuits[1u];
	const bool pixelOutputActive = timing.running && timing.signalStepX != 0u;
	const bool anyEnabled = pixelOutputActive && (circuit1.enabled || circuit2.enabled);
	u32 cropSignalX = circuit1.enabled ? circuit1.displaySignalX : circuit2.displaySignalX;
	u32 cropSignalY = circuit1.enabled ? circuit1.displaySignalY : circuit2.displaySignalY;
	if (circuit1.enabled && circuit2.enabled) {
		if (circuit2.displaySignalX < cropSignalX) cropSignalX = circuit2.displaySignalX;
		if (circuit2.displaySignalY < cropSignalY) cropSignalY = circuit2.displaySignalY;
	}
	this->cropSignalX = anyEnabled ? cropSignalX : 0u;
	this->cropSignalY = anyEnabled ? cropSignalY : 0u;
	const u32 signalStepX = timing.signalStepX;
	const u32 cropPixelX = anyEnabled ? (cropSignalX + signalStepX - 1u) / signalStepX : 0u;
	for (u32 index = 0u; index < circuits.size(); index += 1u) {
		GxGpuPcrtcCircuit& circuit = circuits[index];
		if (!circuit.enabled || !pixelOutputActive) {
			circuit.displayX = 0u;
			circuit.displayY = 0u;
			circuit.displayWidth = 0u;
			circuit.displayHeight = 0u;
			circuit.displayRight = 0u;
			circuit.displayBottom = 0u;
			circuit.sourcePhaseX = 0u;
			circuit.sourcePhaseY = 0u;
			circuit.fieldSourcePhase = 0u;
			circuit.fieldSourceStride = 1u;
			circuit.linearSampling = false;
			continue;
		}
		const u32 displayHigh = words[circuitDisplayLowIndex(index) + 1u];
		const u32 absoluteSignalRight = circuit.displaySignalX + (displayHigh & 0xfffu) + 1u;
		const u32 absoluteDisplayX = (circuit.displaySignalX + signalStepX - 1u) / signalStepX;
		const u32 absoluteDisplayRight = (absoluteSignalRight + signalStepX - 1u) / signalStepX;
		circuit.displayX = absoluteDisplayX - cropPixelX;
		circuit.displayY = circuit.displaySignalY - cropSignalY;
		circuit.displayRight = absoluteDisplayRight - cropPixelX;
		circuit.displayBottom = circuit.displayY + ((displayHigh >> 12u) & 0x7ffu) + 1u;
		circuit.displayWidth = circuit.displayRight - circuit.displayX;
		circuit.displayHeight = circuit.displayBottom - circuit.displayY;
		circuit.sourcePhaseX = absoluteDisplayX * signalStepX - circuit.displaySignalX;
		circuit.sourcePhaseY = 0u;
		circuit.linearSampling = circuit.sourcePhaseX == 0u
			&& signalStepX == circuit.magnificationX
			&& circuit.magnificationY == 1u;
	}
	backgroundColor = words[GX_GPU_PCRTC_BGCOLOR_LOW] & 0x00ffffffu;
	blendAlpha = (pmode >> GX_GPU_PCRTC_PMODE_ALP_SHIFT) & 0xffu;
	interlaced = (smode2 & GX_GPU_PCRTC_SMODE2_INT) != 0u;
	frameMode = interlaced && (smode2 & GX_GPU_PCRTC_SMODE2_FFMD) != 0u;
	outputRowStep = interlaced ? 2u : 1u;
	for (GxGpuPcrtcCircuit& circuit : circuits) {
		circuit.fieldSourceStride = interlaced && !frameMode ? 2u : 1u;
		circuit.fieldSourcePhase = interlaced && !frameMode ? (circuit.displaySignalY ^ field) & 1u : 0u;
		updateFieldTraversal(circuit, interlaced, field, outputRowStep);
	}

	outputWidth = circuit1.enabled ? circuit1.displayRight : circuit2.enabled ? circuit2.displayRight : 0u;
	outputHeight = circuit1.enabled ? circuit1.displayBottom : circuit2.enabled ? circuit2.displayBottom : 0u;
	if (circuit1.enabled && circuit2.enabled) {
		if (circuit2.displayRight > outputWidth) outputWidth = circuit2.displayRight;
		if (circuit2.displayBottom > outputHeight) outputHeight = circuit2.displayBottom;
	}
	const bool circuit1CoversOutput = circuit1.displayX == 0u
		&& circuit1.displayY == 0u
		&& circuit1.displayRight >= outputWidth
		&& circuit1.displayBottom >= outputHeight;
	const bool circuit2CoversOutput = circuit2.displayX == 0u
		&& circuit2.displayY == 0u
		&& circuit2.displayRight >= outputWidth
		&& circuit2.displayBottom >= outputHeight;
	const u32 mmod = (pmode >> GX_GPU_PCRTC_PMODE_MMOD_SHIFT) & 1u;
	const u32 amod = (pmode >> GX_GPU_PCRTC_PMODE_AMOD_SHIFT) & 1u;
	const u32 slbg = (pmode >> GX_GPU_PCRTC_PMODE_SLBG_SHIFT) & 1u;
	circuit2OutputPath = GX_GPU_PCRTC_SCANOUT_DRAW_NONE;
	if (circuit2.enabled != 0u) {
		if (slbg == 0u) {
			circuit2OutputPath = (amod == 0u
				? GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB
				: GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA);
		} else if (amod != 0u) {
			circuit2OutputPath = GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA;
		}
	}
	circuit1ColorPath = GX_GPU_PCRTC_SCANOUT_DRAW_NONE;
	circuit1AlphaPath = GX_GPU_PCRTC_SCANOUT_DRAW_NONE;
	if (circuit1.enabled != 0u) {
		if (mmod == 0u) {
			circuit1ColorPath = GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB;
		} else if (blendAlpha == 255u) {
			circuit1ColorPath = (amod == 0u
				? GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA
				: GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB);
		} else if (blendAlpha != 0u) {
			circuit1ColorPath = GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB;
		}
		if (amod == 0u
			&& circuit1ColorPath != GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
			circuit1AlphaPath = GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA;
		}
	}
	backgroundRequired = 1u;
	if (circuit1CoversOutput
		&& circuit1ColorPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		circuit2OutputPath = GX_GPU_PCRTC_SCANOUT_DRAW_NONE;
		backgroundRequired = 0u;
	} else if (circuit2CoversOutput
		&& circuit2OutputPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		backgroundRequired = 0u;
	}
	const bool circuit1SampleRequired = circuit1ColorPath != GX_GPU_PCRTC_SCANOUT_DRAW_NONE
		|| circuit1AlphaPath != GX_GPU_PCRTC_SCANOUT_DRAW_NONE;
	const bool circuit2SampleRequired = circuit2OutputPath != GX_GPU_PCRTC_SCANOUT_DRAW_NONE;
	if (circuit1.enabled
		&& circuit1.linearSampling
		&& circuit1.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_GX16
		&& circuit1ColorPath == GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA
		&& circuit1CoversOutput) {
		compositionPath = GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1;
	} else if ((!circuit1SampleRequired || (circuit1.linearSampling && circuit1.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_GX16))
		&& (!circuit2SampleRequired || (circuit2.linearSampling && circuit2.framebufferStoragePath == GX_GPU_PCRTC_STORAGE_GX16))) {
		compositionPath = GX_GPU_PCRTC_COMPOSE_GX16;
	} else {
		compositionPath = GX_GPU_PCRTC_COMPOSE_GENERIC;
	}
	revision += 1u;
}

void GxGpuPcrtcScanout::setField(u32 value) {
	field = value;
	for (GxGpuPcrtcCircuit& circuit : circuits) {
		circuit.fieldSourcePhase = interlaced && !frameMode
			? (circuit.displaySignalY ^ value) & 1u
			: 0u;
		updateFieldTraversal(circuit, interlaced, field, outputRowStep);
	}
}

void GxGpuPcrtc::reset(i64 nowCycles) {
	m_registerWords = resetConfigWords;
	m_presentWords = resetConfigWords;
	m_csrWord = GX_GPU_PCRTC_RESET_CSR_WORD;
	m_imrWord = GX_GPU_PCRTC_RESET_IMR_WORD;
	timing.update(m_registerWords);
	m_presentationTiming.update(m_presentWords);
	scanout.setField(0u);
	m_presentationWordsDirty = false;
	m_presentationTimingDirty = false;
	restartBeam(nowCycles);
	publishConfiguration();
}

void GxGpuPcrtc::resetCompositionWords() {
	for (u32 index = 0u; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1u) {
		m_registerWords[index] = resetConfigWords[index];
	}
}

u32 GxGpuPcrtc::readRegisterWord(u32 index) const {
	if (index < GX_GPU_PCRTC_CONFIG_WORD_COUNT) return m_registerWords[index];
	if (index == GX_GPU_PCRTC_CSR_LOW) return m_csrWord;
	if (index == GX_GPU_PCRTC_IMR_LOW) return m_imrWord;
	return 0u;
}

bool GxGpuPcrtc::writeConfigWord(u32 index, u32 word, i64 nowCycles) {
	if (m_registerWords[index] == word) return false;
	m_registerWords[index] = word;
	m_presentationWordsDirty = true;
	if (isBeamTimingWord(index)) {
		m_presentationTimingDirty = true;
		timing.update(m_registerWords);
		restartBeam(nowCycles);
		return true;
	}
	return false;
}

bool GxGpuPcrtc::setCpuHz(i64 cpuHz, i64 nowCycles) {
	if (m_cpuHz == cpuHz) return false;
	m_cpuHz = cpuHz;
	restartBeam(nowCycles);
	return true;
}

u32 GxGpuPcrtc::writeCsr(u32 word, i64 nowCycles) {
	const bool hsyncWasPending = hsyncPending();
	m_csrWord &= ~(word & GX_GPU_PCRTC_CSR_EVENT_MASK);
	if (hsyncWasPending && !hsyncPending() && timing.running) resumeHsync(nowCycles);
	return word & GX_GPU_PCRTC_CSR_ACTION_MASK;
}

bool GxGpuPcrtc::writeImr(u32 word) {
	const u32 previousImrWord = m_imrWord;
	m_imrWord = (word & GX_GPU_PCRTC_IMR_EVENT_MASK) | GX_GPU_PCRTC_IMR_FIXED_BITS;
	const u32 unmaskedEvents = previousImrWord & ~m_imrWord & GX_GPU_PCRTC_IMR_EVENT_MASK;
	return ((m_csrWord << 8u) & unmaskedEvents) != 0u;
}

u32 GxGpuPcrtc::currentHalfLine(i64 nowCycles) const {
	if (!timing.running) return 0u;
	return m_beamHalfLine + elapsedHalfLines(nowCycles);
}

i64 GxGpuPcrtc::nextDeadlineCycle() const {
	if (!timing.running) return -1;
	const u32 verticalHalfLine = verticalEventHalfLine();
	const u32 eventHalfLine = !hsyncPending() && m_nextHsyncHalfLine < verticalHalfLine
		? m_nextHsyncHalfLine
		: verticalHalfLine;
	return deadlineAtHalfLine(eventHalfLine);
}

u32 GxGpuPcrtc::service(i64 nowCycles) {
	if (!timing.running) return GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
	if (nextDeadlineCycle() > nowCycles) return GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
	// CPU instructions are atomic and may service this device after its deadline. Advance from
	// the retained beam epoch: anchoring to nowCycles accumulates lateness into scanout phase.
	// Do not compensate by changing VBlank-edge tick completion or cart first-tick semantics.
	const u32 targetHalfLine = m_beamHalfLine + elapsedHalfLines(nowCycles);
	const u32 totalHalfLines = timing.totalHalfLines;

	u32 firstVblankHalfLine = timing.activeDisplayHalfLines;
	if (m_verticalStage != GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN) {
		firstVblankHalfLine += totalHalfLines;
	}
	u32 firstVsyncHalfLine = timing.vsyncHalfLine;
	if (m_verticalStage == GX_GPU_PCRTC_VERTICAL_STAGE_FIELD_END) {
		firstVsyncHalfLine += totalHalfLines;
	}
	const u32 vblankCount = periodicEventCount(firstVblankHalfLine, targetHalfLine);
	const u32 vsyncCount = periodicEventCount(firstVsyncHalfLine, targetHalfLine);
	const u32 fieldEndCount = periodicEventCount(totalHalfLines, targetHalfLine);

	if (vblankCount != 0u) {
		const u32 lastVblankHalfLine = firstVblankHalfLine + (vblankCount - 1u) * totalHalfLines;
		timing.nextVblankCycleBudget = deadlineAtHalfLine(lastVblankHalfLine + totalHalfLines)
			- deadlineAtHalfLine(lastVblankHalfLine);
	}

	u32 result = GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
	if (m_nextHsyncHalfLine <= targetHalfLine) {
		const u32 hsyncDistance = targetHalfLine - m_nextHsyncHalfLine;
		m_nextHsyncHalfLine += hsyncDistance - hsyncDistance % 2u + 2u;
		if (!hsyncPending() && raiseEvent(GX_GPU_PCRTC_CSR_HSINT)) {
			result |= GX_GPU_PCRTC_SERVICE_IRQ;
		}
	}
	if (vsyncCount != 0u) {
		if (timing.fieldToggles) {
			if ((vsyncCount & 1u) != 0u) m_csrWord ^= GX_GPU_PCRTC_CSR_FIELD;
		} else {
			m_csrWord |= GX_GPU_PCRTC_CSR_FIELD;
		}
		scanout.setField(field());
		if (raiseEvent(GX_GPU_PCRTC_CSR_VSINT)) result |= GX_GPU_PCRTC_SERVICE_IRQ;
	}

	advanceBeam(targetHalfLine);
	const u32 beamHalfLine = m_beamHalfLine % totalHalfLines;
	const u32 completedHalfLines = m_beamHalfLine - beamHalfLine;
	m_beamHalfLine = beamHalfLine;
	m_nextHsyncHalfLine -= completedHalfLines;
	if (beamHalfLine < timing.activeDisplayHalfLines) {
		m_verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN;
		m_beamVblankActive = false;
	} else if (beamHalfLine < timing.vsyncHalfLine) {
		m_verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VSYNC;
		m_beamVblankActive = true;
	} else {
		m_verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_FIELD_END;
		m_beamVblankActive = true;
	}

	if (vblankCount != 0u) return result | GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN;
	if (fieldEndCount != 0u) return result | GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END;
	return result;
}

bool GxGpuPcrtc::latchPresentationWords() {
	if (!m_presentationWordsDirty) return false;
	m_presentWords = m_registerWords;
	if (m_presentationTimingDirty) m_presentationTiming.update(m_presentWords);
	m_presentationWordsDirty = false;
	m_presentationTimingDirty = false;
	publishConfiguration();
	return true;
}

GxGpuPcrtcState GxGpuPcrtc::captureState(i64 nowCycles) const {
	return {
		m_registerWords,
		m_presentWords,
		m_csrWord,
		m_imrWord,
		m_beamCycle - nowCycles,
		m_beamRemainder,
		m_beamHalfLine,
		m_nextHsyncHalfLine,
		m_verticalStage,
		m_beamVblankActive,
	};
}

void GxGpuPcrtc::restoreState(const GxGpuPcrtcState& state, i64 nowCycles) {
	m_registerWords = state.registerWords;
	m_presentWords = state.presentWords;
	m_csrWord = state.csrWord;
	m_imrWord = state.imrWord;
	timing.update(m_registerWords);
	m_presentationTiming.update(m_presentWords);
	refreshPresentationDirtyState();
	m_beamCycle = nowCycles + state.beamCycleOffset;
	m_beamRemainder = state.beamRemainder;
	m_beamHalfLine = state.beamHalfLine;
	m_nextHsyncHalfLine = state.nextHsyncHalfLine;
	m_verticalStage = state.verticalStage;
	m_beamVblankActive = state.vblankActive;
	if (timing.running) {
		configureHalfLinePeriod();
		u32 nextVblankHalfLine = timing.activeDisplayHalfLines;
		if (nextVblankHalfLine < m_beamHalfLine) nextVblankHalfLine += timing.totalHalfLines;
		timing.nextVblankCycleBudget = deadlineAtHalfLine(nextVblankHalfLine + timing.totalHalfLines)
			- deadlineAtHalfLine(nextVblankHalfLine);
	} else {
		m_halfLineSystemNumerator = 0;
		m_halfLineBaseCycles = 0;
		m_halfLineRemainderCycles = 0u;
		timing.nextVblankCycleBudget = 0;
	}
	scanout.setField(field());
	publishConfiguration();
}

void GxGpuPcrtc::captureContext(
	std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& registerWords,
	std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& presentWords) const {
	for (u32 index = 0u; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1u) {
		registerWords[index] = m_registerWords[index];
		presentWords[index] = m_presentWords[index];
	}
}

void GxGpuPcrtc::restoreContext(
	const std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& registerWords,
	const std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& presentWords) {
	for (u32 index = 0u; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1u) {
		m_registerWords[index] = registerWords[index];
		m_presentWords[index] = presentWords[index];
	}
	refreshPresentationDirtyState();
	scanout.setField(field());
	publishConfiguration();
}

void GxGpuPcrtc::enterSupervisorContext(const std::array<u32, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>& userPresentWords) {
	resetCompositionWords();
	m_registerWords[GX_GPU_PCRTC_PMODE_LOW] = (userPresentWords[GX_GPU_PCRTC_PMODE_LOW] & GX_GPU_PCRTC_PMODE_EN1) << 1u;
	m_registerWords[GX_GPU_PCRTC_DISPFB2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPFB1_LOW];
	m_registerWords[GX_GPU_PCRTC_DISPFB2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPFB1_HIGH];
	m_registerWords[GX_GPU_PCRTC_DISPLAY2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_LOW];
	m_registerWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_HIGH];
	m_registerWords[GX_GPU_PCRTC_BGCOLOR_LOW] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_LOW];
	m_registerWords[GX_GPU_PCRTC_BGCOLOR_HIGH] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_HIGH];
	for (u32 index = 0u; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1u) {
		m_presentWords[index] = m_registerWords[index];
	}
	refreshPresentationDirtyState();
	publishConfiguration();
}

void GxGpuPcrtc::refreshPresentationDirtyState() {
	m_presentationWordsDirty = false;
	m_presentationTimingDirty = false;
	for (u32 index = 0u; index < GX_GPU_PCRTC_CONFIG_WORD_COUNT; index += 1u) {
		if (m_registerWords[index] == m_presentWords[index]) continue;
		m_presentationWordsDirty = true;
		if (isBeamTimingWord(index)) m_presentationTimingDirty = true;
	}
}

void GxGpuPcrtc::publishConfiguration() {
	scanout.update(m_presentWords, m_presentationTiming);
}

void GxGpuPcrtc::configureHalfLinePeriod() {
	m_halfLineSystemNumerator = m_cpuHz * timing.halfLineClockNumerator;
	m_halfLineRemainderCycles = static_cast<u32>(m_halfLineSystemNumerator % timing.halfLineClockDenominator);
	m_halfLineBaseCycles = m_halfLineSystemNumerator / timing.halfLineClockDenominator;
}

void GxGpuPcrtc::restartBeam(i64 nowCycles) {
	m_beamCycle = nowCycles;
	m_beamRemainder = 0u;
	m_beamHalfLine = 0u;
	m_nextHsyncHalfLine = 2u;
	m_verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN;
	m_beamVblankActive = false;
	if (timing.running) {
		configureHalfLinePeriod();
		const u32 firstVblankHalfLine = timing.activeDisplayHalfLines;
		timing.nextVblankCycleBudget = deadlineAtHalfLine(firstVblankHalfLine + timing.totalHalfLines)
			- deadlineAtHalfLine(firstVblankHalfLine);
	} else {
		m_halfLineSystemNumerator = 0;
		m_halfLineBaseCycles = 0;
		m_halfLineRemainderCycles = 0u;
		timing.nextVblankCycleBudget = 0;
	}
}

u32 GxGpuPcrtc::verticalEventHalfLine() const {
	switch (m_verticalStage) {
		case GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN:
			return timing.activeDisplayHalfLines;
		case GX_GPU_PCRTC_VERTICAL_STAGE_VSYNC:
			return timing.vsyncHalfLine;
		default:
			return timing.totalHalfLines;
	}
}

i64 GxGpuPcrtc::deadlineAtHalfLine(u32 halfLine) const {
	const u32 deltaHalfLines = halfLine - m_beamHalfLine;
	const i64 remainderTotal = m_beamRemainder + static_cast<i64>(deltaHalfLines) * m_halfLineRemainderCycles;
	const u32 remainder = static_cast<u32>(remainderTotal % timing.halfLineClockDenominator);
	return m_beamCycle + static_cast<i64>(deltaHalfLines) * m_halfLineBaseCycles
		+ remainderTotal / timing.halfLineClockDenominator
		+ (remainder == 0u ? 0 : 1);
}

void GxGpuPcrtc::advanceBeam(u32 halfLine) {
	const u32 deltaHalfLines = halfLine - m_beamHalfLine;
	const i64 remainderTotal = m_beamRemainder + static_cast<i64>(deltaHalfLines) * m_halfLineRemainderCycles;
	m_beamRemainder = static_cast<u32>(remainderTotal % timing.halfLineClockDenominator);
	m_beamCycle += static_cast<i64>(deltaHalfLines) * m_halfLineBaseCycles
		+ remainderTotal / timing.halfLineClockDenominator;
	m_beamHalfLine = halfLine;
}

void GxGpuPcrtc::resumeHsync(i64 nowCycles) {
	skipSuppressedHsyncs(m_beamHalfLine + elapsedHalfLines(nowCycles));
}

u32 GxGpuPcrtc::elapsedHalfLines(i64 nowCycles) const {
	const i64 elapsedNumerator = (nowCycles - m_beamCycle) * timing.halfLineClockDenominator
		- m_beamRemainder;
	return static_cast<u32>(elapsedNumerator / m_halfLineSystemNumerator);
}

void GxGpuPcrtc::skipSuppressedHsyncs(u32 halfLine) {
	if (m_nextHsyncHalfLine > halfLine) return;
	const u32 distance = halfLine - m_nextHsyncHalfLine;
	m_nextHsyncHalfLine += distance - distance % 2u + 2u;
}

u32 GxGpuPcrtc::periodicEventCount(u32 firstHalfLine, u32 targetHalfLine) const {
	if (firstHalfLine > targetHalfLine) return 0u;
	return 1u + (targetHalfLine - firstHalfLine) / timing.totalHalfLines;
}

bool GxGpuPcrtc::raiseEvent(u32 event) {
	if ((m_csrWord & event) != 0u) return false;
	m_csrWord |= event;
	return (m_imrWord & (event << 8u)) == 0u;
}

} // namespace bmsx
