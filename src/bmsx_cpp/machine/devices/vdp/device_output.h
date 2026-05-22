#pragma once

#include "common/types.h"
#include "machine/devices/vdp/rpu.h"
#include <vector>

namespace bmsx {

struct VdpDirtySpan {
	uint32_t xStart = 0;
	uint32_t xEnd = 0;
};

inline std::vector<VdpDirtySpan> createVdpDirtySpans(u32 height) {
	std::vector<VdpDirtySpan> spans(height);
	return spans;
}

struct VdpSurfaceUploadSlot {
	uint32_t baseAddr = 0;
	uint32_t capacity = 0;
	uint32_t surfaceId = 0;
	uint32_t surfaceWidth = 0;
	uint32_t surfaceHeight = 0;
	std::vector<u8> cpuReadback;
	uint32_t dirtyRowStart = 0;
	uint32_t dirtyRowEnd = 0;
	std::vector<VdpDirtySpan> dirtySpansByRow;
};

struct VdpSurfaceUpload {
	uint32_t surfaceId = 0;
	uint32_t surfaceWidth = 0;
	uint32_t surfaceHeight = 0;
	const std::vector<u8>* cpuReadback = nullptr;
	uint32_t dirtyRowStart = 0;
	uint32_t dirtyRowEnd = 0;
	const std::vector<VdpDirtySpan>* dirtySpansByRow = nullptr;
	bool requiresFullSync = false;
};

struct VdpFrameBufferPresentation {
	uint32_t presentationCount = 0;
	bool readbackValid = false;
	bool requiresFullSync = false;
	uint32_t dirtyRowStart = 0;
	uint32_t dirtyRowEnd = 0;
	const std::vector<VdpDirtySpan>* dirtySpansByRow = nullptr;
	const std::vector<u8>* renderReadback = nullptr;
	const std::vector<u8>* displayReadback = nullptr;
	uint32_t width = 0;
	uint32_t height = 0;
};

class VdpFrameBufferPresentationSink {
public:
	virtual ~VdpFrameBufferPresentationSink() = default;
	virtual void consumeVdpFrameBufferPresentation(const VdpFrameBufferPresentation& presentation) = 0;
};

class VdpSurfaceUploadSink {
public:
	virtual ~VdpSurfaceUploadSink() = default;
	virtual void consumeVdpSurfaceUpload(const VdpSurfaceUpload& upload) = 0;
};

struct VdpDeviceOutput {
	i32 ditherType = 0;
	u32 scanoutPhase = 0u;
	u32 scanoutX = 0u;
	u32 scanoutY = 0u;
	uint32_t frameBufferWidth = 0;
	uint32_t frameBufferHeight = 0;
	const VdpRpuFrameOutput* rpu = nullptr;
};

} // namespace bmsx
