#pragma once

#include "../../core/taskgate.h"
#include "../vm_memory.h"
#include <cstdint>
#include <exception>
#include <functional>
#include <optional>
#include <vector>

namespace bmsx {

class ImgDecController {
public:
	ImgDecController(VmMemory& memory, std::function<void(uint32_t)> raiseIrq);

	void tick();

private:
	struct DecodedImage {
		std::vector<uint8_t> pixels;
		uint32_t width = 0;
		uint32_t height = 0;
	};

	void tryStart();
	VmMemory::AssetEntry& resolveSlotEntry(uint32_t dst);
	void finishSuccess(DecodedImage&& result, VmMemory::AssetEntry& entry);
	void finishError();

	GateGroup m_gate;
	GateToken m_gateToken;
	bool m_active = false;
	uint32_t m_status = 0;
	std::exception_ptr m_pendingError;
	std::optional<DecodedImage> m_pendingResult;
	VmMemory::AssetEntry* m_pendingEntry = nullptr;
	uint32_t m_pendingCap = 0;
	VmMemory& m_memory;
	std::function<void(uint32_t)> m_raiseIrq;
};

} // namespace bmsx
