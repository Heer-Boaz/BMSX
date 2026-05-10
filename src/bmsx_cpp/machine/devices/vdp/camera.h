#pragma once

#include "common/primitives.h"
#include <array>

namespace bmsx {

struct VdpCameraSnapshot {
	std::array<f32, 16> view{};
	std::array<f32, 16> proj{};
	std::array<f32, 16> viewProj{};
	std::array<f32, 16> skyboxView{};
	std::array<f32, 24> frustumPlanes{};
	Vec3 eye{};
};

struct VdpCameraState {
	u32 eyeXWord = 0u;
	u32 eyeYWord = 0u;
	u32 eyeZWord = 0u;
	u32 yawWord = 0u;
	u32 pitchWord = 0u;
	u32 rollWord = 0u;
	u32 focalYWord = 0x0001bb68u;
};

class VdpCameraUnit {
public:
	VdpCameraSnapshot snapshot{};
	VdpCameraState pose{};

	VdpCameraUnit();
	void reset();
	void writePosePacket(u32 eyeXWord, u32 eyeYWord, u32 eyeZWord, u32 yawWord, u32 pitchWord, u32 rollWord, u32 focalYWord);
	void restoreState(const VdpCameraState& state);
};

constexpr u32 VDP_CAMERA_PACKET_KIND = 0x10000000u;
constexpr u32 VDP_CAMERA_PACKET_PAYLOAD_WORDS = 7u;

} // namespace bmsx
