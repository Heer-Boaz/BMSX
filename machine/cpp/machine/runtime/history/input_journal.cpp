#include "machine/runtime/history/input_journal.h"

namespace bmsx {

void InputJournal::reset(size_t capacity) {
	m_cycles = std::vector<i64>(capacity);
	m_words = std::vector<u32>(capacity * RECORD_WORD_COUNT);
	firstSequence = 0;
	endSequence = 0;
	replaySequence = 0;
	m_sampleFlags = 0;
}

void InputJournal::recordSample(const InputControllerSnapshot& snapshot, InputControllerSampleContext context) {
	m_sampleFlags = 1u | (static_cast<u32>(context) << 1u);
	storeInputControllerSnapshotWords(snapshot, m_words, (endSequence % capacity()) * RECORD_WORD_COUNT + 1);
}

void InputJournal::recordLine(i64 cycles, bool high) {
	const size_t index = endSequence % capacity();
	m_cycles[index] = cycles;
	m_words[index * RECORD_WORD_COUNT] = m_sampleFlags | (high ? SUPERVISOR_LINE_HIGH : 0u);
	m_sampleFlags = 0;
	++endSequence;
	if (endSequence - firstSequence > static_cast<i64>(capacity())) ++firstSequence;
}

void InputJournal::replaySample(InputControllerSnapshot& snapshot) const {
	loadInputControllerSnapshotWords(snapshot, m_words, (replaySequence % capacity()) * RECORD_WORD_COUNT + 1);
}

bool InputJournal::replayLine() {
	const bool high = (m_words[(replaySequence % capacity()) * RECORD_WORD_COUNT] & SUPERVISOR_LINE_HIGH) != 0u;
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
