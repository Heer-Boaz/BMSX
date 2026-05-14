#include "machine/devices/geometry/sat2.h"

#include "machine/common/numeric.h"
#include "machine/devices/geometry/addressing.h"
#include "machine/devices/geometry/contracts.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>

namespace bmsx {
namespace {

constexpr uint32_t GEO_FAULT_NONE = 0u;

uint32_t packSat2Meta(uint32_t axisIndex, uint32_t shapeSelector) {
	return ((shapeSelector & GEO_SAT_META_AXIS_MASK) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK);
}

} // namespace

GeometrySat2Unit::GeometrySat2Unit(Memory& memory)
	: m_memory(memory) {
}

uint32_t GeometrySat2Unit::validateSubmission(const GeometryJobState& job) const {
	if (job.param0 != 0u || job.param1 != 0u || job.dst1 != 0u) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	if (job.stride0 != GEO_SAT2_PAIR_BYTES || job.stride1 != GEO_SAT2_DESC_BYTES || job.stride2 != GEO_VERTEX2_BYTES) {
		return GEO_FAULT_REJECT_BAD_STRIDE;
	}
	if ((job.src0 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.src1 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.src2 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
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
	if (!m_memory.isRamRange(job.dst0, GEO_SAT2_RESULT_BYTES)) {
		return GEO_FAULT_REJECT_DST_NOT_RAM;
	}
	return GEO_FAULT_NONE;
}

uint32_t GeometrySat2Unit::processRecord(GeometryJobState& job) {
	const std::optional<uint32_t> pairAddr = resolveGeometryIndexedSpan(job.src0, job.processed, job.stride0, GEO_SAT2_PAIR_BYTES);
	if (!pairAddr.has_value()) {
		return GEO_FAULT_BAD_RECORD_ALIGNMENT;
	}
	if (!m_memory.isReadableMainMemoryRange(*pairAddr, GEO_SAT2_PAIR_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const uint32_t flags = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_FLAGS_OFFSET);
	const uint32_t shapeAIndex = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET);
	const uint32_t resultIndex = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_RESULT_INDEX_OFFSET);
	const uint32_t shapeBIndex = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET);
	const uint32_t pairFlags = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_FLAGS2_OFFSET);
	if (flags != 0u || pairFlags != 0u) {
		return GEO_FAULT_BAD_RECORD_FLAGS;
	}
	const std::optional<uint32_t> resultAddr = resolveGeometryIndexedSpan(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES, GEO_SAT2_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, GEO_SAT2_RESULT_BYTES)) {
		return GEO_FAULT_DST_RANGE;
	}
	const std::optional<uint32_t> shapeADescAddr = resolveGeometryIndexedSpan(job.src1, shapeAIndex, job.stride1, GEO_SAT2_DESC_BYTES);
	const std::optional<uint32_t> shapeBDescAddr = resolveGeometryIndexedSpan(job.src1, shapeBIndex, job.stride1, GEO_SAT2_DESC_BYTES);
	if (!shapeADescAddr.has_value() || !shapeBDescAddr.has_value()) {
		return GEO_FAULT_SRC_RANGE;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeADescAddr, GEO_SAT2_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(*shapeBDescAddr, GEO_SAT2_DESC_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const uint32_t shapeAFlags = m_memory.readU32(*shapeADescAddr + GEO_SAT2_DESC_FLAGS_OFFSET);
	const uint32_t shapeAVertexCount = m_memory.readU32(*shapeADescAddr + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET);
	const uint32_t shapeAVertexOffsetBytes = m_memory.readU32(*shapeADescAddr + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET);
	const uint32_t shapeAReserved = m_memory.readU32(*shapeADescAddr + GEO_SAT2_DESC_RESERVED_OFFSET);
	const uint32_t shapeBFlags = m_memory.readU32(*shapeBDescAddr + GEO_SAT2_DESC_FLAGS_OFFSET);
	const uint32_t shapeBVertexCount = m_memory.readU32(*shapeBDescAddr + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET);
	const uint32_t shapeBVertexOffsetBytes = m_memory.readU32(*shapeBDescAddr + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET);
	const uint32_t shapeBReserved = m_memory.readU32(*shapeBDescAddr + GEO_SAT2_DESC_RESERVED_OFFSET);
	if (shapeAFlags != GEO_SHAPE_CONVEX_POLY
		|| shapeBFlags != GEO_SHAPE_CONVEX_POLY
		|| shapeAReserved != 0u
		|| shapeBReserved != 0u) {
		return GEO_FAULT_DESCRIPTOR_KIND;
	}
	if (shapeAVertexCount < 3u || shapeBVertexCount < 3u) {
		return GEO_FAULT_BAD_VERTEX_COUNT;
	}
	if ((shapeAVertexOffsetBytes & GEOMETRY_WORD_ALIGN_MASK) != 0u || (shapeBVertexOffsetBytes & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
		return GEO_FAULT_BAD_RECORD_ALIGNMENT;
	}
	if (shapeAVertexCount > GEOMETRY_VERTEX2_U32_SPAN_MAX_COUNT
		|| shapeBVertexCount > GEOMETRY_VERTEX2_U32_SPAN_MAX_COUNT) {
		return GEO_FAULT_BAD_VERTEX_COUNT;
	}
	const uint32_t shapeAVertexBytes = shapeAVertexCount * GEO_VERTEX2_BYTES;
	const uint32_t shapeBVertexBytes = shapeBVertexCount * GEO_VERTEX2_BYTES;
	const std::optional<uint32_t> shapeAVertexAddr = resolveGeometryIndexedSpan(job.src2, shapeAVertexOffsetBytes, 1u, shapeAVertexBytes);
	const std::optional<uint32_t> shapeBVertexAddr = resolveGeometryIndexedSpan(job.src2, shapeBVertexOffsetBytes, 1u, shapeBVertexBytes);
	if (!shapeAVertexAddr.has_value() || !shapeBVertexAddr.has_value()) {
		return GEO_FAULT_SRC_RANGE;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeAVertexAddr, shapeAVertexBytes)
		|| !m_memory.isReadableMainMemoryRange(*shapeBVertexAddr, shapeBVertexBytes)) {
		return GEO_FAULT_SRC_RANGE;
	}
	double centerAX = 0.0;
	double centerAY = 0.0;
	uint32_t vertexXAddr = *shapeAVertexAddr + GEO_VERTEX2_X_OFFSET;
	uint32_t vertexYAddr = *shapeAVertexAddr + GEO_VERTEX2_Y_OFFSET;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1u) {
		centerAX += toSignedWord(m_memory.readU32(vertexXAddr));
		centerAY += toSignedWord(m_memory.readU32(vertexYAddr));
		vertexXAddr += GEO_VERTEX2_BYTES;
		vertexYAddr += GEO_VERTEX2_BYTES;
	}
	double centerBX = 0.0;
	double centerBY = 0.0;
	vertexXAddr = *shapeBVertexAddr + GEO_VERTEX2_X_OFFSET;
	vertexYAddr = *shapeBVertexAddr + GEO_VERTEX2_Y_OFFSET;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1u) {
		centerBX += toSignedWord(m_memory.readU32(vertexXAddr));
		centerBY += toSignedWord(m_memory.readU32(vertexYAddr));
		vertexXAddr += GEO_VERTEX2_BYTES;
		vertexYAddr += GEO_VERTEX2_BYTES;
	}
	centerAX /= static_cast<double>(shapeAVertexCount);
	centerAY /= static_cast<double>(shapeAVertexCount);
	centerBX /= static_cast<double>(shapeBVertexCount);
	centerBY /= static_cast<double>(shapeBVertexCount);
	double bestOverlap = std::numeric_limits<double>::infinity();
	double bestAxisX = 0.0;
	double bestAxisY = 0.0;
	uint32_t bestAxisIndex = 0u;
	uint32_t bestShapeSelector = GEO_SAT_META_SHAPE_SRC;
	bool sawAxis = false;
	for (uint32_t shapeSelector = GEO_SAT_META_SHAPE_SRC; shapeSelector <= GEO_SAT_META_SHAPE_AUX; shapeSelector += 1u) {
		const uint32_t axisBase = shapeSelector == GEO_SAT_META_SHAPE_SRC ? *shapeAVertexAddr : *shapeBVertexAddr;
		const uint32_t axisCount = shapeSelector == GEO_SAT_META_SHAPE_SRC ? shapeAVertexCount : shapeBVertexCount;
		for (uint32_t edgeIndex = 0; edgeIndex < axisCount; edgeIndex += 1u) {
			const uint32_t currentAddr = axisBase + edgeIndex * GEO_VERTEX2_BYTES;
			const uint32_t nextIndex = edgeIndex + 1u == axisCount ? 0u : edgeIndex + 1u;
			const uint32_t nextAddr = axisBase + nextIndex * GEO_VERTEX2_BYTES;
			const double x0 = toSignedWord(m_memory.readU32(currentAddr + GEO_VERTEX2_X_OFFSET));
			const double y0 = toSignedWord(m_memory.readU32(currentAddr + GEO_VERTEX2_Y_OFFSET));
			const double x1 = toSignedWord(m_memory.readU32(nextAddr + GEO_VERTEX2_X_OFFSET));
			const double y1 = toSignedWord(m_memory.readU32(nextAddr + GEO_VERTEX2_Y_OFFSET));
			const double nx = -(y1 - y0);
			const double ny = x1 - x0;
			const double axisLength = std::sqrt((nx * nx) + (ny * ny));
			if (!(axisLength > 0.0)) {
				continue;
			}
			sawAxis = true;
			const double ax = nx / axisLength;
			const double ay = ny / axisLength;
			projectVertexSpanInto(*shapeAVertexAddr, shapeAVertexCount, ax, ay, m_projectionA);
			projectVertexSpanInto(*shapeBVertexAddr, shapeBVertexCount, ax, ay, m_projectionB);
			const double sepA = m_projectionA.min - m_projectionB.max;
			const double sepB = m_projectionB.min - m_projectionA.max;
			if (sepA > 0.0 || sepB > 0.0) {
				writeResult(*resultAddr, 0u, 0, 0, 0, 0u);
				return GEO_FAULT_NONE;
			}
			const double overlap = std::min(m_projectionA.max, m_projectionB.max) - std::max(m_projectionA.min, m_projectionB.min);
			if (overlap < bestOverlap) {
				bestOverlap = overlap;
				bestAxisX = ax;
				bestAxisY = ay;
				bestAxisIndex = edgeIndex;
				bestShapeSelector = shapeSelector;
			}
		}
	}
	if (!sawAxis) {
		return GEO_FAULT_DESCRIPTOR_KIND;
	}
	const double deltaX = centerBX - centerAX;
	const double deltaY = centerBY - centerAY;
	if (((deltaX * bestAxisX) + (deltaY * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	writeResult(
		*resultAddr,
		1u,
		saturateRoundedI32(bestAxisX * FIX16_SCALE),
		saturateRoundedI32(bestAxisY * FIX16_SCALE),
		saturateRoundedI32(bestOverlap),
		packSat2Meta(bestAxisIndex, bestShapeSelector)
	);
	return GEO_FAULT_NONE;
}

void GeometrySat2Unit::projectVertexSpanInto(uint32_t base, uint32_t count, double ax, double ay, GeometryProjectionSpan& out) const {
	double min = std::numeric_limits<double>::infinity();
	double max = -std::numeric_limits<double>::infinity();
	uint32_t xAddr = base + GEO_VERTEX2_X_OFFSET;
	uint32_t yAddr = base + GEO_VERTEX2_Y_OFFSET;
	for (uint32_t vertexIndex = 0; vertexIndex < count; vertexIndex += 1u) {
		const double px = toSignedWord(m_memory.readU32(xAddr));
		const double py = toSignedWord(m_memory.readU32(yAddr));
		const double projection = (px * ax) + (py * ay);
		if (projection < min) {
			min = projection;
		}
		if (projection > max) {
			max = projection;
		}
		xAddr += GEO_VERTEX2_BYTES;
		yAddr += GEO_VERTEX2_BYTES;
	}
	out.min = min;
	out.max = max;
}

void GeometrySat2Unit::writeResult(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta) {
	m_memory.writeU32(addr + GEO_SAT2_RESULT_HIT_OFFSET, hit);
	m_memory.writeU32(addr + GEO_SAT2_RESULT_NX_OFFSET, static_cast<uint32_t>(nx));
	m_memory.writeU32(addr + GEO_SAT2_RESULT_NY_OFFSET, static_cast<uint32_t>(ny));
	m_memory.writeU32(addr + GEO_SAT2_RESULT_DEPTH_OFFSET, static_cast<uint32_t>(depth));
	m_memory.writeU32(addr + GEO_SAT2_RESULT_META_OFFSET, meta);
}

} // namespace bmsx
