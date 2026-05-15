#pragma once

#include "machine/memory/memory.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/output_port.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"
#include "machine/devices/input/save_state.h"
#include "input/manager.h"
#include <string>

namespace bmsx {

class InputController {
public:
	InputController(Memory& memory, Input& input, const StringPool& strings);

	void reset();
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);

private:
	static void onRegisterWriteThunk(void* context, uint32_t addr, Value value);
	static Value onEventRegisterReadThunk(void* context, uint32_t addr);
	static void onEventCtrlWriteThunk(void* context, uint32_t addr, Value value);
	static Value onOutputRegisterReadThunk(void* context, uint32_t addr);
	static void onOutputCtrlWriteThunk(void* context, uint32_t addr, Value value);

	Memory& m_memory;
	const StringPool& m_strings;
	InputControllerActionTable m_actionTable;
	InputControllerRegisterState m_registers;
	InputControllerEventFifo m_eventFifo;

public:
	InputControllerSampleLatch sampleLatch;

private:
	InputControllerOutputPort m_outputPort;
	InputControllerQueryResult m_queryResult;

	void onRegisterWrite(uint32_t addr, Value value);
	void onCtrlWrite(u32 command);
	Value onEventRegisterRead(uint32_t addr) const;
	void onEventCtrlWrite(u32 command);
	Value onOutputRegisterRead(uint32_t addr) const;
	void onOutputCtrlWrite(u32 command);
	void queryAction();
	void consumeActions();
	void resetActions();
	void writeResult(u32 status, u32 value);
	void mirrorRegisters();
};

} // namespace bmsx
