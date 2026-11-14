#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static atomic_uint main_reads;
static atomic_uint process_reads;

int clock_gettime(clockid_t clock_id, struct timespec* output) {
	if (clock_id != CLOCK_THREAD_CPUTIME_ID && clock_id != CLOCK_PROCESS_CPUTIME_ID) {
		int (*real_clock_gettime)(clockid_t, struct timespec*);
		void* symbol = dlsym(RTLD_NEXT, "clock_gettime");
		memcpy(&real_clock_gettime, &symbol, sizeof(real_clock_gettime));
		return real_clock_gettime(clock_id, output);
	}
	atomic_uint* reads = clock_id == CLOCK_THREAD_CPUTIME_ID ? &main_reads : &process_reads;
	const unsigned index = atomic_fetch_add_explicit(reads, 1u, memory_order_relaxed);
	const char* mode = getenv("BMSX_TEST_CPU_CLOCK_MODE");
	if (strcmp(mode, "error") == 0) {
		errno = EINVAL;
		return -1;
	}
	const uint64_t step_ns = clock_id == CLOCK_THREAD_CPUTIME_ID ? 10000000u : 30000000u;
	const uint64_t timestamp_ns = strcmp(mode, "constant") == 0 ? 0u : index * step_ns;
	output->tv_sec = 123 + timestamp_ns / 1000000000u;
	output->tv_nsec = timestamp_ns % 1000000000u;
	return 0;
}

__attribute__((destructor)) static void print_cpu_reads(void) {
	fprintf(stderr, "[cpu-clock-fixture] main_reads=%u process_reads=%u\n",
		atomic_load_explicit(&main_reads, memory_order_relaxed),
		atomic_load_explicit(&process_reads, memory_order_relaxed));
}
