#include "machine/devices/word_fifo.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

int main() {
	for (size_t sourceStart = 0; sourceStart < 8; ++sourceStart) {
		for (size_t targetStart = 0; targetStart < 16; ++targetStart) {
			for (size_t count = 0; count <= 8; ++count) {
				bmsx::WordFifo<8> source;
				bmsx::WordFifo<16> target;
				for (size_t index = 0; index < sourceStart; ++index) { source.writeWord(0); source.pop(); }
				for (size_t index = 0; index < targetStart; ++index) { target.writeWord(0); target.pop(); }
				std::vector<bmsx::u32> words;
				for (bmsx::u32 index = 0; index < 8; ++index) { words.push_back(0xe1000000u + index); source.writeWord(words.back()); }
				for (const auto word : {0u, 0xffffffffu, 0x50005000u}) target.writeWord(word);
				source.transferWords(target, count);
				require(source.count() == 8 - count && target.count() == 3 + count, "bulk transfers retain FIFO occupancy");
				require(source.captureWords() == std::vector<bmsx::u32>(words.begin() + count, words.end()), "source retains its unread suffix");
				std::array<bmsx::u32, 16> out;
				out.fill(0xdeadbeefu);
				target.readWords(out.data() + 2, 3 + count);
				std::array<bmsx::u32, 16> expected;
				expected.fill(0xdeadbeefu);
				expected[2] = 0u; expected[3] = 0xffffffffu; expected[4] = 0x50005000u;
				std::copy_n(words.begin(), count, expected.begin() + 5);
				require(out == expected && target.empty(), "reads preserve raw words, prefix, wrap order and surrounding storage");
				for (bmsx::u32 index = 0; index < 16; ++index) target.writeWord(index);
				for (bmsx::u32 index = 0; index < 16; ++index) require(target.pop() == index, "consumed ring remains reusable");
			}
		}
	}
	std::cout << "Word FIFO bulk transfer tests passed\n";
}
