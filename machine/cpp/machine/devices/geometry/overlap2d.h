#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/projection.h"
#include "machine/devices/geometry/job.h"
#include "machine/memory/memory.h"

#include <array>
#include <cstdint>

namespace bmsx {

struct GeometryWork {
	u32 axes = 0u;
	u32 projectionVertices = 0u;
	u32 averageVertices = 0u;
	u32 clipVertices = 0u;
	u32 clipEdges = 0u;
	u32 squareRoots = 0u;
	u32 divisions = 0u;
};

struct GeometryOverlap2dProgress {
	u32 phase = 0u;
	u32 instanceBIndex = 0u;
	u32 pairMeta = 0u;
	u32 shapeAAddr = 0u, shapeBAddr = 0u;
	u32 shapeAOffset = 0u, shapeBOffset = 0u;
	u32 countA = 0u, countB = 0u;
	u32 pieceA = 0u, pieceB = 0u;
	bool compoundA = false, compoundB = false, bestHit = false;
	u32 bestPieceA = 0u, bestPieceB = 0u, bestFeature = 0u;
	double bestDepth = 0.0, bestNx = 0.0, bestNy = 0.0, bestPx = 0.0, bestPy = 0.0;
	std::array<u32, GEO_OVERLAP2D_INSTANCE_WORDS> instanceA{};
	std::array<u32, GEO_OVERLAP2D_INSTANCE_WORDS> instanceB{};
	std::array<double, 4> boundsA{};
	GeometryWork pendingWork{};
	MemoryWordCounters pendingMemory{};
	u32 pendingWriteFlags = 0u;
	u32 afterPublishPhase = 0u;
	u32 pendingFault = 0u;
};

class GeometryOverlap2dUnit {
public:
	explicit GeometryOverlap2dUnit(Memory& memory);

	void reset() { m_pair = {}; }
	void beginJob(const GeometryJobState& job);
	const GeometryOverlap2dProgress& progress() const { return m_pair; }
	GeometryOverlap2dProgress captureState() const { return m_pair; }
	void restoreState(const GeometryOverlap2dProgress& state) { m_pair = state; }
	uint32_t processStep(GeometryJobState& job);

private:
	using GeoJob = GeometryJobState;

	struct PointScratch {
		double x = 0.0;
		double y = 0.0;
	};
	struct PolyView {
		uint32_t primitive = 0;
		uint32_t vertexCount = 0;
		std::array<double, GEO_OVERLAP2D_MAX_POLY_VERTICES * 2u> vertices{};
		double left = 0.0;
		double top = 0.0;
		double right = 0.0;
		double bottom = 0.0;
	};
	using ClipBuffer = std::array<double, GEO_OVERLAP2D_MAX_CLIP_VERTICES * 2u>;

	void writeSummary(const GeometryJobState& job, uint32_t flags);
	uint32_t beginRecord(GeoJob& job);
	uint32_t beginPair(GeoJob& job);
	uint32_t processPiece();
	uint32_t completePiece(GeoJob& job);
	uint32_t finishPair(GeoJob& job);
	uint32_t publish(GeoJob& job);
	void pricePendingWrites(const GeoJob& job);
	bool readInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& out);
	uint32_t readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out);
	uint32_t computePiecePairContact(uint32_t pieceAAddr, double txA, double tyA, uint32_t pieceBAddr, double txB, double tyB);
	uint32_t loadPolyView(uint32_t pieceAddr, double tx, double ty, PolyView& out);
	static bool boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b);
	uint32_t computePolyPairContact(const PolyView& polyA, const PolyView& polyB);
	void projectPolyInto(const PolyView& poly, double ax, double ay, GeometryProjectionSpan& out);
	void computePolyAverageInto(const PolyView& poly, PointScratch& out);
	bool clipConvexPolygons(const PolyView& polyA, const PolyView& polyB);
	void readWorldVertexInto(const PolyView& poly, uint32_t vertexIndex, PointScratch& out) const;
	static void writeClipVertex(ClipBuffer& buffer, uint32_t vertexIndex, double x, double y);
	static void computeClipAverageInto(const ClipBuffer& buffer, uint32_t vertexCount, PointScratch& out);
	static double clipPlaneDistance(double x0, double y0, double x1, double y1, double px, double py);
	void writeResult(uint32_t addr, double nx, double ny, double depth, double px, double py, uint32_t pieceA, uint32_t pieceB, uint32_t featureMeta, uint32_t pairMeta);
	float readF32(uint32_t addr);

	GeometryOverlap2dProgress m_pair;
	PolyView m_polyA;
	PolyView m_polyB;
	ClipBuffer m_clip0{};
	ClipBuffer m_clip1{};
	ClipBuffer* m_clipResult = &m_clip0;
	uint32_t m_clipResultVertexCount = 0;
	std::array<double, 4> m_boundsB = { 0, 0, 0, 0 };
	GeometryProjectionSpan m_projectionA;
	GeometryProjectionSpan m_projectionB;
	PointScratch m_centerA;
	PointScratch m_centerB;
	PointScratch m_centroid;
	PointScratch m_vertex0;
	PointScratch m_vertex1;
	bool m_contactHit = false;
	double m_contactNx = 0.0;
	double m_contactNy = 0.0;
	double m_contactDepth = 0.0;
	double m_contactPx = 0.0;
	double m_contactPy = 0.0;
	uint32_t m_contactFeatureMeta = 0;
	Memory& m_memory;
};

} // namespace bmsx
