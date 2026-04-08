#pragma once

#include "../memory.h"

#include <cstdint>
#include <functional>
#include <optional>

namespace bmsx {

class GeometryController {
public:
	GeometryController(Memory& memory, std::function<void(uint32_t)> raiseIrq);

	void setWorkBudget(uint32_t workUnits);
	bool hasPendingWork() const;
	uint32_t pendingWorkUnits() const;
	void tick();
	void reset();
	void normalizeAfterStateRestore();
	void onCtrlWrite();

private:
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
	};

		void tryStart();
		bool validateXform2Submission(const GeoJob& job);
		bool validateSat2Submission(const GeoJob& job);
		void processXform2Record(GeoJob& job);
		void processSat2Record(GeoJob& job);
		void completeRecord(GeoJob& job);
		void finishSuccess(uint32_t processed);
		void finishError(uint32_t code, uint32_t recordIndex, bool signalIrq = true);
		void finishRejected(uint32_t code);
		std::optional<uint32_t> resolveIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint32_t byteLength) const;
		uint32_t readRegister(uint32_t addr) const;
		void writeRegister(uint32_t addr, uint32_t value);
		void writeSat2Result(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta);
		static uint32_t packFault(uint32_t code, uint32_t recordIndex);
		static uint32_t packSat2Meta(uint32_t axisIndex, uint32_t shapeSelector);
		static int32_t roundToI32Clamped(double value);
		static int32_t transformFixed16(int32_t m0, int32_t m1, int32_t tx, int32_t x, int32_t y);

	uint32_t m_workBudget = 0;
	std::optional<GeoJob> m_activeJob;
	Memory& m_memory;
	std::function<void(uint32_t)> m_raiseIrq;
};

} // namespace bmsx
