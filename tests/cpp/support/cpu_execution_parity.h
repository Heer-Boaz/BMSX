#pragma once

#include <stdexcept>

#include "machine/cpu/cpu.h"

namespace bmsx::test {

// Both routes receive the same grant; compare their actual consumed cycles.
inline RunResult runCpuParity(CPU& generated, CPU& reference, int grant, int depth = 0) {
	const auto result = generated.runUntilDepth(depth, grant);
	const int consumed = grant - generated.instructionBudgetRemaining;
	if (reference.runUntilDepth(depth, grant) != result
		|| grant - reference.instructionBudgetRemaining != consumed) {
		throw std::runtime_error("generated and scalar execution differ at the same guest-cycle boundary");
	}
	return result;
}

} // namespace bmsx::test
