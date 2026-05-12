#pragma once

#include <cstddef>
#include <functional>

namespace bmsx {

struct LuaHeapUsageHooks {
	std::function<void()> collect;
	std::function<size_t()> getBaseRamUsedBytes;
};

void configureLuaHeapUsage(LuaHeapUsageHooks hooks);
void resetTrackedLuaHeapBytes();
void addTrackedLuaHeapBytes(ptrdiff_t delta);
size_t trackedLuaHeapBytes();
void enforceLuaHeapBudget();

}
