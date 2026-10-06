#include "rompack/tooling/blua32_symbols.h"

#include <fstream>

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
	input.exceptions(std::ios::failbit | std::ios::badbit);
	std::vector<bmsx::u8> bytes(static_cast<size_t>(input.tellg()));
	input.seekg(0);
	input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
	const auto symbols = bmsx::decodeBlua32SymbolsImage(bytes);
	const auto encoded = bmsx::encodeBlua32SymbolsImage(symbols);
	std::ofstream output(argv[2], std::ios::binary);
	output.exceptions(std::ios::failbit | std::ios::badbit);
	output.write(reinterpret_cast<const char*>(encoded.data()), static_cast<std::streamsize>(encoded.size()));
}
