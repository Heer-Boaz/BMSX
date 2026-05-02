#include "machine/devices/vdp/sbx.h"

#include "machine/devices/vdp/fault.h"
#include <string>

namespace bmsx {

namespace {

constexpr u32 VDP_SBX_CONTROL_RESERVED_MASK = 0xfffffffeu;

void writeFaceWords(VdpSbxUnit::FaceWords& target, size_t faceIndex, const VdpSlotSource& source) {
	const size_t base = faceIndex * SKYBOX_FACE_WORD_STRIDE;
	target[base + SKYBOX_FACE_SLOT_WORD] = source.slot;
	target[base + SKYBOX_FACE_U_WORD] = source.u;
	target[base + SKYBOX_FACE_V_WORD] = source.v;
	target[base + SKYBOX_FACE_W_WORD] = source.w;
	target[base + SKYBOX_FACE_H_WORD] = source.h;
}

} // namespace

void VdpSbxUnit::reset() {
	m_liveFaceWords.fill(0u);
	m_visibleFaceWords.fill(0u);
	m_liveControl = 0u;
	m_visibleControl = 0u;
}

void VdpSbxUnit::setSources(const SkyboxFaceSources& sources) {
	writeFaceWords(m_liveFaceWords, 0u, sources.posx);
	writeFaceWords(m_liveFaceWords, 1u, sources.negx);
	writeFaceWords(m_liveFaceWords, 2u, sources.posy);
	writeFaceWords(m_liveFaceWords, 3u, sources.negy);
	writeFaceWords(m_liveFaceWords, 4u, sources.posz);
	writeFaceWords(m_liveFaceWords, 5u, sources.negz);
	m_liveControl |= VDP_SBX_CONTROL_ENABLE;
}

void VdpSbxUnit::clear() {
	m_liveControl &= ~VDP_SBX_CONTROL_ENABLE;
}

void VdpSbxUnit::writePacket(u32 control, const FaceWords& faceWords) {
	if ((control & VDP_SBX_CONTROL_RESERVED_MASK) != 0u) {
		throw vdpFault("VDP SBX control reserved bits are set (" + std::to_string(control) + ").");
	}
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
