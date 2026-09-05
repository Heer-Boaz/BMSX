#pragma once

#include "machine/runtime/save_state.h"
#include "machine/runtime/history/input_journal.h"
#include "machine/runtime/history/input_source.h"
#include <optional>
#include <vector>

namespace bmsx {

class Runtime;
enum class HistoryMode { Disabled, Recording, Replaying, Reviewing };
enum class HistorySeekResult { Progressed, BackendPending, Complete, Stopped };

struct HistoryOptions {
	size_t checkpointCapacity;
	size_t inputCapacity;
	i64 checkpointIntervalCycles;
};

class RuntimeHistory {
public:
	RuntimeHistory(Runtime& runtime, InputControllerInputSource& liveInput) : input(*this, liveInput), m_runtime(runtime) {}
	HistoryMode mode = HistoryMode::Disabled;
	bool checkpointPending = false;
	InputJournal inputJournal;
	HistoryInputSource input;
	i64 targetCycles = 0;
	size_t checkpointCount() const { return m_count; }
	i64 earliestCycles() const { return m_count == 0 ? 0 : m_checkpoints[m_firstCheckpoint]->cycles; }
	i64 latestCycles() const { return m_endCycles; }
	bool executionPaused() const { return checkpointPending || mode == HistoryMode::Reviewing; }
	void start(const HistoryOptions& options);
	void stop();
	// The host synchronizes VRAM while holding machine execution before this call.
	void captureCheckpoint();
	void recordInputBoundary(bool high);
	void beginSeek(i64 cycles);
	HistorySeekResult advanceSeek(i64 cycleGrant);
	void cancelSeek() { mode = HistoryMode::Reviewing; }
	void resumeRecording();
private:
	struct Checkpoint {
		i64 cycles;
		i64 inputSequence;
		RuntimeSaveState state;
	};
	Runtime& m_runtime;
	std::vector<std::optional<Checkpoint>> m_checkpoints;
	size_t m_firstCheckpoint = 0;
	size_t m_count = 0;
	i64 m_intervalCycles = 0;
	i64 m_nextCheckpointCycles = 0;
	i64 m_latestCheckpointInputSequence = 0;
	i64 m_endCycles = 0;
	i64 m_targetTick = 0;
};

} // namespace bmsx
