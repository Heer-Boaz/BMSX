#pragma once
#include "machine/memory/memory.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/control_port.h"
#include "machine/devices/input/output_port.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"
#include "machine/devices/input/sample_edge.h"
#include "machine/devices/input/save_state.h"

namespace bmsx {
class InputController {
public:
	InputController(Memory& memory, InputControllerInputSource& input);
	void reset();
	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);
	void cancelSampleArm();
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);

private:
	Memory& m_memory;
	InputControllerRegisterFile m_registers;
	InputControllerSampleLatch m_sampleLatch;
	InputControllerSampleEdge m_sampleEdge;
	InputControllerControlPort m_controlPort;
	InputControllerOutputPort m_outputPort;
};
} // namespace bmsx
