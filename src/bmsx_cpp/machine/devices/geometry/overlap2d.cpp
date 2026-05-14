#include "machine/devices/geometry/overlap2d.h"

#include "machine/common/numeric.h"
#include "machine/devices/geometry/addressing.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>

namespace bmsx {
namespace {

constexpr uint32_t GEO_FAULT_NONE = 0u;

} // namespace

GeometryOverlap2dUnit::GeometryOverlap2dUnit(Memory& memory)
	: m_memory(memory) {
}

uint32_t GeometryOverlap2dUnit::validateSubmission(const GeometryJobState& job) const {
	const uint32_t mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
	if ((job.param0 & GEO_OVERLAP2D_CONTACT_POLICY_MASK) != GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
		|| (job.param0 & GEO_OVERLAP2D_OUTPUT_POLICY_MASK) != GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW
		|| (job.param0 & GEO_OVERLAP2D_PARAM0_RESERVED_MASK) != 0u) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	if (job.stride0 != GEO_OVERLAP2D_INSTANCE_BYTES) {
		return GEO_FAULT_REJECT_BAD_STRIDE;
	}
	if (job.src2 != 0u) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) != GEO_OVERLAP2D_BROADPHASE_NONE
			|| job.stride1 != GEO_OVERLAP2D_PAIR_BYTES
			|| job.stride2 == 0u) {
			return GEO_FAULT_REJECT_BAD_STRIDE;
		}
	} else if (mode == GEO_OVERLAP2D_MODE_FULL_PASS) {
		if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) != GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
			|| job.src1 != 0u
			|| job.stride1 != 0u
			|| job.stride2 != 0u
			|| job.count > GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) {
			return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
		}
	} else {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	if ((job.src0 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.src1 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & GEOMETRY_WORD_ALIGN_MASK) != 0u
		|| (job.dst1 & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
		return GEO_FAULT_REJECT_MISALIGNED_REGS;
	}
	if (!m_memory.isRamRange(job.dst1, GEO_OVERLAP2D_SUMMARY_BYTES)) {
		return GEO_FAULT_REJECT_DST_NOT_RAM;
	}
	if (!m_memory.isRamRange(job.dst0, GEO_OVERLAP2D_RESULT_BYTES)) {
		return GEO_FAULT_REJECT_DST_NOT_RAM;
	}
	if (job.count == 0u) {
		return GEO_FAULT_NONE;
	}
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS && !m_memory.isReadableMainMemoryRange(job.src1, GEO_OVERLAP2D_PAIR_BYTES)) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	const uint32_t instanceCount = mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS ? job.stride2 : job.count;
	const std::optional<uint32_t> lastInstanceAddr = resolveGeometryIndexedSpan(job.src0, instanceCount - 1u, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
	if (!lastInstanceAddr.has_value() || !m_memory.isReadableMainMemoryRange(*lastInstanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
		return GEO_FAULT_REJECT_BAD_REGISTER_COMBO;
	}
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::processRecord(GeometryJobState& job) {
	const uint32_t mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		return processCandidateRecord(job);
	}
	return processFullPassRecord(job);
}

void GeometryOverlap2dUnit::writeSummary(const GeometryJobState& job, uint32_t flags) {
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET, job.resultCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET, job.exactPairCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET, job.broadphasePairCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET, flags);
}

uint32_t GeometryOverlap2dUnit::processCandidateRecord(GeoJob& job) {
	const std::optional<uint32_t> pairAddr = resolveGeometryIndexedSpan(job.src1, job.processed, job.stride1, GEO_OVERLAP2D_PAIR_BYTES);
	if (!pairAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pairAddr, GEO_OVERLAP2D_PAIR_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const uint32_t instanceAIndex = m_memory.readU32(*pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET);
	const uint32_t instanceBIndex = m_memory.readU32(*pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET);
	const uint32_t pairMeta = m_memory.readU32(*pairAddr + GEO_OVERLAP2D_PAIR_META_OFFSET);
	if (instanceAIndex == instanceBIndex) {
		return GEO_FAULT_BAD_RECORD_FLAGS;
	}
	const uint32_t instanceCount = job.stride2;
	if (instanceAIndex >= instanceCount || instanceBIndex >= instanceCount) {
		return GEO_FAULT_SRC_RANGE;
	}
	if (!readInstanceAt(job, instanceAIndex, m_instanceA)
		|| !readInstanceAt(job, instanceBIndex, m_instanceB)) {
		return GEO_FAULT_SRC_RANGE;
	}
	const uint32_t fault = processPair(job, m_instanceA, m_instanceB, pairMeta);
	if (fault != GEO_FAULT_NONE) {
		return fault;
	}
	writeSummary(job, 0u);
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::processFullPassRecord(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	if (!readInstanceAt(job, recordIndex, m_instanceA)) {
		return GEO_FAULT_SRC_RANGE;
	}
	for (uint32_t instanceBIndex = recordIndex + 1u; instanceBIndex < job.count; instanceBIndex += 1u) {
		if (!readInstanceAt(job, instanceBIndex, m_instanceB)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const uint32_t pairMeta = ((recordIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) << GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT)
			| (instanceBIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK);
		const uint32_t fault = processPair(job, m_instanceA, m_instanceB, pairMeta);
		if (fault != GEO_FAULT_NONE) {
			return fault;
		}
	}
	writeSummary(job, 0u);
	return GEO_FAULT_NONE;
}

bool GeometryOverlap2dUnit::readInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& out) const {
	const std::optional<uint32_t> instanceAddr = resolveGeometryIndexedSpan(job.src0, instanceIndex, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
	if (!instanceAddr.has_value() || !m_memory.isReadableMainMemoryRange(*instanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
		return false;
	}
	out[0] = m_memory.readU32(*instanceAddr + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
	out[1] = m_memory.readU32(*instanceAddr + GEO_OVERLAP2D_INSTANCE_TX_OFFSET);
	out[2] = m_memory.readU32(*instanceAddr + GEO_OVERLAP2D_INSTANCE_TY_OFFSET);
	out[3] = m_memory.readU32(*instanceAddr + GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET);
	out[4] = m_memory.readU32(*instanceAddr + GEO_OVERLAP2D_INSTANCE_MASK_OFFSET);
	return true;
}

uint32_t GeometryOverlap2dUnit::processPair(GeoJob& job, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceA, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceB, uint32_t pairMeta) {
	const uint32_t shapeAAddr = instanceA[0];
	const double txA = static_cast<double>(f32BitsToNumber(instanceA[1]));
	const double tyA = static_cast<double>(f32BitsToNumber(instanceA[2]));
	const uint32_t layerA = instanceA[3];
	const uint32_t maskA = instanceA[4];
	const uint32_t shapeBAddr = instanceB[0];
	const double txB = static_cast<double>(f32BitsToNumber(instanceB[1]));
	const double tyB = static_cast<double>(f32BitsToNumber(instanceB[2]));
	const uint32_t layerB = instanceB[3];
	const uint32_t maskB = instanceB[4];
	if (!m_memory.isReadableMainMemoryRange(shapeAAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(shapeBAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	if ((maskA & layerB) == 0u || (maskB & layerA) == 0u) {
		return GEO_FAULT_NONE;
	}
	job.broadphasePairCount += 1u;
	const uint32_t shapeABoundsFault = readPieceBounds(shapeAAddr, txA, tyA, m_boundsA);
	if (shapeABoundsFault != GEO_FAULT_NONE) {
		return shapeABoundsFault;
	}
	const uint32_t shapeBBoundsFault = readPieceBounds(shapeBAddr, txB, tyB, m_boundsB);
	if (shapeBBoundsFault != GEO_FAULT_NONE) {
		return shapeBBoundsFault;
	}
	if (!boundsOverlap(m_boundsA, m_boundsB)) {
		return GEO_FAULT_NONE;
	}
	const uint32_t shapeAKind = m_memory.readU32(shapeAAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	const uint32_t shapeACount = m_memory.readU32(shapeAAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
	const uint32_t shapeADataOffset = m_memory.readU32(shapeAAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
	const uint32_t shapeBKind = m_memory.readU32(shapeBAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	const uint32_t shapeBCount = m_memory.readU32(shapeBAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
	const uint32_t shapeBDataOffset = m_memory.readU32(shapeBAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
	const bool shapeAIsCompound = shapeAKind == GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
	const bool shapeBIsCompound = shapeBKind == GEO_OVERLAP2D_SHAPE_KIND_COMPOUND;
	const uint32_t shapeAPieceCount = shapeAIsCompound ? shapeACount : 1u;
	const uint32_t shapeBPieceCount = shapeBIsCompound ? shapeBCount : 1u;
	if (shapeAPieceCount == 0u || shapeBPieceCount == 0u
		|| (shapeAIsCompound && (shapeADataOffset & GEOMETRY_WORD_ALIGN_MASK) != 0u)
		|| (shapeBIsCompound && (shapeBDataOffset & GEOMETRY_WORD_ALIGN_MASK) != 0u)
		|| (!shapeAIsCompound && shapeAKind != GEO_PRIMITIVE_AABB && shapeAKind != GEO_PRIMITIVE_CONVEX_POLY)
		|| (!shapeBIsCompound && shapeBKind != GEO_PRIMITIVE_AABB && shapeBKind != GEO_PRIMITIVE_CONVEX_POLY)) {
		return GEO_FAULT_DESCRIPTOR_KIND;
	}
	job.exactPairCount += 1u;
	bool bestHit = false;
	double bestDepth = std::numeric_limits<double>::infinity();
	uint32_t bestPieceA = 0u;
	uint32_t bestPieceB = 0u;
	uint32_t bestFeatureMeta = 0u;
	double bestNx = 0.0;
	double bestNy = 0.0;
	double bestPx = 0.0;
	double bestPy = 0.0;
	for (uint32_t pieceAIndex = 0u; pieceAIndex < shapeAPieceCount; pieceAIndex += 1u) {
		const std::optional<uint32_t> pieceAAddr = shapeAIsCompound
			? resolveGeometryByteOffset(shapeAAddr, static_cast<uint64_t>(shapeADataOffset) + (static_cast<uint64_t>(pieceAIndex) * GEO_OVERLAP2D_SHAPE_DESC_BYTES), GEO_OVERLAP2D_SHAPE_DESC_BYTES)
			: std::optional<uint32_t>(shapeAAddr);
		if (!pieceAAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pieceAAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		const uint32_t pieceABoundsFault = readPieceBounds(*pieceAAddr, txA, tyA, m_boundsA);
		if (pieceABoundsFault != GEO_FAULT_NONE) {
			return pieceABoundsFault;
		}
		for (uint32_t pieceBIndex = 0u; pieceBIndex < shapeBPieceCount; pieceBIndex += 1u) {
			const std::optional<uint32_t> pieceBAddr = shapeBIsCompound
				? resolveGeometryByteOffset(shapeBAddr, static_cast<uint64_t>(shapeBDataOffset) + (static_cast<uint64_t>(pieceBIndex) * GEO_OVERLAP2D_SHAPE_DESC_BYTES), GEO_OVERLAP2D_SHAPE_DESC_BYTES)
				: std::optional<uint32_t>(shapeBAddr);
			if (!pieceBAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pieceBAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
				return GEO_FAULT_SRC_RANGE;
			}
			const uint32_t pieceBBoundsFault = readPieceBounds(*pieceBAddr, txB, tyB, m_boundsB);
			if (pieceBBoundsFault != GEO_FAULT_NONE) {
				return pieceBBoundsFault;
			}
			if (!boundsOverlap(m_boundsA, m_boundsB)) {
				continue;
			}
			const uint32_t fault = computePiecePairContact(*pieceAAddr, txA, tyA, *pieceBAddr, txB, tyB);
			if (fault != GEO_FAULT_NONE) {
				return fault;
			}
			if (!m_contactHit) {
				continue;
			}
			if (!bestHit
				|| m_contactDepth < bestDepth
				|| (m_contactDepth == bestDepth
					&& (pieceAIndex < bestPieceA
						|| (pieceAIndex == bestPieceA
							&& (pieceBIndex < bestPieceB
								|| (pieceBIndex == bestPieceB && m_contactFeatureMeta < bestFeatureMeta)))))) {
				bestHit = true;
				bestDepth = m_contactDepth;
				bestPieceA = pieceAIndex;
				bestPieceB = pieceBIndex;
				bestFeatureMeta = m_contactFeatureMeta;
				bestNx = m_contactNx;
				bestNy = m_contactNy;
				bestPx = m_contactPx;
				bestPy = m_contactPy;
			}
		}
	}
	if (!bestHit) {
		return GEO_FAULT_NONE;
	}
	if (job.resultCount >= job.param1) {
		writeSummary(job, GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
		return GEO_FAULT_RESULT_CAPACITY;
	}
	const std::optional<uint32_t> resultAddr = resolveGeometryIndexedSpan(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, GEO_OVERLAP2D_RESULT_BYTES)) {
		return GEO_FAULT_DST_RANGE;
	}
	writeResult(*resultAddr, bestNx, bestNy, bestDepth, bestPx, bestPy, bestPieceA, bestPieceB, bestFeatureMeta, pairMeta);
	job.resultCount += 1u;
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) const {
	const uint32_t boundsOffset = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET);
	if ((boundsOffset & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
		return GEO_FAULT_BAD_RECORD_ALIGNMENT;
	}
	const std::optional<uint32_t> boundsAddr = resolveGeometryByteOffset(pieceAddr, boundsOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
	if (!boundsAddr.has_value() || !m_memory.isReadableMainMemoryRange(*boundsAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
		return GEO_FAULT_SRC_RANGE;
	}
	out[0] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET)) + tx;
	out[1] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET)) + ty;
	out[2] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET)) + tx;
	out[3] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET)) + ty;
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
	m_contactHit = computePolyPairContact(m_polyA, m_polyB);
	return GEO_FAULT_NONE;
}

uint32_t GeometryOverlap2dUnit::loadPolyView(uint32_t pieceAddr, double tx, double ty, PolyView& out) const {
	const uint32_t primitive = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	const uint32_t dataCount = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
	const uint32_t dataOffset = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
	if (primitive == GEO_PRIMITIVE_AABB) {
		if (dataCount != GEO_OVERLAP2D_AABB_DATA_COUNT) {
			return GEO_FAULT_BAD_VERTEX_COUNT;
		}
		if ((dataOffset & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
			return GEO_FAULT_BAD_RECORD_ALIGNMENT;
		}
		const std::optional<uint32_t> dataAddr = resolveGeometryByteOffset(pieceAddr, dataOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
		if (!dataAddr.has_value() || !m_memory.isReadableMainMemoryRange(*dataAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
			return GEO_FAULT_SRC_RANGE;
		}
		out.primitive = primitive;
		out.vertexCount = GEO_OVERLAP2D_AABB_DATA_COUNT;
		out.dataAddr = *dataAddr;
		out.tx = tx;
		out.ty = ty;
		out.left = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET)) + tx;
		out.top = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET)) + ty;
		out.right = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET)) + tx;
		out.bottom = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET)) + ty;
		return GEO_FAULT_NONE;
	}
	if (primitive != GEO_PRIMITIVE_CONVEX_POLY) {
		return GEO_FAULT_DESCRIPTOR_KIND;
	}
	if (dataCount < 3u || dataCount > GEO_OVERLAP2D_MAX_POLY_VERTICES) {
		return GEO_FAULT_BAD_VERTEX_COUNT;
	}
	if ((dataOffset & GEOMETRY_WORD_ALIGN_MASK) != 0u) {
		return GEO_FAULT_BAD_RECORD_ALIGNMENT;
	}
	const uint64_t byteLength = static_cast<uint64_t>(dataCount) * GEO_VERTEX2_BYTES;
	const std::optional<uint32_t> dataAddr = resolveGeometryByteOffset(pieceAddr, dataOffset, byteLength);
	if (!dataAddr.has_value() || !m_memory.isReadableMainMemoryRange(*dataAddr, byteLength)) {
		return GEO_FAULT_SRC_RANGE;
	}
	out.primitive = primitive;
	out.vertexCount = dataCount;
	out.dataAddr = *dataAddr;
	out.tx = tx;
	out.ty = ty;
	out.left = 0.0;
	out.top = 0.0;
	out.right = 0.0;
	out.bottom = 0.0;
	return GEO_FAULT_NONE;
}

bool GeometryOverlap2dUnit::boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b) {
	return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

bool GeometryOverlap2dUnit::computePolyPairContact(const PolyView& polyA, const PolyView& polyB) {
	double bestOverlap = std::numeric_limits<double>::infinity();
	double bestAxisX = 0.0;
	double bestAxisY = 0.0;
	uint32_t bestEdgeIndex = 0u;
	uint32_t bestOwner = 0u;
	bool sawAxis = false;
	for (uint32_t owner = 0u; owner < 2u; owner += 1u) {
		const PolyView& poly = owner == 0u ? polyA : polyB;
		for (uint32_t edgeIndex = 0u; edgeIndex < poly.vertexCount; edgeIndex += 1u) {
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
			const double ax = nx / len;
			const double ay = ny / len;
			projectPolyInto(polyA, ax, ay, m_projectionA);
			projectPolyInto(polyB, ax, ay, m_projectionB);
			const double overlap = std::min(m_projectionA.max, m_projectionB.max) - std::max(m_projectionA.min, m_projectionB.min);
			if (!(overlap > 0.0)) {
				return false;
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
		return false;
	}
	computePolyAverageInto(polyA, m_centerA);
	computePolyAverageInto(polyB, m_centerB);
	if ((((m_centerA.x - m_centerB.x) * bestAxisX) + ((m_centerA.y - m_centerB.y) * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	double pointX = 0.0;
	double pointY = 0.0;
	clipConvexPolygons(polyA, polyB);
	if (m_clipResultVertexCount == 0u) {
		pointX = (m_centerA.x + m_centerB.x) * 0.5;
		pointY = (m_centerA.y + m_centerB.y) * 0.5;
	} else {
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
	return true;
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
	out.x = sumX / static_cast<double>(poly.vertexCount);
	out.y = sumY / static_cast<double>(poly.vertexCount);
}

void GeometryOverlap2dUnit::clipConvexPolygons(const PolyView& polyA, const PolyView& polyB) {
	for (uint32_t vertexIndex = 0u; vertexIndex < polyA.vertexCount; vertexIndex += 1u) {
		readWorldVertexInto(polyA, vertexIndex, m_vertex0);
		writeClipVertex(m_clip0, vertexIndex, m_vertex0.x, m_vertex0.y);
	}
	ClipBuffer* input = &m_clip0;
	ClipBuffer* output = &m_clip1;
	uint32_t inputVertexCount = polyA.vertexCount;
	for (uint32_t edgeIndex = 0u; edgeIndex < polyB.vertexCount; edgeIndex += 1u) {
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
			const uint32_t inputOffset = inputIndex * 2u;
			const double ex = (*input)[inputOffset];
			const double ey = (*input)[inputOffset + 1u];
			const double ed = clipPlaneDistance(x0, y0, x1, y1, ex, ey);
			const bool eInside = ed >= 0.0;
			if (sInside && eInside) {
				writeClipVertex(*output, outputVertexCount, ex, ey);
				outputVertexCount += 1u;
			} else if (sInside && !eInside) {
				const double t = sd / (sd - ed);
				writeClipVertex(*output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
				outputVertexCount += 1u;
			} else if (!sInside && eInside) {
				const double t = sd / (sd - ed);
				writeClipVertex(*output, outputVertexCount, sx + ((ex - sx) * t), sy + ((ey - sy) * t));
				outputVertexCount += 1u;
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
	const uint32_t vertexAddr = poly.dataAddr + vertexIndex * GEO_VERTEX2_BYTES;
	out.x = static_cast<double>(readF32(vertexAddr + GEO_VERTEX2_X_OFFSET)) + poly.tx;
	out.y = static_cast<double>(readF32(vertexAddr + GEO_VERTEX2_Y_OFFSET)) + poly.ty;
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

float GeometryOverlap2dUnit::readF32(uint32_t addr) const {
	return f32BitsToNumber(m_memory.readU32(addr));
}

} // namespace bmsx
