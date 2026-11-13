#include "machine/devices/geometry/sat2.h"

#include "machine/common/numeric.h"
#include "machine/devices/geometry/addressing.h"
#include "machine/devices/geometry/projection.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace bmsx {
namespace {

u32 packSat2Meta(u32 axisIndex, u32 shapeSelector) {
	return ((shapeSelector & GEO_SAT_META_AXIS_MASK) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK);
}

void projectVertexSpanInto(const std::array<u32, GEO_SAT2_MAX_POLY_VERTICES * 2u>& vertices,
		u32 count, double ax, double ay, GeometryProjectionSpan& out) {
	double min = std::numeric_limits<double>::infinity();
	double max = -std::numeric_limits<double>::infinity();
	for (u32 i = 0; i < count; ++i) {
		const double projection = toSignedWord(vertices[i * 2u]) * ax + toSignedWord(vertices[i * 2u + 1u]) * ay;
		if (projection < min) min = projection;
		if (projection > max) max = projection;
	}
	out.min = min; out.max = max;
}

} // namespace

GeometrySat2Unit::GeometrySat2Unit(Memory& memory) : m_memory(memory) {}

void GeometrySat2Unit::reset() { m_progress = {}; }

void GeometrySat2Unit::processStep(GeometryJobState& job) {
	auto& s = m_progress;
	auto& words = s.pendingMemory;
	words = {};
	s.pendingWorkUnits = s.pendingFault = 0u;
	switch (static_cast<GeometrySat2Phase>(s.phase)) {
	case GeometrySat2Phase::Record: {
		const u32 pairAddr = geometryIndexedAddr(job.src0, job.processed, job.stride0);
		if (!geometryIndexedSpanFits(job.src0, job.processed, job.stride0, GEO_SAT2_PAIR_BYTES)) {
			s.pendingFault = GEO_FAULT_BAD_RECORD_ALIGNMENT;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		if (!m_memory.isReadableMainMemoryRange(pairAddr, GEO_SAT2_PAIR_BYTES)) {
			s.pendingFault = GEO_FAULT_SRC_RANGE;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		const u32 flags = m_memory.readCountedU32(pairAddr + GEO_SAT2_PAIR_FLAGS_OFFSET, words);
		const u32 indexA = m_memory.readCountedU32(pairAddr + GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET, words);
		const u32 resultIndex = m_memory.readCountedU32(pairAddr + GEO_SAT2_PAIR_RESULT_INDEX_OFFSET, words);
		const u32 indexB = m_memory.readCountedU32(pairAddr + GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET, words);
		const u32 flags2 = m_memory.readCountedU32(pairAddr + GEO_SAT2_PAIR_FLAGS2_OFFSET, words);
		if (flags != 0u || flags2 != 0u) {
			s.pendingFault = GEO_FAULT_BAD_RECORD_FLAGS;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		const u32 resultAddress = geometryIndexedAddr(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES);
		if (!geometryIndexedSpanFits(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES, GEO_SAT2_RESULT_BYTES)
			|| !m_memory.isRamRange(resultAddress, GEO_SAT2_RESULT_BYTES)) {
			s.pendingFault = GEO_FAULT_DST_RANGE;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		const u32 descA = geometryIndexedAddr(job.src1, indexA, job.stride1);
		const u32 descB = geometryIndexedAddr(job.src1, indexB, job.stride1);
		if (!geometryIndexedSpanFits(job.src1, indexA, job.stride1, GEO_SAT2_DESC_BYTES)
			|| !geometryIndexedSpanFits(job.src1, indexB, job.stride1, GEO_SAT2_DESC_BYTES)
			|| !m_memory.isReadableMainMemoryRange(descA, GEO_SAT2_DESC_BYTES)
			|| !m_memory.isReadableMainMemoryRange(descB, GEO_SAT2_DESC_BYTES)) {
			s.pendingFault = GEO_FAULT_SRC_RANGE;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		const u32 kindA = m_memory.readCountedU32(descA + GEO_SAT2_DESC_FLAGS_OFFSET, words);
		const u32 countA = m_memory.readCountedU32(descA + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, words);
		const u32 offsetA = m_memory.readCountedU32(descA + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET, words);
		const u32 reservedA = m_memory.readCountedU32(descA + GEO_SAT2_DESC_RESERVED_OFFSET, words);
		const u32 kindB = m_memory.readCountedU32(descB + GEO_SAT2_DESC_FLAGS_OFFSET, words);
		const u32 countB = m_memory.readCountedU32(descB + GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, words);
		const u32 offsetB = m_memory.readCountedU32(descB + GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET, words);
		const u32 reservedB = m_memory.readCountedU32(descB + GEO_SAT2_DESC_RESERVED_OFFSET, words);
		if (kindA != GEO_SHAPE_CONVEX_POLY || kindB != GEO_SHAPE_CONVEX_POLY || reservedA != 0u || reservedB != 0u) {
			s.pendingFault = GEO_FAULT_DESCRIPTOR_KIND;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		if (countA < 3u || countB < 3u) {
			s.pendingFault = GEO_FAULT_BAD_VERTEX_COUNT;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		if ((offsetA & GEOMETRY_WORD_ALIGN_MASK) != 0u || (offsetB & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
			s.pendingFault = GEO_FAULT_BAD_RECORD_ALIGNMENT;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		if (countA > GEO_SAT2_MAX_POLY_VERTICES || countB > GEO_SAT2_MAX_POLY_VERTICES) {
			s.pendingFault = GEO_FAULT_BAD_VERTEX_COUNT;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		const u32 addressA = geometryIndexedAddr(job.src2, offsetA, 1u), addressB = geometryIndexedAddr(job.src2, offsetB, 1u);
		const u32 bytesA = countA * GEO_VERTEX2_BYTES, bytesB = countB * GEO_VERTEX2_BYTES;
		if (!geometryIndexedSpanFits(job.src2, offsetA, 1u, bytesA) || !geometryIndexedSpanFits(job.src2, offsetB, 1u, bytesB)
			|| !m_memory.isReadableMainMemoryRange(addressA, bytesA) || !m_memory.isReadableMainMemoryRange(addressB, bytesB)) {
			s.pendingFault = GEO_FAULT_SRC_RANGE;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		s.vertexAddressA = addressA;
		s.vertexAddressB = addressB;
		s.countA = countA;
		s.countB = countB;
		s.resultAddress = resultAddress;
		s.phase = static_cast<u32>(GeometrySat2Phase::LoadA);
		return;
	}
	case GeometrySat2Phase::LoadA:
		for (u32 i = 0; i < s.countA * 2u; ++i) {
			s.verticesA[i] = m_memory.readCountedU32(s.vertexAddressA + i * 4u, words);
		}
		s.phase = static_cast<u32>(GeometrySat2Phase::LoadB);
		return;
	case GeometrySat2Phase::LoadB:
		for (u32 i = 0; i < s.countB * 2u; ++i) {
			s.verticesB[i] = m_memory.readCountedU32(s.vertexAddressB + i * 4u, words);
		}
		s.phase = static_cast<u32>(GeometrySat2Phase::Compute);
		return;
	case GeometrySat2Phase::Compute: {
		double centerAX = 0, centerAY = 0, centerBX = 0, centerBY = 0;
		for (u32 i = 0; i < s.countA; ++i) {
			centerAX += toSignedWord(s.verticesA[i * 2u]);
			centerAY += toSignedWord(s.verticesA[i * 2u + 1u]);
		}
		for (u32 i = 0; i < s.countB; ++i) {
			centerBX += toSignedWord(s.verticesB[i * 2u]);
			centerBY += toSignedWord(s.verticesB[i * 2u + 1u]);
		}
		s.pendingWorkUnits += s.countA + s.countB + 4u;
		centerAX /= s.countA;
		centerAY /= s.countA;
		centerBX /= s.countB;
		centerBY /= s.countB;
		double bestOverlap = std::numeric_limits<double>::infinity(), bestAxisX = 0, bestAxisY = 0;
		u32 bestAxisIndex = 0u, bestShapeSelector = GEO_SAT_META_SHAPE_SRC;
		bool sawAxis = false, separated = false;
		for (u32 selector = GEO_SAT_META_SHAPE_SRC; selector <= GEO_SAT_META_SHAPE_AUX && !separated; ++selector) {
			const auto& vertices = selector == GEO_SAT_META_SHAPE_SRC ? s.verticesA : s.verticesB;
			const u32 count = selector == GEO_SAT_META_SHAPE_SRC ? s.countA : s.countB;
			for (u32 edge = 0; edge < count; ++edge) {
				const u32 next = edge + 1u == count ? 0u : edge + 1u;
				const double x0 = toSignedWord(vertices[edge * 2u]), y0 = toSignedWord(vertices[edge * 2u + 1u]);
				const double x1 = toSignedWord(vertices[next * 2u]), y1 = toSignedWord(vertices[next * 2u + 1u]);
				const double nx = -(y1 - y0), ny = x1 - x0;
				const double length = std::sqrt(nx * nx + ny * ny);
				s.pendingWorkUnits += 2u;
				if (!(length > 0.0)) continue;
				sawAxis = true;
				s.pendingWorkUnits += 2u + s.countA + s.countB;
				const double ax = nx / length, ay = ny / length;
				GeometryProjectionSpan projectionA, projectionB;
				projectVertexSpanInto(s.verticesA, s.countA, ax, ay, projectionA);
				projectVertexSpanInto(s.verticesB, s.countB, ax, ay, projectionB);
				if (projectionA.min - projectionB.max > 0 || projectionB.min - projectionA.max > 0) {
					separated = true;
					break;
				}
				const double overlap = std::min(projectionA.max, projectionB.max) - std::max(projectionA.min, projectionB.min);
				if (overlap < bestOverlap) {
					bestOverlap = overlap;
					bestAxisX = ax;
					bestAxisY = ay;
					bestAxisIndex = edge;
					bestShapeSelector = selector;
				}
			}
		}
		if (!sawAxis) {
			s.pendingFault = GEO_FAULT_DESCRIPTOR_KIND;
			s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
			return;
		}
		if (separated) {
			s.result.fill(0u);
		} else {
			if ((centerBX - centerAX) * bestAxisX + (centerBY - centerAY) * bestAxisY < 0) {
				bestAxisX = -bestAxisX;
				bestAxisY = -bestAxisY;
			}
			s.result[0] = 1u;
			s.result[1] = static_cast<u32>(saturateRoundedI32(bestAxisX * FIX16_SCALE));
			s.result[2] = static_cast<u32>(saturateRoundedI32(bestAxisY * FIX16_SCALE));
			s.result[3] = static_cast<u32>(saturateRoundedI32(bestOverlap));
			s.result[4] = packSat2Meta(bestAxisIndex, bestShapeSelector);
		}
		words.ramWords += GEO_SAT2_RESULT_BYTES / IO_WORD_SIZE;
		s.phase = static_cast<u32>(GeometrySat2Phase::Publish);
		return;
	}
	case GeometrySat2Phase::Publish:
		m_memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_HIT_OFFSET, s.result[0]);
		m_memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_NX_OFFSET, s.result[1]);
		m_memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_NY_OFFSET, s.result[2]);
		m_memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_DEPTH_OFFSET, s.result[3]);
		m_memory.writeU32(s.resultAddress + GEO_SAT2_RESULT_META_OFFSET, s.result[4]);
		s.phase = static_cast<u32>(GeometrySat2Phase::Complete);
		return;
	case GeometrySat2Phase::Complete:
		return;
	}
}

} // namespace bmsx
