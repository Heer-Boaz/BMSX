#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

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

struct VdpMduFrameBuffer {
	size_t length = 0u;
	std::array<u32, VDP_MDU_MESH_LIMIT> seq{};
	std::array<u32, VDP_MDU_MESH_LIMIT> modelTokenLo{};
	std::array<u32, VDP_MDU_MESH_LIMIT> modelTokenHi{};
	std::array<u32, VDP_MDU_MESH_LIMIT> meshIndex{};
	std::array<u32, VDP_MDU_MESH_LIMIT> materialIndex{};
	std::array<u32, VDP_MDU_MESH_LIMIT> modelMatrixIndex{};
	std::array<u32, VDP_MDU_MESH_LIMIT> control{};
	std::array<u32, VDP_MDU_MESH_LIMIT> color{};
	std::array<u32, VDP_MDU_MESH_LIMIT> morphBase{};
	std::array<u32, VDP_MDU_MESH_LIMIT> morphCount{};
	std::array<u32, VDP_MDU_MESH_LIMIT> jointBase{};
	std::array<u32, VDP_MDU_MESH_LIMIT> jointCount{};

	void reset();
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
	VdpMduPacketDecision completePacket(VdpMduFrameBuffer& target, const VdpMduPacket& packet, u32 seq);

private:
	void latchMesh(VdpMduFrameBuffer& target, const VdpMduPacket& packet, u32 seq) const;

	VdpMduPacketDecision m_packetDecision;
};

} // namespace bmsx
