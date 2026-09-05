#include "machine/runtime/history/input_source.h"
#include "machine/runtime/history/history.h"

namespace bmsx {

void HistoryInputSource::sampleInputControllerSnapshot(InputControllerSnapshot& snapshot, InputControllerSampleContext context) {
	if (history.mode == HistoryMode::Replaying) {
		history.inputJournal.replaySample(snapshot);
		return;
	}
	live.sampleInputControllerSnapshot(snapshot, context);
	if (history.mode == HistoryMode::Recording) history.inputJournal.recordSample(snapshot, context);
}

bool HistoryInputSource::supervisorRequestLineHigh() const {
	if (history.mode == HistoryMode::Replaying) return history.inputJournal.replayLine();
	const bool high = live.supervisorRequestLineHigh();
	if (history.mode == HistoryMode::Recording) history.recordInputBoundary(high);
	return high;
}

void HistoryInputSource::applyInputControllerVibrationEffect(i32 padIndex, f64 durationMs, f32 intensity) {
	if (history.mode == HistoryMode::Replaying || history.mode == HistoryMode::Reviewing) return;
	live.applyInputControllerVibrationEffect(padIndex, durationMs, intensity);
}

} // namespace bmsx
