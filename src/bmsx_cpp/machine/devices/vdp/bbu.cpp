#include "machine/devices/vdp/bbu.h"

#include "machine/common/word.h"
#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/vram.h"

namespace bmsx {

void VdpBbuFrameBuffer::reset() {
	length = 0u;
}

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

void VdpBbuUnit::resolveSourceInto(const VdpVramUnit& vram, const VdpBbuPacket& packet, VdpBbuSourceResolution& target) const {
	target.faultCode = VDP_FAULT_NONE;
	target.faultDetail = 0u;
	u32 surfaceId = 0u;
	if (packet.sourceRect.slot == VDP_SLOT_SYSTEM) {
		surfaceId = VDP_RD_SURFACE_SYSTEM;
	} else if (packet.sourceRect.slot == VDP_SLOT_PRIMARY) {
		surfaceId = VDP_RD_SURFACE_PRIMARY;
	} else if (packet.sourceRect.slot == VDP_SLOT_SECONDARY) {
		surfaceId = VDP_RD_SURFACE_SECONDARY;
	} else {
		target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
		target.faultDetail = packet.sourceRect.slot;
		return;
	}
	target.source.surfaceId = surfaceId;
	target.source.srcX = packet.sourceRect.u;
	target.source.srcY = packet.sourceRect.v;
	target.source.width = packet.sourceRect.w;
	target.source.height = packet.sourceRect.h;
	target.slot = packet.sourceRect.slot;
	if (target.source.width == 0u || target.source.height == 0u) {
		target.faultCode = VDP_FAULT_BBU_ZERO_SIZE;
		target.faultDetail = target.source.width | (target.source.height << 16u);
		return;
	}
	const VdpSurfaceUploadSlot* surface = vram.findSurface(surfaceId);
	if (surface == nullptr) {
		target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
		target.faultDetail = surfaceId;
		return;
	}
	const uint64_t sourceRight = static_cast<uint64_t>(target.source.srcX) + static_cast<uint64_t>(target.source.width);
	const uint64_t sourceBottom = static_cast<uint64_t>(target.source.srcY) + static_cast<uint64_t>(target.source.height);
	if (sourceRight > surface->surfaceWidth || sourceBottom > surface->surfaceHeight) {
		target.faultCode = VDP_FAULT_BBU_SOURCE_OOB;
		target.faultDetail = target.source.srcX | (target.source.srcY << 16u);
		return;
	}
	target.surfaceWidth = surface->surfaceWidth;
	target.surfaceHeight = surface->surfaceHeight;
}

VdpBbuPacketDecision VdpBbuUnit::completePacket(
	VdpBbuFrameBuffer& target,
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
	VdpBbuFrameBuffer& target,
	const VdpBbuPacket& packet,
	u32 seq,
	f32 size,
	const VdpBbuSource& source,
	u32 surfaceWidth,
	u32 surfaceHeight,
	u32 slot) {
	const size_t index = target.length;
	target.seq[index] = seq;
	target.layer[index] = packet.layer;
	target.priority[index] = packet.priority;
	target.positionX[index] = decodeSignedQ16_16(packet.xWord);
	target.positionY[index] = decodeSignedQ16_16(packet.yWord);
	target.positionZ[index] = decodeSignedQ16_16(packet.zWord);
	target.size[index] = size;
	target.color[index] = packet.color;
	target.sourceSurfaceId[index] = source.surfaceId;
	target.sourceSrcX[index] = source.srcX;
	target.sourceSrcY[index] = source.srcY;
	target.sourceWidth[index] = source.width;
	target.sourceHeight[index] = source.height;
	target.surfaceWidth[index] = surfaceWidth;
	target.surfaceHeight[index] = surfaceHeight;
	target.slot[index] = slot;
	target.length = index + 1u;
}

} // namespace bmsx
