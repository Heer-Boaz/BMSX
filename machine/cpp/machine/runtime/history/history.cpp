#include "machine/runtime/history/history.h"
#include "machine/runtime/runtime.h"
#include <algorithm>

namespace bmsx {

void RuntimeHistory::start(const HistoryOptions& options) {
	checkpoints = std::vector<std::optional<Checkpoint>>(options.checkpointCapacity);
	firstCheckpoint = 0;
	count = 0;
	intervalCycles = options.checkpointIntervalCycles;
	inputJournal.reset(options.inputCapacity);
	targetCycles = 0;
	targetTick = 0;
	endCycles = runtime.machine.scheduler.currentNowCycles();
	mode = HistoryMode::Recording;
	checkpointPending = true;
}

void RuntimeHistory::stop() {
	if (mode == HistoryMode::Disabled) return;
	if (mode == HistoryMode::Replaying || mode == HistoryMode::Reviewing) {
		runtime.frameScheduler.reset();
		runtime.frameLoop.abandonFrameState(runtime);
	}
	mode = HistoryMode::Disabled;
	checkpointPending = false;
	checkpoints.clear();
	count = 0;
	firstCheckpoint = 0;
	endCycles = 0;
	targetCycles = 0;
	inputJournal.reset(0);
}

void RuntimeHistory::captureCheckpoint() {
	const i64 cycles = runtime.machine.scheduler.currentNowCycles();
	const size_t index = (firstCheckpoint + count) % checkpoints.size();
	auto& slot = checkpoints[index];
	// Only the evicted/inactive slot owns storage that may be overwritten.
	RuntimeSaveState storage = slot ? std::move(slot->state) : RuntimeSaveState{};
	slot = Checkpoint{cycles, inputJournal.endSequence, captureRuntimeSaveState(runtime, std::move(storage))};
	if (count == checkpoints.size()) {
		firstCheckpoint = (firstCheckpoint + 1) % checkpoints.size();
	} else {
		++count;
	}
	latestCheckpointInputSequence = inputJournal.endSequence;
	nextCheckpointCycles = cycles + intervalCycles;
	inputJournal.firstSequence = checkpoints[firstCheckpoint]->inputSequence;
	checkpointPending = false;
}

void RuntimeHistory::recordInputBoundary(bool high) {
	const i64 cycles = runtime.machine.scheduler.currentNowCycles();
	inputJournal.recordLine(cycles, high);
	endCycles = cycles;
	// Recycle expired snapshot storage at capture, not inside the ICU poll.
	while (checkpoints[firstCheckpoint]->inputSequence < inputJournal.firstSequence) {
		firstCheckpoint = (firstCheckpoint + 1) % checkpoints.size();
		--count;
	}
	checkpointPending = cycles >= nextCheckpointCycles
		|| inputJournal.endSequence - latestCheckpointInputSequence == static_cast<i64>(inputJournal.capacity());
}

void RuntimeHistory::beginSeek(i64 cycles) {
	cycles = std::clamp(cycles, earliestCycles(), endCycles);
	const Checkpoint* checkpoint = &*checkpoints[firstCheckpoint];
	for (size_t index = 1; index < count; ++index) {
		const auto& candidate = *checkpoints[(firstCheckpoint + index) % checkpoints.size()];
		if (candidate.cycles > cycles) break;
		checkpoint = &candidate;
	}
	const i64 endSequence = inputJournal.endAt(cycles);
	targetCycles = endSequence == checkpoint->inputSequence ? checkpoint->cycles : inputJournal.cycleAt(endSequence - 1);
	targetTick = checkpoint->state.machineState.frameScheduler.lastTickSequence + endSequence - checkpoint->inputSequence;
	applyRuntimeSaveState(runtime, checkpoint->state, RuntimeRestoreOrigin::HistorySeek);
	runtime.frameScheduler.reset();
	runtime.frameLoop.abandonFrameState(runtime);
	inputJournal.replaySequence = checkpoint->inputSequence;
	checkpointPending = false;
	mode = runtime.frameScheduler.lastTickSequence == targetTick ? HistoryMode::Reviewing : HistoryMode::Replaying;
}

HistorySeekResult RuntimeHistory::advanceSeek(i64 cycleGrant) {
	if (mode == HistoryMode::Reviewing) return HistorySeekResult::Complete;
	const i64 before = runtime.machine.scheduler.currentNowCycles();
	runtime.frameScheduler.runToNextLogicalTick(runtime, cycleGrant);
	if (runtime.frameScheduler.lastTickSequence == targetTick) {
		mode = HistoryMode::Reviewing;
		return HistorySeekResult::Complete;
	}
	if (runtime.machine.gxGpu.backendServicePending() || runtime.machine.gxGpu.backendServiceBlocksMachine()) return HistorySeekResult::BackendPending;
	return runtime.machine.scheduler.currentNowCycles() == before ? HistorySeekResult::Stopped : HistorySeekResult::Progressed;
}

void RuntimeHistory::beginPlayback() {
	const auto& checkpoint = *checkpoints[firstCheckpoint];
	targetCycles = endCycles;
	targetTick = checkpoint.state.machineState.frameScheduler.lastTickSequence
		+ inputJournal.endSequence - checkpoint.inputSequence;
	runtime.frameScheduler.reset();
	runtime.frameLoop.abandonFrameState(runtime);
	mode = runtime.frameScheduler.lastTickSequence == targetTick ? HistoryMode::Reviewing : HistoryMode::Replaying;
}

void RuntimeHistory::advancePlayback(f64 hostDeltaMs) {
	while (mode == HistoryMode::Replaying) {
		const bool completed = runtime.frameScheduler.runScheduledToNextLogicalTick(runtime, hostDeltaMs);
		hostDeltaMs = 0;
		if (runtime.frameScheduler.lastTickSequence == targetTick) mode = HistoryMode::Reviewing;
		if (!completed) break;
	}
}

void RuntimeHistory::resumeRecording() {
	const i64 cycles = runtime.machine.scheduler.currentNowCycles();
	const bool rejoiningLatest = cycles == endCycles;
	while (count > 0) {
		const size_t index = (firstCheckpoint + count - 1) % checkpoints.size();
		if (checkpoints[index]->cycles <= cycles) break;
		// Discard the future logically; retain slot storage for the new branch.
		--count;
	}
	inputJournal.branch();
	runtime.frameScheduler.reset();
	runtime.frameLoop.abandonFrameState(runtime);
	endCycles = cycles;
	mode = HistoryMode::Recording;
	checkpointPending = !rejoiningLatest || cycles >= nextCheckpointCycles
		|| inputJournal.endSequence - latestCheckpointInputSequence == static_cast<i64>(inputJournal.capacity());
}

} // namespace bmsx
