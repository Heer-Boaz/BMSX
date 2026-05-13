#pragma once

#include "common/primitives.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/contracts.h"
#include <vector>

namespace bmsx {

constexpr u32 VDP_BBU_PACKET_KIND = 0x11000000u;
constexpr u32 VDP_BBU_PACKET_PAYLOAD_WORDS = 11u;

enum class VdpBbuPacketState : u8 {
	Idle = 0,
	PacketDecode = 1,
	SourceResolve = 2,
	InstanceEmit = 3,
	LimitReached = 4,
	PacketRejected = 5,
};

struct VdpBbuSource {
	u32 surfaceId = 0u;
	u32 srcX = 0u;
	u32 srcY = 0u;
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
	u32 color = 0u;
};

struct VdpBbuPacketDecision {
	VdpBbuPacketState state = VdpBbuPacketState::Idle;
	u32 faultCode = VDP_FAULT_NONE;
	u32 faultDetail = 0u;
	f32 size = 0.0f;
};

struct VdpBbuSourceResolution {
	u32 faultCode = VDP_FAULT_NONE;
	u32 faultDetail = 0u;
	VdpBbuSource source;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	u32 slot = 0u;
};

struct VdpBbuBillboardEntry {
	u32 seq = 0u;
	Layer2D layer = Layer2D::World;
	u32 priority = 0u;
	f32 positionX = 0.0f;
	f32 positionY = 0.0f;
	f32 positionZ = 0.0f;
	f32 size = 1.0f;
	u32 color = 0u;
	VdpBbuSource source;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	u32 slot = 0u;
};

class VdpBbuUnit {
public:
	void reset();
	VdpBbuPacket decodePacket(
		u32 layerWord,
		u32 priority,
		u32 slot,
		u32 uvWord,
		u32 whWord,
		u32 xWord,
		u32 yWord,
		u32 zWord,
		u32 sizeWord,
		u32 color) const;
	VdpBbuPacketDecision beginPacket(const VdpBbuPacket& packet, size_t targetLength);
	VdpBbuPacketDecision completePacket(
		std::vector<VdpBbuBillboardEntry>& target,
		const VdpBbuPacket& packet,
		const VdpBbuSourceResolution& resolution,
		u32 seq);

private:
	void latchBillboard(
		std::vector<VdpBbuBillboardEntry>& target,
		const VdpBbuPacket& packet,
		u32 seq,
		f32 size,
		const VdpBbuSource& source,
		u32 surfaceWidth,
		u32 surfaceHeight,
		u32 slot);

	VdpBbuPacketDecision m_packetDecision;
};

} // namespace bmsx
