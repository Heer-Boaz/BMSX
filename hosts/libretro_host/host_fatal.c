#include "host_fatal.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

void host_fatal(const char* format, ...) {
	va_list arguments;
	va_start(arguments, format);
	vfprintf(stderr, format, arguments);
	va_end(arguments);
	fputc('\n', stderr);
	exit(1);
}
