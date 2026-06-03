#include "machine/runtime/system_irq.h"

#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"

#include <stdexcept>

namespace bmsx {
namespace {

constexpr uint32_t SYSTEM_IRQ_MASK = IRQ_REINIT | IRQ_NEWGAME;

} // namespace

void raiseSystemIrq(Runtime& runtime, uint32_t mask) {
	if (mask == 0u) {
		throw BMSX_RUNTIME_ERROR("system IRQ mask must be non-zero.");
	}
	const uint32_t unsupported = mask & ~SYSTEM_IRQ_MASK;
	if (unsupported != 0u) {
		throw BMSX_RUNTIME_ERROR("unsupported system IRQ mask " + std::to_string(unsupported) + ".");
	}
	runtime.machine.irqController.raise(mask);
}

} // namespace bmsx
