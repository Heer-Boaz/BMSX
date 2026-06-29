#include "machine/specs.h"

#include "rompack/format.h"

#include <stdexcept>
#include <string>

namespace bmsx {

static std::runtime_error runtimeSpecFault(const std::string& message) {
	return std::runtime_error("Runtime fault: " + message);
}

i64 resolvePositiveSafeInteger(i64 value, const char* label) {
	if (value <= 0) {
		throw runtimeSpecFault(std::string(label) + " must be a positive safe integer.");
	}
	return value;
}

RuntimeRenderSize resolveRuntimeRenderSize(const MachineManifest& manifest) {
	return {
		static_cast<i32>(resolvePositiveSafeInteger(manifest.viewportWidth, "machine.render_size.width")),
		static_cast<i32>(resolvePositiveSafeInteger(manifest.viewportHeight, "machine.render_size.height")),
	};
}

} // namespace bmsx
