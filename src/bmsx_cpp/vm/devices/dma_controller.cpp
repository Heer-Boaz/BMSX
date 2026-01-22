#include "dma_controller.h"

#include "../vm_memory.h"
#include "../vm_io.h"
#include "../memory_map.h"

#include <algorithm>
#include <utility>

namespace bmsx {
namespace {

constexpr uint32_t DMA_BYTES_PER_TICK = 0x80000u;

}

DmaController::DmaController(VmMemory& memory, std::function<void(uint32_t)> raiseIrq)
	: m_memory(memory)
	, m_raiseIrq(std::move(raiseIrq)) {}

void DmaController::tick() {
	tryStart();
	if (!m_active) {
		return;
	}
	const uint32_t chunk = (m_remaining > DMA_BYTES_PER_TICK) ? DMA_BYTES_PER_TICK : m_remaining;
	if (chunk > 0) {
		try {
			if (m_buffer.size() < chunk) {
				m_buffer.resize(chunk);
			}
			m_memory.readBytes(m_src, m_buffer.data(), chunk);
			m_memory.writeBytes(m_dst, m_buffer.data(), chunk);
		} catch (...) {
			finishError();
			return;
		}
		m_src += chunk;
		m_dst += chunk;
		m_remaining -= chunk;
		m_written += chunk;
		m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(static_cast<double>(m_written)));
	}
	if (m_remaining == 0) {
		finishSuccess();
	}
}

void DmaController::tryStart() {
	const uint32_t ctrlValue = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_DMA_CTRL)));
	if ((ctrlValue & DMA_CTRL_START) == 0) {
		return;
	}
	const uint32_t ctrl = ctrlValue;
	if (m_active) {
		m_memory.writeValue(IO_DMA_CTRL, valueNumber(static_cast<double>(ctrl & ~DMA_CTRL_START)));
		return;
	}
	const uint32_t src = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_DMA_SRC)));
	const uint32_t dst = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_DMA_DST)));
	const uint32_t len = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_DMA_LEN)));
	m_strict = (ctrl & DMA_CTRL_STRICT) != 0;
	m_clipped = false;
	m_src = src;
	m_dst = dst;
	m_written = 0;
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(static_cast<double>(ctrl & ~DMA_CTRL_START)));

	const uint32_t maxWritable = resolveMaxWritable(dst);
	if (maxWritable == 0) {
		finishError();
		return;
	}
	uint32_t transferLen = len;
	if (transferLen > maxWritable) {
		m_clipped = true;
		if (m_strict) {
			finishError();
			return;
		}
		transferLen = maxWritable;
	}
	m_remaining = transferLen;
	m_status = DMA_STATUS_BUSY | (m_clipped ? DMA_STATUS_CLIPPED : 0);
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(m_status)));
	m_active = true;
	if (m_remaining == 0) {
		finishSuccess();
	}
}

uint32_t DmaController::resolveMaxWritable(uint32_t dst) const {
	if (dst >= VRAM_ENGINE_ATLAS_BASE && dst < VRAM_ENGINE_ATLAS_BASE + VRAM_ENGINE_ATLAS_SIZE) {
		return (VRAM_ENGINE_ATLAS_BASE + VRAM_ENGINE_ATLAS_SIZE) - dst;
	}
	if (dst >= VRAM_PRIMARY_ATLAS_BASE && dst < VRAM_PRIMARY_ATLAS_BASE + VRAM_PRIMARY_ATLAS_SIZE) {
		return (VRAM_PRIMARY_ATLAS_BASE + VRAM_PRIMARY_ATLAS_SIZE) - dst;
	}
	if (dst >= VRAM_SECONDARY_ATLAS_BASE && dst < VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) {
		return (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) - dst;
	}
	if (dst >= VRAM_STAGING_BASE && dst < VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		return (VRAM_STAGING_BASE + VRAM_STAGING_SIZE) - dst;
	}
	if (dst >= OVERLAY_ROM_BASE && dst < OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) {
		return (OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) - dst;
	}
	if (dst >= RAM_BASE && dst < RAM_USED_END) {
		return RAM_USED_END - dst;
	}
	return 0;
}

void DmaController::finishSuccess() {
	m_active = false;
	m_status = (m_status & ~DMA_STATUS_BUSY) | DMA_STATUS_DONE;
	if (m_clipped) {
		m_status |= DMA_STATUS_ERROR | DMA_STATUS_CLIPPED;
		m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(m_status)));
		m_raiseIrq(IRQ_DMA_ERROR);
		return;
	}
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(m_status)));
	m_raiseIrq(IRQ_DMA_DONE);
}

void DmaController::finishError() {
	m_active = false;
	m_status = (m_status & ~DMA_STATUS_BUSY) | DMA_STATUS_DONE | DMA_STATUS_ERROR;
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(m_status)));
	m_raiseIrq(IRQ_DMA_ERROR);
}

} // namespace bmsx
