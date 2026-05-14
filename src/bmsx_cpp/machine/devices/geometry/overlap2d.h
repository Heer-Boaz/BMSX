#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/projection.h"
#include "machine/devices/geometry/state.h"
#include "machine/memory/memory.h"

#include <array>
#include <cstdint>

namespace bmsx {

class GeometryOverlap2dUnit {
public:
	explicit GeometryOverlap2dUnit(Memory& memory);

	uint32_t validateSubmission(const GeometryJobState& job) const;
	uint32_t processRecord(GeometryJobState& job);
	void writeSummary(const GeometryJobState& job, uint32_t flags);

private:
	using GeoJob = GeometryJobState;
	struct PointScratch {
		double x = 0.0;
		double y = 0.0;
	};
	struct PolyView {
		uint32_t primitive = 0;
		uint32_t vertexCount = 0;
		uint32_t dataAddr = 0;
		double tx = 0.0;
		double ty = 0.0;
		double left = 0.0;
		double top = 0.0;
		double right = 0.0;
		double bottom = 0.0;
	};
	using ClipBuffer = std::array<double, GEO_OVERLAP2D_MAX_CLIP_VERTICES * 2u>;

	uint32_t processCandidateRecord(GeoJob& job);
	uint32_t processFullPassRecord(GeoJob& job);
	bool readInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& out) const;
	uint32_t processPair(GeoJob& job, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceA, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceB, uint32_t pairMeta);
	uint32_t readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) const;
	uint32_t computePiecePairContact(uint32_t pieceAAddr, double txA, double tyA, uint32_t pieceBAddr, double txB, double tyB);
	uint32_t loadPolyView(uint32_t pieceAddr, double tx, double ty, PolyView& out) const;
	static bool boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b);
	bool computePolyPairContact(const PolyView& polyA, const PolyView& polyB);
	void projectPolyInto(const PolyView& poly, double ax, double ay, GeometryProjectionSpan& out);
	void computePolyAverageInto(const PolyView& poly, PointScratch& out);
	void clipConvexPolygons(const PolyView& polyA, const PolyView& polyB);
	void readWorldVertexInto(const PolyView& poly, uint32_t vertexIndex, PointScratch& out) const;
	static void writeClipVertex(ClipBuffer& buffer, uint32_t vertexIndex, double x, double y);
	static void computeClipAverageInto(const ClipBuffer& buffer, uint32_t vertexCount, PointScratch& out);
	static double clipPlaneDistance(double x0, double y0, double x1, double y1, double px, double py);
	void writeResult(uint32_t addr, double nx, double ny, double depth, double px, double py, uint32_t pieceA, uint32_t pieceB, uint32_t featureMeta, uint32_t pairMeta);
	float readF32(uint32_t addr) const;

	PolyView m_polyA;
	PolyView m_polyB;
	ClipBuffer m_clip0{};
	ClipBuffer m_clip1{};
	ClipBuffer* m_clipResult = &m_clip0;
	uint32_t m_clipResultVertexCount = 0;
	std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS> m_instanceA = { 0, 0, 0, 0, 0 };
	std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS> m_instanceB = { 0, 0, 0, 0, 0 };
	std::array<double, 4> m_boundsA = { 0, 0, 0, 0 };
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
