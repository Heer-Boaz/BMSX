#pragma once

#include "common/types.h"
#include <span>

namespace bmsx::CRTPipeline {
inline constexpr u32 NOISE_WIDTH = 512u;
inline constexpr u32 NOISE_HEIGHT = 256u;
inline constexpr u32 NOISE_PHASE_MASK = NOISE_WIDTH * NOISE_HEIGHT - 1u;

// R is pixel grain; G is the shared line component. Signal-linear RGBA8.
std::span<const u8> noiseTextureBytes();
}
