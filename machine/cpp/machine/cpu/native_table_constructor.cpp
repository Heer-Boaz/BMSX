#include "machine/cpu/native_table_constructor.h"

#include <algorithm>
#include <span>

#include "machine/cpu/table.h"

namespace bmsx {

bool NativeTableConstructor::bindKeys(ConstValueSpan constants) {
	std::array<StringId, TABLE_RECORD_FIELDS_MAX> current;
	bool changed = !keysBound;
	for (u32 field = 0; field < count; ++field) {
		current[field] = constants.payload(keySelectors[field]);
		changed |= current[field] != keys[field];
	}
	if (!changed) return true;
	// Different selectors can name the same live StringId. The ordered
	// stores, not a fixed record layout, own that case.
	for (u32 field = 1; field < count; ++field)
		if (std::find(current.begin(), current.begin() + field, current[field]) != current.begin() + field)
			return false;
	std::copy_n(current.begin(), count, keys.begin());
	full = TableRecord::planStringRecord(std::span(keys).first(count), (1u << count) - 1u);
	partialMask = 0;
	keysBound = true;
	return true;
}

const TableConstructorLayout& NativeTableConstructor::layoutFor(u32 present) {
	if (present == (1u << count) - 1u) return full;
	if (present != partialMask) {
		partial = TableRecord::planStringRecord(std::span(keys).first(count), present);
		partialMask = present;
	}
	return partial;
}

} // namespace bmsx
