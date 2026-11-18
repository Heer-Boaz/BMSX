#include "common/small_block_pool.h"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {
struct alignas(std::max_align_t) AllocationHeader { size_t bytes; };
size_t allocations = 0;
size_t deallocations = 0;
size_t liveBytes = 0;

void require(bool condition, const char* message) {
	if (!condition) {
		std::fprintf(stderr, "%s\n", message);
		std::abort();
	}
}
}

void* operator new(size_t bytes) {
	auto* header = static_cast<AllocationHeader*>(std::malloc(sizeof(AllocationHeader) + bytes));
	if (!header) throw std::bad_alloc();
	header->bytes = bytes;
	++allocations;
	liveBytes += bytes;
	return header + 1;
}
void operator delete(void* storage) noexcept {
	if (!storage) return;
	auto* header = static_cast<AllocationHeader*>(storage) - 1;
	++deallocations;
	liveBytes -= header->bytes;
	std::free(header);
}
void operator delete(void* storage, size_t) noexcept { ::operator delete(storage); }

int main() {
	using bmsx::SmallBlockPool;
	{
		SmallBlockPool pool;
		void* first = pool.allocate(20);
		void* second = pool.allocate(28);
		require(first != second, "live blocks must be distinct");
		require(reinterpret_cast<uintptr_t>(first) % alignof(std::max_align_t) == 0, "storage preserves allocator alignment");
		std::memset(first, 0x55, 20);
		std::memset(second, 0xaa, 28);
		pool.deallocate(first, 20);
		pool.deallocate(second, 28);
		const auto before = allocations;
		void* last = pool.allocate(32);
		void* next = pool.allocate(17);
		require(last == second && next == first && allocations == before,
			"same byte class recycles in LIFO order without allocator calls");
		pool.deallocate(last, 32);
		pool.deallocate(next, 17);
		const auto freed = deallocations;
		void* large = pool.allocate(1025);
		pool.deallocate(large, 1025);
		require(deallocations == freed + 1, "large storage is returned immediately");
	}
	require(liveBytes == 0 && allocations == deallocations, "destruction releases every cached block");
	{
		SmallBlockPool pool;
		// Sequential peaks in different classes must share ONE retention budget.
		std::array<void*, 513> blocks{};
		const auto freed = deallocations;
		for (size_t bytes = SmallBlockPool::SIZE_STEP; bytes <= SmallBlockPool::MAX_BLOCK_BYTES; bytes += SmallBlockPool::SIZE_STEP) {
			for (auto& block : blocks) block = pool.allocate(bytes);
			for (auto* block : blocks) pool.deallocate(block, bytes);
			require(liveBytes <= SmallBlockPool::MAX_RETAINED_BYTES, "class high-water marks cannot accumulate beyond the total free-byte limit");
		}
		require(deallocations > freed, "excess free blocks are returned rather than accumulating across classes");
	}
	require(liveBytes == 0 && allocations == deallocations, "bounded cache frees all classes on owner destruction");
	{
		SmallBlockPool pool;
		std::array<void*, 513> blocks{};
		for (auto& block : blocks) block = pool.allocate(SmallBlockPool::MAX_BLOCK_BYTES);
		for (auto* block : blocks) pool.deallocate(block, SmallBlockPool::MAX_BLOCK_BYTES);
		require(liveBytes == SmallBlockPool::MAX_RETAINED_BYTES, "one class can use exactly the total allowance");
	}
	require(liveBytes == 0 && allocations == deallocations, "full cache destruction releases its allowance");
	std::puts("Small block pool tests passed");
}
