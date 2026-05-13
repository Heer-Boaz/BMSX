#include "machine/devices/vdp/vout.h"

#include <utility>

namespace bmsx {

VdpVoutUnit::VdpVoutUnit(size_t billboardCapacity) {
	m_visibleBillboards.reserve(billboardCapacity);
}

void VdpVoutUnit::reset(i32 ditherType, u32 frameBufferWidth, u32 frameBufferHeight) {
	m_liveDitherType = ditherType;
	m_scanoutPhase = VdpVoutScanoutPhase::Active;
	m_scanoutX = 0u;
	m_scanoutY = 0u;
	m_liveFrameBufferWidth = frameBufferWidth;
	m_liveFrameBufferHeight = frameBufferHeight;
	m_visibleDitherType = ditherType;
	m_visibleFrameBufferWidth = frameBufferWidth;
	m_visibleFrameBufferHeight = frameBufferHeight;
	m_visibleXf.reset();
	m_visibleSkyboxEnabled = false;
	resetVisibleSkyboxSamples();
	m_visibleBillboards.clear();
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

void VdpVoutUnit::setScanoutTiming(bool vblankActive, int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle) {
	m_scanoutPhase = vblankActive ? VdpVoutScanoutPhase::Vblank : VdpVoutScanoutPhase::Active;
	if (m_liveFrameBufferWidth == 0u || m_liveFrameBufferHeight == 0u) {
		m_scanoutX = 0u;
		m_scanoutY = 0u;
		return;
	}
	if (vblankActive) {
		const int vblankCycles = cyclesPerFrame - vblankStartCycle;
		const int vblankCycle = cyclesIntoFrame - vblankStartCycle;
		m_scanoutX = 0u;
		m_scanoutY = m_liveFrameBufferHeight + static_cast<u32>((static_cast<u64>(vblankCycle) * static_cast<u64>(m_liveFrameBufferHeight)) / static_cast<u64>(vblankCycles));
		return;
	}
	const u64 totalPixels = static_cast<u64>(m_liveFrameBufferWidth) * static_cast<u64>(m_liveFrameBufferHeight);
	const u64 pixel = (static_cast<u64>(cyclesIntoFrame) * totalPixels) / static_cast<u64>(vblankStartCycle);
	m_scanoutX = static_cast<u32>(pixel % static_cast<u64>(m_liveFrameBufferWidth));
	m_scanoutY = static_cast<u32>(pixel / static_cast<u64>(m_liveFrameBufferWidth));
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
	frame.billboards.clear();
	m_state = VdpVoutState::FramePresented;
}

void VdpVoutUnit::presentLiveState(const VdpXfUnit& xf, bool skyboxEnabled) {
	m_visibleDitherType = m_liveDitherType;
	m_visibleFrameBufferWidth = m_liveFrameBufferWidth;
	m_visibleFrameBufferHeight = m_liveFrameBufferHeight;
	m_visibleXf.matrixWords = xf.matrixWords;
	m_visibleXf.viewMatrixIndex = xf.viewMatrixIndex;
	m_visibleXf.projectionMatrixIndex = xf.projectionMatrixIndex;
	m_visibleSkyboxEnabled = skyboxEnabled;
	m_visibleBillboards.clear();
	m_state = VdpVoutState::FramePresented;
}

const VdpDeviceOutput& VdpVoutUnit::readDeviceOutput() {
	m_deviceOutput.ditherType = m_visibleDitherType;
	m_deviceOutput.scanoutPhase = static_cast<u32>(m_scanoutPhase);
	m_deviceOutput.scanoutX = m_scanoutX;
	m_deviceOutput.scanoutY = m_scanoutY;
	m_deviceOutput.xfMatrixWords = &m_visibleXf.matrixWords;
	m_deviceOutput.xfViewMatrixIndex = m_visibleXf.viewMatrixIndex;
	m_deviceOutput.xfProjectionMatrixIndex = m_visibleXf.projectionMatrixIndex;
	m_deviceOutput.skyboxEnabled = m_visibleSkyboxEnabled;
	m_deviceOutput.skyboxSamples = &m_visibleSkyboxSamples;
	m_deviceOutput.billboards = &m_visibleBillboards;
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

} // namespace bmsx
