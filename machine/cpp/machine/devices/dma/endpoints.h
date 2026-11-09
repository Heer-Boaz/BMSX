#pragma once

#include "common/primitives.h"

namespace bmsx {
enum class DmaEndpoint : u32 {
	GpuWrite = 0,
	GpuRead = 1,
	ApuWrite = 2,
	ApuRead = 3,
	ImgDecWrite = 4,
	ImgDecRead = 5,
	Cartridge0Write = 6,
	Cartridge0Read = 7,
	Cartridge1Write = 8,
	Cartridge1Read = 9,
	Memory = 10,
};
} // namespace bmsx
