#include "machine/devices/geometry/controller.h"

#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "machine/common/numeric.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/budget.h"

#include <cstddef>

#if defined(BMSX_DIAGNOSTIC_GEO)
#include "common/scope_exit.h"
#include <time.h>
#endif

namespace bmsx {
namespace {

constexpr u32 GEO_OVERLAP_PAIR_HEADER_WORDS = GEO_OVERLAP2D_INSTANCE_WORDS
	+ 2u * (GEO_OVERLAP2D_SHAPE_DESC_BYTES + GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES) / IO_WORD_SIZE;
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

void GeometryController::setTiming(int64_t cpuHz, int64_t workUnitsPerSec) {
	m_cpuHz = cpuHz;
	m_workUnitsPerSec = workUnitsPerSec;
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
	m_xform2.reset();
	m_sat2.reset();
	m_overlap2d.reset();
	m_phase = GeometryControllerPhase::Idle;
	m_workCarry = 0;
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
	switch (m_activeJob->cmd) {
	case IO_CMD_GEO_XFORM2_BATCH:
		serviceRecords(m_xform2, static_cast<u32>(GeometryXform2Phase::Complete), nowCycles);
		break;
	case IO_CMD_GEO_SAT2_BATCH:
		serviceRecords(m_sat2, static_cast<u32>(GeometrySat2Phase::Complete), nowCycles);
		break;
	case IO_CMD_GEO_OVERLAP2D_PASS:
		serviceOverlap(nowCycles);
		break;
	default:
		finishRejected(GEO_FAULT_REJECT_BAD_CMD);
		break;
	}
}

template<class Unit> void GeometryController::serviceRecords(Unit& unit, u32 completePhase, i64 nowCycles) {
	GeoJob& job = *m_activeJob;
	for (;;) {
		const auto& progress = unit.progress();
		if (progress.phase == completePhase) {
			if (progress.pendingFault != 0u) {
				finishError(progress.pendingFault, job.processed);
				return;
			}
			completeRecord(job);
			if (m_phase != GeometryControllerPhase::Busy) return;
			unit.beginJob();
		}
		unit.processStep(job);
		const i64 cycles = intervalCycles(progress.pendingMemory, progress.pendingWorkUnits);
		if (cycles != 0) {
			scheduleInterval(nowCycles + cycles);
			return;
		}
	}
}

i64 GeometryController::intervalCycles(const MemoryWordCounters& memory, i64 workUnits) {
	i64 interval = static_cast<i64>(memory.ramWords) * PSX_DMA_RAM_CYCLES_PER_WORD
		+ static_cast<i64>(memory.systemRomWords) * PSX_DMA_SYSTEM_ROM_CYCLES_PER_WORD
		+ static_cast<i64>(memory.cartridgeWords) * PSX_DMA_CART_ROM_CYCLES_PER_WORD + memory.otherWords;
	if (workUnits != 0) {
		const i64 cycles = cyclesUntilBudgetUnits(m_cpuHz, m_workUnitsPerSec, m_workCarry, workUnits);
		m_workCarry += cycles * m_workUnitsPerSec - workUnits * m_cpuHz;
		interval += cycles;
	}
	return interval;
}

void GeometryController::serviceOverlap(i64 nowCycles) {
#if defined(BMSX_DIAGNOSTIC_GEO)
	timespec start;
	clock_gettime(CLOCK_THREAD_CPUTIME_ID, &start);
	++m_overlapProfile.services;
	ScopeExit measure([&] {
		timespec end;
		clock_gettime(CLOCK_THREAD_CPUTIME_ID, &end);
		m_overlapProfile.threadNs += (end.tv_sec - start.tv_sec) * 1000000000LL + end.tv_nsec - start.tv_nsec;
	});
#endif
	GeoJob& job = *m_activeJob;
	for (;;) {
		const u32 initialPhase = m_overlap2d.progress().phase;
		const bool readingHeaders = initialPhase == 0u || initialPhase == 1u || initialPhase == 5u || initialPhase == 7u;
		i64 interval = 0;
		u32 groupWords = 0u;
		do {
			const bool publishing = m_overlap2d.progress().phase == 4u;
#if defined(BMSX_DIAGNOSTIC_GEO)
			m_overlapProfile.visited += m_overlap2d.progress().phase == 1u;
			const u32 broadBefore = job.broadphasePairCount, exactBefore = job.exactPairCount;
#endif
			const u32 fault = m_overlap2d.processStep(job);
#if defined(BMSX_DIAGNOSTIC_GEO)
			m_overlapProfile.maskPassed += job.broadphasePairCount - broadBefore;
			m_overlapProfile.exact += job.exactPairCount - exactBefore;
#endif
			if (fault != 0u) {
				finishError(fault, job.processed);
				return;
			}
			if (publishing) {
				if (m_overlap2d.progress().phase == 5u && job.count == 0u) {
					finishSuccess(0u);
					return;
				}
				if (m_overlap2d.progress().phase == 0u) {
					completeRecord(job);
					if (m_phase != GeometryControllerPhase::Busy) return;
				}
				break;
			}
			const auto& progress = m_overlap2d.progress();
			const auto& memory = progress.pendingMemory;
			const auto& work = progress.pendingWork;
			groupWords += memory.ramWords + memory.systemRomWords + memory.cartridgeWords + memory.otherWords;
			const i64 units = static_cast<i64>(work.axes) + work.projectionVertices + work.averageVertices + work.clipVertices
				+ work.clipEdges + work.squareRoots + work.divisions;
			interval += intervalCycles(memory, units);
		} while (readingHeaders && ((m_overlap2d.progress().phase == 1u
			&& groupWords + GEO_OVERLAP_PAIR_HEADER_WORDS <= DMA_BURST_WORD_CAPACITY)
			|| (m_overlap2d.progress().phase == 7u && groupWords + 64u <= DMA_BURST_WORD_CAPACITY)));
		if (interval != 0) {
			scheduleInterval(nowCycles + interval);
			return;
		}
	}
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
	if (job.cmd == IO_CMD_GEO_XFORM2_BATCH) m_xform2.beginJob();
	if (job.cmd == IO_CMD_GEO_SAT2_BATCH) m_sat2.beginJob();
	if (job.cmd == IO_CMD_GEO_OVERLAP2D_PASS) {
		job.resultCount = 0u;
		job.exactPairCount = 0u;
		job.broadphasePairCount = 0u;
#if defined(BMSX_DIAGNOSTIC_GEO)
		++m_overlapProfile.passes;
		m_overlapProfile.instances += (job.param0 & GEO_OVERLAP2D_MODE_MASK) == GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS
			? job.stride2 : job.count;
#endif
		m_overlap2d.beginJob(job);
	}
	if (job.count == 0u && job.cmd != IO_CMD_GEO_OVERLAP2D_PASS) {
		finishSuccess(0u);
		return;
	}
	m_workCarry = 0;
	const i64 initialInterval = job.cmd == IO_CMD_GEO_OVERLAP2D_PASS
		? intervalCycles(m_overlap2d.progress().pendingMemory, 0) : 0;
	m_activeJob = job;
	m_phase = GeometryControllerPhase::Busy;
	m_registerWords[GEO_REGISTER_STATUS] = GEO_STATUS_BUSY;
	m_memory.writeIoU32(IO_GEO_STATUS, m_registerWords[GEO_REGISTER_STATUS]);
	scheduleInterval(nowCycles + initialInterval);
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

void GeometryController::scheduleInterval(i64 deadline) {
	m_serviceDeadline = deadline;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_GEO, deadline);
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
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_GEO);
	latchResultRegisters(GEO_STATUS_DONE, processed, 0u);
	m_irq.raise(IRQ_GEO_DONE);
	notifySupervisorBoundary();
}

void GeometryController::finishError(uint32_t code, uint32_t recordIndex) {
	m_phase = GeometryControllerPhase::Error;
	m_activeJob.reset();
	m_workCarry = 0;
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
