#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/frame.h"

namespace bmsx {

enum class VdpVoutState : u8 {
	Idle = 0,
	RegisterLatched = 1,
	FrameSealed = 2,
	FramePresented = 3,
};

enum class VdpVoutScanoutPhase : u8 {
	Active = 0,
	Vblank = 1,
};

struct VdpVoutFrameOutput {
	i32 ditherType = 0;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
};

class VdpVoutUnit {
public:
	explicit VdpVoutUnit(size_t billboardCapacity = 0u);

	VdpVoutState state() const { return m_state; }
	bool vblankActive() const { return m_scanoutPhase == VdpVoutScanoutPhase::Vblank; }
	i32 liveDitherType() const { return m_liveDitherType; }
	i32 visibleDitherType() const { return m_visibleDitherType; }
	VdpSkyboxSamples& visibleSkyboxSampleBuffer() { return m_visibleSkyboxSamples; }

	void reset(i32 ditherType = 0, u32 frameBufferWidth = 0u, u32 frameBufferHeight = 0u);
	void writeDitherType(i32 ditherType);
	void configureScanout(u32 frameBufferWidth, u32 frameBufferHeight);
	void setScanoutTiming(int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle, i64 nowCycles);
	const VdpVoutFrameOutput& sealFrame();
	void presentFrame(VdpSubmittedFrame& frame, bool skyboxEnabled);
	void presentLiveState(const VdpXfUnit& xf, bool skyboxEnabled, const VdpMfuUnit& mfu, const VdpJtuUnit& jtu);
	const VdpDeviceOutput& readDeviceOutput(i64 nowCycles);

private:
	void resetVisibleSkyboxSamples();
	void refreshScanoutBeam(i64 nowCycles);
	void setVblankBeamPosition(int cyclesIntoFrame);

	VdpVoutState m_state = VdpVoutState::Idle;
	VdpVoutScanoutPhase m_scanoutPhase = VdpVoutScanoutPhase::Active;
	u32 m_scanoutX = 0u;
	u32 m_scanoutY = 0u;
	i64 m_scanoutFrameStartCycle = 0;
	int m_scanoutCyclesPerFrame = 1;
	int m_scanoutVblankStartCycle = 1;
	i32 m_liveDitherType = 0;
	u32 m_liveFrameBufferWidth = 0u;
	u32 m_liveFrameBufferHeight = 0u;
	i32 m_visibleDitherType = 0;
	u32 m_visibleFrameBufferWidth = 0u;
	u32 m_visibleFrameBufferHeight = 0u;
	VdpXfUnit m_visibleXf;
	bool m_visibleSkyboxEnabled = false;
	VdpSkyboxSamples m_visibleSkyboxSamples{};
	std::vector<VdpBbuBillboardEntry> m_visibleBillboards;
	std::vector<VdpMduMeshEntry> m_visibleMeshes;
	std::array<u32, VDP_MFU_WEIGHT_COUNT> m_visibleMorphWeightWords{};
	std::array<u32, VDP_JTU_REGISTER_WORDS> m_visibleJointMatrixWords{};
	VdpVoutFrameOutput m_sealedFrameOutput;
	VdpDeviceOutput m_deviceOutput;
};

} // namespace bmsx
