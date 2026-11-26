#include "dlmalloc.h"

/* Host binding, outside the serialized RAM image. The allocator state itself
 * remains in guest RAM and has the same layout as in the native build. */
static bmsx_dlmalloc_arena arena;

__attribute__((export_name("bind")))
void bind_arena(uint32_t state, uint32_t watch_groups) {
	arena.state = state;
	arena.watched_groups = (uint32_t*)(uintptr_t)watch_groups;
}

__attribute__((export_name("reset")))
void reset_arena(uint32_t floor, uint32_t limit) {
	bmsx_dlmalloc_reset(arena, floor, limit);
}

__attribute__((export_name("setFloor")))
int set_heap_floor(uint32_t floor) {
	return bmsx_dlmalloc_set_floor(arena, floor);
}

__attribute__((export_name("allocate")))
uint32_t allocate_chunk(uint32_t bytes, int object) {
	return bmsx_dlmalloc_allocate(arena, bytes, object);
}

__attribute__((export_name("free")))
void free_chunk(uint32_t offset) {
	bmsx_dlmalloc_free(arena, offset);
}

__attribute__((export_name("reserveBacking")))
uint32_t reserve_backing(uint32_t offset, uint32_t bytes) {
	return bmsx_dlmalloc_reserve_backing(arena, offset, bytes);
}

__attribute__((export_name("resizeBacking")))
uint32_t resize_backing(uint32_t offset, uint32_t bytes) {
	return bmsx_dlmalloc_resize_backing(arena, offset, bytes);
}

__attribute__((export_name("shrink")))
void shrink_chunk(uint32_t offset, uint32_t bytes) {
	bmsx_dlmalloc_shrink(arena, offset, bytes);
}

__attribute__((export_name("allocationBytes")))
uint32_t allocation_bytes(uint32_t offset) {
	return bmsx_dlmalloc_allocation_bytes(arena, offset);
}

__attribute__((export_name("floor")))
uint32_t heap_floor(void) {
	return bmsx_dlmalloc_floor(arena);
}

__attribute__((export_name("occupiedBytes")))
uint32_t occupied_bytes(void) {
	return bmsx_dlmalloc_occupied_bytes(arena);
}

__attribute__((export_name("isObject")))
int is_object(uint32_t offset) {
	return bmsx_dlmalloc_is_object(arena, offset);
}
