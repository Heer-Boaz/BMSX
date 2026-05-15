#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <vector>

namespace bmsx {

constexpr u32 VDP_MDU_PACKET_KIND = 0x16000000u;
constexpr u32 VDP_MDU_PACKET_PAYLOAD_WORDS = 10u;

enum class VdpMduPacketState : u8 {
	Idle = 0,
	PacketDecode = 1,
	InstanceEmit = 2,
	LimitReached = 3,
	PacketRejected = 4,
};

struct VdpMduPacket {
	u32 modelTokenLo = 0u;
	u32 modelTokenHi = 0u;
	u32 meshIndex = 0u;
	u32 materialIndex = 0u;
	u32 modelMatrixIndex = 0u;
	u32 control = 0u;
	u32 color = 0xffffffffu;
	u32 morphBase = 0u;
	u32 morphCount = 0u;
	u32 jointBase = 0u;
	u32 jointCount = 0u;
};

struct VdpMduPacketDecision {
	VdpMduPacketState state = VdpMduPacketState::Idle;
	u32 faultCode = VDP_FAULT_NONE;
	u32 faultDetail = 0u;
};

struct VdpMduMeshEntry {
	u32 seq = 0u;
	u32 modelTokenLo = 0u;
	u32 modelTokenHi = 0u;
	u32 meshIndex = 0u;
	u32 materialIndex = 0u;
	u32 modelMatrixIndex = 0u;
	u32 control = 0u;
	u32 color = 0xffffffffu;
	u32 morphBase = 0u;
	u32 morphCount = 0u;
	u32 jointBase = 0u;
	u32 jointCount = 0u;
};

class VdpMduUnit {
public:
	void reset();
	VdpMduPacket decodePacket(
		u32 modelTokenLo,
		u32 modelTokenHi,
		u32 meshIndex,
		u32 materialIndex,
		u32 modelMatrixIndex,
		u32 control,
		u32 color,
		u32 morphRange,
		u32 jointRange) const;
	VdpMduPacketDecision beginPacket(const VdpMduPacket& packet, size_t targetLength);
	VdpMduPacketDecision completePacket(std::vector<VdpMduMeshEntry>& target, const VdpMduPacket& packet, u32 seq);

private:
	void latchMesh(std::vector<VdpMduMeshEntry>& target, const VdpMduPacket& packet, u32 seq) const;

	VdpMduPacketDecision m_packetDecision;
};

} // namespace bmsx
