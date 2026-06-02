#include "machine/devices/input/event_fifo.h"

#include "machine/bus/io.h"
#include "machine/memory/memory.h"

#include <stdexcept>

namespace bmsx {

InputControllerEventFifo::InputControllerEventFifo(Memory& memory)
	: m_memory(memory) {
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input event FIFO instance.
Value InputControllerEventFifo::readRegisterThunk(void* context, u32 addr) {
	return static_cast<InputControllerEventFifo*>(context)->readRegister(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input event FIFO instance.
void InputControllerEventFifo::writeEventControlRegisterThunk(void* context, u32, Value value) {
	static_cast<InputControllerEventFifo*>(context)->writeEventControlRegister(value);
}

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

Value InputControllerEventFifo::readRegister(u32 addr) const {
	switch (addr) {
		case IO_INP_EVENT_STATUS:
			return valueNumber(static_cast<double>(statusWord()));
		case IO_INP_EVENT_COUNT:
			return valueNumber(static_cast<double>(m_queuedCount));
		case IO_INP_EVENT_PLAYER:
			return valueNumber(static_cast<double>(front().player));
		case IO_INP_EVENT_ACTION:
			return valueString(front().actionStringId);
		case IO_INP_EVENT_FLAGS:
			return valueNumber(static_cast<double>(front().statusWord));
		case IO_INP_EVENT_VALUE:
			return valueNumber(static_cast<double>(front().valueQ16));
		case IO_INP_EVENT_REPEAT_COUNT:
			return valueNumber(static_cast<double>(front().repeatCount));
		case IO_INP_EVENT_CTRL:
			return valueNumber(0.0);
	}
	throw std::runtime_error("ICU event register read is not mapped.");
}

void InputControllerEventFifo::writeControl(u32 command) {
	switch (command) {
		case INP_EVENT_CTRL_POP:
			pop();
			return;
		case INP_EVENT_CTRL_CLEAR:
			clear();
			return;
	}
}

void InputControllerEventFifo::writeEventControlRegister(Value value) {
	writeControl(toU32(value));
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
}

void InputControllerEventFifo::push(u32 player, StringId actionStringId, u32 statusWord, u32 valueQ16, u32 repeatCount) {
	if (m_queuedCount == INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
		m_overflowLatched = true;
		return;
	}
	InputControllerEventState& slot = m_slots[m_writeIndex];
	slot.player = player;
	slot.actionStringId = actionStringId;
	slot.statusWord = statusWord;
	slot.valueQ16 = valueQ16;
	slot.repeatCount = repeatCount;
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
