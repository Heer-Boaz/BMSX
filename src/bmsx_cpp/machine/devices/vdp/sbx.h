#pragma once

#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

constexpr u32 VDP_SBX_PACKET_KIND = 0x12000000u;
constexpr u32 VDP_SBX_PACKET_PAYLOAD_WORDS = 1u + static_cast<u32>(SKYBOX_FACE_WORD_COUNT);

class VdpSbxUnit {
public:
	using FaceWords = std::array<u32, SKYBOX_FACE_WORD_COUNT>;

	void reset();
	void setSources(const SkyboxFaceSources& sources);
	void clear();
	void writePacket(u32 control, const FaceWords& faceWords);
	u32 latchFrame(FaceWords& target) const;
	void presentFrame(u32 control, const FaceWords& faceWords);
	void presentLiveState();
	void restoreLiveState(u32 control, const FaceWords& faceWords);
	u32 liveControl() const { return m_liveControl; }
	const FaceWords& liveFaceWords() const { return m_liveFaceWords; }
	bool visibleEnabled() const { return (m_visibleControl & VDP_SBX_CONTROL_ENABLE) != 0u; }
	u32 visibleControl() const { return m_visibleControl; }
	const FaceWords& visibleFaceWords() const { return m_visibleFaceWords; }

private:
	FaceWords m_liveFaceWords{};
	u32 m_liveControl = 0u;
	FaceWords m_visibleFaceWords{};
	u32 m_visibleControl = 0u;
};

u32 readSkyboxFaceSourceWord(const VdpSbxUnit::FaceWords& words, size_t faceIndex, size_t field);

} // namespace bmsx
