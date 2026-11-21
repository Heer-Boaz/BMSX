#pragma once

#include <algorithm>
#include <cstddef>
#include <optional>

#include "common/types.h"
#include "machine/cpu/thread_record.h"
#include "spec/blua32/image_format.h"

namespace bmsx {

// Counts for writing one receiving window: a prefix from the supplied values,
// followed by nil padding. No backing has been acquired yet.
struct ValuePlacement {
	int copied, padded;

	static constexpr ValuePlacement fit(int supplied, int selected) {
		const int copied = std::min(supplied, selected);
		return {copied, selected - copied};
	}
	constexpr int count() const { return copied + padded; }
};

// Fixed calls reuse their argument base. A variadic activation puts its
// register window after the arguments and leaves extras below that window.
struct ArgumentPlacement {
	ValuePlacement formals;
	int argumentBase, stackBase, varargBase, varargCount;
	size_t capacity;
	bool relocatesFormals;

	// Function records supply raw unsigned counts, including RAM prototypes.
	// Reject an impossible reservation before narrowing or measuring copies.
	static constexpr std::optional<ArgumentPlacement> forEntry(int base, int supplied, const FunctionEntry& entry) {
		const u32 capacity = entry.registerCapacity();
		const int stackBase = (entry.flags & BLUA32_FUNCTION_VARARG) ? base + supplied : base;
		if (static_cast<size_t>(stackBase) > MAX_THREAD_VALUE_SLOTS
			|| capacity > MAX_THREAD_VALUE_SLOTS - static_cast<size_t>(stackBase)) return std::nullopt;
		return ArgumentPlacement(base, supplied, stackBase, entry.numParams, capacity, entry.flags);
	}

	constexpr int top() const { return formals.count(); }
	constexpr int cycles(bool sharedStack) const {
		return sharedStack ? (relocatesFormals ? top() : formals.padded) : top() + varargCount;
	}
	constexpr size_t stackEnd() const { return static_cast<size_t>(stackBase) + capacity; }

private:
	constexpr ArgumentPlacement(int base, int supplied, int window, u32 parameters, u32 reserve, u32 flags)
		: formals(ValuePlacement::fit(supplied, static_cast<int>(parameters))),
		  argumentBase(base),
		  stackBase(window),
		  varargBase(base + static_cast<int>(parameters)),
		  varargCount((flags & BLUA32_FUNCTION_VARARG) && static_cast<u32>(supplied) > parameters
			  ? static_cast<int>(static_cast<u32>(supplied) - parameters) : 0),
		  capacity(reserve),
		  relocatesFormals((flags & BLUA32_FUNCTION_VARARG) != 0) {}
};

} // namespace bmsx
