#pragma once

#include "common/types.h"

#include <array>

namespace bmsx {

inline constexpr u32 DEVICE_QUANTIZE_LUT_WIDTH = 256u;
inline constexpr u32 DEVICE_QUANTIZE_LUT_HEIGHT = 16u;
inline constexpr u32 DEVICE_QUANTIZE_LUT_MODE_COUNT = 2u;
inline constexpr u32 DEVICE_QUANTIZE_CHANNEL_LUT_BYTE_COUNT =
	DEVICE_QUANTIZE_LUT_WIDTH * DEVICE_QUANTIZE_LUT_HEIGHT;
inline constexpr u32 DEVICE_QUANTIZE_TEXTURE_LUT_BYTE_COUNT =
	DEVICE_QUANTIZE_LUT_WIDTH * DEVICE_QUANTIZE_LUT_HEIGHT * 4u;

inline constexpr std::array<u8, 16> DEVICE_QUANTIZE_BAYER_4X4{{
	0u,  8u,  2u, 10u,
	12u, 4u, 14u,  6u,
	3u, 11u,  1u,  9u,
	15u, 7u, 13u,  5u,
}};

using DeviceQuantizeChannelLut = std::array<u8, DEVICE_QUANTIZE_CHANNEL_LUT_BYTE_COUNT>;
using DeviceQuantizeTextureLut = std::array<u8, DEVICE_QUANTIZE_TEXTURE_LUT_BYTE_COUNT>;

struct DeviceQuantizeLuts {
	DeviceQuantizeChannelLut redBlue;
	DeviceQuantizeChannelLut green;
	DeviceQuantizeTextureLut texture;
};

extern const std::array<DeviceQuantizeLuts, DEVICE_QUANTIZE_LUT_MODE_COUNT> DEVICE_QUANTIZE_LUTS;

} // namespace bmsx
