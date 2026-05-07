#include "machine/devices/vdp/bbu.h"

#include "machine/common/word.h"
#include "machine/devices/vdp/fixed_point.h"

namespace bmsx {

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

void VdpBbuUnit::latchBillboard(std::vector<VdpBbuBillboardEntry>& target, const VdpBbuPacket& packet, u32 seq, VdpBbuSource source, VdpBbuSurfaceSize surface, u32 slot) const {
	const f32 size = decodeUnsignedQ16_16(packet.sizeWord);
	VdpBbuBillboardEntry entry;
	entry.seq = seq;
	entry.layer = packet.layer;
	entry.priority = packet.priority;
	entry.positionX = decodeSignedQ16_16(packet.xWord);
	entry.positionY = decodeSignedQ16_16(packet.yWord);
	entry.positionZ = decodeSignedQ16_16(packet.zWord);
	entry.size = size;
	entry.color = packet.color;
	entry.source = source;
	entry.surfaceWidth = surface.width;
	entry.surfaceHeight = surface.height;
	entry.slot = slot;
	target.push_back(entry);
}

} // namespace bmsx
