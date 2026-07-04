#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/frame.h"
#include <memory>
#include <vector>

namespace bmsx {

inline constexpr u8 VDP_VOUT_STATE_IDLE = 0u;
inline constexpr u8 VDP_VOUT_STATE_REGISTER_LATCHED = 1u;
inline constexpr u8 VDP_VOUT_STATE_FRAME_SEALED = 2u;
inline constexpr u8 VDP_VOUT_STATE_FRAME_PRESENTED = 3u;

inline constexpr u8 VDP_VOUT_SCANOUT_PHASE_ACTIVE = 0u;
inline constexpr u8 VDP_VOUT_SCANOUT_PHASE_VBLANK = 1u;

enum class VdpVoutState : u8 {
	Idle = VDP_VOUT_STATE_IDLE,
	RegisterLatched = VDP_VOUT_STATE_REGISTER_LATCHED,
	FrameSealed = VDP_VOUT_STATE_FRAME_SEALED,
	FramePresented = VDP_VOUT_STATE_FRAME_PRESENTED,
};

enum class VdpVoutScanoutPhase : u8 {
	Active = VDP_VOUT_SCANOUT_PHASE_ACTIVE,
	Vblank = VDP_VOUT_SCANOUT_PHASE_VBLANK,
};

struct VdpVoutFrameOutput {
	i32 ditherType = 0;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
};

class VdpVoutUnit {
public:
	VdpVoutUnit(std::vector<u8>& vdpVram, std::vector<u32>& vdpVramPageRevisions);

	VdpVoutState state() const { return m_state; }
	bool vblankActive() const { return m_scanoutPhase == VdpVoutScanoutPhase::Vblank; }
	i32 liveDitherType() const { return m_liveDitherType; }
	i32 visibleDitherType() const { return m_visibleDitherType; }

	void reset(i32 ditherType = 0, u32 frameBufferWidth = 0u, u32 frameBufferHeight = 0u);
	void writeDitherType(i32 ditherType);
	void configureScanout(u32 frameBufferWidth, u32 frameBufferHeight);
	void setScanoutTiming(int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle, i64 nowCycles);
	const VdpVoutFrameOutput& sealFrame();
	void presentFrame(VdpSubmittedFrame& frame);
	void presentLiveState();
	const VdpDeviceOutput& readDeviceOutput(i64 nowCycles);

private:
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
	std::unique_ptr<VdpRpuFrameOutput> m_visibleRpuFrame;
	VdpVoutFrameOutput m_sealedFrameOutput;
	VdpDeviceOutput m_deviceOutput;
};

} // namespace bmsx
