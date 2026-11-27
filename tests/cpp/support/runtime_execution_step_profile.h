#pragma once

#include "machine/runtime/runtime.h"
#include "machine/cpu/jit/runtime/compilation_profile.h"

#include <fstream>
#include <iomanip>
#include <span>
#include <stdexcept>

namespace bmsx::test {

// Benchmark evidence, not machine state. CPU-used includes the owner's charged
// DMA/MMIO waits; it must not be labelled as retired instruction cycles. Preserve
// both boundaries because a host step can finish zero, one or several ticks.
struct RuntimeStepBoundary {
	i64 nowCycles;
	i64 tickSequence;
	i64 lastTickCpuUsedCycles;
	i64 lastTickBudgetGranted;
	i64 lastTickBudgetRemaining;
	i64 activeCpuUsedCycles;
	i64 cycleBudgetGranted;
	i64 cycleBudgetRemaining;
	ExecutionDomainId executionDomain;
	u32 instructionPc;
	bool frameActive;
	bool haltedUntilIrq;
	bool memoryWriteBlocked;
	bool dmaBusHeld;
	bool supervisorCpuHeld;
	u64 cpuSliceCount;
	i64 cpuSliceConsumedCycles;
	NativeCompilationProfile compilation;

	static RuntimeStepBoundary capture(const Runtime& runtime) {
		const auto& scheduler = runtime.frameScheduler;
		const auto& frame = runtime.frameLoop.frameState;
		NativeCompilationProfile compilation{};
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		compilation = runtime.machine.cpu.readNativeCompilationProfile();
#endif
		const auto& deviceScheduler = runtime.machine.scheduler;
		return {deviceScheduler.nowCycles(), scheduler.lastTickSequence,
			scheduler.lastTickCpuUsedCycles, scheduler.lastTickBudgetGranted, scheduler.lastTickBudgetRemaining,
			frame.activeCpuUsedCycles, frame.cycleBudgetGranted, frame.cycleBudgetRemaining,
			runtime.machine.cpu.activeCartridgeSlot(), runtime.machine.cpu.readCurrentInstructionPc(),
			runtime.frameLoop.frameActive, runtime.machine.cpu.isHaltedUntilIrq(),
			runtime.machine.cpu.isMemoryWriteBlocked(), runtime.machine.dmaController.cpuBusHeld(),
			runtime.machine.systemController.cpuHeld(),
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
			deviceScheduler.diagnosticCpuSliceCount, deviceScheduler.diagnosticCpuSliceConsumedCycles,
#else
			0u, 0,
#endif
			compilation};
	}
};

struct RuntimeStepRecord {
	RuntimeStepBoundary before;
	RuntimeStepBoundary after;
	u64 commands;
	u64 commandWords;
	u64 presentations;
	double schedulerMs;
	double renderMs;
	double totalMs;
};

inline void writeRuntimeStepRecords(const char* path, std::span<const RuntimeStepRecord> records) {
	std::ofstream output(path);
	output << std::setprecision(17) << std::boolalpha;
	const auto writeBoundary = [&](const RuntimeStepBoundary& point) {
		output << "{\"nowCycles\":" << point.nowCycles << ",\"tickSequence\":" << point.tickSequence
			<< ",\"lastTickCpuUsedCycles\":" << point.lastTickCpuUsedCycles
			<< ",\"lastTickBudgetGranted\":" << point.lastTickBudgetGranted
			<< ",\"lastTickBudgetRemaining\":" << point.lastTickBudgetRemaining
			<< ",\"frameActive\":" << point.frameActive
			<< ",\"activeCpuUsedCycles\":" << point.activeCpuUsedCycles
			<< ",\"cycleBudgetGranted\":" << point.cycleBudgetGranted
			<< ",\"cycleBudgetRemaining\":" << point.cycleBudgetRemaining
			<< ",\"executionDomain\":" << point.executionDomain << ",\"instructionPc\":" << point.instructionPc
			<< ",\"haltedUntilIrq\":" << point.haltedUntilIrq
			<< ",\"memoryWriteBlocked\":" << point.memoryWriteBlocked
			<< ",\"dmaBusHeld\":" << point.dmaBusHeld
			<< ",\"supervisorCpuHeld\":" << point.supervisorCpuHeld << '}';
	};
	for (size_t index = 0; index < records.size(); ++index) {
		const auto& record = records[index];
		const auto& before = record.before.compilation;
		const auto& after = record.after.compilation;
		output << "{\"hostFrame\":" << index + 1u << ",\"before\":";
		writeBoundary(record.before);
		output << ",\"after\":";
		writeBoundary(record.after);
		output << ",\"sequenceDelta\":" << record.after.tickSequence - record.before.tickSequence
			<< ",\"scheduledCyclesDelta\":" << record.after.nowCycles - record.before.nowCycles
			<< ",\"cpuExecution\":";
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		const i64 cpuConsumed = record.after.cpuSliceConsumedCycles - record.before.cpuSliceConsumedCycles;
		output << "{\"slices\":" << record.after.cpuSliceCount - record.before.cpuSliceCount
			<< ",\"consumedCycles\":" << cpuConsumed
			<< ",\"nonCpuScheduledCycles\":" << record.after.nowCycles - record.before.nowCycles - cpuConsumed << '}';
#else
		output << "null";
#endif
		output
			<< ",\"gxCommandsDelta\":" << record.commands << ",\"gxCommandWordsDelta\":" << record.commandWords
			<< ",\"presentationsDelta\":" << record.presentations
			<< ",\"schedulerMs\":" << record.schedulerMs << ",\"renderMs\":" << record.renderMs
			<< ",\"totalMs\":" << record.totalMs
			<< ",\"compilation\":{\"prepareRequests\":" << after.prepareRequests - before.prepareRequests
			<< ",\"regionsPublished\":" << after.regionsPublished - before.regionsPublished
			<< ",\"prepareNanoseconds\":" << after.prepareNanoseconds - before.prepareNanoseconds
			<< ",\"discoveryNanoseconds\":" << after.discoveryNanoseconds - before.discoveryNanoseconds
			<< ",\"retirementNanoseconds\":" << after.retirementNanoseconds - before.retirementNanoseconds
			<< ",\"compilationNanoseconds\":" << after.compilationNanoseconds - before.compilationNanoseconds
			<< ",\"backgroundCompleted\":" << after.backgroundCompleted - before.backgroundCompleted
			<< ",\"backgroundCancelled\":" << after.backgroundCancelled - before.backgroundCancelled
			<< ",\"backgroundNanoseconds\":" << after.backgroundNanoseconds - before.backgroundNanoseconds
			<< ",\"capacityEvictedRegions\":" << after.capacityEvictedRegions - before.capacityEvictedRegions
			<< ",\"codeBytes\":" << after.codeBytes << "}}\n";
	}
	if (!output) throw std::runtime_error("cannot write host-step profile");
}

} // namespace bmsx::test
