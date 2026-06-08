#include "machine/firmware/civil_time.h"

#include <array>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr i64 SECONDS_PER_DAY = 86'400;
constexpr std::array<std::string_view, 7> WEEKDAYS_SHORT{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
constexpr std::array<std::string_view, 7> WEEKDAYS_LONG{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};
constexpr std::array<std::string_view, 12> MONTHS_SHORT{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
constexpr std::array<std::string_view, 12> MONTHS_LONG{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"};
constexpr i64 LUA_TIME_SAFE_INT_MIN = -9'007'199'254'740'991LL;
constexpr i64 LUA_TIME_SAFE_INT_MAX = 9'007'199'254'740'991LL;

auto floorDiv(i64 value, i64 divisor) -> i64 {
	i64 quotient = value / divisor;
	const i64 remainder = value % divisor;
	if (remainder < 0) {
		quotient -= 1;
	}
	return quotient;
}

auto positiveModulo(i64 value, i64 divisor) -> i64 {
	const i64 mod = value % divisor;
	return mod < 0 ? mod + divisor : mod;
}

auto daysFromCivil(i64 year, i64 month, i64 day) -> i64 {
	year -= month <= 2 ? 1 : 0;
	const i64 era = floorDiv(year, 400);
	const i64 yearOfEra = year - era * 400;
	const i64 monthPrime = month + (month > 2 ? -3 : 9);
	const i64 dayOfYear = (153 * monthPrime + 2) / 5 + day - 1;
	const i64 dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
	return era * 146097 + dayOfEra - 719468;
}

struct CivilDate {
	i64 year;
	int month;
	int day;
};

auto civilFromDays(i64 days) -> CivilDate {
	days += 719468;
	const i64 era = floorDiv(days, 146097);
	const i64 dayOfEra = days - era * 146097;
	const i64 yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
	i64 year = yearOfEra + era * 400;
	const i64 dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
	const i64 monthPrime = (5 * dayOfYear + 2) / 153;
	const int day = static_cast<int>(dayOfYear - (153 * monthPrime + 2) / 5 + 1);
	const int month = static_cast<int>(monthPrime + (monthPrime < 10 ? 3 : -9));
	year += month <= 2 ? 1 : 0;
	return {.year = year, .month = month, .day = day};
}

void appendPadded(std::string& output, i64 value, int size) {
	std::string text = std::to_string(value);
	while (static_cast<int>(text.size()) < size) {
		output.push_back('0');
		size -= 1;
	}
	output += text;
}

void appendSpacePadded(std::string& output, i64 value, int size) {
	std::string text = std::to_string(value);
	while (static_cast<int>(text.size()) < size) {
		output.push_back(' ');
		size -= 1;
	}
	output += text;
}

i64 weekNumberSunday(const BmsxCivilTime& time) {
	return (static_cast<i64>(time.yearday) - 1 + 7 - (time.weekday - 1)) / 7;
}

i64 weekNumberMonday(const BmsxCivilTime& time) {
	return (static_cast<i64>(time.yearday) - 1 + 7 - ((time.weekday + 5) % 7)) / 7;
}

i64 isoWeeksInYear(i64 year) {
	const i64 jan1Weekday = positiveModulo(daysFromCivil(year, 1, 1) + 3, 7) + 1;
	return jan1Weekday == 4 || (jan1Weekday == 3 && daysFromCivil(year + 1, 1, 1) - daysFromCivil(year, 1, 1) == 366) ? 53 : 52;
}

struct BmsxIsoWeek {
	i64 year;
	i64 week;
};

BmsxIsoWeek isoWeek(const BmsxCivilTime& time) {
	const int isoWeekday = time.weekday == 1 ? 7 : time.weekday - 1;
	BmsxIsoWeek out{.year = time.year, .week = (static_cast<i64>(time.yearday) - isoWeekday + 10) / 7};
	if (out.week < 1) {
		out.year -= 1;
		out.week = isoWeeksInYear(out.year);
	} else {
		const i64 weeksInYear = isoWeeksInYear(out.year);
		if (out.week > weeksInYear) {
			out.year += 1;
			out.week = 1;
		}
	}
	return out;
}

bool validExtendedSpecifier(char modifier, char code) {
	switch (modifier) {
		case 'E':
			return code == 'c' || code == 'C' || code == 'x' || code == 'X' || code == 'y' || code == 'Y';
		case 'O':
			return code == 'd' || code == 'e' || code == 'H' || code == 'I' || code == 'm' || code == 'M'
				|| code == 'S' || code == 'u' || code == 'U' || code == 'V' || code == 'w' || code == 'W'
				|| code == 'y';
		default:
			return false;
	}
}

std::runtime_error invalidConversionSpecifier(char modifier, char code) {
	std::string specifier = "%";
	if (modifier != '\0') {
		specifier.push_back(modifier);
	}
	if (code != '\0') {
		specifier.push_back(code);
	}
	return std::runtime_error("invalid conversion specifier '" + specifier + "'");
}

} // namespace

auto bmsxTimestampFromLuaCivilTime(i64 year, i64 month, i64 day, i64 hour, i64 minute, i64 second) -> i64 {
	const i64 monthIndex = month - 1;
	const i64 yearOffset = floorDiv(monthIndex, 12);
	const i64 luaYear = year + yearOffset;
	const i64 luaMonth = monthIndex - yearOffset * 12 + 1;
	const i64 timestamp = daysFromCivil(luaYear, luaMonth, day) * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second;
	if (timestamp < LUA_TIME_SAFE_INT_MIN || timestamp > LUA_TIME_SAFE_INT_MAX) {
		throw std::runtime_error("time is out-of-bound");
	}
	return timestamp;
}

auto bmsxCivilTimeFromTimestamp(i64 timestamp) -> BmsxCivilTime {
	const i64 days = floorDiv(timestamp, SECONDS_PER_DAY);
	const i64 secondsOfDay = timestamp - days * SECONDS_PER_DAY;
	const CivilDate civil = civilFromDays(days);
	const int hour = static_cast<int>(secondsOfDay / 3600);
	const int minute = static_cast<int>((secondsOfDay - static_cast<i64>(hour) * 3600) / 60);
	const int second = static_cast<int>(secondsOfDay - static_cast<i64>(hour) * 3600 - static_cast<i64>(minute) * 60);
	const int yearday = static_cast<int>(days - daysFromCivil(civil.year, 1, 1) + 1);
	return {
		.year = civil.year,
		.month = civil.month,
		.day = civil.day,
		.hour = hour,
		.minute = minute,
		.second = second,
		.weekday = static_cast<int>(positiveModulo(days + 4, 7)) + 1,
		.yearday = yearday,
		.isDst = false,
	};
}

auto formatBmsxCivilTime(std::string_view format, const BmsxCivilTime& time) -> std::string {
	const int weekdayIndex = time.weekday - 1;
	const int hour12 = time.hour % 12 == 0 ? 12 : time.hour % 12;
	std::string output;
	for (size_t index = 0; index < format.size(); index += 1) {
		const char ch = format[index];
		if (ch != '%') {
			output.push_back(ch);
			continue;
		}
		index += 1;
		char code = index < format.size() ? format[index] : '\0';
		char modifier = '\0';
		if (code == 'E' || code == 'O') {
			modifier = code;
			index += 1;
			code = index < format.size() ? format[index] : '\0';
			if (!validExtendedSpecifier(modifier, code)) {
				throw invalidConversionSpecifier(modifier, code);
			}
		}
		const BmsxIsoWeek iso = (code == 'G' || code == 'g' || code == 'V') ? isoWeek(time) : BmsxIsoWeek{};
		switch (code) {
			case 'C': appendPadded(output, floorDiv(time.year, 100), 2); break;
			case 'D':
				appendPadded(output, time.month, 2);
				output.push_back('/');
				appendPadded(output, time.day, 2);
				output.push_back('/');
				appendPadded(output, time.year % 100, 2);
				break;
			case 'F':
				appendPadded(output, time.year, 4);
				output.push_back('-');
				appendPadded(output, time.month, 2);
				output.push_back('-');
				appendPadded(output, time.day, 2);
				break;
			case 'G': appendPadded(output, iso.year, 4); break;
			case 'g': appendPadded(output, iso.year % 100, 2); break;
			case 'Y': appendPadded(output, time.year, 4); break;
			case 'y': appendPadded(output, time.year % 100, 2); break;
			case 'm': appendPadded(output, time.month, 2); break;
			case 'd': appendPadded(output, time.day, 2); break;
			case 'e': appendSpacePadded(output, time.day, 2); break;
			case 'H': appendPadded(output, time.hour, 2); break;
			case 'M': appendPadded(output, time.minute, 2); break;
			case 'S': appendPadded(output, time.second, 2); break;
			case 'I': appendPadded(output, hour12, 2); break;
			case 'R':
				appendPadded(output, time.hour, 2);
				output.push_back(':');
				appendPadded(output, time.minute, 2);
				break;
			case 'r':
				appendPadded(output, hour12, 2);
				output.push_back(':');
				appendPadded(output, time.minute, 2);
				output.push_back(':');
				appendPadded(output, time.second, 2);
				output.push_back(' ');
				output.append(time.hour < 12 ? "AM" : "PM");
				break;
			case 'T':
				appendPadded(output, time.hour, 2);
				output.push_back(':');
				appendPadded(output, time.minute, 2);
				output.push_back(':');
				appendPadded(output, time.second, 2);
				break;
			case 'p': output.append(time.hour < 12 ? "AM" : "PM"); break;
			case 'a': output.append(WEEKDAYS_SHORT[weekdayIndex]); break;
			case 'A': output.append(WEEKDAYS_LONG[weekdayIndex]); break;
			case 'h': output.append(MONTHS_SHORT[time.month - 1]); break;
			case 'b': output.append(MONTHS_SHORT[time.month - 1]); break;
			case 'B': output.append(MONTHS_LONG[time.month - 1]); break;
			case 'j': appendPadded(output, time.yearday, 3); break;
			case 'n': output.push_back('\n'); break;
			case 't': output.push_back('\t'); break;
			case 'U': appendPadded(output, weekNumberSunday(time), 2); break;
			case 'u': output += std::to_string(time.weekday == 1 ? 7 : time.weekday - 1); break;
			case 'V': appendPadded(output, iso.week, 2); break;
			case 'w': output += std::to_string(weekdayIndex); break;
			case 'W': appendPadded(output, weekNumberMonday(time), 2); break;
			case 'c':
				output.append(WEEKDAYS_SHORT[weekdayIndex]);
				output.push_back(' ');
				output.append(MONTHS_SHORT[time.month - 1]);
				output.push_back(' ');
				appendPadded(output, time.day, 2);
				output.push_back(' ');
				appendPadded(output, time.hour, 2);
				output.push_back(':');
				appendPadded(output, time.minute, 2);
				output.push_back(':');
				appendPadded(output, time.second, 2);
				output.push_back(' ');
				appendPadded(output, time.year, 4);
				break;
			case 'x':
				appendPadded(output, time.month, 2);
				output.push_back('/');
				appendPadded(output, time.day, 2);
				output.push_back('/');
				appendPadded(output, time.year % 100, 2);
				break;
			case 'X':
				appendPadded(output, time.hour, 2);
				output.push_back(':');
				appendPadded(output, time.minute, 2);
				output.push_back(':');
				appendPadded(output, time.second, 2);
				break;
			case 'z': output.append("+0000"); break;
			case 'Z': output.append("BMSX"); break;
			case '%': output.push_back('%'); break;
			default:
				throw invalidConversionSpecifier(modifier, code);
		}
	}
	return output;
}

} // namespace bmsx
