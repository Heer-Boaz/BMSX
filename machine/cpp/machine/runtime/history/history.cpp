#include "machine/runtime/history/history.h"
#include "machine/runtime/runtime.h"
#include <algorithm>

namespace bmsx {

void RuntimeHistory::start(const HistoryOptions& options) {
	m_checkpoints = std::vector<std::optional<Checkpoint>>(options.checkpointCapacity);
	m_firstCheckpoint = 0;
	m_count = 0;
	m_intervalCycles = options.checkpointIntervalCycles;
	inputJournal.reset(options.inputCapacity);
	targetCycles = 0;
	m_targetTick = 0;
	m_endCycles = m_runtime.machine.scheduler.currentNowCycles();
	mode = HistoryMode::Recording;
	checkpointPending = true;
}

void RuntimeHistory::stop() {
	if (mode == HistoryMode::Disabled) return;
	if (mode == HistoryMode::Replaying || mode == HistoryMode::Reviewing) {
		m_runtime.frameScheduler.reset();
		m_runtime.frameLoop.abandonFrameState(m_runtime);
	}
	mode = HistoryMode::Disabled;
	checkpointPending = false;
	m_checkpoints.clear();
	m_count = 0;
	m_firstCheckpoint = 0;
	m_endCycles = 0;
	targetCycles = 0;
	inputJournal.reset(0);
}

void RuntimeHistory::captureCheckpoint() {
	const i64 cycles = m_runtime.machine.scheduler.currentNowCycles();
	Checkpoint checkpoint{cycles, inputJournal.endSequence, captureRuntimeSaveState(m_runtime)};
	if (m_count == m_checkpoints.size()) {
		m_checkpoints[m_firstCheckpoint] = std::move(checkpoint);
		m_firstCheckpoint = (m_firstCheckpoint + 1) % m_checkpoints.size();
	} else {
		m_checkpoints[(m_firstCheckpoint + m_count) % m_checkpoints.size()] = std::move(checkpoint);
		++m_count;
	}
	m_latestCheckpointInputSequence = inputJournal.endSequence;
	m_nextCheckpointCycles = cycles + m_intervalCycles;
	inputJournal.firstSequence = m_checkpoints[m_firstCheckpoint]->inputSequence;
	checkpointPending = false;
}

void RuntimeHistory::recordInputBoundary(bool high) {
	const i64 cycles = m_runtime.machine.scheduler.currentNowCycles();
	inputJournal.recordLine(cycles, high);
	m_endCycles = cycles;
	// Recycle expired snapshot storage at capture, not inside the ICU poll.
	while (m_checkpoints[m_firstCheckpoint]->inputSequence < inputJournal.firstSequence) {
		m_firstCheckpoint = (m_firstCheckpoint + 1) % m_checkpoints.size();
		--m_count;
	}
	checkpointPending = cycles >= m_nextCheckpointCycles
		|| inputJournal.endSequence - m_latestCheckpointInputSequence == static_cast<i64>(inputJournal.capacity());
}

void RuntimeHistory::beginSeek(i64 cycles) {
	cycles = std::clamp(cycles, earliestCycles(), m_endCycles);
	const Checkpoint* checkpoint = &*m_checkpoints[m_firstCheckpoint];
	for (size_t index = 1; index < m_count; ++index) {
		const auto& candidate = *m_checkpoints[(m_firstCheckpoint + index) % m_checkpoints.size()];
		if (candidate.cycles > cycles) break;
		checkpoint = &candidate;
	}
	const i64 endSequence = inputJournal.endAt(cycles);
	targetCycles = endSequence == checkpoint->inputSequence ? checkpoint->cycles : inputJournal.cycleAt(endSequence - 1);
	m_targetTick = checkpoint->state.machineState.frameScheduler.lastTickSequence + endSequence - checkpoint->inputSequence;
	applyRuntimeSaveState(m_runtime, checkpoint->state, RuntimeRestoreOrigin::HistorySeek);
	m_runtime.frameScheduler.reset();
	m_runtime.frameLoop.abandonFrameState(m_runtime);
	inputJournal.replaySequence = checkpoint->inputSequence;
	checkpointPending = false;
	mode = m_runtime.frameScheduler.lastTickSequence == m_targetTick ? HistoryMode::Reviewing : HistoryMode::Replaying;
}

HistorySeekResult RuntimeHistory::advanceSeek(i64 cycleGrant) {
	if (mode == HistoryMode::Reviewing) return HistorySeekResult::Complete;
	const i64 before = m_runtime.machine.scheduler.currentNowCycles();
	m_runtime.frameScheduler.runToNextLogicalTick(m_runtime, cycleGrant);
	if (m_runtime.frameScheduler.lastTickSequence == m_targetTick) {
		mode = HistoryMode::Reviewing;
		return HistorySeekResult::Complete;
	}
	if (m_runtime.machine.gxGpu.backendServicePending() || m_runtime.machine.gxGpu.backendServiceBlocksMachine()) return HistorySeekResult::BackendPending;
	return m_runtime.machine.scheduler.currentNowCycles() == before ? HistorySeekResult::Stopped : HistorySeekResult::Progressed;
}

void RuntimeHistory::resumeRecording() {
	const i64 cycles = m_runtime.machine.scheduler.currentNowCycles();
	while (m_count > 0) {
		const size_t index = (m_firstCheckpoint + m_count - 1) % m_checkpoints.size();
		if (m_checkpoints[index]->cycles <= cycles) break;
		m_checkpoints[index].reset();
		--m_count;
	}
	inputJournal.branch();
	m_runtime.frameScheduler.reset();
	m_runtime.frameLoop.abandonFrameState(m_runtime);
	m_endCycles = cycles;
	mode = HistoryMode::Recording;
	checkpointPending = true;
}

} // namespace bmsx
