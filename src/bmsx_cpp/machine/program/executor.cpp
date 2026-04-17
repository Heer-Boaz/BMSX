#include "machine/runtime/runtime.h"

#include <limits>

namespace bmsx {

void Runtime::callLuaFunctionInto(Closure* fn, NativeArgsView args, NativeResults& out) {
	int depthBefore = m_machine.cpu().getFrameDepth();
	const int previousBudget = m_machine.cpu().instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = m_machine.cpu().swapExternalReturnSink(&out);
	out.clear();
	try {
		m_machine.cpu().callExternal(fn, args);
		m_machine.cpu().runUntilDepth(depthBefore, budgetSentinel);
	} catch (...) {
		m_machine.cpu().swapExternalReturnSink(previousSink);
		m_machine.cpu().unwindToDepth(depthBefore);
		const int remaining = m_machine.cpu().instructionBudgetRemaining;
		m_machine.cpu().instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		throw;
	}
	m_machine.cpu().swapExternalReturnSink(previousSink);
	const int remaining = m_machine.cpu().instructionBudgetRemaining;
	m_machine.cpu().instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
}

} // namespace bmsx
