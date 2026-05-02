#include "machine/devices/vdp/bbu.h"

#include "machine/common/word.h"
#include "machine/devices/vdp/fault.h"
#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/registers.h"
#include <string>

namespace bmsx {

VdpBbuPacket VdpBbuUnit::decodePacket(
	u32 layerPriorityWord,
	u32 slot,
	u32 uvWord,
	u32 whWord,
	u32 xWord,
	u32 yWord,
	u32 zWord,
	u32 sizeWord,
	u32 colorWord,
	u32 controlWord) const {
	if (controlWord != 0u) {
		throw vdpFault("VDP BBU control reserved bits are set (" + std::to_string(controlWord) + ").");
	}
	const VdpLayerPriority layerPriority = decodeVdpLayerPriority(layerPriorityWord);
	VdpBbuPacket packet;
	packet.layer = layerPriority.layer;
	packet.priority = layerPriority.priority;
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
	packet.colorWord = colorWord;
	return packet;
}

void VdpBbuUnit::latchBillboard(std::vector<VdpBbuBillboardEntry>& target, const VdpBbuPacket& packet, u32 seq, VdpBbuSource source, VdpBbuSurfaceSize surface, u32 slot) const {
	if (target.size() >= VDP_BBU_BILLBOARD_LIMIT) {
		throw vdpFault("VDP billboard FIFO overflow (" + std::to_string(VDP_BBU_BILLBOARD_LIMIT) + " entries).");
	}
	const f32 size = decodeUnsignedQ16_16(packet.sizeWord);
	if (size <= 0.0f) {
		throw vdpFault("VDP billboard size must be positive.");
	}
	VdpBbuBillboardEntry entry;
	entry.seq = seq;
	entry.layer = packet.layer;
	entry.priority = packet.priority;
	entry.positionX = decodeSignedQ16_16(packet.xWord);
	entry.positionY = decodeSignedQ16_16(packet.yWord);
	entry.positionZ = decodeSignedQ16_16(packet.zWord);
	entry.size = size;
	entry.color = Color::fromRGBA8(
		static_cast<u8>((packet.colorWord >> 16u) & 0xffu),
		static_cast<u8>((packet.colorWord >> 8u) & 0xffu),
		static_cast<u8>(packet.colorWord & 0xffu),
		static_cast<u8>((packet.colorWord >> 24u) & 0xffu));
	entry.source = source;
	entry.surfaceWidth = surface.width;
	entry.surfaceHeight = surface.height;
	entry.slot = slot;
	target.push_back(entry);
}

} // namespace bmsx
