#include "machine/devices/vdp/sbx.h"

#include "machine/devices/vdp/vram.h"

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

bool VdpSbxUnit::resolveFrameSamplesInto(const VdpVramUnit& vram, u32 control, const FaceWords& faceWords, VdpSkyboxSamples& samples, VdpSbxFrameResolution& resolution) const {
	resolution.faultCode = VDP_FAULT_NONE;
	resolution.faultDetail = 0u;
	if ((control & VDP_SBX_CONTROL_ENABLE) == 0u) {
		return true;
	}
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		if (!resolveSampleInto(
			vram,
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_SLOT_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_U_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_V_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_W_WORD),
			readSkyboxFaceSourceWord(faceWords, index, SKYBOX_FACE_H_WORD),
			samples[index],
			resolution)) {
			return false;
		}
	}
	return true;
}

bool VdpSbxUnit::resolveSampleInto(const VdpVramUnit& vram, u32 slot, u32 u, u32 v, u32 w, u32 h, VdpResolvedBlitterSample& target, VdpSbxFrameResolution& resolution) const {
	resolution.faultCode = VDP_FAULT_NONE;
	resolution.faultDetail = 0u;
	if (slot == VDP_SLOT_SYSTEM) {
		target.source.surfaceId = VDP_RD_SURFACE_SYSTEM;
	} else if (slot == VDP_SLOT_PRIMARY) {
		target.source.surfaceId = VDP_RD_SURFACE_PRIMARY;
	} else if (slot == VDP_SLOT_SECONDARY) {
		target.source.surfaceId = VDP_RD_SURFACE_SECONDARY;
	} else {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = slot;
		return false;
	}
	target.source.srcX = u;
	target.source.srcY = v;
	target.source.width = w;
	target.source.height = h;
	if (w == 0u || h == 0u) {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = w | (h << 16u);
		return false;
	}
	const VdpSurfaceUploadSlot* surface = vram.findSurface(target.source.surfaceId);
	if (surface == nullptr) {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = target.source.surfaceId;
		return false;
	}
	const uint64_t sourceRight = static_cast<uint64_t>(u) + static_cast<uint64_t>(w);
	const uint64_t sourceBottom = static_cast<uint64_t>(v) + static_cast<uint64_t>(h);
	if (sourceRight > surface->surfaceWidth || sourceBottom > surface->surfaceHeight) {
		resolution.faultCode = VDP_FAULT_SBX_SOURCE_OOB;
		resolution.faultDetail = u | (v << 16u);
		return false;
	}
	target.surfaceWidth = surface->surfaceWidth;
	target.surfaceHeight = surface->surfaceHeight;
	target.slot = slot;
	return true;
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
