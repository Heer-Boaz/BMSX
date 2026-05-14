#include "machine/devices/geometry/controller.h"

#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/budget.h"
#include <algorithm>
#include <cmath>
#include <limits>

namespace bmsx {
namespace {

constexpr uint32_t WORD_ALIGN_MASK = 3u;
constexpr uint32_t GEO_SERVICE_BATCH_RECORDS = 1u;

uint32_t packFault(uint32_t code, uint32_t recordIndex) {
	return ((code & GEO_FAULT_CODE_MASK) << GEO_FAULT_CODE_SHIFT) | (recordIndex & GEO_FAULT_RECORD_INDEX_MASK);
}

uint32_t packSat2Meta(uint32_t axisIndex, uint32_t shapeSelector) {
	return ((shapeSelector & GEO_SAT_META_AXIS_MASK) << GEO_SAT_META_SHAPE_SHIFT) | (axisIndex & GEO_SAT_META_AXIS_MASK);
}

} // namespace

GeometryController::GeometryController(
	Memory& memory,
	IrqController& irq,
	DeviceScheduler& scheduler
)
	: m_memory(memory)
	, m_irq(irq)
	, m_scheduler(scheduler) {
	m_memory.mapIoWrite(IO_GEO_CTRL, this, &GeometryController::onCtrlWriteThunk);
	m_memory.mapIoWrite(IO_GEO_FAULT_ACK, this, &GeometryController::onFaultAckWriteThunk);
	m_overlapWorldPolyA.reserve(32u);
	m_overlapWorldPolyB.reserve(32u);
	m_overlapClip0.reserve(32u);
	m_overlapClip1.reserve(32u);
}

// disable-next-line normalized_ast_duplicate_pattern -- device MMIO thunks share callback shape while each device owns its scheduler timing.
void GeometryController::onCtrlWriteThunk(void* context, uint32_t, Value) {
	auto* controller = static_cast<GeometryController*>(context);
	controller->onCtrlWrite(controller->m_scheduler.currentNowCycles());
}

void GeometryController::onFaultAckWriteThunk(void* context, uint32_t, Value value) {
	auto* controller = static_cast<GeometryController*>(context);
	controller->onFaultAckWrite(value);
}

void GeometryController::setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_workUnitsPerSec = workUnitsPerSec;
	if (m_phase != GeometryControllerPhase::Busy) {
		m_workCarry = 0;
		m_availableWorkUnits = 0;
	}
	scheduleNextService(nowCycles);
}

void GeometryController::accrueCycles(int cycles, int64_t nowCycles) {
	if (m_phase != GeometryControllerPhase::Busy || cycles <= 0) {
		return;
	}

	const int64_t wholeUnits = accrueBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, cycles);
	if (wholeUnits > 0) {
		const uint32_t remainingRecords = m_activeJob->count - m_activeJob->processed;
		const int64_t maxGrant = static_cast<int64_t>(remainingRecords - m_availableWorkUnits);
		const int64_t granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
		m_availableWorkUnits += static_cast<uint32_t>(granted);
	}
	scheduleNextService(nowCycles);
}

bool GeometryController::hasPendingWork() const {
	return m_phase == GeometryControllerPhase::Busy;
}

uint32_t GeometryController::getPendingWorkUnits() const {
	if (m_phase != GeometryControllerPhase::Busy) {
		return 0u;
	}
	return m_activeJob->count - m_activeJob->processed;
}

void GeometryController::reset() {
	m_phase = GeometryControllerPhase::Idle;
	m_workCarry = 0;
	m_availableWorkUnits = 0;
	m_activeJob.reset();
	m_scheduler.cancelDeviceService(DeviceServiceGeo);
	m_memory.writeValue(IO_GEO_SRC0, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_SRC1, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_SRC2, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_DST0, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_DST1, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_COUNT, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_CMD, valueNumber(static_cast<double>(0)));
	m_memory.writeIoValue(IO_GEO_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_PARAM0, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_PARAM1, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_STRIDE0, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_STRIDE1, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_STRIDE2, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_PROCESSED, valueNumber(static_cast<double>(0)));
	m_memory.writeValue(IO_GEO_FAULT, valueNumber(static_cast<double>(0)));
	m_memory.writeIoValue(IO_GEO_FAULT_ACK, valueNumber(0.0));
}

GeometryControllerState GeometryController::captureState() const {
	GeometryControllerState state;
	state.phase = m_phase;
	for (size_t index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1u) {
		state.registerWords[index] = m_memory.readIoU32(IO_GEO_REGISTER_ADDRS[index]);
	}
	state.activeJob = m_activeJob;
	state.workCarry = m_workCarry;
	state.availableWorkUnits = m_availableWorkUnits;
	return state;
}

void GeometryController::restoreState(const GeometryControllerState& state, int64_t nowCycles) {
	for (size_t index = 0; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoValue(IO_GEO_REGISTER_ADDRS[index], valueNumber(static_cast<double>(state.registerWords[index])));
	}
	m_phase = state.phase;
	m_activeJob = state.activeJob;
	m_workCarry = state.workCarry;
	m_availableWorkUnits = state.availableWorkUnits;
	m_memory.writeIoValue(IO_GEO_CTRL, valueNumber(static_cast<double>(m_memory.readIoU32(IO_GEO_CTRL) & ~(GEO_CTRL_START | GEO_CTRL_ABORT))));
	scheduleNextService(nowCycles);
}

void GeometryController::onCtrlWrite(int64_t nowCycles) {
	const uint32_t ctrl = m_memory.readIoU32(IO_GEO_CTRL);
	const bool start = (ctrl & GEO_CTRL_START) != 0u;
	const bool abort = (ctrl & GEO_CTRL_ABORT) != 0u;
	if (!start && !abort) {
		return;
	}
	m_memory.writeIoValue(IO_GEO_CTRL, valueNumber(static_cast<double>(ctrl & ~(GEO_CTRL_START | GEO_CTRL_ABORT))));
	if (m_phase == GeometryControllerPhase::Error || m_phase == GeometryControllerPhase::Rejected) {
		return;
	}
	if (start && abort) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return;
	}
	if (abort) {
		if (m_phase == GeometryControllerPhase::Busy) {
			finishError(GEO_FAULT_ABORTED_BY_HOST, m_activeJob->processed);
		}
		return;
	}
	if (m_phase == GeometryControllerPhase::Busy) {
		finishRejected(GEO_FAULT_REJECT_BUSY);
		return;
	}
	tryStart(nowCycles);
}

void GeometryController::onService(int64_t nowCycles) {
	if (m_phase != GeometryControllerPhase::Busy || m_availableWorkUnits == 0u) {
		scheduleNextService(nowCycles);
		return;
	}
	uint32_t remaining = m_availableWorkUnits;
	m_availableWorkUnits = 0u;
	while (m_phase == GeometryControllerPhase::Busy && remaining > 0u) {
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
	m_availableWorkUnits = m_phase == GeometryControllerPhase::Busy ? remaining : 0u;
	scheduleNextService(nowCycles);
}

void GeometryController::tryStart(int64_t nowCycles) {
	GeoJob job;
	job.cmd = m_memory.readIoU32(IO_GEO_CMD);
	job.src0 = m_memory.readIoU32(IO_GEO_SRC0);
	job.src1 = m_memory.readIoU32(IO_GEO_SRC1);
	job.src2 = m_memory.readIoU32(IO_GEO_SRC2);
	job.dst0 = m_memory.readIoU32(IO_GEO_DST0);
	job.dst1 = m_memory.readIoU32(IO_GEO_DST1);
	job.count = m_memory.readIoU32(IO_GEO_COUNT);
	job.param0 = m_memory.readIoU32(IO_GEO_PARAM0);
	job.param1 = m_memory.readIoU32(IO_GEO_PARAM1);
	job.stride0 = m_memory.readIoU32(IO_GEO_STRIDE0);
	job.stride1 = m_memory.readIoU32(IO_GEO_STRIDE1);
	job.stride2 = m_memory.readIoU32(IO_GEO_STRIDE2);
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
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(static_cast<double>(0u)));
	m_memory.writeValue(IO_GEO_PROCESSED, valueNumber(static_cast<double>(0u)));
	m_memory.writeValue(IO_GEO_FAULT, valueNumber(static_cast<double>(0u)));
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
	m_phase = GeometryControllerPhase::Busy;
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(static_cast<double>(GEO_STATUS_BUSY)));
	scheduleNextService(nowCycles);
}

void GeometryController::onFaultAckWrite(Value value) {
	if (toU32(value) == 0u) {
		return;
	}
	const uint32_t status = m_memory.readIoU32(IO_GEO_STATUS) & ~(GEO_STATUS_ERROR | GEO_STATUS_REJECTED);
	m_memory.writeIoValue(IO_GEO_STATUS, valueNumber(static_cast<double>(status)));
	m_memory.writeIoValue(IO_GEO_FAULT, valueNumber(0.0));
	m_memory.writeIoValue(IO_GEO_FAULT_ACK, valueNumber(0.0));
	if (m_phase == GeometryControllerPhase::Error) {
		m_phase = GeometryControllerPhase::Done;
	} else if (m_phase == GeometryControllerPhase::Rejected) {
		m_phase = GeometryControllerPhase::Idle;
	}
}

void GeometryController::scheduleNextService(int64_t nowCycles) {
	if (m_phase != GeometryControllerPhase::Busy) {
		m_scheduler.cancelDeviceService(DeviceServiceGeo);
		return;
	}
	const uint32_t remainingRecords = m_activeJob->count - m_activeJob->processed;
	const uint32_t targetUnits = remainingRecords < GEO_SERVICE_BATCH_RECORDS ? remainingRecords : GEO_SERVICE_BATCH_RECORDS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduler.scheduleDeviceService(DeviceServiceGeo, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DeviceServiceGeo, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, targetUnits - m_availableWorkUnits));
}

bool GeometryController::validateXform2Submission(const GeoJob& job) {
	if (job.param0 != 0u || job.param1 != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != GEO_XFORM2_RECORD_BYTES || job.stride1 != GEO_VERTEX2_BYTES || job.stride2 != GEO_XFORM2_MATRIX_BYTES) {
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
	if (!m_memory.isRamRange(job.dst0, GEO_VERTEX2_BYTES)) {
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
	if (job.stride0 != GEO_SAT2_PAIR_BYTES || job.stride1 != GEO_SAT2_DESC_BYTES || job.stride2 != GEO_VERTEX2_BYTES) {
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
	if (!m_memory.isRamRange(job.dst0, GEO_SAT2_RESULT_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	return true;
}

bool GeometryController::validateOverlap2dSubmission(const GeoJob& job) {
	const uint32_t mode = job.param0 & GEO_OVERLAP2D_MODE_MASK;
	if ((job.param0 & GEO_OVERLAP2D_CONTACT_POLICY_MASK) != GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
		|| (job.param0 & GEO_OVERLAP2D_OUTPUT_POLICY_MASK) != GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW
		|| (job.param0 & GEO_OVERLAP2D_PARAM0_RESERVED_MASK) != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (job.stride0 != GEO_OVERLAP2D_INSTANCE_BYTES) {
		finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
		return false;
	}
	if (job.src2 != 0u) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS) {
		if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) != GEO_OVERLAP2D_BROADPHASE_NONE
			|| job.stride1 != GEO_OVERLAP2D_PAIR_BYTES
			|| job.stride2 == 0u) {
			finishRejected(GEO_FAULT_REJECT_BAD_STRIDE);
			return false;
		}
	} else if (mode == GEO_OVERLAP2D_MODE_FULL_PASS) {
		if ((job.param0 & GEO_OVERLAP2D_BROADPHASE_MASK) != GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
			|| job.src1 != 0u
			|| job.stride1 != 0u
			|| job.stride2 != 0u
			|| job.count > GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) {
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
	if (!m_memory.isRamRange(job.dst1, GEO_OVERLAP2D_SUMMARY_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	if (!m_memory.isRamRange(job.dst0, GEO_OVERLAP2D_RESULT_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_DST_NOT_RAM);
		return false;
	}
	if (job.count == 0u) {
		return true;
	}
	if (mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS && !m_memory.isReadableMainMemoryRange(job.src1, GEO_OVERLAP2D_PAIR_BYTES)) {
		finishRejected(GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
		return false;
	}
	const uint32_t instanceCount = mode == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS ? job.stride2 : job.count;
	const std::optional<uint32_t> lastInstanceAddr = resolveIndexedSpan(job.src0, instanceCount - 1u, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
	if (!lastInstanceAddr.has_value() || !m_memory.isReadableMainMemoryRange(*lastInstanceAddr, GEO_OVERLAP2D_INSTANCE_BYTES)) {
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
	const std::optional<uint32_t> pairAddr = resolveIndexedSpan(job.src1, recordIndex, job.stride1, GEO_OVERLAP2D_PAIR_BYTES);
	if (!pairAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pairAddr, GEO_OVERLAP2D_PAIR_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t instanceAIndex = m_memory.readU32(*pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET);
	const uint32_t instanceBIndex = m_memory.readU32(*pairAddr + GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET);
	const uint32_t pairMeta = m_memory.readU32(*pairAddr + GEO_OVERLAP2D_PAIR_META_OFFSET);
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
		const uint32_t pairMeta = ((recordIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK) << GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT)
			| (instanceBIndex & GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK);
		if (!processOverlap2dPair(job, recordIndex, m_overlapInstanceA, m_overlapInstanceB, pairMeta)) {
			return;
		}
	}
	writeOverlap2dSummary(job, 0u);
	completeRecord(job);
}

bool GeometryController::readOverlapInstanceAt(const GeoJob& job, uint32_t instanceIndex, std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& out) const {
	const std::optional<uint32_t> instanceAddr = resolveIndexedSpan(job.src0, instanceIndex, job.stride0, GEO_OVERLAP2D_INSTANCE_BYTES);
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

bool GeometryController::processOverlap2dPair(GeoJob& job, uint32_t recordIndex, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceA, const std::array<uint32_t, GEO_OVERLAP2D_INSTANCE_WORDS>& instanceB, uint32_t pairMeta) {
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
		|| (shapeAIsCompound && (shapeADataOffset & WORD_ALIGN_MASK) != 0u)
		|| (shapeBIsCompound && (shapeBDataOffset & WORD_ALIGN_MASK) != 0u)
		|| (!shapeAIsCompound && shapeAKind != GEO_PRIMITIVE_AABB && shapeAKind != GEO_PRIMITIVE_CONVEX_POLY)
		|| (!shapeBIsCompound && shapeBKind != GEO_PRIMITIVE_AABB && shapeBKind != GEO_PRIMITIVE_CONVEX_POLY)) {
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
		const std::optional<uint32_t> pieceAAddr = shapeAIsCompound
			? resolveByteOffset(shapeAAddr, static_cast<uint64_t>(shapeADataOffset) + (static_cast<uint64_t>(pieceAIndex) * GEO_OVERLAP2D_SHAPE_DESC_BYTES), GEO_OVERLAP2D_SHAPE_DESC_BYTES)
			: std::optional<uint32_t>(shapeAAddr);
		if (!pieceAAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pieceAAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
			finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		if (!readPieceBounds(*pieceAAddr, txA, tyA, m_overlapBoundsA)) {
			finishError(GEO_FAULT_SRC_RANGE, recordIndex);
			return false;
		}
		for (uint32_t pieceBIndex = 0u; pieceBIndex < shapeBPieceCount; pieceBIndex += 1u) {
			const std::optional<uint32_t> pieceBAddr = shapeBIsCompound
				? resolveByteOffset(shapeBAddr, static_cast<uint64_t>(shapeBDataOffset) + (static_cast<uint64_t>(pieceBIndex) * GEO_OVERLAP2D_SHAPE_DESC_BYTES), GEO_OVERLAP2D_SHAPE_DESC_BYTES)
				: std::optional<uint32_t>(shapeBAddr);
			if (!pieceBAddr.has_value() || !m_memory.isReadableMainMemoryRange(*pieceBAddr, GEO_OVERLAP2D_SHAPE_DESC_BYTES)) {
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
	const std::optional<uint32_t> resultAddr = resolveIndexedSpan(job.dst0, job.resultCount, GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, GEO_OVERLAP2D_RESULT_BYTES)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return false;
	}
	writeOverlap2dResult(*resultAddr, bestNx, bestNy, bestDepth, bestPx, bestPy, bestPieceA, bestPieceB, bestFeatureMeta, pairMeta);
	job.resultCount += 1u;
	return true;
}

void GeometryController::processXform2Record(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> recordAddr = resolveIndexedSpan(job.src0, recordIndex, job.stride0, GEO_XFORM2_RECORD_BYTES);
	if (!recordAddr.has_value()) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*recordAddr, GEO_XFORM2_RECORD_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t flags = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_FLAGS_OFFSET);
	const uint32_t srcIndex = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET);
	const uint32_t dstIndex = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET);
	const uint32_t auxIndex = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET);
	const uint32_t vertexCount = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET);
	const uint32_t dst1Index = m_memory.readU32(*recordAddr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET);
	if (flags != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	if (vertexCount == 0u) {
		completeRecord(job);
		return;
	}
	if (vertexCount > (std::numeric_limits<uint32_t>::max() / GEO_VERTEX2_BYTES)) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	const uint32_t vertexBytes = vertexCount * GEO_VERTEX2_BYTES;
	const std::optional<uint32_t> srcAddr = resolveIndexedSpan(job.src1, srcIndex, job.stride1, vertexBytes);
	if (!srcAddr.has_value() || !m_memory.isReadableMainMemoryRange(*srcAddr, vertexBytes)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> matrixAddr = resolveIndexedSpan(job.src2, auxIndex, job.stride2, GEO_XFORM2_MATRIX_BYTES);
	if (!matrixAddr.has_value() || !m_memory.isReadableMainMemoryRange(*matrixAddr, GEO_XFORM2_MATRIX_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> dstAddr = resolveIndexedSpan(job.dst0, dstIndex, GEO_VERTEX2_BYTES, vertexBytes);
	if (!dstAddr.has_value() || !m_memory.isRamRange(*dstAddr, vertexBytes)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return;
	}
	uint32_t aabbAddr = 0u;
	if (dst1Index != GEO_INDEX_NONE) {
		const std::optional<uint32_t> resolvedAabbAddr = resolveIndexedSpan(job.dst1, dst1Index, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_AABB_BYTES);
		if (!resolvedAabbAddr.has_value() || !m_memory.isRamRange(*resolvedAabbAddr, GEO_XFORM2_AABB_BYTES)) {
			finishError(GEO_FAULT_DST_RANGE, recordIndex);
			return;
		}
		aabbAddr = *resolvedAabbAddr;
	}
	const int32_t m00 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M00_OFFSET));
	const int32_t m01 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M01_OFFSET));
	const int32_t tx = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_TX_OFFSET));
	const int32_t m10 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M10_OFFSET));
	const int32_t m11 = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_M11_OFFSET));
	const int32_t ty = toSignedWord(m_memory.readU32(*matrixAddr + GEO_XFORM2_MATRIX_TY_OFFSET));
	int32_t minX = 0;
	int32_t minY = 0;
	int32_t maxX = 0;
	int32_t maxY = 0;
	for (uint32_t vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1u) {
		const uint32_t localAddr = *srcAddr + vertexIndex * GEO_VERTEX2_BYTES;
		const uint32_t worldAddr = *dstAddr + vertexIndex * GEO_VERTEX2_BYTES;
		const int32_t localX = toSignedWord(m_memory.readU32(localAddr + GEO_VERTEX2_X_OFFSET));
		const int32_t localY = toSignedWord(m_memory.readU32(localAddr + GEO_VERTEX2_Y_OFFSET));
		const int32_t worldX = transformFixed16(m00, m01, tx, localX, localY);
		const int32_t worldY = transformFixed16(m10, m11, ty, localX, localY);
		m_memory.writeU32(worldAddr + GEO_VERTEX2_X_OFFSET, static_cast<uint32_t>(worldX));
		m_memory.writeU32(worldAddr + GEO_VERTEX2_Y_OFFSET, static_cast<uint32_t>(worldY));
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
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MIN_X_OFFSET, static_cast<uint32_t>(minX));
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MIN_Y_OFFSET, static_cast<uint32_t>(minY));
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MAX_X_OFFSET, static_cast<uint32_t>(maxX));
		m_memory.writeU32(aabbAddr + GEO_XFORM2_AABB_MAX_Y_OFFSET, static_cast<uint32_t>(maxY));
	}
	completeRecord(job);
}

void GeometryController::processSat2Record(GeoJob& job) {
	const uint32_t recordIndex = job.processed;
	const std::optional<uint32_t> pairAddr = resolveIndexedSpan(job.src0, recordIndex, job.stride0, GEO_SAT2_PAIR_BYTES);
	if (!pairAddr.has_value()) {
		finishError(GEO_FAULT_BAD_RECORD_ALIGNMENT, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*pairAddr, GEO_SAT2_PAIR_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	const uint32_t flags = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_FLAGS_OFFSET);
	const uint32_t shapeAIndex = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET);
	const uint32_t resultIndex = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_RESULT_INDEX_OFFSET);
	const uint32_t shapeBIndex = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET);
	const uint32_t pairFlags = m_memory.readU32(*pairAddr + GEO_SAT2_PAIR_FLAGS2_OFFSET);
	if (flags != 0u || pairFlags != 0u) {
		finishError(GEO_FAULT_BAD_RECORD_FLAGS, recordIndex);
		return;
	}
	const std::optional<uint32_t> resultAddr = resolveIndexedSpan(job.dst0, resultIndex, GEO_SAT2_RESULT_BYTES, GEO_SAT2_RESULT_BYTES);
	if (!resultAddr.has_value() || !m_memory.isRamRange(*resultAddr, GEO_SAT2_RESULT_BYTES)) {
		finishError(GEO_FAULT_DST_RANGE, recordIndex);
		return;
	}
	const std::optional<uint32_t> shapeADescAddr = resolveIndexedSpan(job.src1, shapeAIndex, job.stride1, GEO_SAT2_DESC_BYTES);
	const std::optional<uint32_t> shapeBDescAddr = resolveIndexedSpan(job.src1, shapeBIndex, job.stride1, GEO_SAT2_DESC_BYTES);
	if (!shapeADescAddr.has_value() || !shapeBDescAddr.has_value()) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
	}
	if (!m_memory.isReadableMainMemoryRange(*shapeADescAddr, GEO_SAT2_DESC_BYTES)
		|| !m_memory.isReadableMainMemoryRange(*shapeBDescAddr, GEO_SAT2_DESC_BYTES)) {
		finishError(GEO_FAULT_SRC_RANGE, recordIndex);
		return;
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
	if (shapeAVertexCount > (std::numeric_limits<uint32_t>::max() / GEO_VERTEX2_BYTES)
		|| shapeBVertexCount > (std::numeric_limits<uint32_t>::max() / GEO_VERTEX2_BYTES)) {
		finishError(GEO_FAULT_BAD_VERTEX_COUNT, recordIndex);
		return;
	}
	const uint32_t shapeAVertexBytes = shapeAVertexCount * GEO_VERTEX2_BYTES;
	const uint32_t shapeBVertexBytes = shapeBVertexCount * GEO_VERTEX2_BYTES;
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
		const uint32_t vertexAddr = *shapeAVertexAddr + vertexIndex * GEO_VERTEX2_BYTES;
		centerAX += toSignedWord(m_memory.readU32(vertexAddr + GEO_VERTEX2_X_OFFSET));
		centerAY += toSignedWord(m_memory.readU32(vertexAddr + GEO_VERTEX2_Y_OFFSET));
	}
	double centerBX = 0.0;
	double centerBY = 0.0;
	for (uint32_t vertexIndex = 0; vertexIndex < shapeBVertexCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *shapeBVertexAddr + vertexIndex * GEO_VERTEX2_BYTES;
		centerBX += toSignedWord(m_memory.readU32(vertexAddr + GEO_VERTEX2_X_OFFSET));
		centerBY += toSignedWord(m_memory.readU32(vertexAddr + GEO_VERTEX2_Y_OFFSET));
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
				projectVertexSpanInto(*shapeAVertexAddr, shapeAVertexCount, ax, ay, m_overlapProjectionA);
				projectVertexSpanInto(*shapeBVertexAddr, shapeBVertexCount, ax, ay, m_overlapProjectionB);
				const double sepA = m_overlapProjectionA.min - m_overlapProjectionB.max;
				const double sepB = m_overlapProjectionB.min - m_overlapProjectionA.max;
			if (sepA > 0.0 || sepB > 0.0) {
				writeSat2Result(*resultAddr, 0u, 0, 0, 0, 0u);
				completeRecord(job);
				return;
			}
				const double overlap = std::min(m_overlapProjectionA.max, m_overlapProjectionB.max) - std::max(m_overlapProjectionA.min, m_overlapProjectionB.min);
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
	const double deltaX = centerBX - centerAX;
	const double deltaY = centerBY - centerAY;
	if (((deltaX * bestAxisX) + (deltaY * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	writeSat2Result(
		*resultAddr,
		1u,
		saturateRoundedI32(bestAxisX * FIX16_SCALE),
		saturateRoundedI32(bestAxisY * FIX16_SCALE),
		saturateRoundedI32(bestOverlap),
		packSat2Meta(bestAxisIndex, bestShapeSelector)
	);
	completeRecord(job);
}


bool GeometryController::readPieceBounds(uint32_t pieceAddr, double tx, double ty, std::array<double, 4>& out) const {
	const uint32_t boundsOffset = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET);
	const std::optional<uint32_t> boundsAddr = resolveByteOffset(pieceAddr, boundsOffset, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
	if (!boundsAddr.has_value() || !m_memory.isReadableMainMemoryRange(*boundsAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
		return false;
	}
	out[0] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET)) + tx;
	out[1] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET)) + ty;
	out[2] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET)) + tx;
	out[3] = static_cast<double>(readF32(*boundsAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET)) + ty;
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
	const uint32_t primitiveA = m_memory.readU32(pieceAAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	const uint32_t primitiveB = m_memory.readU32(pieceBAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
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
	const uint32_t primitive = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	const uint32_t dataCount = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
	const uint32_t dataOffset = m_memory.readU32(pieceAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
	const uint64_t byteLength = primitive == GEO_PRIMITIVE_AABB ? GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES : static_cast<uint64_t>(dataCount) * GEO_VERTEX2_BYTES;
	const std::optional<uint32_t> dataAddr = resolveByteOffset(pieceAddr, dataOffset, byteLength);
	if (!dataAddr.has_value()) {
		return false;
	}
	out.clear();
	if (primitive == GEO_PRIMITIVE_AABB) {
		if (dataCount != GEO_OVERLAP2D_AABB_DATA_COUNT || !m_memory.isReadableMainMemoryRange(*dataAddr, GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES)) {
			return false;
		}
		const double left = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET));
		const double top = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET));
		const double right = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET));
		const double bottom = static_cast<double>(readF32(*dataAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET));
		pushWorldVertex(out, tx, ty, left, top);
		pushWorldVertex(out, tx, ty, right, top);
		pushWorldVertex(out, tx, ty, right, bottom);
		pushWorldVertex(out, tx, ty, left, bottom);
		return true;
	}
	if (primitive != GEO_PRIMITIVE_CONVEX_POLY || dataCount < 3u || !m_memory.isReadableMainMemoryRange(*dataAddr, byteLength)) {
		return false;
	}
	for (uint32_t vertexIndex = 0u; vertexIndex < dataCount; vertexIndex += 1u) {
		const uint32_t vertexAddr = *dataAddr + vertexIndex * GEO_VERTEX2_BYTES;
		pushWorldVertex(out, tx, ty, readF32(vertexAddr + GEO_VERTEX2_X_OFFSET), readF32(vertexAddr + GEO_VERTEX2_Y_OFFSET));
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
			projectPolyInto(polyA, ax, ay, m_overlapProjectionA);
			projectPolyInto(polyB, ax, ay, m_overlapProjectionB);
			const double overlap = std::min(m_overlapProjectionA.max, m_overlapProjectionB.max) - std::max(m_overlapProjectionA.min, m_overlapProjectionB.min);
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
	computePolyAverageInto(polyA, m_overlapCenterA);
	computePolyAverageInto(polyB, m_overlapCenterB);
	if ((((m_overlapCenterA.x - m_overlapCenterB.x) * bestAxisX) + ((m_overlapCenterA.y - m_overlapCenterB.y) * bestAxisY)) < 0.0) {
		bestAxisX = -bestAxisX;
		bestAxisY = -bestAxisY;
	}
	const std::vector<double>& intersection = clipConvexPolygons(polyA, polyB);
	double pointX = 0.0;
	double pointY = 0.0;
	if (intersection.empty()) {
		pointX = (m_overlapCenterA.x + m_overlapCenterB.x) * 0.5;
		pointY = (m_overlapCenterA.y + m_overlapCenterB.y) * 0.5;
	} else {
		computePolyAverageInto(intersection, m_overlapCentroid);
		pointX = m_overlapCentroid.x;
		pointY = m_overlapCentroid.y;
	}
	m_overlapContactNx = bestAxisX;
	m_overlapContactNy = bestAxisY;
	m_overlapContactDepth = bestOverlap;
	m_overlapContactPx = pointX;
	m_overlapContactPy = pointY;
	m_overlapContactFeatureMeta = bestEdgeIndex;
	return true;
}

void GeometryController::projectVertexSpanInto(uint32_t base, uint32_t count, double ax, double ay, ProjectionScratch& out) const {
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

void GeometryController::projectPolyInto(const std::vector<double>& poly, double ax, double ay, ProjectionScratch& out) {
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
	out.min = min;
	out.max = max;
}

void GeometryController::computePolyAverageInto(const std::vector<double>& poly, PointScratch& out) {
	double sumX = 0.0;
	double sumY = 0.0;
	const double count = static_cast<double>(poly.size() >> 1u);
	for (size_t i = 0; i < poly.size(); i += 2u) {
		sumX += poly[i];
		sumY += poly[i + 1u];
	}
	out.x = sumX / count;
	out.y = sumY / count;
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
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET, job.resultCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET, job.exactPairCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET, job.broadphasePairCount);
	m_memory.writeU32(job.dst1 + GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET, flags);
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

std::optional<uint32_t> GeometryController::resolveByteOffset(uint32_t base, uint64_t offset, uint64_t byteLength) const {
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

float GeometryController::readF32(uint32_t addr) const {
	return f32BitsToNumber(m_memory.readU32(addr));
}

void GeometryController::completeRecord(GeoJob& job) {
	job.processed += 1u;
	m_memory.writeValue(IO_GEO_PROCESSED, valueNumber(static_cast<double>(job.processed)));
	if (job.processed >= job.count) {
		finishSuccess(job.processed);
	}
}

void GeometryController::finishSuccess(uint32_t processed) {
	m_phase = GeometryControllerPhase::Done;
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_scheduler.cancelDeviceService(DeviceServiceGeo);
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(static_cast<double>(GEO_STATUS_DONE)));
	m_memory.writeValue(IO_GEO_PROCESSED, valueNumber(static_cast<double>(processed)));
	m_memory.writeValue(IO_GEO_FAULT, valueNumber(static_cast<double>(0u)));
	m_irq.raise(IRQ_GEO_DONE);
}

void GeometryController::finishError(uint32_t code, uint32_t recordIndex, bool signalIrq) {
	m_phase = GeometryControllerPhase::Error;
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_scheduler.cancelDeviceService(DeviceServiceGeo);
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(static_cast<double>(GEO_STATUS_DONE | GEO_STATUS_ERROR)));
	m_memory.writeValue(IO_GEO_FAULT, valueNumber(static_cast<double>(packFault(code, recordIndex))));
	if (signalIrq) {
		m_irq.raise(IRQ_GEO_ERROR);
	}
}

void GeometryController::finishRejected(uint32_t code) {
	m_phase = GeometryControllerPhase::Rejected;
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_scheduler.cancelDeviceService(DeviceServiceGeo);
	m_memory.writeValue(IO_GEO_STATUS, valueNumber(static_cast<double>(GEO_STATUS_REJECTED)));
	m_memory.writeValue(IO_GEO_PROCESSED, valueNumber(static_cast<double>(0u)));
	m_memory.writeValue(IO_GEO_FAULT, valueNumber(static_cast<double>(packFault(code, GEO_FAULT_RECORD_INDEX_NONE))));
	m_irq.raise(IRQ_GEO_ERROR);
}

std::optional<uint32_t> GeometryController::resolveIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint64_t byteLength) const {
	return resolveByteOffset(base, static_cast<uint64_t>(index) * static_cast<uint64_t>(stride), byteLength);
}

void GeometryController::writeSat2Result(uint32_t addr, uint32_t hit, int32_t nx, int32_t ny, int32_t depth, uint32_t meta) {
	m_memory.writeU32(addr + GEO_SAT2_RESULT_HIT_OFFSET, hit);
	m_memory.writeU32(addr + GEO_SAT2_RESULT_NX_OFFSET, static_cast<uint32_t>(nx));
	m_memory.writeU32(addr + GEO_SAT2_RESULT_NY_OFFSET, static_cast<uint32_t>(ny));
	m_memory.writeU32(addr + GEO_SAT2_RESULT_DEPTH_OFFSET, static_cast<uint32_t>(depth));
	m_memory.writeU32(addr + GEO_SAT2_RESULT_META_OFFSET, meta);
}

} // namespace bmsx
