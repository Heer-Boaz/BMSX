#pragma once

#include <optional>

#include "machine/cpu/global_bank.h"

namespace bmsx { class CPU; }

namespace bmsx::test {

class GcHeap;

class NativeGlobalBankReference {
public:
	explicit NativeGlobalBankReference(GlobalBank& bank) : m_bank(bank) {}

	static Value getSystemGlobalByKey(const CPU& cpu, StringId key);
	static Value getGlobalByKey(const CPU& cpu, StringId key);
	static void setGlobalByKey(CPU& cpu, StringId key, const Value& value);
	static void setSystemGlobalByKey(CPU& cpu, StringId key, const Value& value);

	static StringId name(const GlobalBank&, u32 slot);
	static std::optional<u32> find(const GlobalBank&, StringId key);
	void writeSlot(GcHeap, u32 slot, Value value);
	u32 registerName(GcHeap, StringId key, Value pending = valueNil());
	void clear(GcHeap);

private:
	static u32 bucketFor(const Memory&, u32 base, u32 capacity, StringId key);
	static std::optional<u32> findSlot(const Memory&, u32 base, u32 capacity, StringId key);
	void grow(u32 oldBase, u32 base, u32 capacity, u32 count);

	GlobalBank& m_bank;
};

} // namespace bmsx::test
