#include "byte_hex_string.h"

#include <iomanip>
#include <sstream>

namespace bmsx {

std::string formatNumberAsHex(uint64_t value, int width) {
	std::ostringstream stream;
	stream << std::uppercase << std::hex;
	if (width > 0) {
		stream << std::setfill('0') << std::setw(width);
	}
	stream << value << 'h';
	return stream.str();
}

} // namespace bmsx
