#include "machine/runtime/engine_irq.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {
namespace {

constexpr uint32_t ENGINE_IRQ_MASK = IRQ_REINIT | IRQ_NEWGAME;

} // namespace

void raiseEngineIrq(Runtime& runtime, uint32_t mask) {
	if (mask == 0u) {
		throw BMSX_RUNTIME_ERROR("engine IRQ mask must be non-zero.");
	}
	const uint32_t unsupported = mask & ~ENGINE_IRQ_MASK;
	if (unsupported != 0u) {
		throw BMSX_RUNTIME_ERROR("unsupported engine IRQ mask " + std::to_string(unsupported) + ".");
	}
	runtime.machine().irqController().raise(mask);
}

} // namespace bmsx
