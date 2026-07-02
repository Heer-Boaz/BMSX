#include "host_fault.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

namespace bmsx {

HostFaultState::HostFaultState(Runtime& runtime)
	: m_runtime(runtime) {
}

void HostFaultState::publishStartup() {
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(static_cast<double>(HOST_FAULT_FLAG_ACTIVE | HOST_FAULT_FLAG_STARTUP_BLOCKING)));
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH)));
}

void HostFaultState::clear() {
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
}

}
