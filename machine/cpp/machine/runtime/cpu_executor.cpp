#include "machine/runtime/cpu_executor.h"

#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace bmsx {

void CpuExecutionState::reset() {
	m_sliceCycleBudgetRemaining = 0;
	m_instructionRunActive = false;
}

bool CpuExecutionState::runStoppedCpu(Runtime& runtime, FrameState& frameState) {
	auto& cpu = runtime.machine.cpu;
	auto& gxGpu = runtime.machine.gxGpu;
	auto& system = runtime.machine.systemController;
	i64& cycleBudgetRemaining = frameState.cycleBudgetRemaining;
	bool tickCompleted = runDueRuntimeTimers(runtime);
	if (gxGpu.backendReadbackBlocksMachine()) {
		return tickCompleted;
	}
	if (!cpu.isHaltedUntilIrq() && !system.cpuHeld()) {
		return tickCompleted;
	}
	auto& scheduler = runtime.machine.scheduler;
	while (true) {
		if (!system.cpuHeld() && cpu.enterPendingInterrupt()) {
			return tickCompleted;
		}
		if (!cpu.isHaltedUntilIrq() && !system.cpuHeld()) {
			return tickCompleted;
		}
		if (tickCompleted) {
			return true;
		}
		if (cycleBudgetRemaining > 0) {
			const i64 nextDeadline = scheduler.nextDeadline();
			if (nextDeadline == std::numeric_limits<i64>::max()) {
				// Parked with no interrupt scheduled to wake the CPU: yield without
				// burning the CPU instruction budget. A parked CPU executes nothing,
				// so it must not draw down the per-frame budget; the host resumes on
				// a later tick once an interrupt is scheduled.
				return tickCompleted;
			}
			const i64 cyclesToTarget = nextDeadline - scheduler.nowCycles();
			if (cyclesToTarget <= 0) {
				tickCompleted = runDueRuntimeTimers(runtime);
				if (gxGpu.backendReadbackBlocksMachine()) {
					return tickCompleted;
				}
				continue;
			}
			i64 idleBudget = cyclesToTarget < cycleBudgetRemaining ? cyclesToTarget : cycleBudgetRemaining;
			if (idleBudget > MAX_CPU_SLICE_CYCLES) idleBudget = MAX_CPU_SLICE_CYCLES;
			const int idleCycles = static_cast<int>(idleBudget);
			cycleBudgetRemaining -= idleCycles;
			frameState.cycleBudgetRemaining = cycleBudgetRemaining;
			tickCompleted = advanceRuntimeTime(runtime, idleCycles);
			if (gxGpu.backendReadbackBlocksMachine()) {
				return tickCompleted;
			}
			continue;
		}
		return true;
	}
}

CpuExecutionResult CpuExecutionState::runWithBudget(Runtime& runtime, FrameState& frameState) {
	CpuExecutionResult result = CpuExecutionResult::Yielded;
	auto& cpu = runtime.machine.cpu;
	m_instructionRunActive = false;
	m_sliceCycleBudgetRemaining = frameState.cycleBudgetRemaining;
	bool running = true;
	while (running) {
		switch (runSlice(runtime, frameState, MAX_CPU_SLICE_CYCLES)) {
			case CpuSliceResult::Advanced:
				continue;
			case CpuSliceResult::InstructionYielded:
				result = CpuExecutionResult::Yielded;
				continue;
			case CpuSliceResult::InstructionHalted:
				result = CpuExecutionResult::Halted;
				if (cpu.isMemoryWriteBlocked()) {
					continue;
				}
				running = false;
				continue;
			case CpuSliceResult::ExecutionStopped:
				result = CpuExecutionResult::ExecutionStopped;
				running = false;
				continue;
			case CpuSliceResult::Halted:
				result = CpuExecutionResult::Halted;
				running = false;
				continue;
			case CpuSliceResult::Blocked:
				running = false;
				continue;
		}
	}
	frameState.cycleBudgetRemaining = m_sliceCycleBudgetRemaining;
	return result;
}

InstructionStepResult CpuExecutionState::runInstruction(Runtime& runtime, FrameState& frameState) {
	if (!m_instructionRunActive) {
		m_sliceCycleBudgetRemaining = frameState.cycleBudgetRemaining;
		m_instructionRunActive = true;
	}
	const CpuSliceResult result = runSlice(runtime, frameState, 1);
	auto& cpu = runtime.machine.cpu;
	const bool runCompleted = result == CpuSliceResult::Advanced
		|| result == CpuSliceResult::Blocked
		|| result == CpuSliceResult::Halted
		|| result == CpuSliceResult::ExecutionStopped
		|| (result == CpuSliceResult::InstructionHalted && !cpu.isMemoryWriteBlocked())
		|| m_sliceCycleBudgetRemaining <= 0
		|| runtime.vblank.tickCompleted()
		|| runtime.machine.gxGpu.backendReadbackBlocksMachine()
		|| runtime.machine.systemController.cpuHeld()
		|| cpu.isHaltedUntilIrq();
	if (runCompleted) {
		frameState.cycleBudgetRemaining = m_sliceCycleBudgetRemaining;
		m_instructionRunActive = false;
	}
	switch (result) {
		case CpuSliceResult::Advanced:
			return InstructionStepResult::Advanced;
		case CpuSliceResult::InstructionYielded:
		case CpuSliceResult::InstructionHalted:
			return InstructionStepResult::Executed;
		case CpuSliceResult::ExecutionStopped:
			return InstructionStepResult::ExecutionStopped;
		case CpuSliceResult::Blocked:
		case CpuSliceResult::Halted:
			return InstructionStepResult::Blocked;
	}
	__builtin_unreachable();
}

CpuSuspendedRunResult CpuExecutionState::runSuspendedUntilDepth(
	Runtime& runtime,
	int targetDepth
) {
	auto& machine = runtime.machine;
	auto& cpu = machine.cpu;
	auto& scheduler = machine.scheduler;
	m_instructionRunActive = false;
	runDueRuntimeTimers(runtime);
	while (cpu.getFrameDepth() > targetDepth) {
		if (machine.gxGpu.backendReadbackBlocksMachine()
			|| machine.systemController.cpuHeld()) {
			return CpuSuspendedRunResult::Halted;
		}
		if (cpu.isMemoryWriteBlocked()) {
			const i64 nextDeadline = scheduler.nextDeadline();
			if (nextDeadline == std::numeric_limits<i64>::max()) {
				return CpuSuspendedRunResult::Halted;
			}
			const i64 waitBudget = nextDeadline - scheduler.nowCycles();
			if (waitBudget <= 0) {
				runDueRuntimeTimers(runtime);
				continue;
			}
			const int waitCycles = static_cast<int>(
				waitBudget < MAX_CPU_SLICE_CYCLES
					? waitBudget
					: MAX_CPU_SLICE_CYCLES
			);
			advanceRuntimeTime(runtime, waitCycles);
			continue;
		}
		int sliceBudget = MAX_CPU_SLICE_CYCLES;
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				runDueRuntimeTimers(runtime);
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		RunResult result;
		scheduler.beginCpuSlice(sliceBudget);
		try {
			result = cpu.runUntilDepth(targetDepth, sliceBudget);
		} catch (...) {
			scheduler.endCpuSlice();
			throw;
		}
		scheduler.endCpuSlice();
		const int consumed = sliceBudget - cpu.instructionBudgetRemaining;
		if (consumed > 0) {
			machine.advanceDevices(consumed);
			if (machine.systemController.cpuHeld()) {
				return CpuSuspendedRunResult::Halted;
			}
			runDueRuntimeTimers(runtime);
		}
		if (cpu.getFrameDepth() <= targetDepth) {
			return CpuSuspendedRunResult::Completed;
		}
		if (result == RunResult::ExecutionStopped) {
			return CpuSuspendedRunResult::ExecutionStopped;
		}
		if (cpu.isMemoryWriteBlocked()) {
			continue;
		}
		if (result == RunResult::Halted) {
			if (!cpu.isHaltedUntilIrq()) {
				return CpuSuspendedRunResult::Halted;
			}
			bool advancedDeadline = false;
			while (cpu.isHaltedUntilIrq()) {
				if (machine.gxGpu.backendReadbackBlocksMachine()) {
					return CpuSuspendedRunResult::Halted;
				}
				const bool cpuHeld = machine.systemController.cpuHeld();
				if (!cpuHeld && cpu.enterPendingInterrupt()) {
					break;
				}
				if (!cpuHeld && advancedDeadline) {
					return CpuSuspendedRunResult::Halted;
				}
				const i64 haltedDeadline = scheduler.nextDeadline();
				if (haltedDeadline == std::numeric_limits<i64>::max()) {
					return CpuSuspendedRunResult::Halted;
				}
				const i64 cyclesToDeadline = haltedDeadline - scheduler.nowCycles();
				if (cyclesToDeadline <= 0) {
					if (runDueRuntimeTimers(runtime)) {
						return CpuSuspendedRunResult::Halted;
					}
					continue;
				}
				const int idleCycles = static_cast<int>(
					cyclesToDeadline < MAX_CPU_SLICE_CYCLES
						? cyclesToDeadline
						: MAX_CPU_SLICE_CYCLES
				);
				advanceRuntimeTime(runtime, idleCycles);
				advancedDeadline = idleCycles == cyclesToDeadline;
			}
			continue;
		}
		if (consumed <= 0) {
			runDueRuntimeTimers(runtime);
		}
	}
	return CpuSuspendedRunResult::Completed;
}

CpuExecutionState::CpuSliceResult CpuExecutionState::runSlice(
	Runtime& runtime,
	FrameState& frameState,
	int maximumCpuCycles
) {
	auto& machine = runtime.machine;
	auto& scheduler = machine.scheduler;
	auto& cpu = machine.cpu;
	i64 remaining = m_sliceCycleBudgetRemaining;
	bool advanced = scheduler.hasDueTimer();
	bool tickCompleted = runDueRuntimeTimers(runtime);
	while (remaining > 0
		&& !tickCompleted
		&& !machine.gxGpu.backendReadbackBlocksMachine()
		&& !machine.systemController.cpuHeld()) {
		if (cpu.isMemoryWriteBlocked()) {
			const i64 nextDeadline = scheduler.nextDeadline();
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				advanced = scheduler.hasDueTimer() || advanced;
				tickCompleted = runDueRuntimeTimers(runtime);
				continue;
			}
			// Device-ready edges release blocked MMIO stores. Advance to scheduled
			// hardware events here; never poll readiness or retry the instruction.
			i64 waitBudget = deadlineBudget < remaining ? deadlineBudget : remaining;
			if (waitBudget > MAX_CPU_SLICE_CYCLES) waitBudget = MAX_CPU_SLICE_CYCLES;
			const int waitCycles = static_cast<int>(waitBudget);
			remaining -= waitCycles;
			frameState.activeCpuUsedCycles += waitCycles;
			advanced = true;
			tickCompleted = advanceRuntimeTime(runtime, waitCycles);
			continue;
		}
		int sliceBudget = static_cast<int>(remaining > maximumCpuCycles
			? maximumCpuCycles
			: remaining);
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				advanced = scheduler.hasDueTimer() || advanced;
				tickCompleted = runDueRuntimeTimers(runtime);
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		RunResult result;
		scheduler.beginCpuSlice(sliceBudget);
		try {
			result = cpu.runUntilDepth(0, sliceBudget);
		} catch (...) {
			scheduler.endCpuSlice();
			throw;
		}
		scheduler.endCpuSlice();
		const int consumed = sliceBudget - cpu.instructionBudgetRemaining;
		if (consumed > 0) {
			remaining -= consumed;
			frameState.activeCpuUsedCycles += consumed;
			advanced = true;
			tickCompleted = advanceRuntimeTime(runtime, consumed);
		}
		if (result == RunResult::ExecutionStopped) {
			m_sliceCycleBudgetRemaining = remaining;
			return CpuSliceResult::ExecutionStopped;
		}
		if (cpu.isMemoryWriteBlocked()) {
			if (consumed > 0) {
				m_sliceCycleBudgetRemaining = remaining;
				return result == RunResult::Halted
					? CpuSliceResult::InstructionHalted
					: CpuSliceResult::InstructionYielded;
			}
			continue;
		}
		if (consumed > 0) {
			m_sliceCycleBudgetRemaining = remaining;
			return result == RunResult::Halted
				? CpuSliceResult::InstructionHalted
				: CpuSliceResult::InstructionYielded;
		}
		if (cpu.isHaltedUntilIrq() || result == RunResult::Halted) {
			m_sliceCycleBudgetRemaining = remaining;
			return advanced ? CpuSliceResult::Advanced : CpuSliceResult::Halted;
		}
		throw BMSX_RUNTIME_ERROR("CPU yielded without consuming cycles.");
	}
	m_sliceCycleBudgetRemaining = remaining;
	return advanced ? CpuSliceResult::Advanced : CpuSliceResult::Blocked;
}

bool advanceRuntimeTime(Runtime& runtime, int cycles) {
	runtime.machine.advanceDevices(cycles);
	return runDueRuntimeTimers(runtime);
}

bool runDueRuntimeTimers(Runtime& runtime) {
	auto& scheduler = runtime.machine.scheduler;
	while (scheduler.hasDueTimer()) {
		const uint8_t deviceKind = scheduler.popDueTimer();
		const u32 serviceResult = runtime.machine.runDeviceService(deviceKind);
		if (deviceKind == DEVICE_SERVICE_GPU) {
			if ((serviceResult & GX_GPU_SERVICE_TIMING_PUBLISHED) != 0u) {
				runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
			}
			runtime.vblank.handleGpuRuntimeEdge(runtime, serviceResult & GX_GPU_SERVICE_RUNTIME_EDGE_MASK);
		}
	}
	return runtime.vblank.tickCompleted();
}

} // namespace bmsx
