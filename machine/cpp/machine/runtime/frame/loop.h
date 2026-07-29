#pragma once

#include "common/primitives.h"
#include "machine/runtime/frame/state.h"

namespace bmsx {

class Runtime;

struct FrameLoopStateSnapshot {
	FrameState frameState;
	bool frameActive = false;
};

class FrameLoopState {
public:
	void reset();
	FrameLoopStateSnapshot captureState() const;
	void restoreState(const FrameLoopStateSnapshot& state);
	void resetFrameState(Runtime& runtime);
	void beginFrameState(Runtime& runtime, i64 budget, i64 carry);
	bool tickUpdate(Runtime& runtime);
	InstructionStepResult tickInstruction(Runtime& runtime);
	void abandonFrameState(Runtime& runtime);

	FrameState frameState;
	bool frameActive = false;

private:
	bool prepareScheduledFrame(Runtime& runtime);
	void runActiveFrameState(Runtime& runtime);
	InstructionStepResult runActiveFrameInstruction(Runtime& runtime);
	void runUpdatePhase(Runtime& runtime);
	InstructionStepResult runUpdateInstruction(Runtime& runtime);
	bool consumeSystemReset(Runtime& runtime);
	void finalizeUpdateSlice(Runtime& runtime);
};

} // namespace bmsx
