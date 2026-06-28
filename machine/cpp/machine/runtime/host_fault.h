#pragma once

#include <optional>
#include <string>

namespace bmsx {

class Runtime;

class HostFaultState {
public:
	explicit HostFaultState(Runtime& runtime);

	auto getMessage() const -> const std::optional<std::string>&;
	void publishStartup(const std::string& error);
	void clear();

private:
	Runtime& m_runtime;
	std::optional<std::string> m_message;
};

}
