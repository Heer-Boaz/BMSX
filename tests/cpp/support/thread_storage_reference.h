#pragma once

#include "machine/cpu/thread_record.h"

namespace bmsx::test {

class GcHeap;

bool resizeReferenceThreadBacking(GcHeap&, u32 address, u32 capacity);
u32 shrinkReferenceThreadStack(GcHeap&, u32 address, const ThreadStorageLayout& layout);

} // namespace bmsx::test
