#pragma once

#include <string>

namespace bmsx {

class Runtime;

class HostFaultState {
public:
	explicit HostFaultState(Runtime& runtime);

	void publishStartup(const std::string& error);
	void clear();

private:
	Runtime& m_runtime;
};

}
