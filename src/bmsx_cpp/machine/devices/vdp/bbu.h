#pragma once

#include "core/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <vector>

namespace bmsx {

constexpr u32 VDP_BBU_PACKET_KIND = 0x11000000u;
constexpr u32 VDP_BBU_PACKET_PAYLOAD_WORDS = 10u;

struct VdpBbuSource {
	u32 surfaceId = 0u;
	u32 srcX = 0u;
	u32 srcY = 0u;
	u32 width = 0u;
	u32 height = 0u;
};

struct VdpBbuSurfaceSize {
	u32 width = 0u;
	u32 height = 0u;
};

struct VdpBbuPacket {
	Layer2D layer = Layer2D::World;
	u32 priority = 0u;
	VdpSlotSource sourceRect;
	u32 xWord = 0u;
	u32 yWord = 0u;
	u32 zWord = 0u;
	u32 sizeWord = 0u;
	u32 colorWord = 0u;
};

struct VdpBbuBillboardEntry {
	u32 seq = 0u;
	Layer2D layer = Layer2D::World;
	u32 priority = 0u;
	f32 positionX = 0.0f;
	f32 positionY = 0.0f;
	f32 positionZ = 0.0f;
	f32 size = 1.0f;
	Color color;
	VdpBbuSource source;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	u32 slot = 0u;
};

class VdpBbuUnit {
public:
	VdpBbuPacket decodePacket(
		u32 layerPriorityWord,
		u32 slot,
		u32 uvWord,
		u32 whWord,
		u32 xWord,
		u32 yWord,
		u32 zWord,
		u32 sizeWord,
		u32 colorWord,
		u32 controlWord) const;
	void latchBillboard(std::vector<VdpBbuBillboardEntry>& target, const VdpBbuPacket& packet, u32 seq, VdpBbuSource source, VdpBbuSurfaceSize surface, u32 slot) const;
};

} // namespace bmsx
