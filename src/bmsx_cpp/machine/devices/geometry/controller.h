#pragma once

#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <optional>
#include <vector>

namespace bmsx {

class IrqController;

class GeometryController {
public:
		GeometryController(
			Memory& memory,
			IrqController& irq,
			DeviceScheduler& scheduler
		);

	void setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	bool hasPendingWork() const;
		uint32_t getPendingWorkUnits() const;
		void onService(int64_t nowCycles);
		void reset();
		void postLoad();
		void onCtrlWrite(int64_t nowCycles);

	private:
		static void onCtrlWriteThunk(void* context, uint32_t addr, Value value);

		struct GeoJob {
		uint32_t cmd = 0;
		uint32_t src0 = 0;
		uint32_t src1 = 0;
		uint32_t src2 = 0;
		uint32_t dst0 = 0;
		uint32_t dst1 = 0;
		uint32_t count = 0;
		uint32_t param0 = 0;
		uint32_t param1 = 0;
		uint32_t stride0 = 0;
		uint32_t stride1 = 0;
		uint32_t stride2 = 0;
		uint32_t processed = 0;
		uint32_t resultCount = 0;
		uint32_t exactPairCount = 0;
		uint32_t broadphasePairCount = 0;
	};

	void tryStart(int64_t nowCycles);
	void scheduleNextService(int64_t nowCycles);
	bool validateXform2Submission(const GeoJob& job);
	bool validateSat2Submission(const GeoJob& job);
	bool validateOverlap2dSubmission(const GeoJob& job);
	void processXform2Record(GeoJob& job);
	void processSat2Record(GeoJob& job);
	void processOverlap2dRecord(GeoJob& job);
	void processOverlap2dCandidateRecord(GeoJob& job);
	void processOverlap2dFullPassRecord(GeoJob& job);
	bool readOverlapInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, 5>& out) const;
	bool processOverlap2dPair(GeoJob& job, uint32_t recordIndex, const std::array<uint32_t, 5>& instanceA, const std::array<uint32_t, 5>& instanceB, uint32_t pairMeta);
	bool readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) const;
	bool computePiecePairContact(uint32_t pieceAAddr, double txA, double tyA, uint32_t pieceBAddr, double txB, double tyB, uint32_t recordIndex);
	bool loadWorldPoly(uint32_t pieceAddr, double tx, double ty, std::vector<double>& out) const;
	static void pushWorldVertex(std::vector<double>& out, double tx, double ty, double localX, double localY);
	static bool boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b);
	bool computePolyPairContact(const std::vector<double>& polyA, const std::vector<double>& polyB);
	static std::pair<double, double> projectPoly(const std::vector<double>& poly, double ax, double ay);
	static std::pair<double, double> computePolyAverage(const std::vector<double>& poly);
	const std::vector<double>& clipConvexPolygons(const std::vector<double>& polyA, const std::vector<double>& polyB);
	static double clipPlaneDistance(double x0, double y0, double x1, double y1, double px, double py);
	void writeOverlap2dSummary(const GeoJob& job, uint32_t flags);
	void writeOverlap2dResult(uint32_t addr, double nx, double ny, double depth, double px, double py, uint32_t pieceA, uint32_t pieceB, uint32_t featureMeta, uint32_t pairMeta);
	std::optional<uint32_t> resolveByteOffset(uint32_t base, uint32_t offset, uint32_t byteLength) const;
	float readF32(uint32_t addr) const;
	void completeRecord(GeoJob& job);
	void finishSuccess(uint32_t processed);
	void finishError(uint32_t code, uint32_t recordIndex, bool signalIrq = true);
	void finishRejected(uint32_t code);
	std::optional<uint32_t> resolveIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint32_t byteLength) const;
	void writeRegister(uint32_t addr, uint32_t value);
	void writeSat2Result(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta);
	static uint32_t packFault(uint32_t code, uint32_t recordIndex);
	static uint32_t packSat2Meta(uint32_t axisIndex, uint32_t shapeSelector);
	static int32_t roundToI32Clamped(double value);
	static int32_t transformFixed16(int32_t m0, int32_t m1, int32_t tx, int32_t x, int32_t y);

	int64_t m_cpuHz = 1;
	int64_t m_workUnitsPerSec = 1;
	int64_t m_workCarry = 0;
	uint32_t m_availableWorkUnits = 0;
	std::optional<GeoJob> m_activeJob;
	std::vector<double> m_overlapWorldPolyA;
	std::vector<double> m_overlapWorldPolyB;
	std::vector<double> m_overlapClip0;
	std::vector<double> m_overlapClip1;
	std::array<uint32_t, 5> m_overlapInstanceA = { 0, 0, 0, 0, 0 };
	std::array<uint32_t, 5> m_overlapInstanceB = { 0, 0, 0, 0, 0 };
	std::array<double, 4> m_overlapBoundsA = { 0, 0, 0, 0 };
	std::array<double, 4> m_overlapBoundsB = { 0, 0, 0, 0 };
	double m_overlapContactNx = 0;
	double m_overlapContactNy = 0;
	double m_overlapContactDepth = 0;
	double m_overlapContactPx = 0;
	double m_overlapContactPy = 0;
		uint32_t m_overlapContactFeatureMeta = 0;
		Memory& m_memory;
		IrqController& m_irq;
		DeviceScheduler& m_scheduler;
};

} // namespace bmsx
