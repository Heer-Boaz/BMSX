export type BmsxCivilTime = {
	year: number;
	month: number;
	day: number;
	hour: number;
	min: number;
	sec: number;
	wday: number;
	yday: number;
	isdst: false;
};

const SECONDS_PER_DAY = 86400;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const LUA_CIVIL_INT_MIN = -0x80000000;
const LUA_CIVIL_INT_MAX = 0x7fffffff;
const LUA_TIME_SAFE_INT_MIN = -0x1fffffffffffff;
const LUA_TIME_SAFE_INT_MAX = 0x1fffffffffffff;

function positiveModulo(value: number, divisor: number): number {
	const mod = value % divisor;
	return mod < 0 ? mod + divisor : mod;
}

function daysFromCivil(year: number, month: number, day: number): number {
	year -= month <= 2 ? 1 : 0;
	const era = Math.floor(year / 400);
	const yearOfEra = year - era * 400;
	const monthPrime = month + (month > 2 ? -3 : 9);
	const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
	const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
	return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
	days += 719468;
	const era = Math.floor(days / 146097);
	const dayOfEra = days - era * 146097;
	const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
	let year = yearOfEra + era * 400;
	const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
	const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
	const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
	const month = monthPrime + (monthPrime < 10 ? 3 : -9);
	year += month <= 2 ? 1 : 0;
	return { year, month, day };
}

export function bmsxTimestampFromLuaCivilTime(year: number, month: number, day: number, hour: number, min: number, sec: number): number {
	const monthIndex = month - 1;
	const yearOffset = Math.floor(monthIndex / 12);
	const luaYear = year + yearOffset;
	const luaMonth = monthIndex - yearOffset * 12 + 1;
	return requireLuaTimeValue(daysFromCivil(luaYear, luaMonth, day) * SECONDS_PER_DAY + hour * 3600 + min * 60 + sec);
}

function requireLuaCivilInteger(value: unknown, field: string, delta: number): number {
	const number = value as number;
	if (number !== number + 0 || number - number !== 0 || number % 1 !== 0) {
		throw new Error(`field '${field}' is not an integer`);
	}
	if (!(number >= 0 ? number - delta <= LUA_CIVIL_INT_MAX : LUA_CIVIL_INT_MIN + delta <= number)) {
		throw new Error(`field '${field}' is out-of-bound`);
	}
	return number;
}

export function requireLuaCivilTimeField(value: unknown, field: string, defaultValue: number, delta: number): number {
	if (value === null) {
		if (defaultValue < 0) {
			throw new Error(`field '${field}' missing in date table`);
		}
		return defaultValue;
	}
	return requireLuaCivilInteger(value, field, delta);
}

export function requireLuaTimeValue(value: unknown): number {
	const number = value as number;
	if (number !== number + 0 || number - number !== 0 || number % 1 !== 0) {
		throw new Error('time is not an integer');
	}
	if (number < LUA_TIME_SAFE_INT_MIN || number > LUA_TIME_SAFE_INT_MAX) {
		throw new Error('time is out-of-bound');
	}
	return number;
}

export function bmsxCivilTimeFromTimestamp(timestamp: number): BmsxCivilTime {
	const days = Math.floor(timestamp / SECONDS_PER_DAY);
	const secondsOfDay = timestamp - days * SECONDS_PER_DAY;
	const civil = civilFromDays(days);
	const hour = Math.floor(secondsOfDay / 3600);
	const min = Math.floor((secondsOfDay - hour * 3600) / 60);
	const sec = secondsOfDay - hour * 3600 - min * 60;
	const yday = days - daysFromCivil(civil.year, 1, 1) + 1;
	return {
		year: civil.year,
		month: civil.month,
		day: civil.day,
		hour,
		min,
		sec,
		wday: positiveModulo(days + 4, 7) + 1,
		yday,
		isdst: false,
	};
}

function pad(value: number, size: number): string {
	let text = Math.floor(value).toString();
	while (text.length < size) {
		text = `0${text}`;
	}
	return text;
}

function padSpace(value: number, size: number): string {
	let text = Math.floor(value).toString();
	while (text.length < size) {
		text = ` ${text}`;
	}
	return text;
}

function bmsxWeekNumberSunday(time: BmsxCivilTime): number {
	return Math.floor((time.yday - 1 + 7 - (time.wday - 1)) / 7);
}

function bmsxWeekNumberMonday(time: BmsxCivilTime): number {
	return Math.floor((time.yday - 1 + 7 - ((time.wday + 5) % 7)) / 7);
}

function isoWeeksInYear(year: number): number {
	const jan1Weekday = positiveModulo(daysFromCivil(year, 1, 1) + 3, 7) + 1;
	return jan1Weekday === 4 || (jan1Weekday === 3 && daysFromCivil(year + 1, 1, 1) - daysFromCivil(year, 1, 1) === 366) ? 53 : 52;
}

function bmsxIsoWeek(time: BmsxCivilTime): { year: number; week: number } {
	const isoWeekday = time.wday === 1 ? 7 : time.wday - 1;
	let isoYear = time.year;
	let week = Math.floor((time.yday - isoWeekday + 10) / 7);
	if (week < 1) {
		isoYear -= 1;
		week = isoWeeksInYear(isoYear);
	} else {
		const weeksInYear = isoWeeksInYear(isoYear);
		if (week > weeksInYear) {
			isoYear += 1;
			week = 1;
		}
	}
	return { year: isoYear, week };
}

export function formatBmsxCivilTime(format: string, time: BmsxCivilTime): string {
	const weekdayIndex = time.wday - 1;
	const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;
	const ampm = time.hour < 12 ? 'AM' : 'PM';
	let output = '';
	for (let index = 0; index < format.length; index += 1) {
		const ch = format.charAt(index);
		if (ch !== '%') {
			output += ch;
			continue;
		}
		index += 1;
		let code = format.charAt(index);
		let modifier = '';
		if (code === 'E' || code === 'O') {
			modifier = code;
			index += 1;
			code = format.charAt(index);
			const valid = modifier === 'E'
				? 'cCxXyY'.indexOf(code) >= 0
				: 'deHImMSuUVwWy'.indexOf(code) >= 0;
			if (!valid) {
				throw new Error(`invalid conversion specifier '%${modifier}${code}'`);
			}
		}
		const isoWeek = code === 'G' || code === 'g' || code === 'V' ? bmsxIsoWeek(time) : null;
		switch (code) {
			case 'C': output += pad(Math.floor(time.year / 100), 2); break;
			case 'D': output += `${pad(time.month, 2)}/${pad(time.day, 2)}/${pad(time.year % 100, 2)}`; break;
			case 'F': output += `${pad(time.year, 4)}-${pad(time.month, 2)}-${pad(time.day, 2)}`; break;
			case 'G': output += pad(isoWeek!.year, 4); break;
			case 'g': output += pad(isoWeek!.year % 100, 2); break;
			case 'Y': output += pad(time.year, 4); break;
			case 'y': output += pad(time.year % 100, 2); break;
			case 'm': output += pad(time.month, 2); break;
			case 'd': output += pad(time.day, 2); break;
			case 'e': output += padSpace(time.day, 2); break;
			case 'H': output += pad(time.hour, 2); break;
			case 'M': output += pad(time.min, 2); break;
			case 'S': output += pad(time.sec, 2); break;
			case 'I': output += pad(hour12, 2); break;
			case 'R': output += `${pad(time.hour, 2)}:${pad(time.min, 2)}`; break;
			case 'r': output += `${pad(hour12, 2)}:${pad(time.min, 2)}:${pad(time.sec, 2)} ${ampm}`; break;
			case 'T': output += `${pad(time.hour, 2)}:${pad(time.min, 2)}:${pad(time.sec, 2)}`; break;
			case 'p': output += ampm; break;
			case 'a': output += WEEKDAYS_SHORT[weekdayIndex]; break;
			case 'A': output += WEEKDAYS_LONG[weekdayIndex]; break;
			case 'h': output += MONTHS_SHORT[time.month - 1]; break;
			case 'b': output += MONTHS_SHORT[time.month - 1]; break;
			case 'B': output += MONTHS_LONG[time.month - 1]; break;
			case 'j': output += pad(time.yday, 3); break;
			case 'n': output += '\n'; break;
			case 't': output += '\t'; break;
			case 'U': output += pad(bmsxWeekNumberSunday(time), 2); break;
			case 'u': output += String(time.wday === 1 ? 7 : time.wday - 1); break;
			case 'V': output += pad(isoWeek!.week, 2); break;
			case 'w': output += String(weekdayIndex); break;
			case 'W': output += pad(bmsxWeekNumberMonday(time), 2); break;
			case 'c': output += `${WEEKDAYS_SHORT[weekdayIndex]} ${MONTHS_SHORT[time.month - 1]} ${pad(time.day, 2)} ${pad(time.hour, 2)}:${pad(time.min, 2)}:${pad(time.sec, 2)} ${pad(time.year, 4)}`; break;
			case 'x': output += `${pad(time.month, 2)}/${pad(time.day, 2)}/${pad(time.year % 100, 2)}`; break;
			case 'X': output += `${pad(time.hour, 2)}:${pad(time.min, 2)}:${pad(time.sec, 2)}`; break;
			case 'z': output += '+0000'; break;
			case 'Z': output += 'BMSX'; break;
			case '%': output += '%'; break;
			default: throw new Error(`invalid conversion specifier '%${modifier}${code}'`);
		}
	}
	return output;
}
