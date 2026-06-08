#pragma once

#include "common/primitives.h"

#include <string>
#include <string_view>

namespace bmsx {

struct BmsxCivilTime {
	i64 year;
	int month;
	int day;
	int hour;
	int minute;
	int second;
	int weekday;
	int yearday;
	bool isDst;
};

auto bmsxTimestampFromLuaCivilTime(i64 year, i64 month, i64 day, i64 hour, i64 minute, i64 second) -> i64;
auto bmsxCivilTimeFromTimestamp(i64 timestamp) -> BmsxCivilTime;
auto formatBmsxCivilTime(std::string_view format, const BmsxCivilTime& time) -> std::string;

} // namespace bmsx
