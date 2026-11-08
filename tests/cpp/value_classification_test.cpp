#include "machine/cpu/value.h"

#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void checkHeaderAndPayload(uint64_t header, uint64_t payload) {
	const Value value = (header << 48u) | payload;
	// Independent header table: positive tags 1..7, negative tags 8..15.
	// Every other header denotes a number. Payload bits never select a kind.
	const uint8_t tag = header >= 0xfff8u ? static_cast<uint8_t>(header - 0xfff0u)
		: header >= 0x7ff9u && header <= 0x7fffu ? static_cast<uint8_t>(header - 0x7ff8u)
		: 0u;
	if (valueEncodedTag(value) != tag
		|| static_cast<uint8_t>(valueTag(value)) != static_cast<uint8_t>(tag - 1u)
		|| valueIsNumber(value) != (tag == 0u)
		|| valueIsTagged(value) != (tag != 0u)
		|| isNil(value) != (tag == 1u)
		|| isTruthy(value) != (tag != 1u && tag != 2u)
		|| valueIsBool(value) != (tag == 2u || tag == 3u)
		|| valueToBool(value) != (tag == 3u)
		|| valueIsString(value) != (tag == 4u)
		|| valueIsTable(value) != (tag == 5u)
		|| valueIsClosure(value) != (tag == 6u)
		|| valueIsBuiltinFunction(value) != (tag == 7u)
		|| valueIsThread(value) != (tag == 8u)
		|| valuePayload(value) != payload) {
		std::cerr << "Value classification mismatch for raw bits 0x" << std::hex << value << std::dec << '\n';
		throw std::runtime_error("Value predicates must preserve all header and payload patterns.");
	}
}

void classifyAllHeaders() {
	for (uint64_t header = 0u; header <= 0xffffu; ++header) {
		for (uint64_t payload : {0ULL, 1ULL, 0x123456789abcULL, 0xffffffffffffULL}) {
			checkHeaderAndPayload(header, payload);
		}
	}
}

void tagProducerRepresentation() {
	constexpr std::array<uint16_t, 8> headers {
		0x7ff9u, 0x7ffau, 0x7ffbu, 0x7ffcu, 0x7ffdu, 0x7ffeu, 0x7fffu, 0xfff8u
	};
	for (uint8_t tag = 0u; tag < headers.size(); ++tag) {
		for (uint64_t payload : {0ULL, 1ULL, 0xffffffffffffffffULL}) {
			const Value expected = (static_cast<uint64_t>(headers[tag]) << 48u) | (payload & VALUE_PAYLOAD_MASK);
			if (valueFromTag(static_cast<ValueTag>(tag), payload) != expected) {
				throw std::runtime_error("Tag producers must retain the NaN-boxed representation.");
			}
		}
	}
}
}

int main() {
	try {
		classifyAllHeaders();
		tagProducerRepresentation();
		std::cout << "Value classification tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
