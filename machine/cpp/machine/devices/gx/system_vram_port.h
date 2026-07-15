#pragma once

#include "common/primitives.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;

constexpr u32 GX_GPU_SYSTEM_VRAM_X = 512u;
constexpr u32 GX_GPU_SYSTEM_VRAM_Y = 0u;
constexpr u32 GX_GPU_SYSTEM_VRAM_WIDTH = 256u;
constexpr u32 GX_GPU_SYSTEM_VRAM_HEIGHT = 256u;
constexpr size_t GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY = 256u;
constexpr size_t GX_GPU_SYSTEM_VRAM_PORT_WORD_CAPACITY = 0x8000u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_CONTROL_START = 1u << 0u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_CONTROL_RESET = 1u << 1u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_STATUS_BUSY = 1u << 0u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_STATUS_WRITE_READY = 1u << 1u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW = 1u << 2u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_STATUS_PENDING = 1u << 3u;
constexpr u32 GX_GPU_SYSTEM_VRAM_PORT_STATUS_REMAINING_SHIFT = 8u;

inline u32 gxGpuSystemVramX(u32 positionWord) {
	return GX_GPU_SYSTEM_VRAM_X + (positionWord & (GX_GPU_SYSTEM_VRAM_WIDTH - 1u));
}

inline u32 gxGpuSystemVramY(u32 positionWord) {
	return GX_GPU_SYSTEM_VRAM_Y + ((positionWord >> 16u) & (GX_GPU_SYSTEM_VRAM_HEIGHT - 1u));
}

inline u32 gxGpuSystemVramColumnX(u32 positionWord, u32 column) {
	return GX_GPU_SYSTEM_VRAM_X + ((positionWord + column) & (GX_GPU_SYSTEM_VRAM_WIDTH - 1u));
}

inline u32 gxGpuSystemVramRowY(u32 positionWord, u32 row) {
	return GX_GPU_SYSTEM_VRAM_Y + (((positionWord >> 16u) + row) & (GX_GPU_SYSTEM_VRAM_HEIGHT - 1u));
}

inline u32 gxGpuSystemVramWidth(u32 sizeWord) {
	return (((sizeWord & 0xffu) - 1u) & 0xffu) + 1u;
}

inline u32 gxGpuSystemVramHeight(u32 sizeWord) {
	return ((((sizeWord >> 16u) & 0xffu) - 1u) & 0xffu) + 1u;
}

struct GxGpuSystemVramPortState {
	u32 positionWord = 0u;
	u32 sizeWord = 0u;
	u32 controlWord = 0u;
	u32 dataWord = 0u;
	u32 statusWord = 0u;
	size_t commandCount = 0u;
	size_t presentCommandCount = 0u;
	size_t wordCount = 0u;
	u32 activePositionWord = 0u;
	u32 activeSizeWord = 0u;
	size_t activeWordStart = 0u;
	u32 activeWordsRemaining = 0u;
	std::vector<u32> commandPositionWord;
	std::vector<u32> commandSizeWord;
	std::vector<u32> commandWordStart;
	std::vector<u32> words;
};

class GxGpuSystemVramPort {
public:
	explicit GxGpuSystemVramPort(Memory& memory);

	void reset();
	GxGpuSystemVramPortState captureState() const;
	void restoreState(const GxGpuSystemVramPortState& state);
	void sealForPresentation();
	bool hasUnretiredPresentCommands() const { return presentCommandCount != 0u; }
	void retirePresentedCommands();

	u32 serial = 0u;
	size_t commandCount = 0u;
	size_t presentCommandCount = 0u;
	size_t wordCount = 0u;
	std::array<u32, GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY> commandPositionWord{};
	std::array<u32, GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY> commandSizeWord{};
	std::array<u32, GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY> commandWordStart{};
	std::array<u32, GX_GPU_SYSTEM_VRAM_PORT_WORD_CAPACITY> words{};

private:
	u32 m_positionWord = 0u;
	u32 m_sizeWord = 0u;
	u32 m_controlWord = 0u;
	u32 m_dataWord = 0u;
	u32 m_statusWord = 0u;
	u32 m_activePositionWord = 0u;
	u32 m_activeSizeWord = 0u;
	size_t m_activeWordStart = 0u;
	u32 m_activeWordsRemaining = 0u;
	inline static u32 nextSerial = 0u;

	void publishRevision();
	void abortTransfers();
	void beginTransfer();
	void writeData(u32 word);
	void updateStatus();
	static u64 readRegister(void* context, u32 address);
	static void writeRegister(void* context, u32 address, u64 value);
};

} // namespace bmsx
