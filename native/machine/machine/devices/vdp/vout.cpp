#include "machine/devices/vdp/vout.h"

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
	resetVdpRpuFrameOutput(*m_visibleRpuFrame);
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

void VdpVoutUnit::presentFrame(VdpSubmittedFrame& frame) {
	m_visibleDitherType = frame.ditherType;
	m_visibleFrameBufferWidth = frame.frameBufferWidth;
	m_visibleFrameBufferHeight = frame.frameBufferHeight;
	m_visibleRpuFrame.swap(frame.rpu);
	resetVdpRpuFrameOutput(*frame.rpu);
	m_state = VdpVoutState::FramePresented;
}

void VdpVoutUnit::presentLiveState() {
	m_visibleDitherType = m_liveDitherType;
	m_visibleFrameBufferWidth = m_liveFrameBufferWidth;
	m_visibleFrameBufferHeight = m_liveFrameBufferHeight;
	resetVdpRpuFrameOutput(*m_visibleRpuFrame);
	m_state = VdpVoutState::FramePresented;
}

const VdpDeviceOutput& VdpVoutUnit::readDeviceOutput(i64 nowCycles) {
	refreshScanoutBeam(nowCycles);
	m_deviceOutput.ditherType = m_visibleDitherType;
	m_deviceOutput.scanoutPhase = static_cast<u32>(m_scanoutPhase);
	m_deviceOutput.scanoutX = m_scanoutX;
	m_deviceOutput.scanoutY = m_scanoutY;
	m_deviceOutput.frameBufferWidth = m_visibleFrameBufferWidth;
	m_deviceOutput.frameBufferHeight = m_visibleFrameBufferHeight;
	m_deviceOutput.rpu = m_visibleRpuFrame.get();
	return m_deviceOutput;
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
