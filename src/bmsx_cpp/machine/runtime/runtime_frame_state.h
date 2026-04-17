#pragma once

namespace bmsx {

struct FrameState {
	bool haltGame = false;
	bool updateExecuted = false;
	bool luaFaulted = false;
	int cycleBudgetRemaining = 0;
	int cycleBudgetGranted = 0;
	int cycleCarryGranted = 0;
	int activeCpuUsedCycles = 0;
};

} // namespace bmsx
