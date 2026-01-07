// libstdc++ configuration shim for old glibc targets (e.g. SNES Mini).
// We build with modern libstdc++ headers, but target an older glibc userspace.
// Disable libstdc++ feature toggles that assume newer pthread APIs.
#pragma once

#include_next <bits/c++config.h>

#undef _GLIBCXX_USE_PTHREAD_COND_CLOCKWAIT
#undef _GLIBCXX_USE_PTHREAD_MUTEX_CLOCKLOCK
#undef _GLIBCXX_USE_PTHREAD_RWLOCK_CLOCKLOCK
