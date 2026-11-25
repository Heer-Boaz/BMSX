/*
Copyright 2023 Doug Lea

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Offset port of dlmalloc 2.8.6 (https://gee.cs.oswego.edu/pub/misc/malloc.c,
 * SHA-256 be7be56b40b4b31417e74e77687f9b96127ea6cae534cf236aee40a4c739508d).
 * Single externally supplied mspace, 32-bit size semantics, 8-byte alignment.
 * Intrusive links are little-endian offsets rather than host pointers. The
 * BMSX supply grows downward and coalesces its range like prepend_alloc.
 * No operating-system backing, segment list, locks, or host allocations.
 */
#include "dlmalloc.h"

typedef uint32_t u32;

/* Four-byte in-use overhead: prev_foot belongs to the previous payload
 * while PINUSE is set. The exported payload address is always chunk + 8. */
enum { PINUSE = 1u, CINUSE = 2u, OBJECT = 4u, FLAGS = 7u, MIN_CHUNK = 16u, MIN_LARGE = 256u };

#if defined(_MSC_VER)
#include <intrin.h>
#include <string.h>
#define copy_word memcpy
static inline u32 highest_bit(u32 bits)
{
  unsigned long index;
  _BitScanReverse(&index, bits);
  return (u32)index;
}
static inline u32 lowest_bit(u32 bits)
{
  unsigned long index;
  _BitScanForward(&index, bits);
  return (u32)index;
}
#else
#define copy_word __builtin_memcpy
static inline u32 highest_bit(u32 bits) { return 31u - (u32)__builtin_clz(bits); }
static inline u32 lowest_bit(u32 bits) { return (u32)__builtin_ctz(bits); }
#endif

static inline u32 read_word(bmsx_dlmalloc_arena a, u32 offset)
{
  u32 result;
  copy_word(&result, (const void*)((uintptr_t)a.ram + offset), sizeof(result));
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
  result = __builtin_bswap32(result);
#endif
  return result;
}

/* Private RAM cannot alias public decoded code. Only consume the existing
 * history bit, without touching other watch state or public RAM. */
static inline void store_word(bmsx_dlmalloc_arena a, u32 offset, u32 value)
{
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
  value = __builtin_bswap32(value);
#endif
  copy_word((void*)((uintptr_t)a.ram + offset), &value, sizeof(value));
  u32* group = a.watched_groups + (offset >> BMSX_DLMALLOC_WATCH_SHIFT);
  if (*group & BMSX_DLMALLOC_HISTORY_CLEAN) *group &= ~BMSX_DLMALLOC_HISTORY_CLEAN;
}

#define WORD(o) read_word(a, (o))
#define SET_WORD(o, v) store_word(a, (o), (v))
#define SET_HEAD(p, v) SET_WORD((p) + 4, v)
#define SET_PREV_FOOT(p, v) SET_WORD(p, v)
#define SET_FORWARD(p, v) SET_WORD((p) + 8, v)
#define SET_BACK(p, v) SET_WORD((p) + 12, v)
#define SET_CHILD(p, side, v) SET_WORD((p) + 16 + 4 * (side), v)
#define SET_PARENT(p, v) SET_WORD((p) + 24, v)
#define SET_INDEX(p, v) SET_WORD((p) + 28, v)
#define HEAD(p) WORD((p) + 4)
#define PREV_FOOT(p) WORD(p)
#define FORWARD(p) WORD((p) + 8)
#define BACK(p) WORD((p) + 12)
#define CHILD(p, side) WORD((p) + 16 + 4 * (side))
#define PARENT(p) WORD((p) + 24)
#define INDEX(p) WORD((p) + 28)

#define SMALLMAP WORD(a.state)
#define SET_SMALLMAP(v) SET_WORD(a.state, v)
#define TREEMAP WORD(a.state + 4)
#define SET_TREEMAP(v) SET_WORD(a.state + 4, v)
#define DVSIZE WORD(a.state + 8)
#define SET_DVSIZE(v) SET_WORD(a.state + 8, v)
#define TOPSIZE WORD(a.state + 12)
#define SET_TOPSIZE(v) SET_WORD(a.state + 12, v)
#define DV WORD(a.state + 16)
#define SET_DV(v) SET_WORD(a.state + 16, v)
#define TOP WORD(a.state + 20)
#define SET_TOP(v) SET_WORD(a.state + 20, v)
/* Just like dlmalloc, a smallbin sentinel shares space with the word
 * before its fd: there are 33 pairs because fd/bk are at +8/+12. */
#define SMALLBIN(i) (a.state + 24 + 8 * (i))
#define TREELINK(i) (a.state + 24 + 33 * 8 + 4 * (i))

static inline u32 chunksize(bmsx_dlmalloc_arena a, u32 p) { return HEAD(p) & ~FLAGS; }
static inline u32 leftmost_child(bmsx_dlmalloc_arena a, u32 p)
{
  const u32 c = CHILD(p, 0);
  return c ? c : CHILD(p, 1);
}
static inline u32 request2size(u32 bytes)
{
  return bytes < 11u ? MIN_CHUNK : (bytes + 11u) & ~7u;
}
static inline u32 idx2bit(u32 i) { return 1u << i; }
static inline u32 left_bits(u32 bit) { return 0u - (bit << 1); }
static inline u32 tree_index(u32 size)
{
  const u32 x = size >> 8;
  if (!x) return 0;
  if (x > 0xffffu) return 31;
  const u32 k = highest_bit(x);
  return (k << 1u) + ((size >> (k + 7u)) & 1u);
}
static inline u32 leftshift_for_tree_index(u32 i) { return i == 31u ? 0u : 25u - (i >> 1u); }

/* dlmalloc set_foot / set_inuse / set_size_and_pinuse branch variants. */
static inline void free_head(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  SET_HEAD(p, size | PINUSE);
  SET_PREV_FOOT(p + size, size);
}
static inline void set_free_with_pinuse(bmsx_dlmalloc_arena a, u32 p, u32 size, u32 next)
{
  SET_HEAD(next, HEAD(next) & (~PINUSE));
  free_head(a, p, size);
}
static inline void set_inuse(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  SET_HEAD(p, (HEAD(p) & PINUSE) | size | CINUSE);
  SET_HEAD(p + size, HEAD(p + size) | (PINUSE));
}
static inline void inuse_head(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  SET_HEAD(p, size | PINUSE | CINUSE);
}
static inline void set_inuse_and_pinuse(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  inuse_head(a, p, size);
  SET_HEAD(p + size, HEAD(p + size) | (PINUSE));
}

static inline void insert_small_chunk(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  const u32 i = size >> 3;
  const u32 b = SMALLBIN(i), bit = idx2bit(i);
  u32 f = b;
  if (!(SMALLMAP & bit)) SET_SMALLMAP(SMALLMAP | (bit));
  else f = FORWARD(b);
  SET_FORWARD(b, p);
  SET_BACK(f, p);
  SET_FORWARD(p, f);
  SET_BACK(p, b);
}
static inline void unlink_small_chunk(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  const u32 f = FORWARD(p), b = BACK(p);
  if (b == f) SET_SMALLMAP(SMALLMAP & (~idx2bit(size >> 3)));
  else {
    SET_BACK(f, b);
    SET_FORWARD(b, f);
  }
}
static inline void unlink_first_small_chunk(bmsx_dlmalloc_arena a, u32 b, u32 p, u32 i)
{
  const u32 f = FORWARD(p);
  if (b == f) SET_SMALLMAP(SMALLMAP & (~idx2bit(i)));
  else {
    SET_BACK(f, b);
    SET_FORWARD(b, f);
  }
}
static inline void replace_dv(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  const u32 bytes = DVSIZE;
  if (bytes) insert_small_chunk(a, DV, bytes);
  SET_DVSIZE(size);
  SET_DV(p);
}

static void insert_large_chunk(bmsx_dlmalloc_arena a, u32 x, u32 size)
{
  const u32 i = tree_index(size), h = TREELINK(i);
  SET_INDEX(x, i);
  { SET_CHILD(x, 1, 0); SET_CHILD(x, 0, CHILD(x, 1)); }
  if (!(TREEMAP & idx2bit(i))) {
    SET_TREEMAP(TREEMAP | (idx2bit(i)));
    SET_WORD(h, x);
    SET_PARENT(x, h);
    { SET_BACK(x, x); SET_FORWARD(x, BACK(x)); }
  } else {
    u32 t = WORD(h);
    u32 k = size << leftshift_for_tree_index(i);
    for (;;) {
      if (chunksize(a, t) != size) {
        const u32 c = t + 16 + (k >> 31u) * 4u;
        k <<= 1;
        if (WORD(c)) t = WORD(c);
        else {
          SET_WORD(c, x);
          SET_PARENT(x, t);
          { SET_BACK(x, x); SET_FORWARD(x, BACK(x)); }
          break;
        }
      } else {
        const u32 f = FORWARD(t);
        { SET_BACK(f, x); SET_FORWARD(t, BACK(f)); }
        SET_FORWARD(x, f);
        SET_BACK(x, t);
        SET_PARENT(x, 0);
        break;
      }
    }
  }
}

static void unlink_large_chunk(bmsx_dlmalloc_arena a, u32 x)
{
  const u32 xp = PARENT(x);
  u32 r;
  if (BACK(x) != x) {
    const u32 f = FORWARD(x);
    r = BACK(x);
    SET_BACK(f, r);
    SET_FORWARD(r, f);
  } else {
    u32 rp;
    if ((r = WORD(rp = x + 20)) || (r = WORD(rp = x + 16))) {
      u32 cp;
      while (WORD(cp = r + 20) || WORD(cp = r + 16)) r = WORD(rp = cp);
      SET_WORD(rp, 0);
    }
  }
  if (xp) {
    const u32 h = TREELINK(INDEX(x));
    if (x == WORD(h)) {
      SET_WORD(h, r);
      if (!r) SET_TREEMAP(TREEMAP & (~idx2bit(INDEX(x))));
    } else if (CHILD(xp, 0) == x) SET_CHILD(xp, 0, r);
    else SET_CHILD(xp, 1, r);
    if (r) {
      SET_PARENT(r, xp);
      const u32 c0 = CHILD(x, 0), c1 = CHILD(x, 1);
      if (c0) { SET_CHILD(r, 0, c0); SET_PARENT(c0, r); }
      if (c1) { SET_CHILD(r, 1, c1); SET_PARENT(c1, r); }
    }
  }
}

static inline void insert_chunk(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  if (size < MIN_LARGE) insert_small_chunk(a, p, size);
  else insert_large_chunk(a, p, size);
}
static inline void unlink_chunk(bmsx_dlmalloc_arena a, u32 p, u32 size)
{
  if (size < MIN_LARGE) unlink_small_chunk(a, p, size);
  else unlink_large_chunk(a, p);
}

/* Direct translation of dlmalloc tmalloc_large (search, compare dv, split). */
static u32 tmalloc_large(bmsx_dlmalloc_arena a, u32 nb)
{
  u32 v = 0, rsize = 0u - nb;
  const u32 idx = tree_index(nb);
  u32 t = WORD(TREELINK(idx));
  if (t) {
    u32 sizebits = nb << leftshift_for_tree_index(idx), rst = 0;
    for (;;) {
      const u32 trem = chunksize(a, t) - nb;
      if (trem < rsize) {
        v = t;
        if (!(rsize = trem)) break;
      }
      const u32 rt = CHILD(t, 1);
      t = CHILD(t, sizebits >> 31u);
      if (rt && rt != t) rst = rt;
      if (!t) { t = rst; break; }
      sizebits <<= 1;
    }
  }
  if (!t && !v) {
    const u32 leftbits = left_bits(idx2bit(idx)) & TREEMAP;
    if (leftbits) t = WORD(TREELINK(lowest_bit(leftbits)));
  }
  while (t) {
    const u32 trem = chunksize(a, t) - nb;
    if (trem < rsize) { rsize = trem; v = t; }
    t = leftmost_child(a, t);
  }
  if (v && rsize < DVSIZE - nb) {
    unlink_large_chunk(a, v);
    if (rsize < MIN_CHUNK) set_inuse_and_pinuse(a, v, rsize + nb);
    else {
      inuse_head(a, v, nb);
      free_head(a, v + nb, rsize);
      insert_chunk(a, v + nb, rsize);
    }
    return v + 8;
  }
  return 0;
}

static u32 tmalloc_small(bmsx_dlmalloc_arena a, u32 nb)
{
  u32 t = WORD(TREELINK(lowest_bit(TREEMAP)));
  u32 v = t, rsize = chunksize(a, t) - nb;
  while ((t = leftmost_child(a, t))) {
    const u32 trem = chunksize(a, t) - nb;
    if (trem < rsize) { rsize = trem; v = t; }
  }
  unlink_large_chunk(a, v);
  if (rsize < MIN_CHUNK) set_inuse_and_pinuse(a, v, rsize + nb);
  else {
    inuse_head(a, v, nb);
    free_head(a, v + nb, rsize);
    replace_dv(a, v + nb, rsize);
  }
  return v + 8;
}

static u32 mspace_malloc(bmsx_dlmalloc_arena a, u32 bytes)
{
  u32 nb;
  if (bytes <= 244u) {
    nb = request2size(bytes);
    u32 idx = nb >> 3;
    const u32 smallbits = SMALLMAP >> idx;
    if (smallbits & 3u) {
      idx += ~smallbits & 1u;
      const u32 b = SMALLBIN(idx), p = FORWARD(b);
      unlink_first_small_chunk(a, b, p, idx);
      set_inuse_and_pinuse(a, p, idx << 3);
      return p + 8;
    } else if (nb > DVSIZE) {
      if (smallbits) {
        const u32 i = lowest_bit(smallbits << idx);
        const u32 b = SMALLBIN(i), p = FORWARD(b), r = p + nb;
        const u32 rsize = (i << 3) - nb;
        unlink_first_small_chunk(a, b, p, i);
        inuse_head(a, p, nb);
        free_head(a, r, rsize);
        replace_dv(a, r, rsize);
        return p + 8;
      } else if (TREEMAP) {
        const u32 mem = tmalloc_small(a, nb);
        if (mem) return mem;
      }
    }
  } else {
    if (bytes >= (0u - MIN_CHUNK) << 2) return 0;
    nb = request2size(bytes);
    if (TREEMAP) {
      const u32 mem = tmalloc_large(a, nb);
      if (mem) return mem;
    }
  }

  if (nb <= DVSIZE) {
    const u32 rsize = DVSIZE - nb, p = DV;
    if (rsize >= MIN_CHUNK) {
      const u32 r = p + nb;
      SET_DV(r);
      SET_DVSIZE(rsize);
      free_head(a, r, rsize);
      inuse_head(a, p, nb);
    } else {
      const u32 dvs = DVSIZE;
      { SET_DVSIZE(0); SET_DV(DVSIZE); }
      set_inuse_and_pinuse(a, p, dvs);
    }
    return p + 8;
  } else if (nb < TOPSIZE) {
    const u32 rsize = TOPSIZE - nb, p = TOP, r = p + nb;
    SET_TOPSIZE(rsize);
    SET_TOP(r);
    SET_HEAD(r, rsize | PINUSE);
    inuse_head(a, p, nb);
    return p + 8;
  }
  return 0;
}

/* Fixed-arena specialization of the identical chunk coalescing in
 * dlmalloc dispose_chunk / mspace_free (no trimming, mapping or release). */
static void dispose_chunk(bmsx_dlmalloc_arena a, u32 p, u32 psize)
{
  const u32 next = p + psize;
  const u32 head = HEAD(p);
  if (!(head & PINUSE)) {
    /* Coalescing backward leaves the old head inside a free chunk. */
    if (head & OBJECT) SET_HEAD(p, head & ~OBJECT);
    const u32 prevsize = PREV_FOOT(p);
    p -= prevsize;
    psize += prevsize;
    if (p != DV) unlink_chunk(a, p, prevsize);
    else if ((HEAD(next) & (PINUSE | CINUSE)) == (PINUSE | CINUSE)) {
      SET_DVSIZE(psize);
      set_free_with_pinuse(a, p, psize, next);
      return;
    }
  }
  if (!(HEAD(next) & CINUSE)) {
    if (next == TOP) {
      const u32 tsize = TOPSIZE + psize;
      SET_TOPSIZE(tsize);
      SET_TOP(p);
      SET_HEAD(p, tsize | PINUSE);
      if (p == DV) { SET_DVSIZE(0); SET_DV(DVSIZE); }
      return;
    } else if (next == DV) {
      const u32 dsize = DVSIZE + psize;
      SET_DVSIZE(dsize);
      SET_DV(p);
      free_head(a, p, dsize);
      return;
    } else {
      const u32 nsize = chunksize(a, next);
      psize += nsize;
      unlink_chunk(a, next, nsize);
      free_head(a, p, psize);
      if (p == DV) { SET_DVSIZE(psize); return; }
    }
  } else set_free_with_pinuse(a, p, psize, next);
  insert_chunk(a, p, psize);
}

/*
 * BMSX RAM supply. LuaJIT's dlmalloc "prepend_alloc" is used because the
 * machine grants adjacent pages downward from the fixed management area.
 * This keeps the ordinary dlmalloc chunk and split orientation unchanged.
 * The additional words are private system state, not dlmalloc bin state.
 */
#define FLOOR WORD(TREELINK(32))
#define SET_FLOOR(v) SET_WORD(TREELINK(32), v)
#define LIMIT WORD(TREELINK(32) + 4)
#define SET_LIMIT(v) SET_WORD(TREELINK(32) + 4, v)
#define SEGMENT WORD(TREELINK(32) + 8)
#define SET_SEGMENT(v) SET_WORD(TREELINK(32) + 8, v)
#define OCCUPIED WORD(TREELINK(32) + 12)
#define SET_OCCUPIED(v) SET_WORD(TREELINK(32) + 12, v)
enum { ARENA_TOP_FOOT = 40 };
_Static_assert(24 + 33 * 8 + 32 * 4 + 16 <= 0x200, "management area");

void bmsx_dlmalloc_reset(bmsx_dlmalloc_arena a, u32 floor, u32 limit)
{
  for (u32 w = a.state; w < TREELINK(32); w += 4) SET_WORD(w, 0);
  for (u32 i = 0; i < 32; ++i) {
    const u32 b = SMALLBIN(i);
    { SET_BACK(b, b); SET_FORWARD(b, BACK(b)); }
  }
  SET_FLOOR(floor);
  SET_LIMIT(limit);
  SET_SEGMENT(limit);
  SET_OCCUPIED(0u);
}

static u32 prepend_alloc(bmsx_dlmalloc_arena a, u32 p, u32 oldfirst, u32 nb)
{
  const u32 q = p + nb;
  u32 qsize = oldfirst - q;
  if (nb) inuse_head(a, p, nb);
  if (oldfirst == TOP) {
    const u32 size = TOPSIZE + qsize;
    SET_TOPSIZE(size);
    SET_TOP(q);
    SET_HEAD(q, size | PINUSE);
  } else if (oldfirst == DV) {
    const u32 size = DVSIZE + qsize;
    SET_DVSIZE(size);
    SET_DV(q);
    free_head(a, q, size);
  } else {
    if (!(HEAD(oldfirst) & CINUSE)) {
      const u32 nsize = chunksize(a, oldfirst);
      unlink_chunk(a, oldfirst, nsize);
      oldfirst += nsize;
      qsize += nsize;
    }
    set_free_with_pinuse(a, q, qsize, oldfirst);
    insert_chunk(a, q, qsize);
  }
  return p + 8;
}

static u32 allocate_from_ram(bmsx_dlmalloc_arena a, u32 bytes)
{
  const u32 allocated = mspace_malloc(a, bytes);
  if (allocated) return allocated;
  const u32 top = TOP, first = SEGMENT;
  const u32 floor = FLOOR, available = first - floor;
  if (!available || bytes > LIMIT - floor) return 0;
  const u32 size = request2size(bytes);
  const u32 reserve = size + (top ? MIN_CHUNK : ARENA_TOP_FOOT + MIN_CHUNK);
  if (!top) {
    if (available <= size + ARENA_TOP_FOOT) return 0;
    const u32 begin = reserve <= available ? (first - reserve) & ~(BMSX_DLMALLOC_PAGE_BYTES - 1u) : floor;
    const u32 end = LIMIT - ARENA_TOP_FOOT;
    SET_SEGMENT(begin);
    SET_TOP(begin);
    SET_TOPSIZE(end - begin);
    SET_HEAD(begin, (end - begin) | PINUSE);
    SET_HEAD(end, ARENA_TOP_FOOT);
    return mspace_malloc(a, bytes);
  }
  if (reserve <= available) {
    const u32 begin = (first - reserve) & ~(BMSX_DLMALLOC_PAGE_BYTES - 1u);
    SET_SEGMENT(begin);
    return prepend_alloc(a, begin, first, size);
  }

  /* Unlike an OS-backed arena the machine cannot grow another segment.
   * Supply the final pages and consolidate the leading free chunk before
   * selecting the request from the ordinary mspace bins / dv / top. */
  const u32 head = HEAD(first);
  const u32 span = available + ((head & CINUSE) ? 0u : (head & ~FLAGS));
  if (size > span || (first == top && size == span)) return 0;
  SET_SEGMENT(floor);
  prepend_alloc(a, floor, first, 0u);
  return mspace_malloc(a, bytes);
}

/* Raising the machine floor can consume only the contiguous free leading
 * chunk. Leftover space shorter than a dlmalloc small chunk is unclaimed,
 * not a synthetic allocated object. No public byte is written by this call. */
int bmsx_dlmalloc_set_floor(bmsx_dlmalloc_arena a, u32 floor)
{
  const u32 leading = SEGMENT;
  if (floor <= leading) {
    SET_FLOOR(floor);
    return 1;
  }
  if (HEAD(leading) & CINUSE) return 0;
  const u32 end = leading + chunksize(a, leading);
  if (leading == TOP) {
    if (floor < end) {
      { SET_TOP(floor); SET_SEGMENT(TOP); }
      SET_TOPSIZE(end - floor);
      SET_HEAD(floor, (end - floor) | PINUSE);
    } else {
      SET_SEGMENT(LIMIT);
      { SET_TOPSIZE(0); SET_TOP(TOPSIZE); }
    }
  } else {
    if (end < floor) return 0;
    const u32 size = end - floor;
    const int is_dv = leading == DV;
    if (!is_dv) unlink_chunk(a, leading, end - leading);
    if (size < MIN_CHUNK) {
      if (is_dv) { SET_DVSIZE(0); SET_DV(DVSIZE); }
      SET_HEAD(end, HEAD(end) | (PINUSE));
      SET_SEGMENT(end);
    } else {
      SET_SEGMENT(floor);
      free_head(a, floor, size);
      if (is_dv) { SET_DV(floor); SET_DVSIZE(size); }
      else insert_chunk(a, floor, size);
    }
  }
  SET_FLOOR(floor);
  return 1;
}

u32 bmsx_dlmalloc_floor(bmsx_dlmalloc_arena a) { return FLOOR; }
u32 bmsx_dlmalloc_occupied_bytes(bmsx_dlmalloc_arena a) { return OCCUPIED; }

u32 bmsx_dlmalloc_allocate(bmsx_dlmalloc_arena a, u32 bytes, int object)
{
  const u32 payload = allocate_from_ram(a, bytes);
  if (payload) {
    const u32 p = payload - 8, head = HEAD(p);
    SET_OCCUPIED(OCCUPIED + (head & ~FLAGS));
    if (object) SET_HEAD(p, head | OBJECT);
  }
  return payload;
}

void bmsx_dlmalloc_free(bmsx_dlmalloc_arena a, u32 offset)
{
  const u32 p = offset - 8, size = chunksize(a, p);
  SET_OCCUPIED(OCCUPIED - size);
  dispose_chunk(a, p, size);
}

void bmsx_dlmalloc_shrink(bmsx_dlmalloc_arena a, u32 offset, u32 bytes)
{
  /* The shrink arm of upstream try_realloc_chunk, for an owned prefix. */
  const u32 p = offset - 8, size = request2size(bytes);
  const u32 remainder = chunksize(a, p) - size;
  if (remainder < MIN_CHUNK) return;
  const u32 tail = p + size;
  set_inuse(a, p, size);
  set_inuse(a, tail, remainder);
  SET_OCCUPIED(OCCUPIED - remainder);
  dispose_chunk(a, tail, remainder);
}

/* try_realloc_chunk for backing storage. Objects retain their issued address.
 * TOP must keep a nonempty suffix; DV and bins may be consumed completely. */
u32 bmsx_dlmalloc_resize_backing(bmsx_dlmalloc_arena a, u32 offset, u32 bytes)
{
  if (bytes > LIMIT - FLOOR) return 0;
  const u32 p = offset - 8, old = chunksize(a, p), nb = request2size(bytes);
  if (nb <= old) {
    bmsx_dlmalloc_shrink(a, offset, bytes);
    return offset;
  }
  const u32 next = p + old;
  if (!(HEAD(next) & CINUSE)) {
    const u32 total = old + chunksize(a, next);
    if (next == TOP && total > nb) {
      SET_TOP(p + nb);
      SET_TOPSIZE(total - nb);
      SET_HEAD(p + nb, (total - nb) | PINUSE);
      SET_HEAD(p, nb | (HEAD(p) & PINUSE) | CINUSE);
      SET_OCCUPIED(OCCUPIED + nb - old);
      return offset;
    }
    if (next != TOP && total >= nb) {
      const u32 remainder = total - nb;
      const int is_dv = next == DV;
      if (!is_dv) unlink_chunk(a, next, total - old);
      if (remainder >= MIN_CHUNK) {
        const u32 tail = p + nb;
        SET_HEAD(p, nb | (HEAD(p) & PINUSE) | CINUSE);
        free_head(a, tail, remainder);
        if (is_dv) { SET_DV(tail); SET_DVSIZE(remainder); }
        else insert_chunk(a, tail, remainder);
        SET_OCCUPIED(OCCUPIED + nb - old);
      } else {
        if (is_dv) { SET_DV(0); SET_DVSIZE(0); }
        set_inuse(a, p, total);
        SET_OCCUPIED(OCCUPIED + total - old);
      }
      return offset;
    }
  }
  const u32 dest = bmsx_dlmalloc_allocate(a, bytes, 0);
  if (!dest) return 0;
  /* The next chunk's prev_foot belongs to this in-use payload. */
  const u32 retained = old - 4;
  copy_word((void*)((uintptr_t)a.ram + dest),
            (const void*)((uintptr_t)a.ram + offset), retained);
  for (u32 g = dest >> BMSX_DLMALLOC_WATCH_SHIFT;
       g <= (dest + retained - 1u) >> BMSX_DLMALLOC_WATCH_SHIFT; ++g)
    a.watched_groups[g] &= ~BMSX_DLMALLOC_HISTORY_CLEAN;
  bmsx_dlmalloc_free(a, offset);
  return dest;
}

u32 bmsx_dlmalloc_allocation_bytes(bmsx_dlmalloc_arena a, u32 offset)
{
  return chunksize(a, offset - 8);
}

int bmsx_dlmalloc_is_object(bmsx_dlmalloc_arena a, u32 offset)
{
  return offset >= SEGMENT + 8 && offset < LIMIT &&
    (HEAD(offset - 8) & (CINUSE | OBJECT)) == (CINUSE | OBJECT);
}
