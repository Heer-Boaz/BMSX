#include "machine/runtime/runtime.h"

#include <limits>

namespace bmsx {
namespace {

int runHaltedClosureUntilInterrupt(Runtime& runtime) {
	CPU& cpu = runtime.machine.cpu;
	DeviceScheduler& scheduler = runtime.machine.scheduler;
	int consumed = 0;
	bool advancedDeadline = false;
	while (cpu.isHaltedUntilIrq()) {
		if (cpu.peekPendingInterrupt() != AcceptedInterruptKind::None) {
			cpu.clearHaltUntilIrq();
			return consumed;
		}
		if (advancedDeadline) {
			return consumed;
		}
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline == std::numeric_limits<i64>::max()) {
			return consumed;
		}
		const i64 idleCycles = nextDeadline - scheduler.nowCycles();
		if (idleCycles <= 0) {
			if (runDueRuntimeTimers(runtime)) {
				return consumed;
			}
			continue;
		}
		advanceRuntimeTime(runtime, static_cast<int>(idleCycles));
		consumed += static_cast<int>(idleCycles);
		advancedDeadline = true;
	}
	return consumed;
}

} // namespace

void Runtime::callClosureInto(Closure& fn, NativeArgsView args, NativeResults& out) {
	CPU& cpu = machine.cpu;
	int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = cpu.swapExternalReturnSink(&out);
	int spentBudget = 0;
	int activeBudget = 0;
	out.clear();
	cpu.enterHostExternalCall();
	try {
		cpu.callExternal(fn, args);
		while (cpu.getFrameDepth() > depthBefore) {
			activeBudget = budgetSentinel;
			RunResult result = cpu.runUntilDepth(depthBefore, budgetSentinel);
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
			activeBudget = 0;
			if (cpu.getFrameDepth() > depthBefore && result == RunResult::Halted) {
				spentBudget += runHaltedClosureUntilInterrupt(*this);
				if (cpu.isHaltedUntilIrq()) {
					break;
				}
			}
		}
	} catch (...) {
		if (activeBudget > 0) {
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
		}
		cpu.unwindToDepth(depthBefore);
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.swapExternalReturnSink(previousSink);
		cpu.leaveHostExternalCall();
		throw;
	}
	cpu.instructionBudgetRemaining = previousBudget - spentBudget;
	cpu.swapExternalReturnSink(previousSink);
	cpu.leaveHostExternalCall();
}

} // namespace bmsx
