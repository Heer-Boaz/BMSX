#include "machine/scheduler/device.h"

#include "common/scope_exit.h"
#include "machine/cpu/cpu.h"


namespace bmsx {

DeviceScheduler::DeviceScheduler(CPU& cpu)
	: m_cpu(cpu) {
}

void DeviceScheduler::setNowCycles(i64 nowCycles) {
	m_schedulerNowCycles = nowCycles;
}

void DeviceScheduler::reset() {
	m_deviceTimers = {};
	m_schedulerNowCycles = 0;
	m_acceptedCpuUntil = 0;
	m_schedulerSliceActive = false;
	m_activeSliceBaseCycle = 0;
	m_activeSliceBudgetCycles = 0;
	m_activeSliceTargetCycle = 0;
}

i64 DeviceScheduler::currentNowCycles() const {
	if (!m_schedulerSliceActive) {
		return m_schedulerNowCycles;
	}
	return m_activeSliceBaseCycle + (m_activeSliceBudgetCycles - m_cpu.instructionBudgetRemaining);
}

RunResult DeviceScheduler::runCpuSlice(int targetDepth, int sliceBudget, u32 targetThread, CpuRunKind kind) {
	beginCpuSlice(sliceBudget);
	ScopeExit activeSlice([this]() { endCpuSlice(); });
#if defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	DiagnosticCpuSliceMeasurement measurement(diagnosticCpuTiming, sliceBudget, m_cpu.instructionBudgetRemaining);
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// Same admission/consumption boundary as CpuTopologyDiagnostic::scheduler;
	// this bounded probe needs the cumulative count/sum, not its histograms.
	const DiagnosticExecutionProfile before = m_cpu.diagnosticExecutionProfile();
	const auto result = m_cpu.runUntilDepth(targetDepth, sliceBudget, targetThread, kind);
	const auto& after = m_cpu.diagnosticExecutionProfile();
	const i64 consumed = static_cast<i64>(sliceBudget) - m_cpu.instructionBudgetRemaining;
	const i64 native = after.nativeOriginCycles - before.nativeOriginCycles;
	++diagnosticCpuSliceCount;
	diagnosticCpuSliceConsumedCycles += consumed;
	diagnosticNativeOriginCycles += native;
	diagnosticInterpreterRuntimeCycles += consumed - native;
	diagnosticNativeOpcodes.newt += after.nativeOpcodes.newt - before.nativeOpcodes.newt;
	diagnosticNativeOpcodes.call += after.nativeOpcodes.call - before.nativeOpcodes.call;
	diagnosticNativeOpcodes.setfield += after.nativeOpcodes.setfield - before.nativeOpcodes.setfield;
	diagnosticNativeOpcodes.concat += after.nativeOpcodes.concat - before.nativeOpcodes.concat;
	diagnosticNativeOpcodes.concatn += after.nativeOpcodes.concatn - before.nativeOpcodes.concatn;
	diagnosticInterpreterOpcodes.newt += after.interpreterOpcodes.newt - before.interpreterOpcodes.newt;
	diagnosticInterpreterOpcodes.call += after.interpreterOpcodes.call - before.interpreterOpcodes.call;
	diagnosticInterpreterOpcodes.setfield += after.interpreterOpcodes.setfield - before.interpreterOpcodes.setfield;
	diagnosticInterpreterOpcodes.concat += after.interpreterOpcodes.concat - before.interpreterOpcodes.concat;
	diagnosticInterpreterOpcodes.concatn += after.interpreterOpcodes.concatn - before.interpreterOpcodes.concatn;
	return result;
#else
	return m_cpu.runUntilDepth(targetDepth, sliceBudget, targetThread, kind);
#endif
}

void DeviceScheduler::advanceTo(i64 nowCycles) {
	m_schedulerNowCycles = nowCycles;
}

i64 DeviceScheduler::nextDeadline() const {
	return m_deviceTimers[m_deviceTimers[0].next].deadline;
}

bool DeviceScheduler::hasDueTimer() const {
	const uint8_t head = m_deviceTimers[0].next;
	return head != 0 && m_deviceTimers[head].deadline <= m_schedulerNowCycles;
}

uint8_t DeviceScheduler::popDueTimer() {
	const uint8_t deviceKind = m_deviceTimers[0].next;
	cancelDeviceService(deviceKind);
	return deviceKind;
}

void DeviceScheduler::scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles) {
	auto& timer = m_deviceTimers[deviceKind];
	if (timer.previous == InactiveTimer || timer.deadline != deadlineCycles) {
		cancelDeviceService(deviceKind);
		uint8_t previous = 0;
		uint8_t next = m_deviceTimers[0].next;
		while (next != 0) {
			const i64 deadline = m_deviceTimers[next].deadline;
			if (deadline > deadlineCycles || (deadline == deadlineCycles && next > deviceKind)) break;
			previous = next;
			next = m_deviceTimers[next].next;
		}
		timer = {deadlineCycles, previous, next};
		m_deviceTimers[previous].next = deviceKind;
		m_deviceTimers[next].previous = deviceKind;
	}
	requestYieldForEarlierDeadline(deadlineCycles);
}

void DeviceScheduler::cancelDeviceService(uint8_t deviceKind) {
	auto& timer = m_deviceTimers[deviceKind];
	if (timer.previous == InactiveTimer) return;
	m_deviceTimers[timer.previous].next = timer.next;
	m_deviceTimers[timer.next].previous = timer.previous;
	timer.previous = InactiveTimer;
}

void DeviceScheduler::requestYieldForEarlierDeadline(i64 deadlineCycles) {
	if (!m_schedulerSliceActive) {
		return;
	}
	if (deadlineCycles > m_activeSliceTargetCycle) {
		return;
	}
	m_cpu.requestYield();
}

} // namespace bmsx
