#include "common/float32.h"
#include "machine/devices/geometry/overlap2d.h"

#include "machine/common/numeric.h"
#include "common/compiler.h"
#include "machine/devices/geometry/addressing.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace bmsx {
namespace {

constexpr uint32_t GEO_FAULT_NONE = 0u;

} // namespace

GeometryOverlap2dUnit::GeometryOverlap2dUnit(Memory& memory)
	: m_memory(memory) {
}

void GeometryOverlap2dUnit::beginJob(const GeometryJobState& job) {
	reset();
	m_pair.pendingWriteFlags = 2u;
	m_pair.afterPublishPhase = 5u;
	m_pair.phase = 4u;
	pricePendingWrites(job);
}

uint32_t GeometryOverlap2dUnit::processStep(GeometryJobState& job) {
	if (m_pair.phase == 4u) return publish(job);
	m_pair.pendingMemory = {};
	m_pair.pendingWork = {};
	u32 fault;
	switch (m_pair.phase) {
	case 0u:
	case 5u: fault = beginRecord(job); break;
	case 1u: fault = beginPair(job); break;
	case 2u: fault = processPiece(); break;
	case 3u: fault = completePiece(job); break;
	default: BMSX_UNREACHABLE();
	}
	if (fault != GEO_FAULT_NONE) {
		m_pair.pendingFault = fault;
		m_pair.pendingWriteFlags = 0u;
		m_pair.phase = 4u;
	}
	if (m_pair.phase == 4u) pricePendingWrites(job);
	return GEO_FAULT_NONE;
}

void GeometryOverlap2dUnit::writeSummary(const GeometryJobState& job, uint32_t flags) {
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET, job.resultCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET, job.exactPairCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET, job.broadphasePairCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET, flags);
}

uint32_t GeometryOverlap2dUnit::beginRecord(GeoJob& job) {
	const u32 mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		const u32 pairAddr = geometryIndexedAddr(job.src1, job.processed, job.stride1);
		if (!geometryIndexedSpanFits(job.src1, job.processed, job.stride1, GEO_OVERLAP2D_PAIR_BYTES)
			|| !m_memory.isReadableMainMemoryRange(pairAddr, GEO_OVERLAP2D_PAIR_BYTES)) return GEO_FAULT_SRC_RANGE;
		const u32 a = m_memory.readCountedU32(pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET, m_pair.pendingMemory);
		const u32 b = m_memory.readCountedU32(pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET, m_pair.pendingMemory);
		m_pair.pairMeta = m_memory.readCountedU32(pairAddr + GEO_OVERLAP2D_PAIR_META_OFFSET, m_pair.pendingMemory);
		if (a == b) return GEO_FAULT_BAD_RECORD_FLAGS;
		if (a >= job.stride2 || b >= job.stride2) return GEO_FAULT_SRC_RANGE;
		if (!readInstanceAt(job, a, m_pair.instanceA) || !readInstanceAt(job, b, m_pair.instanceB)) return GEO_FAULT_SRC_RANGE;
	} else {
		if (!readInstanceAt(job, job.processed, m_pair.instanceA)) return GEO_FAULT_SRC_RANGE;
		m_pair.instanceBIndex = job.processed + 1u;
		if (m_pair.instanceBIndex >= job.count) {
			m_pair.pendingWriteFlags = 2u;
			m_pair.afterPublishPhase = 0u;
			m_pair.phase = 4u;
			return GEO_FAULT_NONE;
		}
	}
	m_pair.phase = 1u;
	return GEO_FAULT_NONE;
}

bool GeometryOverlap2dUnit::readInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& out) {
	const uint32_t instanceAddr = geometryIndexedAddr(job.src0, instanceIndex, job.stride0);
	if (!geometryIndexedSpanFits(job.src0, instanceIndex, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES)
		|| !m_memory.isReadableMainMemoryRange(instanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
		return false;
	}
	out[0] = m_memory.readCountedU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET, m_pair.pendingMemory);
	out[1] = m_memory.readCountedU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_TX_OFFSET, m_pair.pendingMemory);
	out[2] = m_memory.readCountedU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_TY_OFFSET, m_pair.pendingMemory);
	out[3] = m_memory.readCountedU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET, m_pair.pendingMemory);
	out[4] = m_memory.readCountedU32(instanceAddr + GEO_OVERLAP2D_INSTANCE_MASK_OFFSET, m_pair.pendingMemory);
	return true;
}

uint32_t GeometryOverlap2dUnit::beginPair(GeoJob& job) {
	if ((job.param0 & GEO_OVERLAP2D_MODE_MASK) != GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		if (!readInstanceAt(job, m_pair.instanceBIndex, m_pair.instanceB)) return GEO_FAULT_SRC_RANGE;
		m_pair.pairMeta = ((job.processed & GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) << GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT)
			| (m_pair.instanceBIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK);
	}
	const u32 shapeA = m_pair.instanceA[0], shapeB = m_pair.instanceB[0];
	if (!m_memory.isReadableMainMemoryRange(shapeA, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(shapeB, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) return GEO_FAULT_SRC_RANGE;
	if ((m_pair.instanceA[4] & m_pair.instanceB[3]) == 0u || (m_pair.instanceB[4] & m_pair.instanceA[3]) == 0u) return finishPair(job);
	job.broadphasePairCount += 1u;
	const double txA = f32BitsToNumber(m_pair.instanceA[1]), tyA = f32BitsToNumber(m_pair.instanceA[2]);
	const double txB = f32BitsToNumber(m_pair.instanceB[1]), tyB = f32BitsToNumber(m_pair.instanceB[2]);
	const u32 faultA = readPieceBounds(shapeA, txA, tyA, m_pair.boundsA);
	if (faultA != GEO_FAULT_NONE) return faultA;
	const u32 faultB = readPieceBounds(shapeB, txB, tyB, m_boundsB);
	if (faultB != GEO_FAULT_NONE) return faultB;
	if (!boundsOverlap(m_pair.boundsA, m_boundsB)) return finishPair(job);
	const u32 kindA = m_memory.readCountedU32(shapeA + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, m_pair.pendingMemory);
	const u32 countA = m_memory.readCountedU32(shapeA + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, m_pair.pendingMemory);
	const u32 offsetA = m_memory.readCountedU32(shapeA + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, m_pair.pendingMemory);
	const u32 kindB = m_memory.readCountedU32(shapeB + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, m_pair.pendingMemory);
	const u32 countB = m_memory.readCountedU32(shapeB + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, m_pair.pendingMemory);
	const u32 offsetB = m_memory.readCountedU32(shapeB + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, m_pair.pendingMemory);
	m_pair.compoundA = kindA == GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
	m_pair.compoundB = kindB == GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
	m_pair.countA = m_pair.compoundA ? countA : 1u;
	m_pair.countB = m_pair.compoundB ? countB : 1u;
	if (m_pair.countA == 0u || m_pair.countB == 0u
		|| (!m_pair.compoundA && kindA != GEO_PRIMITIVE_AABB && kindA != GEO_PRIMITIVE_CONVEX_POLY)
		|| (!m_pair.compoundB && kindB != GEO_PRIMITIVE_AABB && kindB != GEO_PRIMITIVE_CONVEX_POLY)) return GEO_FAULT_DESCRIPTOR_KIND;
	job.exactPairCount += 1u;
	m_pair.shapeAAddr = shapeA; m_pair.shapeBAddr = shapeB;
	m_pair.shapeAOffset = offsetA; m_pair.shapeBOffset = offsetB;
	m_pair.pieceA = 0u; m_pair.pieceB = 0u; m_pair.bestHit = false;
	m_pair.bestDepth = std::numeric_limits<double>::infinity();
	m_pair.bestPieceA = 0u; m_pair.bestPieceB = 0u; m_pair.bestFeature = 0u;
	m_pair.bestNx = 0.0; m_pair.bestNy = 0.0; m_pair.bestPx = 0.0; m_pair.bestPy = 0.0;
	m_pair.phase = 2u;
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::processPiece() {
	m_pair.pendingFault = 0u;
	const double txA = f32BitsToNumber(m_pair.instanceA[1]), tyA = f32BitsToNumber(m_pair.instanceA[2]);
	const double txB = f32BitsToNumber(m_pair.instanceB[1]), tyB = f32BitsToNumber(m_pair.instanceB[2]);
	const u64 offsetA = static_cast<u64>(m_pair.shapeAOffset) + static_cast<u64>(m_pair.pieceA) * GEO_OVERLAP2D_SHAPE_DESC_BYTES;
	const u32 pieceA = m_pair.compoundA ? geometryByteAddr(m_pair.shapeAAddr, offsetA) : m_pair.shapeAAddr;
	if (m_pair.pieceB == 0u) {
		if ((m_pair.compoundA && !geometryByteSpanFits(m_pair.shapeAAddr, offsetA, GEO_OVERLAP2D_SHAPE_DESC_BYTES))
			|| !m_memory.isReadableMainMemoryRange(pieceA, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) return GEO_FAULT_SRC_RANGE;
		const u32 fault = readPieceBounds(pieceA, txA, tyA, m_pair.boundsA);
		if (fault != GEO_FAULT_NONE) return fault;
	}
	const u64 offsetB = static_cast<u64>(m_pair.shapeBOffset) + static_cast<u64>(m_pair.pieceB) * GEO_OVERLAP2D_SHAPE_DESC_BYTES;
	const u32 pieceB = m_pair.compoundB ? geometryByteAddr(m_pair.shapeBAddr, offsetB) : m_pair.shapeBAddr;
	if ((m_pair.compoundB && !geometryByteSpanFits(m_pair.shapeBAddr, offsetB, GEO_OVERLAP2D_SHAPE_DESC_BYTES))
		|| !m_memory.isReadableMainMemoryRange(pieceB, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) return GEO_FAULT_SRC_RANGE;
	const u32 boundsFault = readPieceBounds(pieceB, txB, tyB, m_boundsB);
	if (boundsFault != GEO_FAULT_NONE) return boundsFault;
	if (boundsOverlap(m_pair.boundsA, m_boundsB)) {
		const u32 fault = computePiecePairContact(pieceA, txA, tyA, pieceB, txB, tyB);
		if (fault != GEO_FAULT_NONE) return fault;
		if (m_contactHit && (!m_pair.bestHit || m_contactDepth < m_pair.bestDepth
			|| (m_contactDepth == m_pair.bestDepth && (m_pair.pieceA < m_pair.bestPieceA
				|| (m_pair.pieceA == m_pair.bestPieceA && (m_pair.pieceB < m_pair.bestPieceB
					|| (m_pair.pieceB == m_pair.bestPieceB && m_contactFeatureMeta < m_pair.bestFeature))))))) {
			m_pair.bestHit = true; m_pair.bestDepth = m_contactDepth;
			m_pair.bestPieceA = m_pair.pieceA; m_pair.bestPieceB = m_pair.pieceB; m_pair.bestFeature = m_contactFeatureMeta;
			m_pair.bestNx = m_contactNx; m_pair.bestNy = m_contactNy; m_pair.bestPx = m_contactPx; m_pair.bestPy = m_contactPy;
		}
	}
	m_pair.phase = 3u;
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::completePiece(GeoJob& job) {
	if (m_pair.pendingFault != GEO_FAULT_NONE) return m_pair.pendingFault;
	m_pair.phase = 2u;
	m_pair.pieceB += 1u;
	if (m_pair.pieceB < m_pair.countB) return GEO_FAULT_NONE;
	m_pair.pieceB = 0u;
	m_pair.pieceA += 1u;
	if (m_pair.pieceA < m_pair.countA) return GEO_FAULT_NONE;
	m_pair.pendingWriteFlags = 0u;
	if (m_pair.bestHit) {
		if (job.resultCount >= job.param1) {
			m_pair.pendingWriteFlags = 2u | 4u;
			m_pair.pendingFault = GEO_FAULT_RESULT_CAPACITY;
			m_pair.afterPublishPhase = 0u;
			m_pair.phase = 4u;
			return GEO_FAULT_NONE;
		}
		const u32 result = geometryIndexedAddr(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES);
		if (!geometryIndexedSpanFits(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_RESULT_BYTES)
			|| !m_memory.isRamRange(result, GEO_OVERLAP2D_RESULT_BYTES)) return GEO_FAULT_DST_RANGE;
		m_pair.pendingWriteFlags = 1u;
	}
	return finishPair(job);
}

uint32_t GeometryOverlap2dUnit::finishPair(GeoJob& job) {
	if ((job.param0 & GEO_OVERLAP2D_MODE_MASK) == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS
		|| ++m_pair.instanceBIndex >= job.count) {
		m_pair.pendingWriteFlags |= 2u;
		m_pair.afterPublishPhase = 0u;
		m_pair.phase = 4u;
	} else if ((m_pair.pendingWriteFlags & 1u) != 0u) {
		m_pair.afterPublishPhase = 1u;
		m_pair.phase = 4u;
	} else {
		m_pair.phase = 1u;
	}
	return GEO_FAULT_NONE;
}

void GeometryOverlap2dUnit::pricePendingWrites(const GeoJob& job) {
	if ((m_pair.pendingWriteFlags & 1u) != 0u) {
		const u32 addr = geometryIndexedAddr(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES);
		for (u32 word = 0u; word < GEO_OVERLAP2D_RESULT_WORDS; ++word) {
			m_memory.countRawWriteU32(addr + word * IO_WORD_SIZE, m_pair.pendingMemory);
		}
	}
	if ((m_pair.pendingWriteFlags & 2u) != 0u) {
		for (u32 word = 0u; word < GEO_OVERLAP2D_SUMMARY_BYTES / IO_WORD_SIZE; ++word) {
			m_memory.countRawWriteU32(job.dst1 + word * IO_WORD_SIZE, m_pair.pendingMemory);
		}
	}
}

uint32_t GeometryOverlap2dUnit::publish(GeoJob& job) {
	if ((m_pair.pendingWriteFlags & 1u) != 0u) {
		const u32 result = geometryIndexedAddr(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES);
		writeResult(result, m_pair.bestNx, m_pair.bestNy, m_pair.bestDepth, m_pair.bestPx, m_pair.bestPy,
			m_pair.bestPieceA, m_pair.bestPieceB, m_pair.bestFeature, m_pair.pairMeta);
		job.resultCount += 1u;
	}
	if ((m_pair.pendingWriteFlags & 2u) != 0u) {
		writeSummary(job, (m_pair.pendingWriteFlags & 4u) != 0u ? GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW : 0u);
	}
	m_pair.pendingWriteFlags = 0u;
	m_pair.phase = m_pair.afterPublishPhase;
	return m_pair.pendingFault;
}

uint32_t GeometryOverlap2dUnit::readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) {
	const uint32_t boundsOffset = m_memory.readCountedU32(pieceAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, m_pair.pendingMemory);
	const uint32_t boundsAddr = geometryByteAddr(pieceAddr, boundsOffset);
	if (!geometryByteSpanFits(pieceAddr, boundsOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)
		|| !m_memory.isReadableMainMemoryRange(boundsAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	out[0] = static_cast<double>(readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET)) + tx;
	out[1] = static_cast<double>(readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET)) + ty;
	out[2] = static_cast<double>(readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET)) + tx;
	out[3] = static_cast<double>(readF32(boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET)) + ty;
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::computePiecePairContact(
	uint32_t pieceAAddr,
	double txA,
	double tyA,
	uint32_t pieceBAddr,
	double txB,
	double tyB
) {
	m_contactHit = false;
	const uint32_t faultA = loadPolyView(pieceAAddr, txA, tyA, m_polyA);
	if (faultA != GEO_FAULT_NONE) {
		return faultA;
	}
	const uint32_t faultB = loadPolyView(pieceBAddr, txB, tyB, m_polyB);
	if (faultB != GEO_FAULT_NONE) {
		return faultB;
	}
	return computePolyPairContact(m_polyA, m_polyB);
}

uint32_t GeometryOverlap2dUnit::loadPolyView(uint32_t pieceAddr, double tx, double ty, PolyView& out) {
	const uint32_t primitive = m_memory.readCountedU32(pieceAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, m_pair.pendingMemory);
	const uint32_t dataCount = m_memory.readCountedU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, m_pair.pendingMemory);
	const uint32_t dataOffset = m_memory.readCountedU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, m_pair.pendingMemory);
	if (primitive == GEO_PRIMITIVE_AABB) {
		if (dataCount != GEO_OVERLAP2D_AABB_DATA_COUNT) {
			return GEO_FAULT_BAD_VERTEX_COUNT;
		}
		const uint32_t dataAddr = geometryByteAddr(pieceAddr, dataOffset);
		if (!geometryByteSpanFits(pieceAddr, dataOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)
			|| !m_memory.isReadableMainMemoryRange(dataAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		out.primitive = primitive;
		out.vertexCount = GEO_OVERLAP2D_AABB_DATA_COUNT;
		out.left = static_cast<double>(readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET)) + tx;
		out.top = static_cast<double>(readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET)) + ty;
		out.right = static_cast<double>(readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET)) + tx;
		out.bottom = static_cast<double>(readF32(dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET)) + ty;
		return GEO_FAULT_NONE;
	}
	if (primitive != GEO_PRIMITIVE_CONVEX_POLY) {
		return GEO_FAULT_DESCRIPTOR_KIND;
	}
	if (dataCount < 3u || dataCount > GEO_OVERLAP2D_MAX_POLY_VERTICES) {
		return GEO_FAULT_BAD_VERTEX_COUNT;
	}
	const uint32_t dataBytes = dataCount * GEO_VERTEX2_BYTES;
	const uint32_t dataAddr = geometryByteAddr(pieceAddr, dataOffset);
	if (!geometryByteSpanFits(pieceAddr, dataOffset, dataBytes)
		|| !m_memory.isReadableMainMemoryRange(dataAddr, dataBytes)) {
		return GEO_FAULT_SRC_RANGE;
	}
	out.primitive = primitive;
	out.vertexCount = dataCount;
	for (u32 vertex = 0u; vertex < dataCount; ++vertex) {
		const u32 word = vertex * 2u;
		out.vertices[word] = static_cast<double>(readF32(dataAddr + word * IO_WORD_SIZE)) + tx;
		out.vertices[word + 1u] = static_cast<double>(readF32(dataAddr + (word + 1u) * IO_WORD_SIZE)) + ty;
	}
	out.left = 0.0;
	out.top = 0.0;
	out.right = 0.0;
	out.bottom = 0.0;
	return GEO_FAULT_NONE;
}

bool GeometryOverlap2dUnit::boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b) {
	return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

uint32_t GeometryOverlap2dUnit::computePolyPairContact(const PolyView& polyA, const PolyView& polyB) {
	double bestOverlap = std::numeric_limits<double>::infinity();
	double bestAxisX = 0.0;
	double bestAxisY = 0.0;
	uint32_t bestEdgeIndex = 0u;
	uint32_t bestOwner = 0u;
	bool sawAxis = false;
	for (uint32_t owner = 0u; owner < 2u; owner += 1u) {
		const PolyView& poly = owner == 0u ? polyA : polyB;
		for (uint32_t edgeIndex = 0u; edgeIndex < poly.vertexCount; edgeIndex += 1u) {
			m_pair.pendingWork.axes += 1u;
			m_pair.pendingWork.squareRoots += 1u;
			const uint32_t nextIndex = edgeIndex + 1u == poly.vertexCount ? 0u : edgeIndex + 1u;
			readWorldVertexInto(poly, edgeIndex, m_vertex0);
			readWorldVertexInto(poly, nextIndex, m_vertex1);
			const double nx = -(m_vertex1.y - m_vertex0.y);
			const double ny = m_vertex1.x - m_vertex0.x;
			const double len = std::sqrt((nx * nx) + (ny * ny));
			if (!(len > 0.0)) {
				continue;
			}
			sawAxis = true;
			m_pair.pendingWork.divisions += 2u;
			const double ax = nx / len;
			const double ay = ny / len;
			projectPolyInto(polyA, ax, ay, m_projectionA);
			projectPolyInto(polyB, ax, ay, m_projectionB);
			const double overlap = std::min(m_projectionA.max, m_projectionB.max) - std::max(m_projectionA.min, m_projectionB.min);
			if (!(overlap > 0.0)) {
				return GEO_FAULT_NONE;
			}
			if (overlap < bestOverlap || (overlap == bestOverlap && (owner < bestOwner || (owner == bestOwner && edgeIndex < bestEdgeIndex)))) {
				bestOverlap = overlap;
				bestAxisX = ax;
				bestAxisY = ay;
				bestOwner = owner;
				bestEdgeIndex = edgeIndex;
			}
		}
	}
	if (!sawAxis) {
		return GEO_FAULT_NONE;
	}
	computePolyAverageInto(polyA, m_centerA);
	computePolyAverageInto(polyB, m_centerB);
	if ((((m_centerA.x - m_centerB.x) * bestAxisX) + ((m_centerA.y - m_centerB.y) * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	double pointX = 0.0;
	double pointY = 0.0;
	if (!clipConvexPolygons(polyA, polyB)) {
		return GEO_FAULT_CLIP_CAPACITY;
	}
	if (m_clipResultVertexCount == 0u) {
		pointX = (m_centerA.x + m_centerB.x) * 0.5;
		pointY = (m_centerA.y + m_centerB.y) * 0.5;
	} else {
		m_pair.pendingWork.averageVertices += m_clipResultVertexCount;
		m_pair.pendingWork.divisions += 2u;
		computeClipAverageInto(*m_clipResult, m_clipResultVertexCount, m_centroid);
		pointX = m_centroid.x;
		pointY = m_centroid.y;
	}
	m_contactNx = bestAxisX;
	m_contactNy = bestAxisY;
	m_contactDepth = bestOverlap;
	m_contactPx = pointX;
	m_contactPy = pointY;
	m_contactFeatureMeta = bestEdgeIndex;
	m_contactHit = true;
	return GEO_FAULT_NONE;
}

void GeometryOverlap2dUnit::projectPolyInto(const PolyView& poly, double ax, double ay, GeometryProjectionSpan& out) {
	double min = std::numeric_limits<double>::infinity();
	double max = -std::numeric_limits<double>::infinity();
	for (uint32_t vertexIndex = 0u; vertexIndex < poly.vertexCount; vertexIndex += 1u) {
		readWorldVertexInto(poly, vertexIndex, m_vertex0);
		const double projection = (m_vertex0.x * ax) + (m_vertex0.y * ay);
		if (projection < min) {
			min = projection;
		}
		if (projection > max) {
			max = projection;
		}
	}
	m_pair.pendingWork.projectionVertices += poly.vertexCount;
	out.min = min;
	out.max = max;
}

void GeometryOverlap2dUnit::computePolyAverageInto(const PolyView& poly, PointScratch& out) {
	double sumX = 0.0;
	double sumY = 0.0;
	for (uint32_t vertexIndex = 0u; vertexIndex < poly.vertexCount; vertexIndex += 1u) {
		readWorldVertexInto(poly, vertexIndex, m_vertex0);
		sumX += m_vertex0.x;
		sumY += m_vertex0.y;
	}
	m_pair.pendingWork.averageVertices += poly.vertexCount;
	m_pair.pendingWork.divisions += 2u;
	out.x = sumX / static_cast<double>(poly.vertexCount);
	out.y = sumY / static_cast<double>(poly.vertexCount);
}

bool GeometryOverlap2dUnit::clipConvexPolygons(const PolyView& polyA, const PolyView& polyB) {
	m_pair.pendingWork.clipVertices += polyA.vertexCount;
	for (uint32_t vertexIndex = 0u; vertexIndex < polyA.vertexCount; vertexIndex += 1u) {
		readWorldVertexInto(polyA, vertexIndex, m_vertex0);
		writeClipVertex(m_clip0, vertexIndex, m_vertex0.x, m_vertex0.y);
	}
	ClipBuffer* input = &m_clip0;
	ClipBuffer* output = &m_clip1;
	uint32_t inputVertexCount = polyA.vertexCount;
	for (uint32_t edgeIndex = 0u; edgeIndex < polyB.vertexCount; edgeIndex += 1u) {
		m_pair.pendingWork.clipEdges += 1u;
		uint32_t outputVertexCount = 0u;
		const uint32_t nextIndex = edgeIndex + 1u == polyB.vertexCount ? 0u : edgeIndex + 1u;
		readWorldVertexInto(polyB, edgeIndex, m_vertex0);
		const double x0 = m_vertex0.x;
		const double y0 = m_vertex0.y;
		readWorldVertexInto(polyB, nextIndex, m_vertex1);
		const double x1 = m_vertex1.x;
		const double y1 = m_vertex1.y;
		if (inputVertexCount == 0u) {
			break;
		}
		double sx = (*input)[(inputVertexCount - 1u) * 2u];
		double sy = (*input)[((inputVertexCount - 1u) * 2u) + 1u];
		double sd = clipPlaneDistance(x0, y0, x1, y1, sx, sy);
		bool sInside = sd >= 0.0;
		for (uint32_t inputIndex = 0u; inputIndex < inputVertexCount; inputIndex += 1u) {
			m_pair.pendingWork.clipVertices += 1u;
			const uint32_t inputOffset = inputIndex * 2u;
			const double ex = (*input)[inputOffset];
			const double ey = (*input)[inputOffset + 1u];
			const double ed = clipPlaneDistance(x0, y0, x1, y1, ex, ey);
			const bool eInside = ed >= 0.0;
			if ((sInside || eInside) && outputVertexCount == GEO_OVERLAP2D_MAX_CLIP_VERTICES) {
				return false;
			}
			if (sInside && eInside) {
				writeClipVertex(*output, outputVertexCount, ex, ey);
				outputVertexCount += 1u;
			} else if (sInside && !eInside) {
				m_pair.pendingWork.divisions += 1u;
				const double t = sd / (sd - ed);
				writeClipVertex(*output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
				outputVertexCount += 1u;
			} else if (!sInside && eInside) {
				m_pair.pendingWork.divisions += 1u;
				const double t = sd / (sd - ed);
				writeClipVertex(*output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
				outputVertexCount += 1u;
				if (outputVertexCount == GEO_OVERLAP2D_MAX_CLIP_VERTICES) {
					return false;
				}
				writeClipVertex(*output, outputVertexCount, ex, ey);
				outputVertexCount += 1u;
			}
			sx = ex;
			sy = ey;
			sd = ed;
			sInside = eInside;
		}
		std::swap(input, output);
		inputVertexCount = outputVertexCount;
	}
	m_clipResult = input;
	m_clipResultVertexCount = inputVertexCount;
	return true;
}

void GeometryOverlap2dUnit::readWorldVertexInto(const PolyView& poly, uint32_t vertexIndex, PointScratch& out) const {
	if (poly.primitive == GEO_PRIMITIVE_AABB) {
		if (vertexIndex == 0u) {
			out.x = poly.left;
			out.y = poly.top;
		} else if (vertexIndex == 1u) {
			out.x = poly.right;
			out.y = poly.top;
		} else if (vertexIndex == 2u) {
			out.x = poly.right;
			out.y = poly.bottom;
		} else {
			out.x = poly.left;
			out.y = poly.bottom;
		}
		return;
	}
	const uint32_t word = vertexIndex * 2u;
	out.x = poly.vertices[word];
	out.y = poly.vertices[word + 1u];
}

void GeometryOverlap2dUnit::writeClipVertex(ClipBuffer& buffer, uint32_t vertexIndex, double x, double y) {
	const uint32_t offset = vertexIndex * 2u;
	buffer[offset] = x;
	buffer[offset + 1u] = y;
}

void GeometryOverlap2dUnit::computeClipAverageInto(const ClipBuffer& buffer, uint32_t vertexCount, PointScratch& out) {
	double sumX = 0.0;
	double sumY = 0.0;
	for (uint32_t vertexIndex = 0u; vertexIndex < vertexCount; vertexIndex += 1u) {
		const uint32_t offset = vertexIndex * 2u;
		sumX += buffer[offset];
		sumY += buffer[offset + 1u];
	}
	out.x = sumX / static_cast<double>(vertexCount);
	out.y = sumY / static_cast<double>(vertexCount);
}

double GeometryOverlap2dUnit::clipPlaneDistance(double x0, double y0, double x1, double y1, double px, double py) {
	return ((x1 - x0) * (py - y0)) - ((y1 - y0) * (px - x0));
}

void GeometryOverlap2dUnit::writeResult(
	uint32_t addr,
	double nx,
	double ny,
	double depth,
	double px,
	double py,
	uint32_t pieceA,
	uint32_t pieceB,
	uint32_t featureMeta,
	uint32_t pairMeta
) {
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_NX_OFFSET, numberToF32Bits(nx));
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_NY_OFFSET, numberToF32Bits(ny));
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_DEPTH_OFFSET, numberToF32Bits(depth));
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PX_OFFSET, numberToF32Bits(px));
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PY_OFFSET, numberToF32Bits(py));
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PIECE_A_OFFSET, pieceA);
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PIECE_B_OFFSET, pieceB);
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_FEATURE_META_OFFSET, featureMeta);
	m_memory.writeU32(addr + GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET, pairMeta);
}

float GeometryOverlap2dUnit::readF32(uint32_t addr) {
	return f32BitsToNumber(m_memory.readCountedU32(addr, m_pair.pendingMemory));
}

} // namespace bmsx
