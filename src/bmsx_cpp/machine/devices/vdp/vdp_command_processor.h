#pragma once

#include "core/types.h"
#include <cstdint>

namespace bmsx {

class Api;
class CPU;
class Memory;
class VDP;

void processVdpCommand(
	VDP& vdp,
	CPU& cpu,
	Api& api,
	const Memory& memory,
	uint32_t cmd,
	uint32_t argWords,
	uint32_t argBase,
	uint32_t payloadBase,
	uint32_t payloadWords
);

void processVdpBufferedCommand(
	VDP& vdp,
	CPU& cpu,
	Api& api,
	const u32* words,
	uint32_t cmd,
	uint32_t argWords,
	uint32_t argOffset,
	uint32_t payloadOffset,
	uint32_t payloadWords
);

} // namespace bmsx
