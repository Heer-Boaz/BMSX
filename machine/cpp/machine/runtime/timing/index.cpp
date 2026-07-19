#include "machine/runtime/timing/index.h"

namespace bmsx {

i64 calcCyclesPerFrameScaled(i64 cpuHz, i64 refreshHzScaled) {
	const i64 whole = (cpuHz / refreshHzScaled) * HZ_SCALE;
	const i64 remainder = ((cpuHz % refreshHzScaled) * HZ_SCALE) / refreshHzScaled;
	return whole + remainder;
}

} // namespace bmsx
