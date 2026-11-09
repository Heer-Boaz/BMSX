#include "common/object_storage_pool.h"

#include <array>
#include <cstdint>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <unordered_set>

namespace {
struct alignas(64) Record {
	static inline int constructions = 0;
	static inline int destructions = 0;
	std::unique_ptr<int> value;
	explicit Record(std::unique_ptr<int> input) : value(std::move(input)) { ++constructions; }
	~Record() { ++destructions; }
};
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

int main() {
	try {
		bmsx::ObjectStoragePool<Record, 8> pool;
		std::array<Record*, 193> records;
		std::unordered_set<Record*> storage;
		for (size_t index = 0; index < records.size(); ++index) {
			records[index] = pool.construct(std::make_unique<int>(static_cast<int>(index)));
			require(storage.insert(records[index]).second, "live objects have distinct storage across slabs");
			require((reinterpret_cast<uintptr_t>(records[index]) & 63u) == 0u, "slabs preserve over-aligned object storage");
		}
		for (size_t index = 0; index < records.size(); ++index) {
			require(*records[index]->value == static_cast<int>(index), "growth preserves every live pointer and value");
			if ((index & 1u) != 0u) pool.destroy(records[index]);
		}
		for (size_t index = 1; index < records.size(); index += 2) {
			records[index] = pool.construct(std::make_unique<int>(-static_cast<int>(index)));
			require(storage.contains(records[index]), "retired storage is reused without relocating live objects");
		}
		for (size_t index = 0; index < records.size(); ++index) {
			require(*records[index]->value == ((index & 1u) ? -static_cast<int>(index) : static_cast<int>(index)),
				"reused objects are independently constructed");
			pool.destroy(records[index]);
		}
		require(Record::constructions == Record::destructions, "every constructed lifetime ends exactly once");
		std::cout << "Object storage pool tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
