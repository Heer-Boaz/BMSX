#pragma once

#include "machine/devices/input/contracts.h"
#include <vector>

namespace bmsx {

class InputJournal {
public:
	i64 firstSequence = 0;
	i64 endSequence = 0;
	i64 replaySequence = 0;
	size_t capacity() const { return cycles.size(); }
	size_t storageBytes() const { return cycles.size() * sizeof(i64) + words.size() * sizeof(u32); }
	void reset(size_t capacity);
	void recordSample(const InputControllerSnapshot& snapshot, InputControllerSampleContext context);
	void recordLine(i64 cycles, bool high);
	void replaySample(InputControllerSnapshot& snapshot) const;
	bool replayLine();
	i64 cycleAt(i64 sequence) const { return cycles[sequence % capacity()]; }
	u32 flagsAt(i64 sequence) const { return words[(sequence % capacity()) * RECORD_WORD_COUNT]; }
	i64 endAt(i64 cycles) const;
	void branch() { endSequence = replaySequence; }
private:
	static constexpr size_t RECORD_WORD_COUNT = 1 + INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT;
	static constexpr u32 SUPERVISOR_LINE_HIGH = 4;
	std::vector<i64> cycles;
	std::vector<u32> words;
	u32 sampleFlags = 0;
};

} // namespace bmsx
