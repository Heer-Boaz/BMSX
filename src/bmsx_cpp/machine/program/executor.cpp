#include "machine/runtime/runtime.h"

#include <limits>

namespace bmsx {

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
			if (cpu.getFrameDepth() > depthBefore && cpu.isHaltedUntilIrq()) {
				throw BMSX_RUNTIME_ERROR("Lua host call halted before returning.");
			}
			if (cpu.getFrameDepth() > depthBefore && result == RunResult::Yielded) {
				throw BMSX_RUNTIME_ERROR("Lua host call exceeded external call budget before returning.");
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
