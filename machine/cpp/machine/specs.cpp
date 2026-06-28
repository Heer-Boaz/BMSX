#include "machine/specs.h"

#include "machine/runtime/timing/index.h"
#include "rompack/loader.h"

#include <stdexcept>
#include <string>

namespace bmsx {

static constexpr const char* kCpuHzMissingMessage = "[RuntimeMachineSpecs] machine.specs.cpu.cpu_freq_hz is required.";
static constexpr const char* kCpuHzInvalidMessage = "[RuntimeMachineSpecs] machine.specs.cpu.cpu_freq_hz must be a positive integer.";
static constexpr const char* kUfpsMissingMessage = "[RuntimeMachineSpecs] machine.ufps is required.";
static constexpr const char* kUfpsInvalidMessage = "[RuntimeMachineSpecs] machine.ufps must be greater than 1 Hz.";

static std::runtime_error runtimeSpecFault(const std::string& message) {
	return std::runtime_error("Runtime fault: " + message);
}

template<typename Predicate>
static bool resolveValue(const std::optional<i64>& value, i64& out, Predicate predicate) {
	if (!value || !predicate(*value)) {
		return false;
	}
	out = *value;
	return true;
}

i64 requirePositiveManifestValue(const std::optional<i64>& value, const char* missingMessage, const char* invalidMessage) {
	if (!value) {
		throw std::runtime_error(missingMessage);
	}
	if (*value <= 0) {
		throw std::runtime_error(invalidMessage);
	}
	return *value;
}

// start value-or-boundary -- manifest defaults are resolved at the manifest boundary.
i64 resolvePositiveManifestValue(const std::optional<i64>& value, i64 defaultValue, const char* invalidMessage) {
	const i64 resolved = value.value_or(defaultValue);
	if (resolved <= 0) {
		throw std::runtime_error(invalidMessage);
	}
	return resolved;
}
// end value-or-boundary

i64 requireManifestValueAbove(const std::optional<i64>& value, i64 minimumExclusive, const char* missingMessage, const char* invalidMessage) {
	if (!value) {
		throw std::runtime_error(missingMessage);
	}
	if (*value <= minimumExclusive) {
		throw std::runtime_error(invalidMessage);
	}
	return *value;
}

bool resolveCpuHz(const MachineManifest& manifest, i64& outHz) {
	return resolveValue(manifest.cpuHz, outHz, [](i64 hz) {
		return hz > 0;
	});
}

i64 resolveCpuHz(const MachineManifest& manifest) {
	return requirePositiveManifestValue(manifest.cpuHz, kCpuHzMissingMessage, kCpuHzInvalidMessage);
}

bool resolveUfpsScaled(const MachineManifest& manifest, i64& outUfpsScaled) {
	return resolveValue(manifest.ufpsScaled, outUfpsScaled, [](i64 ufpsScaled) {
		return ufpsScaled > HZ_SCALE;
	});
}

i64 resolveUfpsScaled(const MachineManifest& manifest) {
	return requireManifestValueAbove(manifest.ufpsScaled, HZ_SCALE, kUfpsMissingMessage, kUfpsInvalidMessage);
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
