#pragma once

#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

constexpr u32 VDP_SBX_PACKET_KIND = 0x12000000u;
constexpr u32 VDP_SBX_PACKET_PAYLOAD_WORDS = 1u + static_cast<u32>(SKYBOX_FACE_WORD_COUNT);

enum class VdpSbxFrameState : u8 {
	Idle = 0,
	PacketOpen = 1,
	FrameSealed = 2,
	FrameRejected = 3,
};

struct VdpSbxFrameDecision {
	VdpSbxFrameState state = VdpSbxFrameState::Idle;
	u32 control = 0u;
	u32 faultCode = VDP_FAULT_NONE;
	u32 faultDetail = 0u;
};

struct VdpSbxFrameResolution {
	u32 faultCode = VDP_FAULT_NONE;
	u32 faultDetail = 0u;
};

class VdpVramUnit;

class VdpSbxUnit {
public:
	using FaceWords = std::array<u32, SKYBOX_FACE_WORD_COUNT>;

	void reset();
	void writeFaceWindowControl(u32 control);
	void writeFaceWindowWord(size_t index, u32 word);
	void commitFaceWindow();
	FaceWords& beginPacket(u32 control);
	void commitPacket();
	VdpSbxFrameDecision beginFrameSeal();
	VdpSbxFrameDecision completeFrameSeal(const VdpSbxFrameResolution& resolution);
	bool resolveFrameSamplesInto(const VdpVramUnit& vram, u32 control, const FaceWords& faceWords, VdpSkyboxSamples& samples, VdpSbxFrameResolution& resolution) const;
	void presentFrame(u32 control, const FaceWords& faceWords);
	void presentLiveState();
	void restoreLiveState(u32 control, const FaceWords& faceWords);
	u32 liveControl() const { return m_liveControl; }
	const FaceWords& liveFaceWords() const { return m_liveFaceWords; }
	const FaceWords& sealFaceWords() const { return m_sealFaceWords; }
	bool visibleEnabled() const { return (m_visibleControl & VDP_SBX_CONTROL_ENABLE) != 0u; }
	u32 visibleControl() const { return m_visibleControl; }
	const FaceWords& visibleFaceWords() const { return m_visibleFaceWords; }

private:
	FaceWords m_liveFaceWords{};
	u32 m_liveControl = 0u;
	FaceWords m_faceWindowWords{};
	u32 m_faceWindowControl = 0u;
	FaceWords m_packetFaceWords{};
	u32 m_packetControl = 0u;
	FaceWords m_sealFaceWords{};
	FaceWords m_visibleFaceWords{};
	u32 m_visibleControl = 0u;
	VdpSbxFrameDecision m_frameDecision;

	bool resolveSampleInto(const VdpVramUnit& vram, u32 slot, u32 u, u32 v, u32 w, u32 h, VdpResolvedBlitterSample& target, VdpSbxFrameResolution& resolution) const;
};

u32 readSkyboxFaceSourceWord(const VdpSbxUnit::FaceWords& words, size_t faceIndex, size_t field);

} // namespace bmsx
