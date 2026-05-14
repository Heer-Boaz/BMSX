#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/projection.h"
#include "machine/devices/geometry/state.h"
#include "machine/memory/memory.h"

#include <array>
#include <cstdint>
#include <vector>

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

	uint32_t processCandidateRecord(GeoJob& job);
	uint32_t processFullPassRecord(GeoJob& job);
	bool readInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& out) const;
	uint32_t processPair(GeoJob& job, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceA, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceB, uint32_t pairMeta);
	bool readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) const;
	uint32_t computePiecePairContact(uint32_t pieceAAddr, double txA, double tyA, uint32_t pieceBAddr, double txB, double tyB);
	bool loadWorldPoly(uint32_t pieceAddr, double tx, double ty, std::vector<double>& out) const;
	static void pushWorldVertex(std::vector<double>& out, double tx, double ty, double localX, double localY);
	static bool boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b);
	bool computePolyPairContact(const std::vector<double>& polyA, const std::vector<double>& polyB);
	static void projectPolyInto(const std::vector<double>& poly, double ax, double ay, GeometryProjectionSpan& out);
	static void computePolyAverageInto(const std::vector<double>& poly, PointScratch& out);
	const std::vector<double>& clipConvexPolygons(const std::vector<double>& polyA, const std::vector<double>& polyB);
	static double clipPlaneDistance(double x0, double y0, double x1, double y1, double px, double py);
	void writeResult(uint32_t addr, double nx, double ny, double depth, double px, double py, uint32_t pieceA, uint32_t pieceB, uint32_t featureMeta, uint32_t pairMeta);
	float readF32(uint32_t addr) const;

	std::vector<double> m_worldPolyA;
	std::vector<double> m_worldPolyB;
	std::vector<double> m_clip0;
	std::vector<double> m_clip1;
	std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS> m_instanceA = { 0, 0, 0, 0, 0 };
	std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS> m_instanceB = { 0, 0, 0, 0, 0 };
	std::array<double, 4> m_boundsA = { 0, 0, 0, 0 };
	std::array<double, 4> m_boundsB = { 0, 0, 0, 0 };
	GeometryProjectionSpan m_projectionA;
	GeometryProjectionSpan m_projectionB;
	PointScratch m_centerA;
	PointScratch m_centerB;
	PointScratch m_centroid;
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
