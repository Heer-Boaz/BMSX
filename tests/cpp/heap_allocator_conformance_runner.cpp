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
	std::vector<u32> addresses;
	MemorySaveState savedMemory;
	std::vector<u32> savedAddresses;
	std::string op;
	while (input >> op) {
		u32 a = 0, b = 0, c = 0;
		if (op == "R" || op == "S" || op == "F") input >> a;
		else if (op == "A" || op == "T") input >> a >> b;
		else if (op == "W") input >> a >> b >> c;
		if (op == "R") {
			allocator.reset(a);
			addresses.clear();
			std::cout << "R\n";
		} else if (op == "S") {
			std::cout << (allocator.setFloor(a) ? "1\n" : "0\n");
		} else if (op == "A") {
			const u32 address = allocator.allocate(a, b != 0);
			if (address != 0) addresses.push_back(address);
			std::cout << address << '\n';
		} else if (op == "F") {
			allocator.free(addresses[a]);
			addresses[a] = addresses.back();
			addresses.pop_back();
			std::cout << "F\n";
		} else if (op == "W") {
			memory.writeRamRecordByte(addresses[a] + b, static_cast<u8>(c));
			std::cout << "W\n";
		} else if (op == "T") {
			allocator.shrinkBacking(addresses[a], b);
			std::cout << "T\n";
		} else if (op == "C") {
			savedMemory = memory.captureSaveState();
			savedAddresses = addresses;
			std::cout << "C\n";
		} else if (op == "U") {
			memory.restoreSaveState(savedMemory);
			addresses = savedAddresses;
			std::cout << "U\n";
		} else if (op == "H") {
			u32 hash = 0x811c9dc5u;
			const auto* ram = memory.ramData();
			for (size_t offset = 0; offset < memory.ramByteCount(); ++offset) hash = (hash ^ ram[offset]) * 0x01000193u;
			std::cout << allocator.floorAddress() << ' ' << allocator.capacityBytes() << ' ' << allocator.occupiedBytes() << ' ' << hash << '\n';
		} else {
			return 3;
		}
	}
}
