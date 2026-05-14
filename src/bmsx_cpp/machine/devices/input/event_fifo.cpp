#include "machine/devices/input/event_fifo.h"

namespace bmsx {

u32 InputControllerEventFifo::count() const {
	return m_queuedCount;
}

bool InputControllerEventFifo::overflow() const {
	return m_overflowLatched;
}

u32 InputControllerEventFifo::statusWord() const {
	return (m_queuedCount == 0u ? INP_EVENT_STATUS_EMPTY : 0u)
		| (m_queuedCount == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY ? INP_EVENT_STATUS_FULL : 0u)
		| (m_overflowLatched ? INP_EVENT_STATUS_OVERFLOW : 0u);
}

const InputControllerEventState& InputControllerEventFifo::front() const {
	if (m_queuedCount == 0u) {
		return m_slots[0];
	}
	return m_slots[m_readIndex];
}

void InputControllerEventFifo::push(u32 player, const InputControllerActionState& action) {
	if (m_queuedCount == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
		m_overflowLatched = true;
		return;
	}
	InputControllerEventState& slot = m_slots[m_writeIndex];
	slot.player = player;
	slot.actionStringId = action.actionStringId;
	slot.statusWord = action.statusWord;
	slot.valueQ16 = action.valueQ16;
	slot.repeatCount = action.repeatCount;
	m_writeIndex += 1u;
	if (m_writeIndex == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
		m_writeIndex = 0u;
	}
	m_queuedCount += 1u;
}

void InputControllerEventFifo::pop() {
	if (m_queuedCount == 0u) {
		return;
	}
	m_slots[m_readIndex] = InputControllerEventState{};
	m_readIndex += 1u;
	if (m_readIndex == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
		m_readIndex = 0u;
	}
	m_queuedCount -= 1u;
}

void InputControllerEventFifo::clear() {
	m_slots.fill(InputControllerEventState{});
	m_readIndex = 0u;
	m_writeIndex = 0u;
	m_queuedCount = 0u;
	m_overflowLatched = false;
}

std::vector<InputControllerEventState> InputControllerEventFifo::captureEvents() const {
	std::vector<InputControllerEventState> events;
	events.reserve(m_queuedCount);
	u32 entry = m_readIndex;
	for (u32 index = 0u; index < m_queuedCount; index += 1u) {
		events.push_back(m_slots[entry]);
		entry += 1u;
		if (entry == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			entry = 0u;
		}
	}
	return events;
}

void InputControllerEventFifo::restore(const std::vector<InputControllerEventState>& events, bool overflow) {
	clear();
	for (const InputControllerEventState& event : events) {
		m_slots[m_writeIndex] = event;
		m_writeIndex += 1u;
		if (m_writeIndex == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			m_writeIndex = 0u;
		}
		m_queuedCount += 1u;
	}
	m_overflowLatched = overflow;
}

} // namespace bmsx
