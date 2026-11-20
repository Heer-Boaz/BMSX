#pragma once

namespace bmsx {

// Shared native leaf for fixed-string reads. Its cold edge tail-enters the
// semantic lookup with the original request, without committing a guest read.
void* nativeFixedStringLookup();

} // namespace bmsx
