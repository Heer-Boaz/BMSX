#include "machine/devices/vdp/sbx.h"

namespace bmsx {

void VdpSbxUnit::reset() {
	m_liveFaceWords.fill(0u);
	m_visibleFaceWords.fill(0u);
	m_liveControl = 0u;
	m_visibleControl = 0u;
}

void VdpSbxUnit::writePacket(u32 control, const FaceWords& faceWords) {
	m_liveControl = control;
	m_liveFaceWords = faceWords;
}

u32 VdpSbxUnit::latchFrame(FaceWords& target) const {
	target = m_liveFaceWords;
	return m_liveControl;
}

void VdpSbxUnit::presentFrame(u32 control, const FaceWords& faceWords) {
	m_visibleControl = control;
	m_visibleFaceWords = faceWords;
}

void VdpSbxUnit::presentLiveState() {
	m_visibleControl = m_liveControl;
	m_visibleFaceWords = m_liveFaceWords;
}

void VdpSbxUnit::restoreLiveState(u32 control, const FaceWords& faceWords) {
	m_liveControl = control;
	m_liveFaceWords = faceWords;
}

u32 readSkyboxFaceSourceWord(const VdpSbxUnit::FaceWords& words, size_t faceIndex, size_t field) {
	return words[faceIndex * SKYBOX_FACE_WORD_STRIDE + field];
}

} // namespace bmsx
