#include "machine/firmware/builtins.h"

#include "common/clamp.h"
#include "machine/common/number_format.h"
#include "machine/runtime/runtime.h"
#include "platform/platform.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace bmsx {

int floorIntArg(NativeArgsView args, size_t index) {
	return static_cast<int>(std::floor(asNumber(args.at(index))));
}

void registerMathAndEasingBuiltins(Runtime& runtime) {
	CPU& cpu = runtime.machine.cpu;
	Clock* runtimeClock = &runtime.clock();
	auto key = [&runtime](std::string_view name) {
		return runtime.luaKey(name);
	};
	auto str = [&cpu](std::string_view value) {
		return valueString(cpu.internString(value));
	};
	auto clamp01 = [](double value) {
		return clamp(value, 0.0, 1.0);
	};
	auto smoothstep01 = [clamp01](double value) {
		const double x = clamp01(value);
		return x * x * (3.0 - (2.0 * x));
	};
	auto pingpong01 = [](double value) {
		double p = std::fmod(value, 2.0);
		if (p < 0.0) {
			p += 2.0;
		}
		return (p < 1.0) ? p : (2.0 - p);
	};
	const double kPi = 3.14159265358979323846;
	const double radToDeg = 180.0 / kPi;
	const double degToRad = kPi / 180.0;
	const double maxSafeInteger = 9007199254740991.0;
	auto* mathTable = cpu.createTable();
	mathTable->set(key("abs"), runtime.machine.cpu.createNativeFunction("math.abs", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::abs(value)));
	}));
	mathTable->set(key("acos"), runtime.machine.cpu.createNativeFunction("math.acos", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::acos(value)));
	}));
	mathTable->set(key("asin"), runtime.machine.cpu.createNativeFunction("math.asin", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::asin(value)));
	}));
	mathTable->set(key("atan"), runtime.machine.cpu.createNativeFunction("math.atan", [](NativeArgsView args, NativeResults& out) {
		double y = asNumber(args.at(0));
		if (args.size() > 1) {
			double x = asNumber(args.at(1));
			out.push_back(valueNumber(std::atan2(y, x)));
			return;
		}
		out.push_back(valueNumber(std::atan(y)));
	}));
	mathTable->set(key("ceil"), runtime.machine.cpu.createNativeFunction("math.ceil", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::ceil(value)));
	}));
	mathTable->set(key("cos"), runtime.machine.cpu.createNativeFunction("math.cos", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::cos(value)));
	}));
	mathTable->set(key("deg"), runtime.machine.cpu.createNativeFunction("math.deg", [radToDeg](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(value * radToDeg));
	}));
	mathTable->set(key("exp"), runtime.machine.cpu.createNativeFunction("math.exp", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::exp(value)));
	}));
	mathTable->set(key("floor"), runtime.machine.cpu.createNativeFunction("math.floor", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::floor(value)));
	}));
	mathTable->set(key("fmod"), runtime.machine.cpu.createNativeFunction("math.fmod", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		double divisor = asNumber(args.at(1));
		out.push_back(valueNumber(std::fmod(value, divisor)));
	}));
	mathTable->set(key("log"), runtime.machine.cpu.createNativeFunction("math.log", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		if (args.size() > 1) {
			double base = asNumber(args.at(1));
			out.push_back(valueNumber(std::log(value) / std::log(base)));
			return;
		}
		out.push_back(valueNumber(std::log(value)));
	}));
		mathTable->set(key("max"), runtime.machine.cpu.createNativeFunction("math.max", [](NativeArgsView args, NativeResults& out) {
			double result = asNumber(args.at(0));
			for (size_t i = 1; i < args.size(); ++i) {
				result = std::max(result, asNumber(args[i]));
			}
			out.push_back(valueNumber(result));
		}));
		mathTable->set(key("min"), runtime.machine.cpu.createNativeFunction("math.min", [](NativeArgsView args, NativeResults& out) {
			double result = asNumber(args.at(0));
			for (size_t i = 1; i < args.size(); ++i) {
				result = std::min(result, asNumber(args[i]));
			}
			out.push_back(valueNumber(result));
		}));
	mathTable->set(key("modf"), runtime.machine.cpu.createNativeFunction("math.modf", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		double intPart = 0.0;
		double fracPart = std::modf(value, &intPart);
		out.push_back(valueNumber(intPart));
		out.push_back(valueNumber(fracPart));
	}));
	mathTable->set(key("rad"), runtime.machine.cpu.createNativeFunction("math.rad", [degToRad](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(value * degToRad));
	}));
	mathTable->set(key("sin"), runtime.machine.cpu.createNativeFunction("math.sin", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sin(value)));
	}));
	mathTable->set(key("sqrt"), runtime.machine.cpu.createNativeFunction("math.sqrt", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sqrt(value)));
	}));
	mathTable->set(key("tan"), runtime.machine.cpu.createNativeFunction("math.tan", [](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::tan(value)));
	}));
	mathTable->set(key("tointeger"), runtime.machine.cpu.createNativeFunction("math.tointeger", [](NativeArgsView args, NativeResults& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (!valueIsNumber(v)) {
			out.push_back(valueNil());
			return;
		}
		double value = asNumber(v);
		if (!std::isfinite(value)) {
			out.push_back(valueNil());
			return;
		}
		double intPart = std::trunc(value);
		if (intPart == value) {
			out.push_back(valueNumber(intPart));
			return;
		}
		out.push_back(valueNil());
	}));
	mathTable->set(key("type"), runtime.machine.cpu.createNativeFunction("math.type", [str](NativeArgsView args, NativeResults& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (!valueIsNumber(v)) {
			out.push_back(valueNil());
			return;
		}
		double value = asNumber(v);
		if (std::trunc(value) == value) {
			out.push_back(str("integer"));
			return;
		}
		out.push_back(str("float"));
	}));
	mathTable->set(key("ult"), runtime.machine.cpu.createNativeFunction("math.ult", [](NativeArgsView args, NativeResults& out) {
		uint32_t left = toU32(asNumber(args.at(0)));
		uint32_t right = toU32(asNumber(args.at(1)));
		out.push_back(valueBool(left < right));
	}));
	mathTable->set(key("random"), runtime.machine.cpu.createNativeFunction("math.random", [&runtime](NativeArgsView args, NativeResults& out) {
		double randomValue = runtime.nextRandom();
		if (args.empty()) {
			out.push_back(valueNumber(randomValue));
			return;
		}
		if (args.size() == 1) {
			int upper = floorIntArg(args, 0);
			if (upper < 1) {
				throw BMSX_RUNTIME_ERROR("math.random upper bound must be positive.");
			}
			out.push_back(valueNumber(static_cast<double>(static_cast<int>(randomValue * upper) + 1)));
			return;
		}
		int lower = floorIntArg(args, 0);
		int upper = floorIntArg(args, 1);
		if (upper < lower) {
			throw BMSX_RUNTIME_ERROR("math.random upper bound must be greater than or equal to lower bound.");
		}
		int span = upper - lower + 1;
		out.push_back(valueNumber(static_cast<double>(lower + static_cast<int>(randomValue * span))));
	}));
	mathTable->set(key("randomseed"), runtime.machine.cpu.createNativeFunction("math.randomseed", [&runtime, runtimeClock](NativeArgsView args, NativeResults& out) {
		double seedValue = args.empty() ? runtimeClock->now() : asNumber(args.at(0));
		uint64_t seed = static_cast<uint64_t>(std::floor(seedValue));
		runtime.m_randomSeedValue = static_cast<uint32_t>(seed & 0xffffffffu);
		(void)out;
	}));
	mathTable->set(key("huge"), valueNumber(std::numeric_limits<double>::infinity()));
	mathTable->set(key("maxinteger"), valueNumber(maxSafeInteger));
	mathTable->set(key("mininteger"), valueNumber(-maxSafeInteger));
	mathTable->set(key("pi"), valueNumber(kPi));

	auto* easingTable = cpu.createTable();
	easingTable->set(key("linear"), runtime.machine.cpu.createNativeFunction("easing.linear", [clamp01](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(clamp01(value)));
	}));
	easingTable->set(key("ease_in_quad"), runtime.machine.cpu.createNativeFunction("easing.ease_in_quad", [clamp01](NativeArgsView args, NativeResults& out) {
		double x = clamp01(asNumber(args.at(0)));
		out.push_back(valueNumber(x * x));
	}));
	easingTable->set(key("ease_out_quad"), runtime.machine.cpu.createNativeFunction("easing.ease_out_quad", [clamp01](NativeArgsView args, NativeResults& out) {
		double x = clamp01(1.0 - asNumber(args.at(0)));
		out.push_back(valueNumber(1.0 - (x * x)));
	}));
	easingTable->set(key("ease_in_out_quad"), runtime.machine.cpu.createNativeFunction("easing.ease_in_out_quad", [clamp01](NativeArgsView args, NativeResults& out) {
		double x = clamp01(asNumber(args.at(0)));
		if (x < 0.5) {
			out.push_back(valueNumber(2.0 * x * x));
			return;
		}
		double y = (-2.0 * x) + 2.0;
		out.push_back(valueNumber(1.0 - ((y * y) / 2.0)));
	}));
	easingTable->set(key("ease_out_back"), runtime.machine.cpu.createNativeFunction("easing.ease_out_back", [clamp01](NativeArgsView args, NativeResults& out) {
		double x = clamp01(asNumber(args.at(0)));
		const double c1 = 1.70158;
		const double c3 = c1 + 1.0;
		out.push_back(valueNumber(1.0 + (c3 * std::pow(x - 1.0, 3.0)) + (c1 * std::pow(x - 1.0, 2.0))));
	}));
	easingTable->set(key("smoothstep"), runtime.machine.cpu.createNativeFunction("easing.smoothstep", [smoothstep01](NativeArgsView args, NativeResults& out) {
		out.push_back(valueNumber(smoothstep01(asNumber(args.at(0)))));
	}));
	easingTable->set(key("pingpong01"), runtime.machine.cpu.createNativeFunction("easing.pingpong01", [pingpong01](NativeArgsView args, NativeResults& out) {
		out.push_back(valueNumber(pingpong01(asNumber(args.at(0)))));
	}));
	easingTable->set(key("arc01"), runtime.machine.cpu.createNativeFunction("easing.arc01", [smoothstep01](NativeArgsView args, NativeResults& out) {
		double value = asNumber(args.at(0));
		if (value <= 0.5) {
			out.push_back(valueNumber(smoothstep01(value * 2.0)));
			return;
		}
		out.push_back(valueNumber(smoothstep01((1.0 - value) * 2.0)));
	}));

	runtime.setGlobal("math", valueTable(mathTable));
	runtime.setGlobal("easing", valueTable(easingTable));
}

} // namespace bmsx
