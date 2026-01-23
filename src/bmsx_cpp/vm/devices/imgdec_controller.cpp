#include "imgdec_controller.h"

#include "../memory_map.h"
#include "../vm_io.h"
#include "../vm_memory.h"
#include "../../core/engine_core.h"
#include "../../rompack/rompack.h"
#include "../../vendor/stb_image.h"

#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <string>
#include <utility>

namespace bmsx {
namespace {

TaskGate& imgdecGate() {
	static TaskGate gate;
	return gate;
}

}

ImgDecController::ImgDecController(VmMemory& memory, std::function<void(uint32_t)> raiseIrq)
	: m_gate(imgdecGate().group("imgdec"))
	, m_memory(memory)
	, m_raiseIrq(std::move(raiseIrq)) {}

void ImgDecController::tick() {
	tryStart();
	if (!m_active) {
		return;
	}
	if (m_pendingError) {
		m_pendingError = nullptr;
		finishError();
		return;
	}
	if (m_pendingResult && m_pendingEntry) {
		auto result = std::move(*m_pendingResult);
		m_pendingResult.reset();
		auto* entry = m_pendingEntry;
		m_pendingEntry = nullptr;
		finishSuccess(std::move(result), *entry);
	}
}

void ImgDecController::tryStart() {
	const uint32_t ctrlValue = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IMG_CTRL)));
	if ((ctrlValue & IMG_CTRL_START) == 0) {
		return;
	}
	const uint32_t ctrl = ctrlValue;
	if (m_active) {
		m_memory.writeValue(IO_IMG_CTRL, valueNumber(static_cast<double>(ctrl & ~IMG_CTRL_START)));
		return;
	}
	const uint32_t src = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IMG_SRC)));
	const uint32_t len = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IMG_LEN)));
	const uint32_t dst = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IMG_DST)));
	const uint32_t cap = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IMG_CAP)));
	m_memory.writeValue(IO_IMG_CTRL, valueNumber(static_cast<double>(ctrl & ~IMG_CTRL_START)));
	m_pendingResult.reset();
	m_pendingError = nullptr;
	m_pendingEntry = nullptr;
	m_status = IMG_STATUS_BUSY;
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));

	VmMemory::AssetEntry* entry = nullptr;
	try {
		entry = &resolveSlotEntry(dst);
	} catch (...) {
		finishError();
		return;
	}
	const uint32_t effectiveCap = std::min(cap, entry->capacity);
	if (effectiveCap == 0) {
		finishError();
		return;
	}
	m_pendingCap = effectiveCap;
	std::vector<uint8_t> buffer(len);
	try {
		if (len > 0) {
			m_memory.readBytes(src, buffer.data(), len);
		}
	} catch (...) {
		finishError();
		return;
	}
	m_active = true;
	GateScope scope;
	scope.blocking = false;
	scope.category = "texture";
	scope.tag = "imgdec";
	m_gateToken = m_gate.begin(scope);
	auto* queue = EngineCore::instance().platform()->microtaskQueue();
	queue->queueMicrotask([this, entry, buffer = std::move(buffer)]() mutable {
		try {
			int width = 0;
			int height = 0;
			int comp = 0;
			unsigned char* pixels = stbi_load_from_memory(
				buffer.data(),
				static_cast<int>(buffer.size()),
				&width,
				&height,
				&comp,
				STBI_rgb_alpha
			);
			(void)comp;
			if (!pixels || width <= 0 || height <= 0) {
				if (pixels) {
					stbi_image_free(pixels);
				}
				throw std::runtime_error("[ImgDec] PNG decode failed.");
			}
			const size_t byteCount = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
			DecodedImage result;
			result.width = static_cast<uint32_t>(width);
			result.height = static_cast<uint32_t>(height);
			result.pixels.resize(byteCount);
			std::memcpy(result.pixels.data(), pixels, byteCount);
			stbi_image_free(pixels);
			m_pendingResult = std::move(result);
			m_pendingEntry = entry;
		} catch (...) {
			m_pendingError = std::current_exception();
		}
		m_gate.end(m_gateToken);
	});
}

VmMemory::AssetEntry& ImgDecController::resolveSlotEntry(uint32_t dst) {
	if (dst == VRAM_PRIMARY_ATLAS_BASE) {
		return m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
	}
	if (dst == VRAM_SECONDARY_ATLAS_BASE) {
		return m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
	}
	throw std::runtime_error("[ImgDec] Unsupported destination address " + std::to_string(dst) + ".");
}

void ImgDecController::finishSuccess(DecodedImage&& result, VmMemory::AssetEntry& entry) {
	const size_t pixelBytes = result.pixels.size();
	const uint32_t cap = m_pendingCap;
	m_pendingCap = 0;
	m_memory.writeImageSlot(entry, result.pixels.data(), pixelBytes, result.width, result.height, cap);
	const uint32_t bytes = entry.baseSize;
	const bool clipped = (entry.regionW != result.width) || (entry.regionH != result.height);
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(static_cast<double>(bytes)));
	m_active = false;
	m_status = (m_status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE;
	if (clipped) {
		m_status |= IMG_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	m_raiseIrq(IRQ_IMG_DONE);
}

void ImgDecController::finishError() {
	m_active = false;
	m_status = (m_status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	m_raiseIrq(IRQ_IMG_ERROR);
}

} // namespace bmsx
