#include "machine/runtime/runtime.h"

#include <limits>

namespace bmsx {
namespace {

void runHaltedClosureUntilInterrupt(Runtime& runtime) {
	CPU& cpu = runtime.machine.cpu;
	DeviceScheduler& scheduler = runtime.machine.scheduler;
	while (cpu.isHaltedUntilIrq()) {
		if (cpu.acceptPendingInterrupt(runtime.machine.irqController) != AcceptedInterruptKind::None) {
			return;
		}
		if (scheduler.hasDueTimer()) {
			runDueRuntimeTimers(runtime);
			continue;
		}
		const i64 nextDeadline = scheduler.nextDeadline();
		const i64 cyclesToDeadline = nextDeadline - scheduler.nowCycles();
		if (cyclesToDeadline <= 0) {
			continue;
		}
		advanceRuntimeTime(runtime, static_cast<int>(cyclesToDeadline));
	}
}

} // namespace

void Runtime::callLuaFunctionInto(Closure* fn, NativeArgsView args, NativeResults& out) {
	CPU& cpu = machine.cpu;
	int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = cpu.swapExternalReturnSink(&out);
	int spentBudget = 0;
	int activeBudget = 0;
	out.clear();
	try {
		cpu.callExternal(fn, args);
		while (cpu.getFrameDepth() > depthBefore) {
			activeBudget = budgetSentinel;
			RunResult result = cpu.runUntilDepth(depthBefore, budgetSentinel);
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
			activeBudget = 0;
			if (cpu.getFrameDepth() > depthBefore && result == RunResult::Halted) {
				runHaltedClosureUntilInterrupt(*this);
			}
		}
	} catch (...) {
		if (activeBudget > 0) {
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
		}
		cpu.unwindToDepth(depthBefore);
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.swapExternalReturnSink(previousSink);
		throw;
	}
	cpu.instructionBudgetRemaining = previousBudget - spentBudget;
	cpu.swapExternalReturnSink(previousSink);
}

} // namespace bmsx
