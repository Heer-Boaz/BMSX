#pragma once

#include "machine/devices/input/save_state.h"

#include <array>
#include <vector>

namespace bmsx {

class InputControllerEventFifo {
public:
	u32 count() const;
	bool overflow() const;
	u32 statusWord() const;
	const InputControllerEventState& front() const;
	void push(u32 player, const InputControllerActionState& action);
	void pop();
	void clear();
	std::vector<InputControllerEventState> captureEvents() const;
	void restore(const std::vector<InputControllerEventState>& events, bool overflow);

private:
	std::array<InputControllerEventState, INPUT_CONTROLLER_EVENT_FIFO_CAPACITY> m_slots{};
	u32 m_readIndex = 0;
	u32 m_writeIndex = 0;
	u32 m_queuedCount = 0;
	bool m_overflowLatched = false;
};

} // namespace bmsx
