#include "machine/devices/vdp/fbm.h"

#include <cstring>
#include <utility>

namespace bmsx {

void VdpFbmUnit::configure(u32 width, u32 height) {
	m_width = width;
	m_height = height;
	m_displayFrameBufferCpuReadback.assign(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u, 0u);
	m_presentationDirtySpansByRow.assign(height, VdpDirtySpan{});
	resetPresentation();
}

std::vector<u8> VdpFbmUnit::captureDisplayReadback() const {
	return m_displayFrameBufferCpuReadback;
}

void VdpFbmUnit::restoreDisplayReadback(const std::vector<u8>& pixels) {
	m_displayFrameBufferCpuReadback = pixels;
	for (VdpDirtySpan& span : m_presentationDirtySpansByRow) {
		span = VdpDirtySpan{};
	}
	resetPresentation();
}

void VdpFbmUnit::presentPage(VdpSurfaceUploadSlot& renderSlot) {
	if (m_presentationCount == 0u) {
		m_presentationReadbackValid = true;
		m_presentationDirtyRowStart = renderSlot.dirtyRowStart;
		m_presentationDirtyRowEnd = renderSlot.dirtyRowEnd;
		for (u32 row = renderSlot.dirtyRowStart; row < renderSlot.dirtyRowEnd; ++row) {
			m_presentationDirtySpansByRow[row] = renderSlot.dirtySpansByRow[row];
		}
	} else {
		m_presentationRequiresFullSync = true;
	}
	m_presentationCount += 1u;
	std::swap(renderSlot.cpuReadback, m_displayFrameBufferCpuReadback);
	m_state = VdpFbmState::PagePendingPresent;
}

void VdpFbmUnit::presentTexturePage() {
	if (m_presentationCount == 0u) {
		m_presentationDirtyRowStart = 0u;
		m_presentationDirtyRowEnd = 0u;
	}
	m_presentationReadbackValid = false;
	m_presentationCount += 1u;
	m_state = VdpFbmState::PagePendingPresent;
}

void VdpFbmUnit::copyReadbackPixelsFrom(const std::vector<u8>& source, u32 x, u32 y, u32 width, u32 height, u8* out) {
	m_state = VdpFbmState::ReadbackRequested;
	const size_t rowBytes = static_cast<size_t>(width) * 4u;
	const size_t stride = static_cast<size_t>(m_width) * 4u;
	for (u32 row = 0; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(y + row) * stride + static_cast<size_t>(x) * 4u;
		const size_t dstOffset = static_cast<size_t>(row) * rowBytes;
		std::memcpy(out + dstOffset, source.data() + srcOffset, rowBytes);
	}
}

const VdpFrameBufferPresentation& VdpFbmUnit::buildPresentation(const std::vector<u8>& renderReadback, bool forceFullSync) {
	if (forceFullSync) {
		m_presentationOutput.presentationCount = 0u;
		m_presentationOutput.readbackValid = true;
		m_presentationOutput.requiresFullSync = true;
		m_presentationOutput.dirtyRowStart = 0u;
		m_presentationOutput.dirtyRowEnd = 0u;
	} else {
		m_presentationOutput.presentationCount = m_presentationCount;
		m_presentationOutput.readbackValid = m_presentationReadbackValid;
		m_presentationOutput.requiresFullSync = m_presentationRequiresFullSync;
		m_presentationOutput.dirtyRowStart = m_presentationDirtyRowStart;
		m_presentationOutput.dirtyRowEnd = m_presentationDirtyRowEnd;
	}
	m_presentationOutput.dirtySpansByRow = &m_presentationDirtySpansByRow;
	m_presentationOutput.renderReadback = &renderReadback;
	m_presentationOutput.displayReadback = &m_displayFrameBufferCpuReadback;
	m_presentationOutput.width = m_width;
	m_presentationOutput.height = m_height;
	return m_presentationOutput;
}

void VdpFbmUnit::clearPresentation() {
	for (u32 row = m_presentationDirtyRowStart; row < m_presentationDirtyRowEnd; ++row) {
		m_presentationDirtySpansByRow[row] = VdpDirtySpan{};
	}
	resetPresentation();
	m_state = VdpFbmState::PagePresented;
}

void VdpFbmUnit::drainPresentation(VdpFrameBufferPresentationSink& sink, const std::vector<u8>& renderReadback) {
	if (!hasPendingPresentation()) {
		return;
	}
	sink.consumeVdpFrameBufferPresentation(buildPresentation(renderReadback));
	clearPresentation();
}

void VdpFbmUnit::syncPresentation(VdpFrameBufferPresentationSink& sink, const std::vector<u8>& renderReadback) {
	sink.consumeVdpFrameBufferPresentation(buildPresentation(renderReadback, true));
	if (hasPendingPresentation()) {
		clearPresentation();
	}
}

void VdpFbmUnit::resetPresentation() {
	m_presentationCount = 0u;
	m_presentationReadbackValid = false;
	m_presentationRequiresFullSync = false;
	m_presentationDirtyRowStart = 0u;
	m_presentationDirtyRowEnd = 0u;
	m_state = VdpFbmState::PageWritable;
}

} // namespace bmsx
