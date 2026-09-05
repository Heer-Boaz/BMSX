#include "machine/runtime/history/input_source.h"
#include "machine/runtime/history/history.h"

namespace bmsx {

void HistoryInputSource::sampleInputControllerSnapshot(InputControllerSnapshot& snapshot, InputControllerSampleContext context) {
	if (m_history.mode == HistoryMode::Replaying) {
		m_history.inputJournal.replaySample(snapshot);
		return;
	}
	m_live.sampleInputControllerSnapshot(snapshot, context);
	if (m_history.mode == HistoryMode::Recording) m_history.inputJournal.recordSample(snapshot, context);
}

bool HistoryInputSource::supervisorRequestLineHigh() const {
	if (m_history.mode == HistoryMode::Replaying) return m_history.inputJournal.replayLine();
	const bool high = m_live.supervisorRequestLineHigh();
	if (m_history.mode == HistoryMode::Recording) m_history.recordInputBoundary(high);
	return high;
}

void HistoryInputSource::applyInputControllerVibrationEffect(i32 padIndex, f64 durationMs, f32 intensity) {
	if (m_history.mode == HistoryMode::Replaying || m_history.mode == HistoryMode::Reviewing) return;
	m_live.applyInputControllerVibrationEffect(padIndex, durationMs, intensity);
}

} // namespace bmsx
