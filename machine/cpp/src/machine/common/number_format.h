#pragma once

#include <cmath>
#include <cstdint>
#include <string>

namespace bmsx {
namespace number_format_detail {

// Fast %.6g formatting for runtime hot paths.
constexpr int kPrecision = 6;
constexpr double kPow10[] = {1e1, 1e2, 1e4, 1e8, 1e16, 1e32, 1e64, 1e128, 1e256};
constexpr double kPow10Inv[] = {1e-1, 1e-2, 1e-4, 1e-8, 1e-16, 1e-32, 1e-64, 1e-128, 1e-256};
constexpr int kPow10Exp[] = {1, 2, 4, 8, 16, 32, 64, 128, 256};

inline uint64_t roundToEven(double value) {
	uint64_t base = static_cast<uint64_t>(value);
	double frac = value - static_cast<double>(base);
	if (frac > 0.5) {
		return base + 1;
	}
	if (frac < 0.5) {
		return base;
	}
	return (base & 1ULL) ? base + 1 : base;
}

inline int normalize10(double value, double& norm) {
	int exp10 = 0;
	norm = value;
	if (norm >= 10.0) {
		for (int i = 8; i >= 0; --i) {
			if (norm >= kPow10[i]) {
				norm *= kPow10Inv[i];
				exp10 += kPow10Exp[i];
			}
		}
		while (norm >= 10.0) {
			norm *= 0.1;
			exp10 += 1;
		}
	} else if (norm < 1.0) {
		for (int i = 8; i >= 0; --i) {
			if (norm < kPow10Inv[i]) {
				norm *= kPow10[i];
				exp10 -= kPow10Exp[i];
			}
		}
		while (norm < 1.0) {
			norm *= 10.0;
			exp10 -= 1;
		}
	}
	return exp10;
}

inline void writeDigits6(uint64_t value, char* out) {
	for (int i = 5; i >= 0; --i) {
		out[i] = static_cast<char>('0' + (value % 10));
		value /= 10;
	}
}

inline std::string formatNumberCore(double value) {
	if (value == 0.0) {
		return std::signbit(value) ? "-0" : "0";
	}
	bool negative = value < 0.0;
	double absValue = negative ? -value : value;
	if (absValue < 1000000.0) {
		int64_t asInt = static_cast<int64_t>(absValue);
		if (static_cast<double>(asInt) == absValue) {
			char buffer[24];
			char* end = buffer + sizeof(buffer);
			char* ptr = end;
			uint64_t magnitude = static_cast<uint64_t>(asInt);
			do {
				*--ptr = static_cast<char>('0' + (magnitude % 10));
				magnitude /= 10;
			} while (magnitude != 0);
			if (negative) {
				*--ptr = '-';
			}
			return std::string(ptr, end);
		}
	}

	double norm = 0.0;
	int exp10 = normalize10(absValue, norm);
	double scaled = norm * 100000.0;
	uint64_t digits = roundToEven(scaled);
	if (digits == 1000000ULL) {
		digits = 100000ULL;
		exp10 += 1;
	}

	char digitsBuf[6];
	writeDigits6(digits, digitsBuf);

	std::string out;
	out.reserve(32);
	if (negative) {
		out.push_back('-');
	}

	if (exp10 >= -4 && exp10 < kPrecision) {
		int decimalPos = exp10 + 1;
		if (decimalPos > 0) {
			out.append(digitsBuf, digitsBuf + decimalPos);
			if (decimalPos < kPrecision) {
				size_t dotPos = out.size();
				out.push_back('.');
				out.append(digitsBuf + decimalPos, digitsBuf + kPrecision);
				size_t trim = out.size();
				while (trim > dotPos + 1 && out[trim - 1] == '0') {
					trim -= 1;
				}
				if (trim == dotPos + 1) {
					trim = dotPos;
				}
				out.resize(trim);
			}
		} else {
			out.append("0.");
			size_t dotPos = out.size() - 1;
			for (int i = 0; i < -decimalPos; ++i) {
				out.push_back('0');
			}
			out.append(digitsBuf, digitsBuf + kPrecision);
			size_t trim = out.size();
			while (trim > dotPos + 1 && out[trim - 1] == '0') {
				trim -= 1;
			}
			if (trim == dotPos + 1) {
				trim = dotPos;
			}
			out.resize(trim);
		}
		return out;
	}

	out.push_back(digitsBuf[0]);
	size_t dotPos = out.size();
	out.push_back('.');
	out.append(digitsBuf + 1, digitsBuf + kPrecision);
	size_t trim = out.size();
	while (trim > dotPos + 1 && out[trim - 1] == '0') {
		trim -= 1;
	}
	if (trim == dotPos + 1) {
		trim = dotPos;
	}
	out.resize(trim);

	out.push_back('e');
	if (exp10 >= 0) {
		out.push_back('+');
	} else {
		out.push_back('-');
	}
	int absExp = exp10 >= 0 ? exp10 : -exp10;
	if (absExp >= 100) {
		out.push_back(static_cast<char>('0' + (absExp / 100)));
		int rem = absExp % 100;
		out.push_back(static_cast<char>('0' + (rem / 10)));
		out.push_back(static_cast<char>('0' + (rem % 10)));
	} else {
		out.push_back(static_cast<char>('0' + (absExp / 10)));
		out.push_back(static_cast<char>('0' + (absExp % 10)));
	}
	return out;
}

} // namespace number_format_detail

inline std::string formatNumber(double value) {
	return number_format_detail::formatNumberCore(value);
}
} // namespace bmsx
