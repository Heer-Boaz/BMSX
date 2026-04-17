#include "machine/runtime/engine_irq.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {
namespace {

inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

constexpr uint32_t ENGINE_IRQ_MASK = IRQ_REINIT | IRQ_NEWGAME;

} // namespace

void raiseEngineIrq(Runtime& runtime, uint32_t mask) {
	if (mask == 0u) {
		throw runtimeFault("engine IRQ mask must be non-zero.");
	}
	const uint32_t unsupported = mask & ~ENGINE_IRQ_MASK;
	if (unsupported != 0u) {
		throw runtimeFault("unsupported engine IRQ mask " + std::to_string(unsupported) + ".");
	}
	runtime.machine().irqController().raise(mask);
}

} // namespace bmsx
