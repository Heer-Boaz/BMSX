#include "machine/runtime/history/input_journal.h"

namespace bmsx {

void InputJournal::reset(size_t capacity) {
	cycles = std::vector<i64>(capacity);
	words = std::vector<u32>(capacity * RECORD_WORD_COUNT);
	firstSequence = 0;
	endSequence = 0;
	replaySequence = 0;
	sampleFlags = 0;
}

void InputJournal::recordSample(const InputControllerSnapshot& snapshot, InputControllerSampleContext context) {
	sampleFlags = 1u | (static_cast<u32>(context) << 1u);
	storeInputControllerSnapshotWords(snapshot, words, (endSequence % capacity()) * RECORD_WORD_COUNT + 1);
}

void InputJournal::recordLine(i64 cycles, bool high) {
	const size_t index = endSequence % capacity();
	this->cycles[index] = cycles;
	words[index * RECORD_WORD_COUNT] = sampleFlags | (high ? SUPERVISOR_LINE_HIGH : 0u);
	sampleFlags = 0;
	++endSequence;
	if (endSequence - firstSequence > static_cast<i64>(capacity())) ++firstSequence;
}

void InputJournal::replaySample(InputControllerSnapshot& snapshot) const {
	loadInputControllerSnapshotWords(snapshot, words, (replaySequence % capacity()) * RECORD_WORD_COUNT + 1);
}

bool InputJournal::replayLine() {
	const bool high = (words[(replaySequence % capacity()) * RECORD_WORD_COUNT] & SUPERVISOR_LINE_HIGH) != 0u;
	++replaySequence;
	return high;
}

i64 InputJournal::endAt(i64 cycles) const {
	i64 first = firstSequence;
	i64 end = endSequence;
	while (first < end) {
		const i64 middle = first + (end - first) / 2;
		if (cycleAt(middle) <= cycles) first = middle + 1;
		else end = middle;
	}
	return first;
}

} // namespace bmsx
