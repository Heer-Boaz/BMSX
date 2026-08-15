#include "machine/devices/geometry/controller.h"

#include "spec/bmsx/io.h"
#include "machine/common/numeric.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/budget.h"

#include <cstddef>

namespace bmsx {
namespace {

constexpr uint32_t GEO_SERVICE_BATCH_RECORDS = 1u;
constexpr std::size_t GEO_REGISTER_SRC0 = (IO_GEO_SRC0 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_SRC1 = (IO_GEO_SRC1 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_SRC2 = (IO_GEO_SRC2 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_DST0 = (IO_GEO_DST0 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_DST1 = (IO_GEO_DST1 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_COUNT = (IO_GEO_COUNT - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_CMD = (IO_GEO_CMD - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_CTRL = (IO_GEO_CTRL - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_STATUS = (IO_GEO_STATUS - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_PARAM0 = (IO_GEO_PARAM0 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_PARAM1 = (IO_GEO_PARAM1 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_STRIDE0 = (IO_GEO_STRIDE0 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_STRIDE1 = (IO_GEO_STRIDE1 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_STRIDE2 = (IO_GEO_STRIDE2 - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_PROCESSED = (IO_GEO_PROCESSED - IO_GEO_BASE) / IO_WORD_SIZE;
constexpr std::size_t GEO_REGISTER_FAULT = (IO_GEO_FAULT - IO_GEO_BASE) / IO_WORD_SIZE;

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
	for (uint32_t address = IO_GEO_SRC0; address <= IO_GEO_COUNT; address += IO_WORD_SIZE) {
		m_memory.mapIoWrite(address, this, &GeometryController::onConfigWriteThunk);
	}
	for (uint32_t address = IO_GEO_PARAM0; address <= IO_GEO_STRIDE2; address += IO_WORD_SIZE) {
		m_memory.mapIoWrite(address, this, &GeometryController::onConfigWriteThunk);
	}
	m_memory.mapIoWrite(IO_GEO_CMD, this, &GeometryController::onCommandWriteThunk);
	m_memory.mapIoWriteReady(IO_GEO_CMD, &GeometryController::commandWriteReadyThunk);
	m_memory.mapIoWrite(IO_GEO_CTRL, this, &GeometryController::onCtrlWriteThunk);
	m_memory.mapIoWrite(IO_GEO_FAULT_ACK, this, &GeometryController::onFaultAckWriteThunk);
}

bool GeometryController::commandWriteReadyThunk(void* context, uint32_t, MappedBusSignals) {
	return !static_cast<GeometryController*>(context)->m_supervisorQuiesceRequested;
}

void GeometryController::onConfigWriteThunk(void* context, uint32_t address, u32 value, MappedBusSignals) {
	auto* controller = static_cast<GeometryController*>(context);
	controller->m_registerWords[(address - IO_GEO_BASE) / IO_WORD_SIZE] = value;
}

void GeometryController::onCommandWriteThunk(void* context, uint32_t, u32 value, MappedBusSignals) {
	auto* controller = static_cast<GeometryController*>(context);
	controller->m_registerWords[GEO_REGISTER_CMD] = value;
	controller->onCommandDoorbell(controller->m_scheduler.currentNowCycles(), value);
}

void GeometryController::onCtrlWriteThunk(void* context, uint32_t, u32 value, MappedBusSignals) {
	auto* controller = static_cast<GeometryController*>(context);
	controller->m_registerWords[GEO_REGISTER_CTRL] = value;
	controller->onCtrlWrite();
}

void GeometryController::onFaultAckWriteThunk(void* context, uint32_t, u32 value, MappedBusSignals) {
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

	BudgetAccrual accrual;
	accrueBudgetUnits(accrual, m_cpuHz, m_workUnitsPerSec, m_workCarry, cycles);
	m_workCarry = accrual.carry;
	if (accrual.wholeUnits > 0) {
		const uint32_t remainingRecords = m_activeJob->count - m_activeJob->processed;
		const int64_t maxGrant = static_cast<int64_t>(remainingRecords - m_availableWorkUnits);
		const int64_t granted = accrual.wholeUnits > maxGrant ? maxGrant : accrual.wholeUnits;
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
	m_supervisorQuiesceRequested = false;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
	m_registerWords.fill(0u);
	mirrorRegisters();
	m_memory.writeIoU32(IO_GEO_FAULT_ACK, 0u);
}

void GeometryController::beginSupervisorQuiesce() {
	m_supervisorQuiesceRequested = true;
	notifySupervisorBoundary();
}

void GeometryController::leaveSupervisorContext() {
	m_supervisorQuiesceRequested = false;
}

void GeometryController::notifySupervisorBoundary() {
	if (m_supervisorQuiesceRequested) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

void GeometryController::onCtrlWrite() {
	const uint32_t ctrl = m_registerWords[GEO_REGISTER_CTRL];
	const bool abort = (ctrl & GEO_CTRL_ABORT) != 0u;
	if (!abort) {
		return;
	}
	m_registerWords[GEO_REGISTER_CTRL] = ctrl & ~GEO_CTRL_ABORT;
	m_memory.writeIoU32(IO_GEO_CTRL, m_registerWords[GEO_REGISTER_CTRL]);
	if (m_phase == GeometryControllerPhase::Error || m_phase == GeometryControllerPhase::Rejected) {
		return;
	}
	if (m_phase == GeometryControllerPhase::Busy) {
		finishError(GEO_FAULT_ABORTED, m_activeJob->processed);
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
	start(nowCycles, command);
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

void GeometryController::start(int64_t nowCycles, uint32_t command) {
	GeoJob job;
	job.cmd = command;
	job.src0 = m_registerWords[GEO_REGISTER_SRC0];
	job.src1 = m_registerWords[GEO_REGISTER_SRC1];
	job.src2 = m_registerWords[GEO_REGISTER_SRC2];
	job.dst0 = m_registerWords[GEO_REGISTER_DST0];
	job.dst1 = m_registerWords[GEO_REGISTER_DST1];
	job.count = m_registerWords[GEO_REGISTER_COUNT];
	job.param0 = m_registerWords[GEO_REGISTER_PARAM0];
	job.param1 = m_registerWords[GEO_REGISTER_PARAM1];
	job.stride0 = m_registerWords[GEO_REGISTER_STRIDE0];
	job.stride1 = m_registerWords[GEO_REGISTER_STRIDE1];
	job.stride2 = m_registerWords[GEO_REGISTER_STRIDE2];
	switch (job.cmd) {
		case IO_CMD_GEO_XFORM2_BATCH:
		case IO_CMD_GEO_SAT2_BATCH:
		case IO_CMD_GEO_OVERLAP2D_PASS:
			break;
		default:
			finishRejected(GEO_FAULT_REJECT_BAD_CMD);
			return;
	}
	latchResultRegisters(0u, 0u, 0u);
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
	m_registerWords[GEO_REGISTER_STATUS] = GEO_STATUS_BUSY;
	m_memory.writeIoU32(IO_GEO_STATUS, m_registerWords[GEO_REGISTER_STATUS]);
	scheduleNextService(nowCycles);
}

void GeometryController::onFaultAckWrite(u32 value) {
	if (value == 0u) {
		return;
	}
	const uint32_t status = m_registerWords[GEO_REGISTER_STATUS]
		& ~(GEO_STATUS_ERROR | GEO_STATUS_REJECTED);
	m_registerWords[GEO_REGISTER_STATUS] = status;
	m_registerWords[GEO_REGISTER_FAULT] = 0u;
	m_memory.writeIoU32(IO_GEO_STATUS, status);
	m_memory.writeIoU32(IO_GEO_FAULT, 0u);
	m_memory.writeIoU32(IO_GEO_FAULT_ACK, 0u);
	if (m_phase == GeometryControllerPhase::Error) {
		m_phase = GeometryControllerPhase::Done;
	} else if (m_phase == GeometryControllerPhase::Rejected) {
		m_phase = GeometryControllerPhase::Idle;
	}
}

void GeometryController::scheduleNextService(int64_t nowCycles) {
	if (m_phase != GeometryControllerPhase::Busy) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
		return;
	}
	const uint32_t remainingRecords = m_activeJob->count - m_activeJob->processed;
	const uint32_t targetUnits = remainingRecords < GEO_SERVICE_BATCH_RECORDS ? remainingRecords : GEO_SERVICE_BATCH_RECORDS;
	if (m_availableWorkUnits >= targetUnits) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_GEO, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_GEO, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, targetUnits - m_availableWorkUnits));
}

void GeometryController::completeRecord(GeoJob& job) {
	job.processed += 1u;
	m_registerWords[GEO_REGISTER_PROCESSED] = job.processed;
	m_memory.writeIoU32(IO_GEO_PROCESSED, m_registerWords[GEO_REGISTER_PROCESSED]);
	if (job.processed >= job.count) {
		finishSuccess(job.processed);
	}
}

void GeometryController::finishSuccess(uint32_t processed) {
	m_phase = GeometryControllerPhase::Done;
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
	latchResultRegisters(GEO_STATUS_DONE, processed, 0u);
	m_irq.raise(IRQ_GEO_DONE);
	notifySupervisorBoundary();
}

void GeometryController::finishError(uint32_t code, uint32_t recordIndex) {
	m_phase = GeometryControllerPhase::Error;
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
	m_registerWords[GEO_REGISTER_STATUS] = GEO_STATUS_DONE | GEO_STATUS_ERROR;
	m_registerWords[GEO_REGISTER_FAULT] = packFault(code, recordIndex);
	m_memory.writeIoU32(IO_GEO_STATUS, m_registerWords[GEO_REGISTER_STATUS]);
	m_memory.writeIoU32(IO_GEO_FAULT, m_registerWords[GEO_REGISTER_FAULT]);
	m_irq.raise(IRQ_GEO_ERROR);
	notifySupervisorBoundary();
}

void GeometryController::finishRejected(uint32_t code) {
	m_phase = GeometryControllerPhase::Rejected;
	m_activeJob.reset();
	m_workCarry = 0;
	m_availableWorkUnits = 0u;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
	latchResultRegisters(
		GEO_STATUS_REJECTED,
		0u,
		packFault(code, GEO_FAULT_RECORD_INDEX_NONE));
	m_irq.raise(IRQ_GEO_ERROR);
	notifySupervisorBoundary();
}

void GeometryController::latchResultRegisters(u32 status, u32 processed, u32 fault) {
	m_registerWords[GEO_REGISTER_STATUS] = status;
	m_registerWords[GEO_REGISTER_PROCESSED] = processed;
	m_registerWords[GEO_REGISTER_FAULT] = fault;
	m_memory.writeIoU32(IO_GEO_STATUS, m_registerWords[GEO_REGISTER_STATUS]);
	m_memory.writeIoU32(IO_GEO_PROCESSED, m_registerWords[GEO_REGISTER_PROCESSED]);
	m_memory.writeIoU32(IO_GEO_FAULT, m_registerWords[GEO_REGISTER_FAULT]);
}

void GeometryController::mirrorRegisters() {
	for (std::size_t index = 0u; index < GEOMETRY_CONTROLLER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoU32(IO_GEO_REGISTER_ADDRS[index], m_registerWords[index]);
	}
}

} // namespace bmsx
