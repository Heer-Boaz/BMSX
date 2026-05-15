#pragma once

#include "common/types.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/mdu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/xf.h"
#include <array>
#include <vector>

namespace bmsx {

struct VdpDirtySpan {
	uint32_t xStart = 0;
	uint32_t xEnd = 0;
};

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
	const std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS>* xfMatrixWords = nullptr;
	u32 xfViewMatrixIndex = 0;
	u32 xfProjectionMatrixIndex = 0;
	bool skyboxEnabled = false;
	const VdpSkyboxSamples* skyboxSamples = nullptr;
	const VdpBbuFrameBuffer* billboards = nullptr;
	const VdpMduFrameBuffer* meshes = nullptr;
	const std::array<u32, VDP_MFU_WEIGHT_COUNT>* morphWeightWords = nullptr;
	const std::array<u32, VDP_JTU_REGISTER_WORDS>* jointMatrixWords = nullptr;
	uint32_t frameBufferWidth = 0;
	uint32_t frameBufferHeight = 0;
};

} // namespace bmsx
