#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace bmsx {
namespace {

constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;

size_t g_trackedLuaHeapBytes = 0;
size_t g_nextCollectionBytes = MIN_COLLECTION_BYTES;
bool g_pendingLuaHeapCollection = false;
uint8_t g_defaultLuaHeapUsageContext = 0;

size_t zeroBaseRamUsedBytes([[maybe_unused]] void* context) {
	return 0;
}

size_t zeroTrackedHeapBytes([[maybe_unused]] void* context) {
	return g_trackedLuaHeapBytes;
}

LuaHeapUsageHooks g_luaHeapUsageHooks = {
	&g_defaultLuaHeapUsageContext,
	&zeroBaseRamUsedBytes,
	&zeroTrackedHeapBytes,
};

void collectTrackedLuaHeapBytesNow() {
	g_pendingLuaHeapCollection = false;
	g_trackedLuaHeapBytes = g_luaHeapUsageHooks.collectTrackedHeapBytes(g_luaHeapUsageHooks.context);
	g_nextCollectionBytes = std::max(MIN_COLLECTION_BYTES, g_trackedLuaHeapBytes * 2);
	const size_t totalRamUsedBytes = g_luaHeapUsageHooks.getBaseRamUsedBytes(g_luaHeapUsageHooks.context) + g_trackedLuaHeapBytes;
	if (totalRamUsedBytes >= RAM_SIZE) {
		throw std::runtime_error("[LuaHeap] Out of heap memory (" + std::to_string(totalRamUsedBytes) + " >= " + std::to_string(RAM_SIZE) + ").");
	}
}

void requestLuaHeapCollectionIfNeeded() {
	const size_t totalRamUsedBytes = g_luaHeapUsageHooks.getBaseRamUsedBytes(g_luaHeapUsageHooks.context) + g_trackedLuaHeapBytes;
	if (g_trackedLuaHeapBytes <= g_nextCollectionBytes && totalRamUsedBytes < RAM_SIZE) {
		return;
	}
	g_pendingLuaHeapCollection = true;
}

}

void configureLuaHeapUsage(void* context, LuaHeapUsageReader getBaseRamUsedBytes, LuaHeapUsageReader collectTrackedHeapBytes) {
	g_luaHeapUsageHooks = {
		context,
		getBaseRamUsedBytes,
		collectTrackedHeapBytes,
	};
}

void resetLuaHeapUsageHooks() {
	g_luaHeapUsageHooks = {
		&g_defaultLuaHeapUsageContext,
		&zeroBaseRamUsedBytes,
		&zeroTrackedHeapBytes,
	};
}

void resetTrackedLuaHeapBytes() {
	g_trackedLuaHeapBytes = 0;
	g_nextCollectionBytes = MIN_COLLECTION_BYTES;
	g_pendingLuaHeapCollection = false;
}

void addTrackedLuaHeapBytes(ptrdiff_t delta) {
	if (delta < 0 && static_cast<size_t>(-delta) > g_trackedLuaHeapBytes) {
		throw std::runtime_error("[LuaHeapUsage] Tracked heap bytes underflow.");
	}
	g_trackedLuaHeapBytes = static_cast<size_t>(static_cast<ptrdiff_t>(g_trackedLuaHeapBytes) + delta);
	if (delta > 0) {
		requestLuaHeapCollectionIfNeeded();
	}
}

size_t trackedLuaHeapBytes() {
	return g_trackedLuaHeapBytes;
}

void enforceLuaHeapBudget() {
	const size_t totalRamUsedBytes = g_luaHeapUsageHooks.getBaseRamUsedBytes(g_luaHeapUsageHooks.context) + g_trackedLuaHeapBytes;
	if (!g_pendingLuaHeapCollection && totalRamUsedBytes < RAM_SIZE) {
		return;
	}
	collectTrackedLuaHeapBytesNow();
}

}
