#include "common/endian.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

using namespace bmsx;

int main(int argc, char** argv) {
	if (argc != 2) return 2;
	std::ifstream input(argv[1]);
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	HeapAllocator allocator(memory);
	u8* ram = memory.ramData();
	const u32 management = allocator.managementOffset();
	std::vector<u32> addresses;
	std::string op;
	while (input >> op) {
		u32 a = 0, b = 0;
		if (op == "R" || op == "S" || op == "F") input >> a;
		else if (op == "A" || op == "W") input >> a >> b;
		if (op == "R") {
			allocator.reset(a);
			std::cout << "R\n";
		} else if (op == "S") {
			std::cout << (allocator.setFloor(a) ? "1\n" : "0\n");
		} else if (op == "A") {
			const u32 address = allocator.allocate(a, b != 0);
			if (address != 0) addresses.push_back(address);
			std::cout << address << '\n';
		} else if (op == "F") {
			if (a < addresses.size()) {
				allocator.free(addresses[a]);
				addresses[a] = addresses.back();
				addresses.pop_back();
			}
			std::cout << "F\n";
		} else if (op == "W") {
			writeLE32(ram + a, b);
			std::cout << "W\n";
		} else if (op == "H") {
			u32 hash = 0x811c9dc5u;
			for (u32 offset = management; offset < management + RUNTIME_MANAGEMENT_SIZE; ++offset) hash = (hash ^ ram[offset]) * 0x01000193u;
			std::cout << allocator.floorAddress() << ' ' << allocator.capacityBytes() << ' ' << allocator.occupiedBytes() << ' ' << hash << '\n';
		} else {
			return 3;
		}
	}
}
