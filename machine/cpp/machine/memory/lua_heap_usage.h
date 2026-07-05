#pragma once

#include <cstddef>

namespace bmsx {

using LuaHeapUsageReader = size_t (*)(void* context);

struct LuaHeapUsageHooks {
	void* context;
	LuaHeapUsageReader getBaseRamUsedBytes;
	LuaHeapUsageReader collectTrackedHeapBytes;
};

void configureLuaHeapUsage(void* context, LuaHeapUsageReader getBaseRamUsedBytes, LuaHeapUsageReader collectTrackedHeapBytes);
void resetLuaHeapUsageHooks();
void resetTrackedLuaHeapBytes();
void addTrackedLuaHeapBytes(ptrdiff_t delta);
size_t trackedLuaHeapBytes();
void enforceLuaHeapBudget();

}
