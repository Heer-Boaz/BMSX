#include "common/serializer/binencoder.h"

#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

int main() {
	using namespace bmsx;
	try {
		require(BINENC_VERSION == 0xa1, "the existing format marker is unchanged");
		require(encodeBinary(BinValue(BinArray{BinValue(0), BinValue(-1), BinValue(1)}))
			== std::vector<u8>{0xa1, 0, 12, 3, 0, 1, 2}, "native integer-array bytes match the TS producer");
		require(encodeBinary(BinValue(BinArray{})) == std::vector<u8>{0xa1, 0, 12, 0}, "empty arrays have no element payload");
		const std::vector<i32> integers{0, 1, -1, 63, -64, 64, -65, 8191, -8192, 8192, -8193,
			1048575, -1048576, 1048576, -1048577, 134217727, -134217728, 134217728, -134217729,
			std::numeric_limits<i32>::max(), std::numeric_limits<i32>::min()};
		for (const bool doubles : {false, true}) {
			BinArray array;
			for (i32 value : integers) {
				if (doubles) array.emplace_back(static_cast<f64>(value));
				else array.emplace_back(value);
			}
			const auto encoded = encodeBinary(BinValue(std::move(array)));
			require(encoded[2] == 12, "both integer and lossless double inputs use the packed representation");
			const auto decoded = decodeBinary(encoded);
			for (size_t index = 0; index < integers.size(); ++index)
				require(decoded.asArray()[index].asInt() == integers[index], "every signed-width boundary roundtrips");
		}
		BinArray mixed{BinValue(-0.0), BinValue(1.25), BinValue(std::numeric_limits<f64>::quiet_NaN()),
			BinValue(std::numeric_limits<f64>::infinity()), BinValue(-std::numeric_limits<f64>::infinity()), BinValue(1e100)};
		const auto encoded = encodeBinary(BinValue(std::move(mixed)));
		require(encoded[2] == 5, "general arrays retain their per-element representation");
		const auto decoded = decodeBinary(encoded);
		const f32 zero = decoded.asArray()[0].asF32();
		require(zero == 0.0f && std::signbit(zero), "negative zero is not quantized to integer zero");
		const f32 nan = decoded.asArray()[2].asF32();
		require(nan != nan, "NaN retains its floating-point representation");
		require(decoded.asArray()[3].asF32() == std::numeric_limits<f32>::infinity(), "positive infinity is not cast to an integer");
		require(decoded.asArray()[4].asF32() == -std::numeric_limits<f32>::infinity(), "negative infinity is not cast to an integer");
		require(decoded.asArray()[5].asF64() == 1e100, "large finite doubles retain their payload");
		std::cout << "Binary codec tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
