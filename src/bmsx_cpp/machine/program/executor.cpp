#include "machine/runtime/runtime.h"

#include <limits>

namespace bmsx {

void Runtime::callLuaFunctionInto(Closure* fn, NativeArgsView args, NativeResults& out) {
	CPU& cpu = m_machine.cpu();
	int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = cpu.swapExternalReturnSink(&out);
	int spentBudget = 0;
	out.clear();
	try {
		cpu.callExternal(fn, args);
		while (cpu.getFrameDepth() > depthBefore) {
			RunResult result = cpu.runUntilDepth(depthBefore, budgetSentinel);
			spentBudget += budgetSentinel - cpu.instructionBudgetRemaining;
			if (cpu.getFrameDepth() > depthBefore && cpu.isHaltedUntilIrq()) {
				throw BMSX_RUNTIME_ERROR("Lua host call halted before returning.");
			}
			if (cpu.getFrameDepth() > depthBefore && result == RunResult::Yielded) {
				throw BMSX_RUNTIME_ERROR("Lua host call exceeded external call budget before returning.");
			}
		}
	} catch (...) {
		cpu.unwindToDepth(depthBefore);
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.swapExternalReturnSink(previousSink);
		throw;
	}
	cpu.instructionBudgetRemaining = previousBudget - spentBudget;
	cpu.swapExternalReturnSink(previousSink);
}

} // namespace bmsx
