#pragma once

#include "machine/devices/input/contracts.h"
#include <vector>

namespace bmsx {

class InputJournal {
public:
	i64 firstSequence = 0;
	i64 endSequence = 0;
	i64 replaySequence = 0;
	size_t capacity() const { return m_cycles.size(); }
	size_t storageBytes() const { return m_cycles.size() * sizeof(i64) + m_words.size() * sizeof(u32); }
	void reset(size_t capacity);
	void recordSample(const InputControllerSnapshot& snapshot, InputControllerSampleContext context);
	void recordLine(i64 cycles, bool high);
	void replaySample(InputControllerSnapshot& snapshot) const;
	bool replayLine();
	i64 cycleAt(i64 sequence) const { return m_cycles[sequence % capacity()]; }
	u32 flagsAt(i64 sequence) const { return m_words[(sequence % capacity()) * RECORD_WORD_COUNT]; }
	i64 endAt(i64 cycles) const;
	void branch() { endSequence = replaySequence; }
private:
	static constexpr size_t RECORD_WORD_COUNT = 1 + INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT;
	static constexpr u32 SUPERVISOR_LINE_HIGH = 4;
	std::vector<i64> m_cycles;
	std::vector<u32> m_words;
	u32 m_sampleFlags = 0;
};

} // namespace bmsx
