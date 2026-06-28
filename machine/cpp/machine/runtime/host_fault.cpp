#include "host_fault.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

namespace bmsx {

HostFaultState::HostFaultState(Runtime& runtime)
	: m_runtime(runtime) {
}

// disable-next-line single_line_method_pattern -- host-fault message is read through the mirrored TS/C++ runtime state owner.
auto HostFaultState::getMessage() const -> const std::optional<std::string>& {
	return m_message;
}

void HostFaultState::publishStartup(const std::string& error) {
	m_message = error;
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(static_cast<double>(HOST_FAULT_FLAG_ACTIVE | HOST_FAULT_FLAG_STARTUP_BLOCKING)));
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH)));
}

void HostFaultState::clear() {
	m_message.reset();
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	m_runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
}

}
