#pragma once

#include <algorithm>
#include <stdexcept>

#include "machine/cpu/cpu.h"

namespace bmsx::test {

// Run the scalar reference to the generated segment boundary. Do not restore
// state or alter either CPU's accounting to hide a mismatched instruction charge.
inline RunResult runCpuParity(CPU& generated, CPU& reference, int grant, int depth = 0) {
	const auto result = generated.runUntilDepth(depth, grant);
	const int consumed = grant - generated.instructionBudgetRemaining;
	const int referenceGrant = std::max(grant, consumed);
	if (reference.runUntilDepth(depth, referenceGrant) != result
		|| referenceGrant - reference.instructionBudgetRemaining != consumed) {
		throw std::runtime_error("generated and scalar execution differ at the same guest-cycle boundary");
	}
	return result;
}

} // namespace bmsx::test
