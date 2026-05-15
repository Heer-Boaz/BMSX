#include "machine/devices/vdp/vout.h"

#include <utility>

namespace bmsx {

void VdpVoutUnit::reset(i32 ditherType, u32 frameBufferWidth, u32 frameBufferHeight) {
	m_liveDitherType = ditherType;
	m_scanoutPhase = VdpVoutScanoutPhase::Active;
	m_scanoutX = 0u;
	m_scanoutY = 0u;
	m_scanoutFrameStartCycle = 0;
	m_scanoutCyclesPerFrame = 1;
	m_scanoutVblankStartCycle = 1;
	m_liveFrameBufferWidth = frameBufferWidth;
	m_liveFrameBufferHeight = frameBufferHeight;
	m_visibleDitherType = ditherType;
	m_visibleFrameBufferWidth = frameBufferWidth;
	m_visibleFrameBufferHeight = frameBufferHeight;
	m_visibleXf.reset();
	m_visibleSkyboxEnabled = false;
	resetVisibleSkyboxSamples();
	m_visibleBillboards->reset();
	m_visibleMeshes->reset();
	m_visibleLightRegisterWords.fill(0u);
	m_visibleMorphWeightWords.fill(0u);
	m_visibleJointMatrixWords.fill(0u);
	m_sealedFrameOutput.ditherType = ditherType;
	m_sealedFrameOutput.frameBufferWidth = frameBufferWidth;
	m_sealedFrameOutput.frameBufferHeight = frameBufferHeight;
	m_state = VdpVoutState::Idle;
}

void VdpVoutUnit::writeDitherType(i32 ditherType) {
	m_liveDitherType = ditherType;
	m_state = VdpVoutState::RegisterLatched;
}

void VdpVoutUnit::configureScanout(u32 frameBufferWidth, u32 frameBufferHeight) {
	m_liveFrameBufferWidth = frameBufferWidth;
	m_liveFrameBufferHeight = frameBufferHeight;
	m_state = VdpVoutState::RegisterLatched;
}

void VdpVoutUnit::setScanoutTiming(int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle, i64 nowCycles) {
	m_scanoutFrameStartCycle = nowCycles - static_cast<i64>(cyclesIntoFrame);
	m_scanoutCyclesPerFrame = cyclesPerFrame;
	m_scanoutVblankStartCycle = vblankStartCycle;
	refreshScanoutBeam(nowCycles);
}

void VdpVoutUnit::refreshScanoutBeam(i64 nowCycles) {
	const int cyclesIntoFrame = static_cast<int>((nowCycles - m_scanoutFrameStartCycle) % static_cast<i64>(m_scanoutCyclesPerFrame));
	const bool vblankActive = m_scanoutVblankStartCycle == 0 || cyclesIntoFrame >= m_scanoutVblankStartCycle;
	m_scanoutPhase = vblankActive ? VdpVoutScanoutPhase::Vblank : VdpVoutScanoutPhase::Active;
	if (m_visibleFrameBufferWidth == 0u || m_visibleFrameBufferHeight == 0u) {
		m_scanoutX = 0u;
		m_scanoutY = 0u;
		return;
	}
	if (vblankActive) {
		setVblankBeamPosition(cyclesIntoFrame);
		return;
	}
	const u64 totalPixels = static_cast<u64>(m_visibleFrameBufferWidth) * static_cast<u64>(m_visibleFrameBufferHeight);
	const u64 pixel = (static_cast<u64>(cyclesIntoFrame) * totalPixels) / static_cast<u64>(m_scanoutVblankStartCycle);
	m_scanoutX = static_cast<u32>(pixel % static_cast<u64>(m_visibleFrameBufferWidth));
	m_scanoutY = static_cast<u32>(pixel / static_cast<u64>(m_visibleFrameBufferWidth));
}

const VdpVoutFrameOutput& VdpVoutUnit::sealFrame() {
	m_sealedFrameOutput.ditherType = m_liveDitherType;
	m_sealedFrameOutput.frameBufferWidth = m_liveFrameBufferWidth;
	m_sealedFrameOutput.frameBufferHeight = m_liveFrameBufferHeight;
	m_state = VdpVoutState::FrameSealed;
	return m_sealedFrameOutput;
}

void VdpVoutUnit::presentFrame(VdpSubmittedFrame& frame, bool skyboxEnabled) {
	m_visibleDitherType = frame.ditherType;
	m_visibleFrameBufferWidth = frame.frameBufferWidth;
	m_visibleFrameBufferHeight = frame.frameBufferHeight;
	m_visibleXf.matrixWords = frame.xf.matrixWords;
	m_visibleXf.viewMatrixIndex = frame.xf.viewMatrixIndex;
	m_visibleXf.projectionMatrixIndex = frame.xf.projectionMatrixIndex;
	m_visibleSkyboxEnabled = skyboxEnabled;
	std::swap(m_visibleSkyboxSamples, frame.skyboxSamples);
	m_visibleBillboards.swap(frame.billboards);
	frame.billboards->reset();
	m_visibleMeshes.swap(frame.meshes);
	frame.meshes->reset();
	m_visibleLightRegisterWords = frame.lightRegisterWords;
	m_visibleMorphWeightWords = frame.morphWeightWords;
	m_visibleJointMatrixWords = frame.jointMatrixWords;
	m_state = VdpVoutState::FramePresented;
}

void VdpVoutUnit::presentLiveState(const VdpXfUnit& xf, bool skyboxEnabled, const VdpLpuUnit& lpu, const VdpMfuUnit& mfu, const VdpJtuUnit& jtu) {
	m_visibleDitherType = m_liveDitherType;
	m_visibleFrameBufferWidth = m_liveFrameBufferWidth;
	m_visibleFrameBufferHeight = m_liveFrameBufferHeight;
	m_visibleXf.matrixWords = xf.matrixWords;
	m_visibleXf.viewMatrixIndex = xf.viewMatrixIndex;
	m_visibleXf.projectionMatrixIndex = xf.projectionMatrixIndex;
	m_visibleSkyboxEnabled = skyboxEnabled;
	m_visibleBillboards->reset();
	m_visibleMeshes->reset();
	m_visibleLightRegisterWords = lpu.registerWords;
	m_visibleMorphWeightWords = mfu.weightWords;
	m_visibleJointMatrixWords = jtu.matrixWords;
	m_state = VdpVoutState::FramePresented;
}

const VdpDeviceOutput& VdpVoutUnit::readDeviceOutput(i64 nowCycles) {
	refreshScanoutBeam(nowCycles);
	m_deviceOutput.ditherType = m_visibleDitherType;
	m_deviceOutput.scanoutPhase = static_cast<u32>(m_scanoutPhase);
	m_deviceOutput.scanoutX = m_scanoutX;
	m_deviceOutput.scanoutY = m_scanoutY;
	m_deviceOutput.xfMatrixWords = &m_visibleXf.matrixWords;
	m_deviceOutput.xfViewMatrixIndex = m_visibleXf.viewMatrixIndex;
	m_deviceOutput.xfProjectionMatrixIndex = m_visibleXf.projectionMatrixIndex;
	m_deviceOutput.skyboxEnabled = m_visibleSkyboxEnabled;
	m_deviceOutput.skyboxSamples = &m_visibleSkyboxSamples;
	m_deviceOutput.billboards = m_visibleBillboards.get();
	m_deviceOutput.meshes = m_visibleMeshes.get();
	m_deviceOutput.lightRegisterWords = &m_visibleLightRegisterWords;
	m_deviceOutput.morphWeightWords = &m_visibleMorphWeightWords;
	m_deviceOutput.jointMatrixWords = &m_visibleJointMatrixWords;
	m_deviceOutput.frameBufferWidth = m_visibleFrameBufferWidth;
	m_deviceOutput.frameBufferHeight = m_visibleFrameBufferHeight;
	return m_deviceOutput;
}

void VdpVoutUnit::resetVisibleSkyboxSamples() {
	for (VdpResolvedBlitterSample& sample : m_visibleSkyboxSamples) {
		sample.source.surfaceId = 0u;
		sample.source.srcX = 0u;
		sample.source.srcY = 0u;
		sample.source.width = 0u;
		sample.source.height = 0u;
		sample.surfaceWidth = 0u;
		sample.surfaceHeight = 0u;
		sample.slot = 0u;
	}
}

void VdpVoutUnit::setVblankBeamPosition(int cyclesIntoFrame) {
	if (m_scanoutVblankStartCycle == 0) {
		const u64 totalPixels = static_cast<u64>(m_visibleFrameBufferWidth) * static_cast<u64>(m_visibleFrameBufferHeight);
		const u64 pixel = (static_cast<u64>(cyclesIntoFrame) * totalPixels) / static_cast<u64>(m_scanoutCyclesPerFrame);
		m_scanoutX = static_cast<u32>(pixel % static_cast<u64>(m_visibleFrameBufferWidth));
		m_scanoutY = m_visibleFrameBufferHeight + static_cast<u32>(pixel / static_cast<u64>(m_visibleFrameBufferWidth));
		return;
	}
	const int vblankCycles = m_scanoutCyclesPerFrame - m_scanoutVblankStartCycle;
	const int vblankCycle = cyclesIntoFrame - m_scanoutVblankStartCycle;
	const u64 blankLineCount = (static_cast<u64>(vblankCycles) * static_cast<u64>(m_visibleFrameBufferHeight)) / static_cast<u64>(m_scanoutVblankStartCycle);
	const u64 blankPixel = (static_cast<u64>(vblankCycle) * static_cast<u64>(m_visibleFrameBufferWidth) * blankLineCount) / static_cast<u64>(vblankCycles);
	m_scanoutX = static_cast<u32>(blankPixel % static_cast<u64>(m_visibleFrameBufferWidth));
	m_scanoutY = m_visibleFrameBufferHeight + static_cast<u32>(blankPixel / static_cast<u64>(m_visibleFrameBufferWidth));
}

} // namespace bmsx
