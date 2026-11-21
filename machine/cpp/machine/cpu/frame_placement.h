#pragma once

#include <algorithm>
#include <cstddef>

#include "common/types.h"
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

	constexpr ArgumentPlacement(int base, int supplied, u32 parameters, u32 maxStack, u32 flags)
		: formals(ValuePlacement::fit(supplied, static_cast<int>(parameters))),
		  argumentBase(base),
		  stackBase((flags & BLUA32_FUNCTION_VARARG) ? base + supplied : base),
		  varargBase(static_cast<i32>(static_cast<u32>(base) + parameters)),
		  varargCount((flags & BLUA32_FUNCTION_VARARG) && static_cast<u32>(supplied) > parameters
			  ? static_cast<int>(static_cast<u32>(supplied) - parameters) : 0),
		  capacity(std::max({maxStack, parameters, 1u})),
		  relocatesFormals((flags & BLUA32_FUNCTION_VARARG) != 0) {}

	constexpr int top() const { return formals.count(); }
	constexpr int cycles(bool sharedStack) const {
		return sharedStack ? (relocatesFormals ? top() : formals.padded) : top() + varargCount;
	}
	constexpr size_t stackEnd() const { return static_cast<size_t>(stackBase) + capacity; }
};

} // namespace bmsx
