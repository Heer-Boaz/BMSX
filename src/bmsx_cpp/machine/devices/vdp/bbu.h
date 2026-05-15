#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

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

struct VdpBbuFrameBuffer {
	size_t length = 0u;
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> seq{};
	std::array<Layer2D, VDP_BBU_BILLBOARD_LIMIT> layer{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> priority{};
	std::array<f32, VDP_BBU_BILLBOARD_LIMIT> positionX{};
	std::array<f32, VDP_BBU_BILLBOARD_LIMIT> positionY{};
	std::array<f32, VDP_BBU_BILLBOARD_LIMIT> positionZ{};
	std::array<f32, VDP_BBU_BILLBOARD_LIMIT> size{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> color{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> sourceSurfaceId{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> sourceSrcX{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> sourceSrcY{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> sourceWidth{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> sourceHeight{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> surfaceWidth{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> surfaceHeight{};
	std::array<u32, VDP_BBU_BILLBOARD_LIMIT> slot{};

	void reset();
};

class VdpVramUnit;

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
	void resolveSourceInto(const VdpVramUnit& vram, const VdpBbuPacket& packet, VdpBbuSourceResolution& target) const;
	VdpBbuPacketDecision completePacket(
		VdpBbuFrameBuffer& target,
		const VdpBbuPacket& packet,
		const VdpBbuSourceResolution& resolution,
		u32 seq);

private:
	void latchBillboard(
		VdpBbuFrameBuffer& target,
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
