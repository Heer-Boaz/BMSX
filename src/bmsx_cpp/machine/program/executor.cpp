#include "machine/runtime/runtime.h"

#include <limits>

namespace bmsx {

void Runtime::callLuaFunctionInto(Closure* fn, NativeArgsView args, NativeResults& out) {
	CPU& cpu = m_machine.cpu();
	int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = cpu.swapExternalReturnSink(&out);
	out.clear();
	try {
		cpu.callExternal(fn, args);
		cpu.runUntilDepth(depthBefore, budgetSentinel);
	} catch (...) {
		cpu.swapExternalReturnSink(previousSink);
		cpu.unwindToDepth(depthBefore);
		const int remaining = cpu.instructionBudgetRemaining;
		cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		throw;
	}
	cpu.swapExternalReturnSink(previousSink);
	const int remaining = cpu.instructionBudgetRemaining;
	cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
}

} // namespace bmsx
