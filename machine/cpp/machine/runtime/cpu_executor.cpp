#include "machine/runtime/cpu_executor.h"

#include "common/compiler.h"
#include "common/scope_exit.h"

#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace bmsx {

namespace {
enum class ClockRun { Devices, RetiredCpu, RetainedCpu };
template<ClockRun Run>
bool settleTime(Runtime& runtime, i64 targetCycle);

bool settleRetiredCpuGrant(Runtime& runtime, FrameState& state, int cycles) {
	auto& scheduler = runtime.machine.scheduler;
	state.cycleBudgetRemaining -= cycles;
	state.activeCpuUsedCycles += cycles;
	scheduler.setAcceptedCpuCycles(cycles);
	return settleTime<ClockRun::RetiredCpu>(runtime, scheduler.nowCycles() + cycles);
}
}

bool CpuExecutionState::runStoppedCpu(Runtime& runtime, FrameState& frameState) {
	auto& cpu = runtime.machine.cpu;
	const bool service = cpu.heapServiceActive();
	if (!service && cpu.allocationParked()) return false;
	auto& gxGpu = runtime.machine.gxGpu;
	auto& system = runtime.machine.systemController;
	bool tickCompleted = runDueRuntimeTimers(runtime);
	if (gxGpu.backendServiceBlocksMachine()) {
		return tickCompleted;
	}
	if ((service || !cpu.isHaltedUntilIrq()) && !system.cpuHeld() && !runtime.machine.dmaController.cpuBusHeld()) {
		return tickCompleted;
	}
	auto& scheduler = runtime.machine.scheduler;
	while (true) {
		if (!service && !system.cpuHeld() && !runtime.machine.dmaController.cpuBusHeld() && cpu.enterPendingInterrupt()) {
			return tickCompleted;
		}
		if ((service || !cpu.isHaltedUntilIrq()) && !system.cpuHeld() && !runtime.machine.dmaController.cpuBusHeld()) {
			return tickCompleted;
		}
		if (tickCompleted) {
			return true;
		}
		if (frameState.cycleBudgetRemaining > 0) {
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
				if (gxGpu.backendServiceBlocksMachine()) {
					return tickCompleted;
				}
				continue;
			}
			i64 idleBudget = cyclesToTarget < frameState.cycleBudgetRemaining ? cyclesToTarget : frameState.cycleBudgetRemaining;
			if (idleBudget > MAX_CPU_SLICE_CYCLES) idleBudget = MAX_CPU_SLICE_CYCLES;
			const int idleCycles = static_cast<int>(idleBudget);
			frameState.cycleBudgetRemaining -= idleCycles;
			tickCompleted = advanceRuntimeTime(runtime, idleCycles);
			if (gxGpu.backendServiceBlocksMachine()) {
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
	bool running = true;
	while (running && !runtime.vblank.tickCompleted() && (cpu.heapServiceActive()
		|| (cpu.allocationParked() ? cpu.allocationReady()
			: !cpu.queuedFixedWork()))) {
		if (runtime.machine.systemController.hasResetRequest() && !cpu.heapServiceActive()
			&& runtime.machine.scheduler.acceptedCpuCycles() == 0) break;
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
			case CpuSliceResult::ParkedAllocation:
			case CpuSliceResult::Blocked:
				running = false;
				continue;
		}
	}
	return result;
}

InstructionStepResult CpuExecutionState::runInstruction(Runtime& runtime, FrameState& frameState) {
	const CpuSliceResult result = runSlice(runtime, frameState, 1);
	switch (result) {
		case CpuSliceResult::Advanced:
			return InstructionStepResult::Advanced;
		case CpuSliceResult::InstructionYielded:
		case CpuSliceResult::InstructionHalted:
			return InstructionStepResult::Executed;
		case CpuSliceResult::ExecutionStopped:
			return InstructionStepResult::ExecutionStopped;
		case CpuSliceResult::ParkedAllocation:
		case CpuSliceResult::Blocked:
		case CpuSliceResult::Halted:
			return InstructionStepResult::Blocked;
	}
	BMSX_UNREACHABLE();
}

CpuSuspendedRunResult CpuExecutionState::runSuspendedUntilDepth(
	Runtime& runtime,
	int targetDepth,
	int cycleBudget,
	u32 targetThread
) {
	auto& machine = runtime.machine;
	auto& cpu = machine.cpu;
	auto& scheduler = machine.scheduler;
	if (targetThread == 0u) targetThread = cpu.activeThread()->address;
	if (!cpu.heapServiceActive() && cpu.allocationParked()) return CpuSuspendedRunResult::Halted;
	// Scheduled work still owes physical edges to the frame owner.
	if (scheduler.acceptedCpuCycles() != 0) return CpuSuspendedRunResult::Yielded;
	const i64 endCycle = scheduler.nowCycles() + cycleBudget;
	cpu.admitFixedWork(CpuRunKind::Direct);
	runDueRuntimeTimers(runtime);
	// A fixed service can own the next grant without a deeper guest frame.
	while (cpu.heapServiceActive()
		|| static_cast<int>(ThreadRecord::count(machine.memory, targetThread, ThreadField::FrameDepth)) > targetDepth) {
		if (scheduler.nowCycles() >= endCycle) return CpuSuspendedRunResult::Yielded;
		if (machine.gxGpu.backendServiceBlocksMachine()
			|| machine.systemController.cpuHeld()) {
			return CpuSuspendedRunResult::Halted;
		}
		if ((!cpu.heapServiceActive() && cpu.isMemoryWriteBlocked()) || machine.dmaController.cpuBusHeld()) {
			const i64 nextDeadline = scheduler.nextDeadline();
			if (nextDeadline == std::numeric_limits<i64>::max()) {
				return CpuSuspendedRunResult::Halted;
			}
			const i64 waitBudget = std::min(nextDeadline, endCycle) - scheduler.nowCycles();
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
		int sliceBudget = static_cast<int>(std::min<i64>(MAX_CPU_SLICE_CYCLES, endCycle - scheduler.nowCycles()));
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
		const RunResult result = scheduler.runCpuSlice(targetDepth, sliceBudget, targetThread);
		const int consumed = sliceBudget - cpu.instructionBudgetRemaining;
		if (consumed > 0) {
			advanceRuntimeTime(runtime, consumed);
			if (machine.systemController.cpuHeld()) {
				return CpuSuspendedRunResult::Halted;
			}
		}
		if (!cpu.heapServiceActive()) {
			if (cpu.admitFixedWork(CpuRunKind::Direct)) {
				if (result == RunResult::ExecutionStopped) return CpuSuspendedRunResult::ExecutionStopped;
				continue;
			}
			if (static_cast<int>(ThreadRecord::count(machine.memory, targetThread, ThreadField::FrameDepth)) <= targetDepth)
				return CpuSuspendedRunResult::Completed;
			if (cpu.allocationParked()) return CpuSuspendedRunResult::Halted;
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
			while (cpu.isHaltedUntilIrq() && !cpu.heapServiceActive()) {
				if (scheduler.nowCycles() >= endCycle) return CpuSuspendedRunResult::Yielded;
				if (machine.gxGpu.backendServiceBlocksMachine()) {
					return CpuSuspendedRunResult::Halted;
				}
				const bool cpuHeld = machine.systemController.cpuHeld() || machine.dmaController.cpuBusHeld();
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
				const i64 cyclesToDeadline = std::min(haltedDeadline, endCycle) - scheduler.nowCycles();
				if (cyclesToDeadline <= 0) {
					if (runDueRuntimeTimers(runtime) && !cpu.heapServiceActive()) {
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
	const bool service = cpu.heapServiceActive();
	if (service && cpu.allocationParked() && frameState.deferredAllocationCycles != 0) {
		// Settle the caller's accepted prefix before granting timed recovery.
		const int deferred = frameState.deferredAllocationCycles;
		frameState.deferredAllocationCycles = 0;
		settleRetiredCpuGrant(runtime, frameState, deferred);
		return CpuSliceResult::Advanced;
	}
	if (!service && cpu.allocationParked()) {
		if (!cpu.allocationReady()) return CpuSliceResult::ParkedAllocation;
		// Late fault handling observes the same effective clock as the original slice.
		const int deferred = frameState.deferredAllocationCycles;
		cpu.instructionBudgetRemaining = 0;
		{
			scheduler.beginCpuSlice(deferred);
			ScopeExit activeSlice([&scheduler]() { scheduler.endCpuSlice(); });
			cpu.resumeAllocation();
		}
		const int consumed = deferred - cpu.instructionBudgetRemaining;
		if (cpu.allocationParked()) {
			frameState.deferredAllocationCycles = consumed;
			return CpuSliceResult::ParkedAllocation;
		}
		frameState.deferredAllocationCycles = 0;
		settleRetiredCpuGrant(runtime, frameState, consumed);
		return cpu.getFrameDepth() != 0 ? CpuSliceResult::InstructionYielded : CpuSliceResult::InstructionHalted;
	}
	bool advanced = scheduler.hasDueTimer();
	bool tickCompleted = runDueRuntimeTimers(runtime);
	while (frameState.cycleBudgetRemaining > 0
		&& !tickCompleted
		&& !machine.gxGpu.backendServiceBlocksMachine()
		&& !machine.systemController.cpuHeld()) {
		if ((!service && cpu.isMemoryWriteBlocked()) || machine.dmaController.cpuBusHeld()) {
			const i64 nextDeadline = scheduler.nextDeadline();
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				advanced = scheduler.hasDueTimer() || advanced;
				tickCompleted = runDueRuntimeTimers(runtime);
				continue;
			}
			// Device-ready edges release blocked MMIO stores. Advance to scheduled
			// hardware events here; never poll readiness or retry the instruction.
			i64 waitBudget = deadlineBudget < frameState.cycleBudgetRemaining ? deadlineBudget : frameState.cycleBudgetRemaining;
			if (waitBudget > MAX_CPU_SLICE_CYCLES) waitBudget = MAX_CPU_SLICE_CYCLES;
			const int waitCycles = static_cast<int>(waitBudget);
			frameState.cycleBudgetRemaining -= waitCycles;
			frameState.activeCpuUsedCycles += waitCycles;
			advanced = true;
			tickCompleted = advanceRuntimeTime(runtime, waitCycles);
			continue;
		}
		int sliceBudget = static_cast<int>(frameState.cycleBudgetRemaining > maximumCpuCycles
			? maximumCpuCycles
			: frameState.cycleBudgetRemaining);
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
		const RunResult result = scheduler.runCpuSlice(0, sliceBudget, 0u, CpuRunKind::Scheduled);
		const int consumed = sliceBudget - cpu.instructionBudgetRemaining;
		if (result == RunResult::ParkedAllocation) {
			frameState.deferredAllocationCycles = consumed;
			return CpuSliceResult::ParkedAllocation;
		}
		if (consumed > 0) {
			// Device timers publish this frame's remainder at the VBlank edge.
			advanced = true;
			if (consumed > sliceBudget) {
				tickCompleted = settleRetiredCpuGrant(runtime, frameState, consumed);
			} else {
				frameState.cycleBudgetRemaining -= consumed;
				frameState.activeCpuUsedCycles += consumed;
				tickCompleted = advanceRuntimeTime(runtime, consumed);
			}
		}
		if (result == RunResult::CollectionProgress) return CpuSliceResult::Advanced;
		if (result == RunResult::ExecutionStopped) {
			return CpuSliceResult::ExecutionStopped;
		}
		// A fixed activation runs machine work, not the next caller instruction.
		if (service && (consumed == 0 || result == RunResult::Yielded)) return advanced ? CpuSliceResult::Advanced : CpuSliceResult::Blocked;
		if (cpu.isMemoryWriteBlocked()) {
			if (consumed > 0) {
				return result == RunResult::Halted
					? CpuSliceResult::InstructionHalted
					: CpuSliceResult::InstructionYielded;
			}
			continue;
		}
		if (consumed > 0) {
			return result == RunResult::Halted
				? CpuSliceResult::InstructionHalted
				: CpuSliceResult::InstructionYielded;
		}
		if (cpu.isHaltedUntilIrq() || result == RunResult::Halted) {
			return advanced ? CpuSliceResult::Advanced : CpuSliceResult::Halted;
		}
		throw BMSX_RUNTIME_ERROR("CPU yielded without consuming cycles.");
	}
	return advanced ? CpuSliceResult::Advanced : CpuSliceResult::Blocked;
}

namespace {
template<ClockRun Run>
bool settleTime(Runtime& runtime, i64 targetCycle) {
	auto& scheduler = runtime.machine.scheduler;
	bool tickCompleted = runDueRuntimeTimers(runtime);
	// Device edges retire in absolute clock order, regardless of how much
	// time an instruction accepted before the next device deadline.
	while (scheduler.nowCycles() < targetCycle) {
		if constexpr (Run == ClockRun::RetainedCpu) {
			if (runtime.machine.gxGpu.backendServiceBlocksMachine()) break;
		}
		if constexpr (Run != ClockRun::Devices) {
			// At VBlank the beam publishes the exact spacing to its next
			// VBlank. The CPU cannot write beam timing during settlement.
			// Keep ordinary sub-frame overshoot, but leave the next VBlank
			// for another host tick if this accepted time reaches it.
			const i64 interval = runtime.timing.cycleBudgetPerFrame;
			if (tickCompleted && interval > 0 && targetCycle - scheduler.nowCycles() >= interval) break;
		}
		scheduler.advanceTo(std::min(scheduler.nextDeadline(), targetCycle));
		tickCompleted = runDueRuntimeTimers(runtime);
	}
	return tickCompleted;
}
}

bool advanceRuntimeTime(Runtime& runtime, int cycles) {
	return settleTime<ClockRun::Devices>(runtime, runtime.machine.scheduler.nowCycles() + cycles);
}

bool settleAcceptedCpuTime(Runtime& runtime) {
	auto& scheduler = runtime.machine.scheduler;
	return settleTime<ClockRun::RetainedCpu>(runtime, scheduler.nowCycles() + scheduler.acceptedCpuCycles());
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
