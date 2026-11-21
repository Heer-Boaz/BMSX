#include "machine/cpu/native_table_constructor.h"

#include <span>

#include "machine/cpu/table.h"

namespace bmsx {

const TableConstructorLayout& NativeTableConstructor::layoutFor(u32 present) {
	if (present == (1u << count) - 1u) return full;
	if (present != partialMask) {
		partial = TableRecord::planStringRecord(std::span(keys).first(count), present);
		partialMask = present;
	}
	return partial;
}

} // namespace bmsx
