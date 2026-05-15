#include "machine/devices/geometry/controller.h"

#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/budget.h"

namespace bmsx {
namespace {

constexpr uint32_t GEO_SERVICE_BATCH_RECORDS = 1u;

uint32_t packFault(uint32_t code, uint32_t recordIndex) {
	return ((code & GEO_FAULT_CODE_MASK) << GEO_FAULT_CODE_SHIFT) | (recordIndex & GEO_FAULT_RECORD_INDEX_MASK);
}

} // namespace

GeometryController::GeometryController(
	Memory& memory,
	IrqController& irq,
	DeviceScheduler& scheduler
)
	: m_memory(memory)
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_xform2(memory)
	, m_sat2(memory)
	, m_overlap2d(memory) {
	m_memory.mapIoWrite(IO_GEO_CMD, this, &GeometryController::onCommandWriteThunk);
	m_memory.mapIoWrite(IO_GEO_CTRL, this, &GeometryController::onCtrlWriteThunk);
	m_memory.mapIoWrite(IO_GEO_FAULT_ACK, this, &GeometryController::onFaultAckWriteThunk);
}

void GeometryController::onCommandWriteThunk(void* context, uint32_t, Value value) {
	auto* controller = static_cast<GeometryController*>(context);
	controller->onCommandDoorbell(controller->m_scheduler.currentNowCycles(), toU32(value));
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
	m_memory.writeIoValue(IO_GEO_CMD, valueNumber(static_cast<double>(0)));
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

void GeometryController::onCtrlWrite(int64_t) {
	const uint32_t ctrl = m_memory.readIoU32(IO_GEO_CTRL);
	const bool abort = (ctrl & GEO_CTRL_ABORT) != 0u;
	if (!abort) {
		return;
	}
	m_memory.writeIoValue(IO_GEO_CTRL, valueNumber(static_cast<double>(ctrl & ~GEO_CTRL_ABORT)));
	if (m_phase == GeometryControllerPhase::Error || m_phase == GeometryControllerPhase::Rejected) {
		return;
	}
	if (m_phase == GeometryControllerPhase::Busy) {
		finishError(GEO_FAULT_ABORTED_BY_HOST, m_activeJob->processed);
	}
}

void GeometryController::onCommandDoorbell(int64_t nowCycles, uint32_t command) {
	if (m_phase == GeometryControllerPhase::Error || m_phase == GeometryControllerPhase::Rejected) {
		return;
	}
	if (m_phase == GeometryControllerPhase::Busy) {
		finishRejected(GEO_FAULT_REJECT_BUSY);
		return;
	}
	tryStart(nowCycles, command);
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
			case IO_CMD_GEO_XFORM2_BATCH: {
				const uint32_t fault = m_xform2.processRecord(*m_activeJob);
				if (fault != 0u) {
					finishError(fault, m_activeJob->processed);
				} else {
					completeRecord(*m_activeJob);
				}
				break;
			}
			case IO_CMD_GEO_SAT2_BATCH: {
				const uint32_t fault = m_sat2.processRecord(*m_activeJob);
				if (fault != 0u) {
					finishError(fault, m_activeJob->processed);
				} else {
					completeRecord(*m_activeJob);
				}
				break;
			}
			case IO_CMD_GEO_OVERLAP2D_PASS: {
				const uint32_t fault = m_overlap2d.processRecord(*m_activeJob);
				if (fault != 0u) {
					finishError(fault, m_activeJob->processed);
				} else {
					completeRecord(*m_activeJob);
				}
				break;
			}
			default:
				finishRejected(GEO_FAULT_REJECT_BAD_CMD);
				return;
		}
		remaining -= 1u;
	}
	m_availableWorkUnits = m_phase == GeometryControllerPhase::Busy ? remaining : 0u;
	scheduleNextService(nowCycles);
}

void GeometryController::tryStart(int64_t nowCycles, uint32_t command) {
	GeoJob job;
	job.cmd = command;
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
		case IO_CMD_GEO_XFORM2_BATCH: {
			const uint32_t rejectFault = m_xform2.validateSubmission(job);
			if (rejectFault != 0u) {
				finishRejected(rejectFault);
				return;
			}
			break;
		}
		case IO_CMD_GEO_SAT2_BATCH: {
			const uint32_t rejectFault = m_sat2.validateSubmission(job);
			if (rejectFault != 0u) {
				finishRejected(rejectFault);
				return;
			}
			break;
		}
		case IO_CMD_GEO_OVERLAP2D_PASS: {
			const uint32_t rejectFault = m_overlap2d.validateSubmission(job);
			if (rejectFault != 0u) {
				finishRejected(rejectFault);
				return;
			}
			break;
		}
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
		m_overlap2d.writeSummary(job, 0u);
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

} // namespace bmsx
