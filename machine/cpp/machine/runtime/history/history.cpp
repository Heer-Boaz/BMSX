#include "machine/runtime/history/history.h"
#include "machine/runtime/runtime.h"
#include <algorithm>
#include <limits>

namespace bmsx {

bool RuntimeHistory::canSeekFrom(i64 checkpoint, i64 cycles) const {
	if (cycles < earliestCycles() || cycles > endCycles) return false;
	size_t first = 0, end = count;
	while (first < end) {
		const size_t middle = first + (end - first) / 2;
		const auto& candidate = *checkpoints[(firstCheckpoint + middle) % checkpoints.size()];
		if (candidate.id < checkpoint) first = middle + 1;
		else if (candidate.id > checkpoint) end = middle;
		else return cycles >= candidate.cycles && cycles < candidate.seekUntilCycles;
	}
	return false;
}

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

void RuntimeHistory::resetFrameAdmission() {
	runtime.frameScheduler.reset();
	// Dropping host pacing must not discard an accepted instruction whose
	// cycles are still waiting to become visible to the emulated devices.
	if (!runtime.machine.cpu.allocationParked()) runtime.frameLoop.abandonFrameState(runtime);
}

void RuntimeHistory::stop() {
	if (mode == HistoryMode::Disabled) return;
	if (mode == HistoryMode::Replaying || mode == HistoryMode::Reviewing) {
		if (onWillEndReview) onWillEndReview();
		resetFrameAdmission();
	}
	mode = HistoryMode::Disabled;
	checkpointPending = false;
	checkpoints.clear();
	ramHistory.clear();
	ramBaseSlot.reset();
	runtime.machine.memory.ramWriteWatches().disarmHistoryWrites();
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
	auto& checkpoint = slot ? *slot : slot.emplace();
	checkpoint.id = nextCheckpointId++;
	checkpoint.cycles = cycles;
	checkpoint.seekUntilCycles = std::numeric_limits<i64>::max();
	checkpoint.inputSequence = inputJournal.endSequence;
	captureRuntimeCheckpointState(runtime, checkpoint.state);
	ramHistory.capture(runtime.machine.memory, ramBaseSlot ? &checkpoints[*ramBaseSlot]->ram : nullptr, checkpoint.ram);
	ramBaseSlot = index;
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
	size_t slot = firstCheckpoint;
	for (size_t index = 1; index < count; ++index) {
		const size_t candidate = (firstCheckpoint + index) % checkpoints.size();
		if (checkpoints[candidate]->cycles > cycles) break;
		slot = candidate;
	}
	const auto& checkpoint = *checkpoints[slot];
	const i64 endSequence = inputJournal.endAt(cycles);
	targetCycles = endSequence == checkpoint.inputSequence ? checkpoint.cycles : inputJournal.cycleAt(endSequence - 1);
	targetTick = checkpoint.state.machineState.frameScheduler.lastTickSequence + endSequence - checkpoint.inputSequence;
	ramHistory.restore(runtime.machine.memory, checkpoints[*ramBaseSlot]->ram, checkpoint.ram);
	ramBaseSlot = slot;
	applyRuntimeCheckpointState(runtime, checkpoint.state, RuntimeRestoreOrigin::HistorySeek);
	resetFrameAdmission();
	inputJournal.replaySequence = checkpoint.inputSequence;
	checkpointPending = false;
	mode = runtime.frameScheduler.lastTickSequence == targetTick ? HistoryMode::Reviewing : HistoryMode::Replaying;
}

HistorySeekResult RuntimeHistory::advanceSeek(i64 cycleGrant) {
	if (mode == HistoryMode::Reviewing) return HistorySeekResult::Complete;
	const i64 before = runtime.machine.scheduler.currentNowCycles();
	const i64 budgetBefore = runtime.frameScheduler.remainingCycleBudget(runtime);
	const auto result = runtime.frameScheduler.advanceLogicalTick(runtime, cycleGrant);
	if (runtime.frameScheduler.lastTickSequence == targetTick) {
		mode = HistoryMode::Reviewing;
		return HistorySeekResult::Complete;
	}
	if (runtime.machine.gxGpu.backendServicePending() || runtime.machine.gxGpu.backendServiceBlocksMachine()) return HistorySeekResult::BackendPending;
	if (result == LogicalTickResult::Maintenance || result == LogicalTickResult::DeferredCpu)
		return HistorySeekResult::Progressed;
	// A grant can pay for an indivisible instruction already executed without advancing the clock.
	if (runtime.machine.scheduler.currentNowCycles() != before
		|| (budgetBefore < 0 && runtime.frameScheduler.remainingCycleBudget(runtime) > budgetBefore)) return HistorySeekResult::Progressed;
	return HistorySeekResult::Stopped;
}

void RuntimeHistory::beginPlayback() {
	const auto& checkpoint = *checkpoints[firstCheckpoint];
	targetCycles = endCycles;
	targetTick = checkpoint.state.machineState.frameScheduler.lastTickSequence
		+ inputJournal.endSequence - checkpoint.inputSequence;
	resetFrameAdmission();
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
	if (onWillEndReview) onWillEndReview();
	if (onWillResumeRecording) onWillResumeRecording(!rejoiningLatest);
	while (count > 0) {
		const size_t index = (firstCheckpoint + count - 1) % checkpoints.size();
		if (checkpoints[index]->cycles <= cycles) break;
		// Discard the future logically; retain slot storage for the new branch.
		--count;
	}
	if (!rejoiningLatest) for (size_t index = 0; index < count; ++index) {
		auto& checkpoint = *checkpoints[(firstCheckpoint + index) % checkpoints.size()];
		checkpoint.seekUntilCycles = std::min(checkpoint.seekUntilCycles, cycles);
	}
	inputJournal.branch();
	resetFrameAdmission();
	endCycles = cycles;
	mode = HistoryMode::Recording;
	checkpointPending = !rejoiningLatest || cycles >= nextCheckpointCycles
		|| inputJournal.endSequence - latestCheckpointInputSequence == static_cast<i64>(inputJournal.capacity());
}

} // namespace bmsx
