#pragma once

#include "machine/devices/input/contracts.h"

namespace bmsx {

class RuntimeHistory;

class HistoryInputSource final : public InputControllerInputSource {
public:
	HistoryInputSource(RuntimeHistory& history, InputControllerInputSource& live) : history(history), live(live) {}
	void sampleInputControllerSnapshot(InputControllerSnapshot& snapshot, InputControllerSampleContext context) override;
	bool supervisorRequestLineHigh() const override;
	void applyInputControllerVibrationEffect(i32 padIndex, f64 durationMs, f32 intensity) override;
private:
	RuntimeHistory& history;
	InputControllerInputSource& live;
};

} // namespace bmsx
