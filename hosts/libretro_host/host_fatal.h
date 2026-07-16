#ifndef BMSX_LIBRETRO_HOST_FATAL_H
#define BMSX_LIBRETRO_HOST_FATAL_H

__attribute__((noreturn, format(printf, 1, 2)))
void host_fatal(const char* format, ...);

#endif
