#include "machine/devices/vdp/sbx.h"

namespace bmsx {

void VdpSbxUnit::reset() {
	m_liveFaceWords.fill(0u);
	m_faceWindowWords.fill(0u);
	m_packetFaceWords.fill(0u);
	m_sealFaceWords.fill(0u);
	m_visibleFaceWords.fill(0u);
	m_liveControl = 0u;
	m_faceWindowControl = 0u;
	m_packetControl = 0u;
	m_visibleControl = 0u;
	m_frameDecision.state = VdpSbxFrameState::Idle;
	m_frameDecision.control = 0u;
	m_frameDecision.faultCode = VDP_FAULT_NONE;
	m_frameDecision.faultDetail = 0u;
}

void VdpSbxUnit::writeFaceWindowControl(u32 control) {
	m_faceWindowControl = control;
}

void VdpSbxUnit::writeFaceWindowWord(size_t index, u32 word) {
	m_faceWindowWords[index] = word;
}

void VdpSbxUnit::commitFaceWindow() {
	m_liveControl = m_faceWindowControl;
	m_liveFaceWords = m_faceWindowWords;
}

VdpSbxUnit::FaceWords& VdpSbxUnit::beginPacket(u32 control) {
	m_packetControl = control;
	return m_packetFaceWords;
}

void VdpSbxUnit::commitPacket() {
	m_liveControl = m_packetControl;
	m_liveFaceWords = m_packetFaceWords;
}

VdpSbxFrameDecision VdpSbxUnit::beginFrameSeal() {
	VdpSbxFrameDecision& decision = m_frameDecision;
	decision.state = VdpSbxFrameState::PacketOpen;
	m_sealFaceWords = m_liveFaceWords;
	decision.control = m_liveControl;
	decision.faultCode = VDP_FAULT_NONE;
	decision.faultDetail = 0u;
	return decision;
}

VdpSbxFrameDecision VdpSbxUnit::completeFrameSeal(const VdpSbxFrameResolution& resolution) {
	VdpSbxFrameDecision& decision = m_frameDecision;
	if (resolution.faultCode != VDP_FAULT_NONE) {
		decision.state = VdpSbxFrameState::FrameRejected;
		decision.faultCode = resolution.faultCode;
		decision.faultDetail = resolution.faultDetail;
		return decision;
	}
	decision.state = VdpSbxFrameState::FrameSealed;
	decision.faultCode = VDP_FAULT_NONE;
	decision.faultDetail = 0u;
	return decision;
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
	m_faceWindowControl = m_liveControl;
	m_faceWindowWords = m_liveFaceWords;
}

u32 readSkyboxFaceSourceWord(const VdpSbxUnit::FaceWords& words, size_t faceIndex, size_t field) {
	return words[faceIndex * SKYBOX_FACE_WORD_STRIDE + field];
}

} // namespace bmsx
