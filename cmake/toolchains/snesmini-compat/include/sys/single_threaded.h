// Compatibility shim for older glibc targets (e.g., SNES Mini).
// Avoids pulling in the __libc_single_threaded symbol from newer headers.
#ifndef BMSX_SNESTHREAD_SINGLE_THREADED_H
#define BMSX_SNESTHREAD_SINGLE_THREADED_H
static const char __libc_single_threaded = 1;
#endif
