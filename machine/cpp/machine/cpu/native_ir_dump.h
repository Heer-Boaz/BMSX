#pragma once

#include <iosfwd>

namespace bmsx {

class NativeIrRegion;

// Deterministic diagnostic view of the IR, without host addresses or caches.
void dumpNativeIr(std::ostream& out, const NativeIrRegion& region);

} // namespace bmsx
