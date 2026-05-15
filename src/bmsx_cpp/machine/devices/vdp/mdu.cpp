#include "machine/devices/vdp/mdu.h"

#include "machine/common/word.h"
#include "machine/devices/vdp/xf.h"

namespace bmsx {

void VdpMduFrameBuffer::reset() {
	length = 0u;
}

void VdpMduUnit::reset() {
	m_packetDecision.state = VdpMduPacketState::Idle;
	m_packetDecision.faultCode = VDP_FAULT_NONE;
	m_packetDecision.faultDetail = 0u;
}

VdpMduPacket VdpMduUnit::decodePacket(
	u32 modelTokenLo,
	u32 modelTokenHi,
	u32 meshIndex,
	u32 materialIndex,
	u32 modelMatrixIndex,
	u32 control,
	u32 color,
	u32 morphRange,
	u32 jointRange) const {
	VdpMduPacket packet;
	packet.modelTokenLo = modelTokenLo;
	packet.modelTokenHi = modelTokenHi;
	packet.meshIndex = meshIndex;
	packet.materialIndex = materialIndex;
	packet.modelMatrixIndex = modelMatrixIndex;
	packet.control = control;
	packet.color = color;
	packet.morphBase = packedLow16(morphRange);
	packet.morphCount = packedHigh16(morphRange);
	packet.jointBase = packedLow16(jointRange);
	packet.jointCount = packedHigh16(jointRange);
	return packet;
}

VdpMduPacketDecision VdpMduUnit::beginPacket(const VdpMduPacket& packet, size_t targetLength) {
	VdpMduPacketDecision& decision = m_packetDecision;
	decision.state = VdpMduPacketState::PacketDecode;
	decision.faultCode = VDP_FAULT_NONE;
	decision.faultDetail = 0u;
	if (targetLength >= VDP_MDU_MESH_LIMIT) {
		decision.state = VdpMduPacketState::LimitReached;
		decision.faultCode = VDP_FAULT_MDU_OVERFLOW;
		decision.faultDetail = static_cast<u32>(targetLength);
		return decision;
	}
	if (packet.modelMatrixIndex >= VDP_XF_MATRIX_COUNT) {
		decision.state = VdpMduPacketState::PacketRejected;
		decision.faultCode = VDP_FAULT_MDU_BAD_MATRIX;
		decision.faultDetail = packet.modelMatrixIndex;
		return decision;
	}
	if ((packet.control & VDP_MDU_CONTROL_TEXTURE_ENABLE) != 0u) {
		const u32 textureSlot = (packet.control & VDP_MDU_CONTROL_TEXTURE_SLOT_MASK) >> VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT;
		if (textureSlot > VDP_SLOT_SYSTEM) {
			decision.state = VdpMduPacketState::PacketRejected;
			decision.faultCode = VDP_FAULT_MDU_BAD_TEXTURE_SLOT;
			decision.faultDetail = textureSlot;
			return decision;
		}
	}
	if (packet.morphCount > VDP_MDU_MORPH_WEIGHT_LIMIT || packet.morphBase + packet.morphCount > VDP_MFU_WEIGHT_COUNT) {
		decision.state = VdpMduPacketState::PacketRejected;
		decision.faultCode = VDP_FAULT_MDU_BAD_MORPH_RANGE;
		decision.faultDetail = packLowHigh16(packet.morphBase, packet.morphCount);
		return decision;
	}
	if (packet.jointBase + packet.jointCount > VDP_JTU_MATRIX_COUNT) {
		decision.state = VdpMduPacketState::PacketRejected;
		decision.faultCode = VDP_FAULT_MDU_BAD_JOINT_RANGE;
		decision.faultDetail = packLowHigh16(packet.jointBase, packet.jointCount);
		return decision;
	}
	decision.state = VdpMduPacketState::InstanceEmit;
	return decision;
}

VdpMduPacketDecision VdpMduUnit::completePacket(VdpMduFrameBuffer& target, const VdpMduPacket& packet, u32 seq) {
	VdpMduPacketDecision& decision = m_packetDecision;
	latchMesh(target, packet, seq);
	decision.state = VdpMduPacketState::InstanceEmit;
	decision.faultCode = VDP_FAULT_NONE;
	decision.faultDetail = 0u;
	return decision;
}

void VdpMduUnit::latchMesh(VdpMduFrameBuffer& target, const VdpMduPacket& packet, u32 seq) const {
	const size_t index = target.length;
	target.seq[index] = seq;
	target.modelTokenLo[index] = packet.modelTokenLo;
	target.modelTokenHi[index] = packet.modelTokenHi;
	target.meshIndex[index] = packet.meshIndex;
	target.materialIndex[index] = packet.materialIndex;
	target.modelMatrixIndex[index] = packet.modelMatrixIndex;
	target.control[index] = packet.control;
	target.color[index] = packet.color;
	target.morphBase[index] = packet.morphBase;
	target.morphCount[index] = packet.morphCount;
	target.jointBase[index] = packet.jointBase;
	target.jointCount[index] = packet.jointCount;
	target.length = index + 1u;
}

} // namespace bmsx
