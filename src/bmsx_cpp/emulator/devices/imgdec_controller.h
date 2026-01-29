#pragma once

#include "../../core/taskgate.h"
#include "../memory.h"
#include <cstdint>
#include <exception>
#include <functional>
#include <optional>
#include <vector>

namespace bmsx {

class DmaController;

class ImgDecController {
public:
	ImgDecController(Memory& memory, DmaController& dma, std::function<void(uint32_t)> raiseIrq);

	void tick();
	void setDecodeBudget(uint32_t bytesPerTick);
	void reset();

private:
	struct DecodedImage {
		std::vector<uint8_t> pixels;
		uint32_t width = 0;
		uint32_t height = 0;
	};

	void tryStart();
	Memory::AssetEntry& resolveSlotEntry(uint32_t dst);
	void beginDecode(DecodedImage&& result, Memory::AssetEntry& entry);
	void advanceDecode();
	void finishSuccess(bool clipped);
	void finishError();

	GateGroup m_gate;
	GateToken m_gateToken;
	bool m_active = false;
	uint32_t m_status = 0;
	std::exception_ptr m_pendingError;
	std::optional<DecodedImage> m_pendingResult;
	Memory::AssetEntry* m_pendingEntry = nullptr;
	uint32_t m_pendingCap = 0;
	uint32_t m_decodeBudget = 0;
	bool m_decodeActive = false;
	size_t m_decodeRemaining = 0;
	Memory::ImageWritePlan m_decodePlan;
	std::vector<uint8_t> m_decodePixels;
	bool m_decodeQueued = false;
	uint64_t m_decodeToken = 0;
	Memory& m_memory;
	DmaController& m_dma;
	std::function<void(uint32_t)> m_raiseIrq;
};

} // namespace bmsx
