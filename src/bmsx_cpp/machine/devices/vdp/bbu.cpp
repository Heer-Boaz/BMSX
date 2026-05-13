#include "machine/devices/vdp/bbu.h"

#include "machine/common/word.h"
#include "machine/devices/vdp/fixed_point.h"

namespace bmsx {

void VdpBbuUnit::reset() {
	m_packetDecision.state = VdpBbuPacketState::Idle;
	m_packetDecision.faultCode = VDP_FAULT_NONE;
	m_packetDecision.faultDetail = 0u;
	m_packetDecision.size = 0.0f;
}

VdpBbuPacket VdpBbuUnit::decodePacket(
	u32 layerWord,
	u32 priority,
	u32 slot,
	u32 uvWord,
	u32 whWord,
	u32 xWord,
	u32 yWord,
	u32 zWord,
	u32 sizeWord,
	u32 color) const {
	VdpBbuPacket packet;
	packet.layer = static_cast<Layer2D>(layerWord);
	packet.priority = priority;
	packet.sourceRect = VdpSlotSource{
		slot,
		packedLow16(uvWord),
		packedHigh16(uvWord),
		packedLow16(whWord),
		packedHigh16(whWord),
	};
	packet.xWord = xWord;
	packet.yWord = yWord;
	packet.zWord = zWord;
	packet.sizeWord = sizeWord;
	packet.color = color;
	return packet;
}

VdpBbuPacketDecision VdpBbuUnit::beginPacket(const VdpBbuPacket& packet, size_t targetLength) {
	VdpBbuPacketDecision& decision = m_packetDecision;
	decision.state = VdpBbuPacketState::PacketDecode;
	decision.faultCode = VDP_FAULT_NONE;
	decision.faultDetail = 0u;
	const f32 size = decodeUnsignedQ16_16(packet.sizeWord);
	decision.size = size;
	if (size <= 0.0f) {
		decision.state = VdpBbuPacketState::PacketRejected;
		decision.faultCode = VDP_FAULT_BBU_ZERO_SIZE;
		decision.faultDetail = packet.sizeWord;
		return decision;
	}
	if (targetLength >= VDP_BBU_BILLBOARD_LIMIT) {
		decision.state = VdpBbuPacketState::LimitReached;
		decision.faultCode = VDP_FAULT_BBU_OVERFLOW;
		decision.faultDetail = static_cast<u32>(targetLength);
		return decision;
	}
	decision.state = VdpBbuPacketState::SourceResolve;
	return decision;
}

VdpBbuPacketDecision VdpBbuUnit::completePacket(
	std::vector<VdpBbuBillboardEntry>& target,
	const VdpBbuPacket& packet,
	const VdpBbuSourceResolution& resolution,
	u32 seq) {
	VdpBbuPacketDecision& decision = m_packetDecision;
	if (resolution.faultCode != VDP_FAULT_NONE) {
		decision.state = VdpBbuPacketState::PacketRejected;
		decision.faultCode = resolution.faultCode;
		decision.faultDetail = resolution.faultDetail;
		return decision;
	}
	decision.state = VdpBbuPacketState::InstanceEmit;
	latchBillboard(
		target,
		packet,
		seq,
		decision.size,
		resolution.source,
		resolution.surfaceWidth,
		resolution.surfaceHeight,
		resolution.slot);
	decision.faultCode = VDP_FAULT_NONE;
	decision.faultDetail = 0u;
	return decision;
}

void VdpBbuUnit::latchBillboard(
	std::vector<VdpBbuBillboardEntry>& target,
	const VdpBbuPacket& packet,
	u32 seq,
	f32 size,
	const VdpBbuSource& source,
	u32 surfaceWidth,
	u32 surfaceHeight,
	u32 slot) {
	target.emplace_back();
	VdpBbuBillboardEntry& entry = target.back();
	entry.seq = seq;
	entry.layer = packet.layer;
	entry.priority = packet.priority;
	entry.positionX = decodeSignedQ16_16(packet.xWord);
	entry.positionY = decodeSignedQ16_16(packet.yWord);
	entry.positionZ = decodeSignedQ16_16(packet.zWord);
	entry.size = size;
	entry.color = packet.color;
	entry.source = source;
	entry.surfaceWidth = surfaceWidth;
	entry.surfaceHeight = surfaceHeight;
	entry.slot = slot;
}

} // namespace bmsx
