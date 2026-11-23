#ifndef BMSX_DLMALLOC_H
#define BMSX_DLMALLOC_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Native pointers are only views; all persistent words contain RAM offsets.
// The caller supplies the private metadata area and existing rewind groups.
typedef struct {
	unsigned char* ram;
	uint32_t state;
	uint32_t* watched_groups;
} bmsx_dlmalloc_arena;

enum {
	BMSX_DLMALLOC_STATE_OFFSET = 0x400,
	BMSX_DLMALLOC_PAGE_BYTES = 4096,
	BMSX_DLMALLOC_WATCH_SHIFT = 10,
	BMSX_DLMALLOC_HISTORY_CLEAN = 1u << 8,
};

void bmsx_dlmalloc_reset(bmsx_dlmalloc_arena, uint32_t floor, uint32_t limit);
int bmsx_dlmalloc_set_floor(bmsx_dlmalloc_arena, uint32_t floor);
uint32_t bmsx_dlmalloc_floor(bmsx_dlmalloc_arena);
uint32_t bmsx_dlmalloc_allocate(bmsx_dlmalloc_arena, uint32_t bytes, int object);
void bmsx_dlmalloc_free(bmsx_dlmalloc_arena, uint32_t offset);
// The owner has retired the suffix of this backing allocation.
void bmsx_dlmalloc_shrink(bmsx_dlmalloc_arena, uint32_t offset, uint32_t bytes);
uint32_t bmsx_dlmalloc_allocation_bytes(bmsx_dlmalloc_arena, uint32_t offset);
uint32_t bmsx_dlmalloc_occupied_bytes(bmsx_dlmalloc_arena);
int bmsx_dlmalloc_is_object(bmsx_dlmalloc_arena, uint32_t offset);

#ifdef __cplusplus
}
#endif
#endif
