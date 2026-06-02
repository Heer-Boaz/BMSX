#include "machine/devices/geometry/xform2.h"

#include "machine/common/numeric.h"
#include "machine/devices/geometry/addressing.h"
#include "machine/devices/geometry/contracts.h"

#include <optional>

namespace bmsx {
namespace {

constexpr uint32_t GEO_FAULT_NONE = 0u;

} // namespace

GeometryXform2Unit::GeometryXform2Unit(Memory& memory)
	: m_memory(memory) {
}

uint32_t GeometryXform2Unit::validateSubmission(const GeometryJobState& job) const {
	if (job.param0 != 0u || job.param1 != 0u) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	if (job.stride0 != GEO_XFORM2_RECORD_BYTES || job.stride1 != GEO_VERTEX2_BYTES || job.stride2 != GEO_XFORM2_MATRIX_BYTES) {
		return GEO_FAULT_REJECT_BAD_STRIDE;
	}
	if ((job.src0 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.src1 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.src2 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.dst1 & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
		return GEO_FAULT_REJECT_MISALIGNED_REGS;
	}
	if (job.count == 0u) {
		return GEO_FAULT_NONE;
	}
	if (!m_memory.isReadableMainMemoryRange(job.src0, job.stride0)
		|| !m_memory.isReadableMainMemoryRange(job.src1, job.stride1)
		|| !m_memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	if (!m_memory.isRamRange(job.dst0, GEO_VERTEX2_BYTES)) {
		return GEO_FAULT_REJECT_DST_NOT_RAM;
	}
	if (job.dst1 != 0u && !m_memory.isRamRange(job.dst1, 4u)) {
		return GEO_FAULT_REJECT_DST_NOT_RAM;
	}
	return GEO_FAULT_NONE;
}

uint32_t GeometryXform2Unit::processRecord(GeometryJobState& job) {
	const std::optional<uint32_t> recordAddr = resolveGeometryIndexedSpan(job.src0, job.processed, job.stride0, GEO_XFORM2_RECORD_BYTES);
	if (!recordAddr.has_value()) {
		return GEO_FAULT_BAD_RECORD_ALIGNMENT;
	}
	if (!m_memory.isReadableMainMemoryRange(*recordAddr, GEO_XFORM2_RECORD_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const uint32_t flags = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_FLAGS_OFFSET);
	const uint32_t srcIndex = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET);
	const uint32_t dstIndex = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET);
	const uint32_t auxIndex = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET);
	const uint32_t vertexCount = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET);
	const uint32_t dst1Index = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET);
	if (flags != 0u) {
		return GEO_FAULT_BAD_RECORD_FLAGS;
	}
	if (vertexCount == 0u) {
		return GEO_FAULT_NONE;
	}
	if (vertexCount > GEO_XFORM2_MAX_VERTICES) {
		return GEO_FAULT_BAD_VERTEX_COUNT;
	}
	const uint32_t vertexBytes = vertexCount * GEO_VERTEX2_BYTES;
	const std::optional<uint32_t> srcAddr = resolveGeometryIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
	if (!srcAddr.has_value() || !m_memory.isReadableMainMemoryRange(*srcAddr, vertexBytes)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const std::optional<uint32_t> matrixAddr = resolveGeometryIndexedSpan(job.src2, auxIndex, job.stride2, GEO_XFORM2_MATRIX_BYTES);
	if (!matrixAddr.has_value() || !m_memory.isReadableMainMemoryRange(*matrixAddr, GEO_XFORM2_MATRIX_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const std::optional<uint32_t> dstAddr = resolveGeometryIndexedSpan(job.dst0, dstIndex, GEO_VERTEX2_BYTES, vertexBytes);
	if (!dstAddr.has_value() || !m_memory.isRamRange(*dstAddr, vertexBytes)) {
		return GEO_FAULT_DST_RANGE;
	}
	uint32_t aabbAddr = 0u;
	if (dst1Index != GEO_INDEX_NONE) {
		const std::optional<uint32_t> resolvedAabbAddr = resolveGeometryIndexedSpan(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_AABB_BYTES);
		if (!resolvedAabbAddr.has_value() || !m_memory.isRamRange(*resolvedAabbAddr, GEO_XFORM2_AABB_BYTES)) {
			return GEO_FAULT_DST_RANGE;
		}
		aabbAddr = *resolvedAabbAddr;
	}
	const int32_t m00 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M00_OFFSET));
	const int32_t m01 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M01_OFFSET));
	const int32_t tx = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_TX_OFFSET));
	const int32_t m10 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M10_OFFSET));
	const int32_t m11 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M11_OFFSET));
	const int32_t ty = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_TY_OFFSET));
	int32_t minX = 0;
	int32_t minY = 0;
	int32_t maxX = 0;
	int32_t maxY = 0;
	for (uint32_t vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1u) {
		const uint32_t localAddr = *srcAddr + vertexIndex * GEO_VERTEX2_BYTES;
		const uint32_t worldAddr = *dstAddr + vertexIndex * GEO_VERTEX2_BYTES;
		const int32_t localX = toSignedWord(m_memory.readU32(localAddr + GEO_VERTEX2_X_OFFSET));
		const int32_t localY = toSignedWord(m_memory.readU32(localAddr + GEO_VERTEX2_Y_OFFSET));
		const int32_t worldX = transformFixed16(m00, m01, tx, localX, localY);
		const int32_t worldY = transformFixed16(m10, m11, ty, localX, localY);
		m_memory.writeU32(worldAddr + GEO_VERTEX2_X_OFFSET, static_cast<uint32_t>(worldX));
		m_memory.writeU32(worldAddr + GEO_VERTEX2_Y_OFFSET, static_cast<uint32_t>(worldY));
		if (vertexIndex == 0u) {
			minX = worldX;
			minY = worldY;
			maxX = worldX;
			maxY = worldY;
			continue;
		}
		if (worldX < minX) {
			minX = worldX;
		}
		if (worldY < minY) {
			minY = worldY;
		}
		if (worldX > maxX) {
			maxX = worldX;
		}
		if (worldY > maxY) {
			maxY = worldY;
		}
	}
	if (dst1Index != GEO_INDEX_NONE) {
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MIN_X_OFFSET, static_cast<uint32_t>(minX));
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MIN_Y_OFFSET, static_cast<uint32_t>(minY));
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MAX_X_OFFSET, static_cast<uint32_t>(maxX));
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MAX_Y_OFFSET, static_cast<uint32_t>(maxY));
	}
	return GEO_FAULT_NONE;
}

} // namespace bmsx
