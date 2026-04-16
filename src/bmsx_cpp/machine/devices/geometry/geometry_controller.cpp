#include "machine/devices/geometry/geometry_controller.h"

#include "machine/bus/io.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <utility>

namespace bmsx {
namespace {

constexpr uint32_t GEO_RECORD_INDEX_NONE = 0xffffu;
constexpr uint32_t WORD_ALIGN_MASK = 3u;
constexpr uint32_t XFORM2_JOB_WORDS = 6u;
constexpr uint32_t XFORM2_JOB_BYTES = XFORM2_JOB_WORDS * 4u;
constexpr uint32_t XFORM2_VERTEX_BYTES = 8u;
constexpr uint32_t XFORM2_MATRIX_WORDS = 6u;
constexpr uint32_t XFORM2_MATRIX_BYTES = XFORM2_MATRIX_WORDS * 4u;
constexpr uint32_t XFORM2_AABB_BYTES = 16u;
constexpr uint32_t SAT2_PAIR_WORDS = 5u;
constexpr uint32_t SAT2_PAIR_BYTES = SAT2_PAIR_WORDS * 4u;
constexpr uint32_t SAT2_DESC_WORDS = 4u;
constexpr uint32_t SAT2_DESC_BYTES = SAT2_DESC_WORDS * 4u;
constexpr uint32_t SAT2_RESULT_WORDS = 5u;
constexpr uint32_t SAT2_RESULT_BYTES = SAT2_RESULT_WORDS * 4u;
constexpr uint32_t OVERLAP2D_INSTANCE_WORDS = 5u;
constexpr uint32_t OVERLAP2D_INSTANCE_BYTES = OVERLAP2D_INSTANCE_WORDS * 4u;
constexpr uint32_t OVERLAP2D_PAIR_WORDS = 3u;
constexpr uint32_t OVERLAP2D_PAIR_BYTES = OVERLAP2D_PAIR_WORDS * 4u;
constexpr uint32_t OVERLAP2D_RESULT_WORDS = 9u;
constexpr uint32_t OVERLAP2D_RESULT_BYTES = OVERLAP2D_RESULT_WORDS * 4u;
constexpr uint32_t OVERLAP2D_SUMMARY_BYTES = 16u;
constexpr uint32_t OVERLAP2D_DESC_BYTES = 16u;
constexpr uint32_t OVERLAP2D_BOUNDS_BYTES = 16u;
constexpr uint32_t OVERLAP2D_KIND_COMPOUND = 4u;
constexpr uint32_t GEO_SERVICE_BATCH_RECORDS = 1u;
constexpr int FIX16_SHIFT = 16;
constexpr double FIX16_SCALE = 65536.0;

inline int32_t saturateI32(int64_t value) {
	if (value < static_cast<int64_t>(std::numeric_limits<int32_t>::min())) {
		return std::numeric_limits<int32_t>::min();
	}
	if (value > static_cast<int64_t>(std::numeric_limits<int32_t>::max())) {
		return std::numeric_limits<int32_t>::max();
	}
	return static_cast<int32_t>(value);
}

inline int64_t saturatingAdd64(int64_t lhs, int64_t rhs) {
	if (rhs > 0 && lhs > (std::numeric_limits<int64_t>::max() - rhs)) {
		return std::numeric_limits<int64_t>::max();
	}
	if (rhs < 0 && lhs < (std::numeric_limits<int64_t>::min() - rhs)) {
		return std::numeric_limits<int64_t>::min();
	}
	return lhs + rhs;
}

inline float f32BitsToNumber(uint32_t bits) {
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

inline uint32_t numberToF32Bits(double value) {
	const float narrowed = static_cast<float>(value);
	uint32_t bits = 0u;
	std::memcpy(&bits, &narrowed, sizeof(bits));
	return bits;
}

} // namespace

GeometryController::GeometryController(
	Memory& memory,
	std::function<void(uint32_t)> raiseIrq,
	std::function<void(int64_t deadlineCycles)> scheduleService,
	std::function<void()> cancelService
)
	: m_memory(memory)
	, m_raiseIrq(std::move(raiseIrq))
	, m_scheduleService(std::move(scheduleService))
	, m_cancelService(std::move(cancelService)) {
	m_overlapWorldPolyA.reserve(32u);
	m_overlapWorldPolyB.reserve(32u);
	m_overlapClip0.reserve(32u);
	m_overlapClip1.reserve(32u);
}

void GeometryController::setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_workUnitsPerSec = workUnitsPerSec;
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	maybeScheduleNextService(nowCycles);
}

void GeometryController::accrueCycles(int cycles, int64_t nowCycles) {
	if (!m_activeJob.has_value() || cycles <= 0) {
		return;
	}
	const int64_t numerator = m_workUnitsPerSec * static_cast<int64_t>(cycles) + m_workCarry;
	const int64_t wholeUnits = numerator / m_cpuHz;
	m_workCarry = numerator % m_cpuHz;
	if (wholeUnits > 0) {
		const uint32_t remainingRecords = m_activeJob->count - m_activeJob->processed;
		const int64_t maxGrant = static_cast<int64_t>(remainingRecords - m_availableWorkUnits);
		const int64_t granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
		m_availableWorkUnits += static_cast<uint32_t>(granted);
	}
	maybeScheduleNextService(nowCycles);
}

bool GeometryController::hasPendingWork() const {
	return m_activeJob.has_value();
}

uint32_t GeometryController::getPendingWorkUnits() const {
	if (!m_activeJob.has_value()) {
		return 0u;
	}
	return m_activeJob->count - m_activeJob->processed;
}

void GeometryController::reset() {
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	m_activeJob.reset();
	m_cancelService();
	writeRegister(IO_GEO_SRC0, 0);
	writeRegister(IO_GEO_SRC1, 0);
	writeRegister(IO_GEO_SRC2, 0);
	writeRegister(IO_GEO_DST0, 0);
	writeRegister(IO_GEO_DST1, 0);
	writeRegister(IO_GEO_COUNT, 0);
	writeRegister(IO_GEO_CMD, 0);
	writeRegister(IO_GEO_CTRL, 0);
	writeRegister(IO_GEO_STATUS, 0);
	writeRegister(IO_GEO_PARAM0, 0);
	writeRegister(IO_GEO_PARAM1, 0);
	writeRegister(IO_GEO_STRIDE0, 0);
	writeRegister(IO_GEO_STRIDE1, 0);
	writeRegister(IO_GEO_STRIDE2, 0);
	writeRegister(IO_GEO_PROCESSED, 0);
	writeRegister(IO_GEO_FAULT, 0);
}

void GeometryController::normalizeAfterStateRestore() {
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	m_activeJob.reset();
	m_cancelService();
	const uint32_t ctrl = readRegister(IO_GEO_CTRL);
	const uint32_t status = readRegister(IO_GEO_STATUS);
	const uint32_t processed = readRegister(IO_GEO_PROCESSED);
	writeRegister(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
	if ((status & GEO_STATUS_BUSY) != 0u) {
		writeRegister(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
		writeRegister(IO_GEO_PROCESSED, processed);
		writeRegister(IO_GEO_FAULT, packFault(GEO_FAULT_ABORTED_BY_HOST, processed));
	}
}

void GeometryController::onCtrlWrite(int64_t nowCycles) {
	const uint32_t ctrl = readRegister(IO_GEO_CTRL);
	const bool start = (ctrl & GEO_CTRL_START) != 0u;
	const bool abort = (ctrl & GEO_CTRL_ABORT) != 0u;
	if (!start && !abort) {
		return;
	}
	writeRegister(IO_GEO_CTRL, ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT));
	if (start && abort) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return;
	}
	if (abort) {
		if (m_activeJob.has_value()) {
			finishError(GEO_FAULT_ABORTED_BY_HOST, m_activeJob->processed);
		}
		return;
	}
	if (m_activeJob.has_value()) {
		finishRejected(GEO_FAULT_REJECT_BUSY);
		return;
	}
	tryStart(nowCycles);
}

void GeometryController::onService(int64_t nowCycles) {
	if (!m_activeJob.has_value() || m_availableWorkUnits == 0u) {
		maybeScheduleNextService(nowCycles);
		return;
	}
	uint32_t remaining = m_availableWorkUnits;
	m_availableWorkUnits = 0u;
	while (m_activeJob.has_value() && remaining > 0u) {
		switch (m_activeJob->cmd) {
			case IO_CMD_GEO_XFORM2_BATCH:
				processXform2Record(*m_activeJob);
				break;
			case IO_CMD_GEO_SAT2_BATCH:
				processSat2Record(*m_activeJob);
				break;
			case IO_CMD_GEO_OVERLAP2D_PASS:
				processOverlap2dRecord(*m_activeJob);
				break;
			default:
				finishRejected(GEO_FAULT_REJECT_BAD_CMD);
				return;
		}
		remaining -= 1u;
	}
	m_availableWorkUnits = remaining;
	maybeScheduleNextService(nowCycles);
}

void GeometryController::tryStart(int64_t nowCycles) {
	GeoJob job;
	job.cmd = readRegister(IO_GEO_CMD);
	job.src0 = readRegister(IO_GEO_SRC0);
	job.src1 = readRegister(IO_GEO_SRC1);
	job.src2 = readRegister(IO_GEO_SRC2);
	job.dst0 = readRegister(IO_GEO_DST0);
	job.dst1 = readRegister(IO_GEO_DST1);
	job.count = readRegister(IO_GEO_COUNT);
	job.param0 = readRegister(IO_GEO_PARAM0);
	job.param1 = readRegister(IO_GEO_PARAM1);
	job.stride0 = readRegister(IO_GEO_STRIDE0);
	job.stride1 = readRegister(IO_GEO_STRIDE1);
	job.stride2 = readRegister(IO_GEO_STRIDE2);
	switch (job.cmd) {
		case IO_CMD_GEO_XFORM2_BATCH:
			if (!validateXform2Submission(job)) {
				return;
			}
			break;
		case IO_CMD_GEO_SAT2_BATCH:
			if (!validateSat2Submission(job)) {
				return;
			}
			break;
		case IO_CMD_GEO_OVERLAP2D_PASS:
			if (!validateOverlap2dSubmission(job)) {
				return;
			}
			break;
		default:
			finishRejected(GEO_FAULT_REJECT_BAD_CMD);
			return;
	}
	writeRegister(IO_GEO_STATUS, 0u);
	writeRegister(IO_GEO_PROCESSED, 0u);
	writeRegister(IO_GEO_FAULT, 0u);
	if (job.cmd == IO_CMD_GEO_OVERLAP2D_PASS) {
		job.resultCount = 0u;
		job.exactPairCount = 0u;
		job.broadphasePairCount = 0u;
		writeOverlap2dSummary(job, 0u);
	}
	if (job.count == 0u) {
		finishSuccess(0u);
		return;
	}
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	m_activeJob = job;
	writeRegister(IO_GEO_STATUS, GEO_STATUS_BUSY);
	maybeScheduleNextService(nowCycles);
}

void GeometryController::maybeScheduleNextService(int64_t nowCycles) {
	if (!m_activeJob.has_value()) {
		m_cancelService();
		return;
	}
	const uint32_t remainingRecords = m_activeJob->count - m_activeJob->processed;
	const uint32_t targetUnits = remainingRecords < GEO_SERVICE_BATCH_RECORDS ? remainingRecords : GEO_SERVICE_BATCH_RECORDS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduleService(nowCycles);
		return;
	}
	m_scheduleService(nowCycles + cyclesUntilWorkUnits(targetUnits - m_availableWorkUnits));
}

int64_t GeometryController::cyclesUntilWorkUnits(uint32_t targetUnits) const {
	const int64_t needed = static_cast<int64_t>(targetUnits) * m_cpuHz - m_workCarry;
	if (needed <= 0) {
		return 1;
	}
	const int64_t cycles = (needed + m_workUnitsPerSec - 1) / m_workUnitsPerSec;
	return cycles <= 0 ? 1 : cycles;
}

bool GeometryController::validateXform2Submission(const GeoJob& job) {
	if (job.param0 != 0u || job.param1 != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != XFORM2_JOB_BYTES || job.stride1 != XFORM2_VERTEX_BYTES || job.stride2 != XFORM2_MATRIX_BYTES) {
		finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
		return false;
	}
	if ((job.src0 & WORD_ALIGN_MASK) != 0u
		|| (job.src1 & WORD_ALIGN_MASK) != 0u
		|| (job.src2 & WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & WORD_ALIGN_MASK) != 0u
		|| (job.dst1 & WORD_ALIGN_MASK) != 0u) {
		finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
		return false;
	}
	if (job.count == 0u) {
		return true;
	}
	if (!m_memory.isReadableMainMemoryRange(job.src0, job.stride0)
		|| !m_memory.isReadableMainMemoryRange(job.src1, job.stride1)
		|| !m_memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (!m_memory.isRamRange(job.dst0, XFORM2_VERTEX_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	if (job.dst1 != 0u && !m_memory.isRamRange(job.dst1, 4u)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	return true;
}

bool GeometryController::validateSat2Submission(const GeoJob& job) {
	if (job.param0 != 0u || job.param1 != 0u || job.dst1 != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != SAT2_PAIR_BYTES || job.stride1 != SAT2_DESC_BYTES || job.stride2 != XFORM2_VERTEX_BYTES) {
		finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
		return false;
	}
	if ((job.src0 & WORD_ALIGN_MASK) != 0u
		|| (job.src1 & WORD_ALIGN_MASK) != 0u
		|| (job.src2 & WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & WORD_ALIGN_MASK) != 0u) {
		finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
		return false;
	}
	if (job.count == 0u) {
		return true;
	}
	if (!m_memory.isReadableMainMemoryRange(job.src0, job.stride0)
		|| !m_memory.isReadableMainMemoryRange(job.src1, job.stride1)
		|| !m_memory.isReadableMainMemoryRange(job.src2, job.stride2)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (!m_memory.isRamRange(job.dst0, SAT2_RESULT_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	return true;
}

bool GeometryController::validateOverlap2dSubmission(const GeoJob& job) {
	const uint32_t mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
	if ((job.param0 & GEO_OVERLAP2D_CONTACT_POLICY_MASK) != GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
		|| (job.param0 & GEO_OVERLAP2D_OUTPUT_POLICY_MASK) != GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW
		|| (job.param0 & 0xffff0000u) != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != OVERLAP2D_INSTANCE_BYTES) {
		finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
		return false;
	}
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) != GEO_OVERLAP2D_BROADPHASE_NONE
			|| job.stride1 != OVERLAP2D_PAIR_BYTES
			|| job.stride2 == 0u) {
			finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
			return false;
		}
	} else if (mode == GEO_OVERLAP2D_MODE_FULL_PASS) {
		if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) != GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
			|| job.src1 != 0u
			|| job.stride1 != 0u
			|| job.stride2 != 0u
			|| job.count > 0xffffu) {
			finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
			return false;
		}
	} else {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if ((job.src0 & WORD_ALIGN_MASK) != 0u
		|| (job.src1 & WORD_ALIGN_MASK) != 0u
		|| (job.dst0 & WORD_ALIGN_MASK) != 0u
		|| (job.dst1 & WORD_ALIGN_MASK) != 0u) {
		finishRejected(GEO_FAULT_REJECT_MISALIGNED_REGS);
		return false;
	}
	if (!m_memory.isRamRange(job.dst1, OVERLAP2D_SUMMARY_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	if (job.param1 != 0u && !m_memory.isRamRange(job.dst0, OVERLAP2D_RESULT_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	if (job.count == 0u) {
		return true;
	}
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS && !m_memory.isReadableMainMemoryRange(job.src1, OVERLAP2D_PAIR_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	const uint32_t instanceCount = mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS ? job.stride2 : job.count;
	const std::optional<uint32_t> lastInstanceAddr = resolveIndexedSpan(job.src0, instanceCount - 1u, job.stride0, OVERLAP2D_INSTANCE_BYTES);
	if (!lastInstanceAddr.has_value() || !m_memory.isReadableMainMemoryRange(*lastInstanceAddr, OVERLAP2D_INSTANCE_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	return true;
}

void GeometryController::processOverlap2dRecord(GeoJob& job) {
	const uint32_t mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		processOverlap2dCandidateRecord(job);
		return;
	}
	processOverlap2dFullPassRecord(job);
}

void GeometryController::processOverlap2dCandidateRecord(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> pairAddr = resolveIndexedSpan(job.src1, recordIndex, job.stride1, OVERLAP2D_PAIR_BYTES);
	if (!pairAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pairAddr, OVERLAP2D_PAIR_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t instanceAIndex = m_memory.readU32(*pairAddr + 0u);
	const uint32_t instanceBIndex = m_memory.readU32(*pairAddr + 4u);
	const uint32_t pairMeta = m_memory.readU32(*pairAddr + 8u);
	if (instanceAIndex == instanceBIndex) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	const uint32_t instanceCount = job.stride2;
	if (instanceAIndex >= instanceCount || instanceBIndex >= instanceCount) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!readOverlapInstanceAt(job, instanceAIndex, m_overlapInstanceA)
		|| !readOverlapInstanceAt(job, instanceBIndex, m_overlapInstanceB)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!processOverlap2dPair(job, recordIndex, m_overlapInstanceA, m_overlapInstanceB, pairMeta)) {
		return;
	}
	writeOverlap2dSummary(job, 0u);
	completeRecord(job);
}

void GeometryController::processOverlap2dFullPassRecord(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	if (!readOverlapInstanceAt(job, recordIndex, m_overlapInstanceA)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	for (uint32_t instanceBIndex = recordIndex + 1u; instanceBIndex < job.count; instanceBIndex += 1u) {
		if (!readOverlapInstanceAt(job, instanceBIndex, m_overlapInstanceB)) {
			finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return;
		}
		const uint32_t pairMeta = ((recordIndex & 0xffffu) << 16u) | (instanceBIndex & 0xffffu);
		if (!processOverlap2dPair(job, recordIndex, m_overlapInstanceA, m_overlapInstanceB, pairMeta)) {
			return;
		}
	}
	writeOverlap2dSummary(job, 0u);
	completeRecord(job);
}

bool GeometryController::readOverlapInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, 5>& out) const {
	const std::optional<uint32_t> instanceAddr = resolveIndexedSpan(job.src0, instanceIndex, job.stride0, OVERLAP2D_INSTANCE_BYTES);
	if (!instanceAddr.has_value() || !m_memory.isReadableMainMemoryRange(*instanceAddr, OVERLAP2D_INSTANCE_BYTES)) {
		return false;
	}
	out[0] = m_memory.readU32(*instanceAddr + 0u);
	out[1] = m_memory.readU32(*instanceAddr + 4u);
	out[2] = m_memory.readU32(*instanceAddr + 8u);
	out[3] = m_memory.readU32(*instanceAddr + 12u);
	out[4] = m_memory.readU32(*instanceAddr + 16u);
	return true;
}

bool GeometryController::processOverlap2dPair(GeoJob& job, uint32_t recordIndex, const std::array<uint32_t, 5>& instanceA, const std::array<uint32_t, 5>& instanceB, uint32_t pairMeta) {
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
	if (!m_memory.isReadableMainMemoryRange(shapeAAddr, OVERLAP2D_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(shapeBAddr, OVERLAP2D_DESC_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return false;
	}
	if ((maskA & layerB) == 0u || (maskB & layerA) == 0u) {
		return true;
	}
	job.broadphasePairCount += 1u;
	if (!readPieceBounds(shapeAAddr, txA, tyA, m_overlapBoundsA)
		|| !readPieceBounds(shapeBAddr, txB, tyB, m_overlapBoundsB)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return false;
	}
	if (!boundsOverlap(m_overlapBoundsA, m_overlapBoundsB)) {
		return true;
	}
	const uint32_t shapeAKind = m_memory.readU32(shapeAAddr + 0u);
	const uint32_t shapeACount = m_memory.readU32(shapeAAddr + 4u);
	const uint32_t shapeADataOffset = m_memory.readU32(shapeAAddr + 8u);
	const uint32_t shapeBKind = m_memory.readU32(shapeBAddr + 0u);
	const uint32_t shapeBCount = m_memory.readU32(shapeBAddr + 4u);
	const uint32_t shapeBDataOffset = m_memory.readU32(shapeBAddr + 8u);
	const uint32_t shapeAPieceCount = shapeAKind == OVERLAP2D_KIND_COMPOUND ? shapeACount : 1u;
	const uint32_t shapeBPieceCount = shapeBKind == OVERLAP2D_KIND_COMPOUND ? shapeBCount : 1u;
	if (shapeAPieceCount == 0u || shapeBPieceCount == 0u
		|| (shapeAKind == OVERLAP2D_KIND_COMPOUND && (shapeADataOffset & WORD_ALIGN_MASK) != 0u)
		|| (shapeBKind == OVERLAP2D_KIND_COMPOUND && (shapeBDataOffset & WORD_ALIGN_MASK) != 0u)
		|| (shapeAKind != OVERLAP2D_KIND_COMPOUND && shapeAKind != GEO_PRIMITIVE_AABB && shapeAKind != GEO_PRIMITIVE_CONVEX_POLY)
		|| (shapeBKind != OVERLAP2D_KIND_COMPOUND && shapeBKind != GEO_PRIMITIVE_AABB && shapeBKind != GEO_PRIMITIVE_CONVEX_POLY)) {
		finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
		return false;
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
		const std::optional<uint32_t> pieceAAddr = shapeAKind == OVERLAP2D_KIND_COMPOUND
			? resolveByteOffset(shapeAAddr, shapeADataOffset + pieceAIndex * OVERLAP2D_DESC_BYTES, OVERLAP2D_DESC_BYTES)
			: std::optional<uint32_t>(shapeAAddr);
		if (!pieceAAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pieceAAddr, OVERLAP2D_DESC_BYTES)) {
			finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		if (!readPieceBounds(*pieceAAddr, txA, tyA, m_overlapBoundsA)) {
			finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		for (uint32_t pieceBIndex = 0u; pieceBIndex < shapeBPieceCount; pieceBIndex += 1u) {
			const std::optional<uint32_t> pieceBAddr = shapeBKind == OVERLAP2D_KIND_COMPOUND
				? resolveByteOffset(shapeBAddr, shapeBDataOffset + pieceBIndex * OVERLAP2D_DESC_BYTES, OVERLAP2D_DESC_BYTES)
				: std::optional<uint32_t>(shapeBAddr);
			if (!pieceBAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pieceBAddr, OVERLAP2D_DESC_BYTES)) {
				finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return false;
			}
			if (!readPieceBounds(*pieceBAddr, txB, tyB, m_overlapBoundsB)) {
				finishError(GEO_FAULT_SRC_RANGE, recordIndex);
				return false;
			}
			if (!boundsOverlap(m_overlapBoundsA, m_overlapBoundsB)) {
				continue;
			}
			if (!computePiecePairContact(*pieceAAddr, txA, tyA, *pieceBAddr, txB, tyB, recordIndex)) {
				if (!m_activeJob.has_value()) {
					return false;
				}
				continue;
			}
			if (!bestHit
				|| m_overlapContactDepth < bestDepth
				|| (m_overlapContactDepth == bestDepth
					&& (pieceAIndex < bestPieceA
						|| (pieceAIndex == bestPieceA
							&& (pieceBIndex < bestPieceB
								|| (pieceBIndex == bestPieceB && m_overlapContactFeatureMeta < bestFeatureMeta)))))) {
				bestHit = true;
				bestDepth = static_cast<double>(m_overlapContactDepth);
				bestPieceA = pieceAIndex;
				bestPieceB = pieceBIndex;
				bestFeatureMeta = m_overlapContactFeatureMeta;
				bestNx = m_overlapContactNx;
				bestNy = m_overlapContactNy;
				bestPx = m_overlapContactPx;
				bestPy = m_overlapContactPy;
			}
		}
	}
	if (!bestHit) {
		return true;
	}
	if (job.resultCount >= job.param1) {
		writeOverlap2dSummary(job, GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
		finishError(GEO_FAULT_RESULT_CAPACITY, recordIndex);
		return false;
	}
	const std::optional<uint32_t> resultAddr = resolveIndexedSpan(job.dst0, job.resultCount, OVERLAP2D_RESULT_BYTES, OVERLAP2D_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, OVERLAP2D_RESULT_BYTES)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return false;
	}
	writeOverlap2dResult(*resultAddr, bestNx, bestNy, bestDepth, bestPx, bestPy, bestPieceA, bestPieceB, bestFeatureMeta, pairMeta);
	job.resultCount += 1u;
	return true;
}

void GeometryController::processXform2Record(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> recordAddr = resolveIndexedSpan(job.src0, recordIndex, job.stride0, XFORM2_JOB_BYTES);
	if (!recordAddr.has_value()) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*recordAddr, XFORM2_JOB_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t flags = m_memory.readU32(*recordAddr + 0u);
	const uint32_t srcIndex = m_memory.readU32(*recordAddr + 4u);
	const uint32_t dstIndex = m_memory.readU32(*recordAddr + 8u);
	const uint32_t auxIndex = m_memory.readU32(*recordAddr + 12u);
	const uint32_t vertexCount = m_memory.readU32(*recordAddr + 16u);
	const uint32_t dst1Index = m_memory.readU32(*recordAddr + 20u);
	if (flags != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	if (vertexCount == 0u) {
		completeRecord(job);
		return;
	}
	if (vertexCount > (std::numeric_limits<uint32_t>::max() / XFORM2_VERTEX_BYTES)) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	const uint32_t vertexBytes = vertexCount * XFORM2_VERTEX_BYTES;
	const std::optional<uint32_t> srcAddr = resolveIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
	if (!srcAddr.has_value() || !m_memory.isReadableMainMemoryRange(*srcAddr, vertexBytes)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> matrixAddr = resolveIndexedSpan(job.src2, auxIndex, job.stride2, XFORM2_MATRIX_BYTES);
	if (!matrixAddr.has_value() || !m_memory.isReadableMainMemoryRange(*matrixAddr, XFORM2_MATRIX_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> dstAddr = resolveIndexedSpan(job.dst0, dstIndex, XFORM2_VERTEX_BYTES, vertexBytes);
	if (!dstAddr.has_value() || !m_memory.isRamRange(*dstAddr, vertexBytes)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return;
	}
	uint32_t aabbAddr = 0u;
	if (dst1Index != GEO_INDEX_NONE) {
		const std::optional<uint32_t> resolvedAabbAddr = resolveIndexedSpan(job.dst1, dst1Index, XFORM2_AABB_BYTES, XFORM2_AABB_BYTES);
		if (!resolvedAabbAddr.has_value() || !m_memory.isRamRange(*resolvedAabbAddr, XFORM2_AABB_BYTES)) {
			finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		aabbAddr = *resolvedAabbAddr;
	}
	const int32_t m00 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 0u));
	const int32_t m01 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 4u));
	const int32_t tx = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 8u));
	const int32_t m10 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 12u));
	const int32_t m11 = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 16u));
	const int32_t ty = static_cast<int32_t>(m_memory.readU32(*matrixAddr + 20u));
	int32_t minX = 0;
	int32_t minY = 0;
	int32_t maxX = 0;
	int32_t maxY = 0;
	for (uint32_t vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1u) {
		const uint32_t localAddr = *srcAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		const uint32_t worldAddr = *dstAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		const int32_t localX = static_cast<int32_t>(m_memory.readU32(localAddr + 0u));
		const int32_t localY = static_cast<int32_t>(m_memory.readU32(localAddr + 4u));
		const int32_t worldX = transformFixed16(m00, m01, tx, localX, localY);
		const int32_t worldY = transformFixed16(m10, m11, ty, localX, localY);
		m_memory.writeU32(worldAddr + 0u, static_cast<uint32_t>(worldX));
		m_memory.writeU32(worldAddr + 4u, static_cast<uint32_t>(worldY));
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
		m_memory.writeU32(aabbAddr + 0u, static_cast<uint32_t>(minX));
		m_memory.writeU32(aabbAddr + 4u, static_cast<uint32_t>(minY));
		m_memory.writeU32(aabbAddr + 8u, static_cast<uint32_t>(maxX));
		m_memory.writeU32(aabbAddr + 12u, static_cast<uint32_t>(maxY));
	}
	completeRecord(job);
}

void GeometryController::processSat2Record(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> pairAddr = resolveIndexedSpan(job.src0, recordIndex, job.stride0, SAT2_PAIR_BYTES);
	if (!pairAddr.has_value()) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*pairAddr, SAT2_PAIR_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t flags = m_memory.readU32(*pairAddr + 0u);
	const uint32_t shapeAIndex = m_memory.readU32(*pairAddr + 4u);
	const uint32_t resultIndex = m_memory.readU32(*pairAddr + 8u);
	const uint32_t shapeBIndex = m_memory.readU32(*pairAddr + 12u);
	const uint32_t pairFlags = m_memory.readU32(*pairAddr + 16u);
	if (flags != 0u || pairFlags != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	const std::optional<uint32_t> resultAddr = resolveIndexedSpan(job.dst0, resultIndex, SAT2_RESULT_BYTES, SAT2_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, SAT2_RESULT_BYTES)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> shapeADescAddr = resolveIndexedSpan(job.src1, shapeAIndex, job.stride1, SAT2_DESC_BYTES);
	const std::optional<uint32_t> shapeBDescAddr = resolveIndexedSpan(job.src1, shapeBIndex, job.stride1, SAT2_DESC_BYTES);
	if (!shapeADescAddr.has_value() || !shapeBDescAddr.has_value()) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeADescAddr, SAT2_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(*shapeBDescAddr, SAT2_DESC_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t shapeAFlags = m_memory.readU32(*shapeADescAddr + 0u);
	const uint32_t shapeAVertexCount = m_memory.readU32(*shapeADescAddr + 4u);
	const uint32_t shapeAVertexOffsetBytes = m_memory.readU32(*shapeADescAddr + 8u);
	const uint32_t shapeAReserved = m_memory.readU32(*shapeADescAddr + 12u);
	const uint32_t shapeBFlags = m_memory.readU32(*shapeBDescAddr + 0u);
	const uint32_t shapeBVertexCount = m_memory.readU32(*shapeBDescAddr + 4u);
	const uint32_t shapeBVertexOffsetBytes = m_memory.readU32(*shapeBDescAddr + 8u);
	const uint32_t shapeBReserved = m_memory.readU32(*shapeBDescAddr + 12u);
	if (shapeAFlags != GEO_SHAPE_CONVEX_POLY
		|| shapeBFlags != GEO_SHAPE_CONVEX_POLY
		|| shapeAReserved != 0u
		|| shapeBReserved != 0u) {
		finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
		return;
	}
	if (shapeAVertexCount < 3u || shapeBVertexCount < 3u) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	if ((shapeAVertexOffsetBytes & WORD_ALIGN_MASK) != 0u || (shapeBVertexOffsetBytes & WORD_ALIGN_MASK) != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (shapeAVertexCount > (std::numeric_limits<uint32_t>::max() / XFORM2_VERTEX_BYTES)
		|| shapeBVertexCount > (std::numeric_limits<uint32_t>::max() / XFORM2_VERTEX_BYTES)) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	const uint32_t shapeAVertexBytes = shapeAVertexCount * XFORM2_VERTEX_BYTES;
	const uint32_t shapeBVertexBytes = shapeBVertexCount * XFORM2_VERTEX_BYTES;
	const std::optional<uint32_t> shapeAVertexAddr = resolveIndexedSpan(job.src2, shapeAVertexOffsetBytes, 1u, shapeAVertexBytes);
	const std::optional<uint32_t> shapeBVertexAddr = resolveIndexedSpan(job.src2, shapeBVertexOffsetBytes, 1u, shapeBVertexBytes);
	if (!shapeAVertexAddr.has_value() || !shapeBVertexAddr.has_value()) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeAVertexAddr, shapeAVertexBytes)
		|| !m_memory.isReadableMainMemoryRange(*shapeBVertexAddr, shapeBVertexBytes)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	double centerAX = 0.0;
	double centerAY = 0.0;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *shapeAVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		centerAX += static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
		centerAY += static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
	}
	double centerBX = 0.0;
	double centerBY = 0.0;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *shapeBVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		centerBX += static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
		centerBY += static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
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
			const uint32_t currentAddr = axisBase + edgeIndex * XFORM2_VERTEX_BYTES;
			const uint32_t nextIndex = edgeIndex + 1u == axisCount ? 0u : edgeIndex + 1u;
			const uint32_t nextAddr = axisBase + nextIndex * XFORM2_VERTEX_BYTES;
			const double x0 = static_cast<int32_t>(m_memory.readU32(currentAddr + 0u));
			const double y0 = static_cast<int32_t>(m_memory.readU32(currentAddr + 4u));
			const double x1 = static_cast<int32_t>(m_memory.readU32(nextAddr + 0u));
			const double y1 = static_cast<int32_t>(m_memory.readU32(nextAddr + 4u));
			const double nx = -(y1 - y0);
			const double ny = x1 - x0;
			const double axisLength = std::sqrt((nx * nx) + (ny * ny));
			if (!(axisLength > 0.0)) {
				continue;
			}
			sawAxis = true;
			const double ax = nx / axisLength;
			const double ay = ny / axisLength;
			double minA = std::numeric_limits<double>::infinity();
			double maxA = -std::numeric_limits<double>::infinity();
			for (uint32_t vertexIndex = 0; vertexIndex < shapeAVertexCount; vertexIndex += 1u) {
				const uint32_t vertexAddr = *shapeAVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
				const double px = static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
				const double py = static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
				const double projection = (px * ax) + (py * ay);
				if (projection < minA) {
					minA = projection;
				}
				if (projection > maxA) {
					maxA = projection;
				}
			}
			double minB = std::numeric_limits<double>::infinity();
			double maxB = -std::numeric_limits<double>::infinity();
			for (uint32_t vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1u) {
				const uint32_t vertexAddr = *shapeBVertexAddr + vertexIndex * XFORM2_VERTEX_BYTES;
				const double px = static_cast<int32_t>(m_memory.readU32(vertexAddr + 0u));
				const double py = static_cast<int32_t>(m_memory.readU32(vertexAddr + 4u));
				const double projection = (px * ax) + (py * ay);
				if (projection < minB) {
					minB = projection;
				}
				if (projection > maxB) {
					maxB = projection;
				}
			}
			const double sepA = minA - maxB;
			const double sepB = minB - maxA;
			if (sepA > 0.0 || sepB > 0.0) {
				writeSat2Result(*resultAddr, 0u, 0, 0, 0, 0u);
				completeRecord(job);
				return;
			}
			const double overlap = std::min(maxA, maxB) - std::max(minA, minB);
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
		finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
		return;
	}
	if (!std::isfinite(bestOverlap) || !std::isfinite(bestAxisX) || !std::isfinite(bestAxisY)) {
		finishError(GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL, recordIndex);
		return;
	}
	const double deltaX = centerBX - centerAX;
	const double deltaY = centerBY - centerAY;
	if (((deltaX * bestAxisX) + (deltaY * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	writeSat2Result(
		*resultAddr,
		1u,
		roundToI32Clamped(bestAxisX * FIX16_SCALE),
		roundToI32Clamped(bestAxisY * FIX16_SCALE),
		roundToI32Clamped(bestOverlap),
		packSat2Meta(bestAxisIndex, bestShapeSelector)
	);
	completeRecord(job);
}


bool GeometryController::readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) const {
	const uint32_t boundsOffset = m_memory.readU32(pieceAddr + 12u);
	const std::optional<uint32_t> boundsAddr = resolveByteOffset(pieceAddr, boundsOffset, OVERLAP2D_BOUNDS_BYTES);
	if (!boundsAddr.has_value() || !m_memory.isReadableMainMemoryRange(*boundsAddr, OVERLAP2D_BOUNDS_BYTES)) {
		return false;
	}
	out[0] = static_cast<double>(readF32(*boundsAddr + 0u)) + tx;
	out[1] = static_cast<double>(readF32(*boundsAddr + 4u)) + ty;
	out[2] = static_cast<double>(readF32(*boundsAddr + 8u)) + tx;
	out[3] = static_cast<double>(readF32(*boundsAddr + 12u)) + ty;
	return true;
}

bool GeometryController::computePiecePairContact(
	uint32_t pieceAAddr,
	double txA,
	double tyA,
	uint32_t pieceBAddr,
	double txB,
	double tyB,
	uint32_t recordIndex
) {
	const uint32_t primitiveA = m_memory.readU32(pieceAAddr + 0u);
	const uint32_t primitiveB = m_memory.readU32(pieceBAddr + 0u);
	if ((primitiveA != GEO_PRIMITIVE_AABB && primitiveA != GEO_PRIMITIVE_CONVEX_POLY)
		|| (primitiveB != GEO_PRIMITIVE_AABB && primitiveB != GEO_PRIMITIVE_CONVEX_POLY)) {
		finishError(GEO_FAULT_DESCRIPTOR_KIND, recordIndex);
		return false;
	}
	if (!loadWorldPoly(pieceAAddr, txA, tyA, m_overlapWorldPolyA)
		|| !loadWorldPoly(pieceBAddr, txB, tyB, m_overlapWorldPolyB)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return false;
	}
	return computePolyPairContact(m_overlapWorldPolyA, m_overlapWorldPolyB);
}

bool GeometryController::loadWorldPoly(uint32_t pieceAddr, double tx, double ty, std::vector<double>& out) const {
	const uint32_t primitive = m_memory.readU32(pieceAddr + 0u);
	const uint32_t dataCount = m_memory.readU32(pieceAddr + 4u);
	const uint32_t dataOffset = m_memory.readU32(pieceAddr + 8u);
	const uint32_t byteLength = primitive == GEO_PRIMITIVE_AABB ? 16u : dataCount * XFORM2_VERTEX_BYTES;
	const std::optional<uint32_t> dataAddr = resolveByteOffset(pieceAddr, dataOffset, byteLength);
	if (!dataAddr.has_value()) {
		return false;
	}
	out.clear();
	if (primitive == GEO_PRIMITIVE_AABB) {
		if (dataCount != 4u || !m_memory.isReadableMainMemoryRange(*dataAddr, 16u)) {
			return false;
		}
		const double left = static_cast<double>(readF32(*dataAddr + 0u));
		const double top = static_cast<double>(readF32(*dataAddr + 4u));
		const double right = static_cast<double>(readF32(*dataAddr + 8u));
		const double bottom = static_cast<double>(readF32(*dataAddr + 12u));
		pushWorldVertex(out, tx, ty, left, top);
		pushWorldVertex(out, tx, ty, right, top);
		pushWorldVertex(out, tx, ty, right, bottom);
		pushWorldVertex(out, tx, ty, left, bottom);
		return true;
	}
	if (primitive != GEO_PRIMITIVE_CONVEX_POLY || dataCount < 3u || !m_memory.isReadableMainMemoryRange(*dataAddr, dataCount * XFORM2_VERTEX_BYTES)) {
		return false;
	}
	for (uint32_t vertexIndex = 0u; vertexIndex < dataCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *dataAddr + vertexIndex * XFORM2_VERTEX_BYTES;
		pushWorldVertex(out, tx, ty, readF32(vertexAddr + 0u), readF32(vertexAddr + 4u));
	}
	return true;
}

void GeometryController::pushWorldVertex(std::vector<double>& out, double tx, double ty, double localX, double localY) {
	out.push_back(localX + tx);
	out.push_back(localY + ty);
}

bool GeometryController::boundsOverlap(const std::array<double, 4>& a, const std::array<double, 4>& b) {
	return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

bool GeometryController::computePolyPairContact(const std::vector<double>& polyA, const std::vector<double>& polyB) {
	double bestOverlap = std::numeric_limits<double>::infinity();
	double bestAxisX = 0.0;
	double bestAxisY = 0.0;
	uint32_t bestEdgeIndex = 0u;
	uint32_t bestOwner = 0u;
	bool sawAxis = false;
	for (uint32_t owner = 0u; owner < 2u; owner += 1u) {
		const std::vector<double>& poly = owner == 0u ? polyA : polyB;
		for (size_t i = 0; i < poly.size(); i += 2u) {
			const size_t next = i + 2u >= poly.size() ? 0u : i + 2u;
			const double nx = -(poly[next + 1u] - poly[i + 1u]);
			const double ny = poly[next] - poly[i];
			const double len = std::sqrt((nx * nx) + (ny * ny));
			if (!(len > 0.0)) {
				continue;
			}
			sawAxis = true;
			const double ax = nx / len;
			const double ay = ny / len;
			const auto projA = projectPoly(polyA, ax, ay);
			const auto projB = projectPoly(polyB, ax, ay);
			const double overlap = std::min(projA.second, projB.second) - std::max(projA.first, projB.first);
			if (!(overlap > 0.0)) {
				return false;
			}
			const uint32_t edgeIndex = static_cast<uint32_t>(i >> 1u);
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
	const auto centerA = computePolyAverage(polyA);
	const auto centerB = computePolyAverage(polyB);
	if ((((centerA.first - centerB.first) * bestAxisX) + ((centerA.second - centerB.second) * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	const std::vector<double>& intersection = clipConvexPolygons(polyA, polyB);
	double pointX = 0.0;
	double pointY = 0.0;
	if (intersection.empty()) {
		pointX = (centerA.first + centerB.first) * 0.5;
		pointY = (centerA.second + centerB.second) * 0.5;
	} else {
		const auto centroid = computePolyAverage(intersection);
		pointX = centroid.first;
		pointY = centroid.second;
	}
	m_overlapContactNx = bestAxisX;
	m_overlapContactNy = bestAxisY;
	m_overlapContactDepth = bestOverlap;
	m_overlapContactPx = pointX;
	m_overlapContactPy = pointY;
	m_overlapContactFeatureMeta = bestEdgeIndex;
	return true;
}

std::pair<double, double> GeometryController::projectPoly(const std::vector<double>& poly, double ax, double ay) {
	double min = std::numeric_limits<double>::infinity();
	double max = -std::numeric_limits<double>::infinity();
	for (size_t i = 0; i < poly.size(); i += 2u) {
		const double projection = (poly[i] * ax) + (poly[i + 1u] * ay);
		if (projection < min) {
			min = projection;
		}
		if (projection > max) {
			max = projection;
		}
	}
	return { min, max };
}

std::pair<double, double> GeometryController::computePolyAverage(const std::vector<double>& poly) {
	double sumX = 0.0;
	double sumY = 0.0;
	const double count = static_cast<double>(poly.size() >> 1u);
	for (size_t i = 0; i < poly.size(); i += 2u) {
		sumX += poly[i];
		sumY += poly[i + 1u];
	}
	return { sumX / count, sumY / count };
}

const std::vector<double>& GeometryController::clipConvexPolygons(const std::vector<double>& polyA, const std::vector<double>& polyB) {
	m_overlapClip0.assign(polyA.begin(), polyA.end());
	std::vector<double>* input = &m_overlapClip0;
	std::vector<double>* output = &m_overlapClip1;
	for (size_t i = 0; i < polyB.size(); i += 2u) {
		output->clear();
		const double x0 = polyB[i];
		const double y0 = polyB[i + 1u];
		const size_t next = i + 2u >= polyB.size() ? 0u : i + 2u;
		const double x1 = polyB[next];
		const double y1 = polyB[next + 1u];
		if (input->empty()) {
			break;
		}
		double sx = (*input)[input->size() - 2u];
		double sy = (*input)[input->size() - 1u];
		double sd = clipPlaneDistance(x0, y0, x1, y1, sx, sy);
		bool sInside = sd >= 0.0;
		for (size_t j = 0; j < input->size(); j += 2u) {
			const double ex = (*input)[j];
			const double ey = (*input)[j + 1u];
			const double ed = clipPlaneDistance(x0, y0, x1, y1, ex, ey);
			const bool eInside = ed >= 0.0;
			if (sInside && eInside) {
				output->push_back(ex);
				output->push_back(ey);
			} else if (sInside && !eInside) {
				const double t = sd / (sd - ed);
				output->push_back(sx + ((ex - sx) * t));
				output->push_back(sy + ((ey - sy) * t));
			} else if (!sInside && eInside) {
				const double t = sd / (sd - ed);
				output->push_back(sx + ((ex - sx) * t));
				output->push_back(sy + ((ey - sy) * t));
				output->push_back(ex);
				output->push_back(ey);
			}
			sx = ex;
			sy = ey;
			sd = ed;
			sInside = eInside;
		}
		std::swap(input, output);
	}
	return *input;
}

double GeometryController::clipPlaneDistance(double x0, double y0, double x1, double y1, double px, double py) {
	return ((x1 - x0) * (py - y0)) - ((y1 - y0) * (px - x0));
}

void GeometryController::writeOverlap2dSummary(const GeoJob& job, uint32_t flags) {
	m_memory.writeU32(job.dst1 + 0u, job.resultCount);
	m_memory.writeU32(job.dst1 + 4u, job.exactPairCount);
	m_memory.writeU32(job.dst1 + 8u, job.broadphasePairCount);
	m_memory.writeU32(job.dst1 + 12u, flags);
}

void GeometryController::writeOverlap2dResult(
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
	m_memory.writeU32(addr + 0u, numberToF32Bits(nx));
	m_memory.writeU32(addr + 4u, numberToF32Bits(ny));
	m_memory.writeU32(addr + 8u, numberToF32Bits(depth));
	m_memory.writeU32(addr + 12u, numberToF32Bits(px));
	m_memory.writeU32(addr + 16u, numberToF32Bits(py));
	m_memory.writeU32(addr + 20u, pieceA);
	m_memory.writeU32(addr + 24u, pieceB);
	m_memory.writeU32(addr + 28u, featureMeta);
	m_memory.writeU32(addr + 32u, pairMeta);
}

std::optional<uint32_t> GeometryController::resolveByteOffset(uint32_t base, uint32_t offset, uint32_t byteLength) const {
	const uint64_t addr = static_cast<uint64_t>(base) + static_cast<uint64_t>(offset);
	if (addr > std::numeric_limits<uint32_t>::max()) {
		return std::nullopt;
	}
	const uint64_t end = addr + static_cast<uint64_t>(byteLength);
	if (end > (static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 1ull)) {
		return std::nullopt;
	}
	return static_cast<uint32_t>(addr);
}

int32_t GeometryController::readI32(uint32_t addr) const {
	return static_cast<int32_t>(m_memory.readU32(addr));
}

float GeometryController::readF32(uint32_t addr) const {
	return f32BitsToNumber(m_memory.readU32(addr));
}

void GeometryController::completeRecord(GeoJob& job) {
	job.processed += 1u;
	writeRegister(IO_GEO_PROCESSED, job.processed);
	if (job.processed >= job.count) {
		finishSuccess(job.processed);
	}
}

void GeometryController::finishSuccess(uint32_t processed) {
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_cancelService();
	writeRegister(IO_GEO_STATUS, GEO_STATUS_DONE);
	writeRegister(IO_GEO_PROCESSED, processed);
	writeRegister(IO_GEO_FAULT, 0u);
	m_raiseIrq(IRQ_GEO_DONE);
}

void GeometryController::finishError(uint32_t code, uint32_t recordIndex, bool signalIrq) {
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_cancelService();
	writeRegister(IO_GEO_STATUS, GEO_STATUS_DONE | GEO_STATUS_ERROR);
	writeRegister(IO_GEO_FAULT, packFault(code, recordIndex));
	if (signalIrq) {
		m_raiseIrq(IRQ_GEO_ERROR);
	}
}

void GeometryController::finishRejected(uint32_t code) {
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_cancelService();
	writeRegister(IO_GEO_STATUS, GEO_STATUS_REJECTED);
	writeRegister(IO_GEO_PROCESSED, 0u);
	writeRegister(IO_GEO_FAULT, packFault(code, GEO_RECORD_INDEX_NONE));
	m_raiseIrq(IRQ_GEO_ERROR);
}

std::optional<uint32_t> GeometryController::resolveIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint32_t byteLength) const {
	const uint64_t offset = static_cast<uint64_t>(index) * static_cast<uint64_t>(stride);
	if (offset > std::numeric_limits<uint32_t>::max()) {
		return std::nullopt;
	}
	const uint64_t addr = static_cast<uint64_t>(base) + offset;
	if (addr > std::numeric_limits<uint32_t>::max()) {
		return std::nullopt;
	}
	const uint64_t end = addr + byteLength;
	if (end > (static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 1ull)) {
		return std::nullopt;
	}
	return static_cast<uint32_t>(addr);
}

uint32_t GeometryController::readRegister(uint32_t addr) const {
	return toU32(asNumber(m_memory.readValue(addr)));
}

void GeometryController::writeRegister(uint32_t addr, uint32_t value) {
	m_memory.writeValue(addr, valueNumber(static_cast<double>(value)));
}

void GeometryController::writeSat2Result(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta) {
	m_memory.writeU32(addr + 0u, hit);
	m_memory.writeU32(addr + 4u, static_cast<uint32_t>(nx));
	m_memory.writeU32(addr + 8u, static_cast<uint32_t>(ny));
	m_memory.writeU32(addr + 12u, static_cast<uint32_t>(depth));
	m_memory.writeU32(addr + 16u, meta);
}

uint32_t GeometryController::packFault(uint32_t code, uint32_t recordIndex) {
	return ((code & 0xffffu) << 16u) | (recordIndex & 0xffffu);
}

uint32_t GeometryController::packSat2Meta(uint32_t axisIndex, uint32_t shapeSelector) {
	return ((shapeSelector & 0xffffu) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK);
}

int32_t GeometryController::roundToI32Clamped(double value) {
	if (value <= static_cast<double>(std::numeric_limits<int32_t>::min())) {
		return std::numeric_limits<int32_t>::min();
	}
	if (value >= static_cast<double>(std::numeric_limits<int32_t>::max())) {
		return std::numeric_limits<int32_t>::max();
	}
	return static_cast<int32_t>(std::llround(value));
}

int32_t GeometryController::transformFixed16(int32_t m0, int32_t m1, int32_t tx, int32_t x, int32_t y) {
	int64_t accum = 0;
	accum = saturatingAdd64(accum, static_cast<int64_t>(m0) * static_cast<int64_t>(x));
	accum = saturatingAdd64(accum, static_cast<int64_t>(m1) * static_cast<int64_t>(y));
	accum = saturatingAdd64(accum, static_cast<int64_t>(tx) * (static_cast<int64_t>(1) << FIX16_SHIFT));
	return saturateI32(accum >> FIX16_SHIFT);
}

} // namespace bmsx
