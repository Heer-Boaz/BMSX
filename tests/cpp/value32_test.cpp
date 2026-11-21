#include "machine/cpu/value_slots.h"
#include "machine/cpu/builtin_values.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "machine/cpu/closure.h"
#include "common/number_format.h"
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
void storageAndFrames() {
	ValueSlots empty;
	auto nothing = empty.view().subspan(0, 0); nothing.clear(0, 0); nothing.copyFrom(nothing, 0, 0, 0);
	ValueSlots slots(17);
	require(slots.byteLength() == 85, "persistent values occupy five bytes");
	slots.set(0, valueInteger(-1)); slots.set(1, valueFloatBits(0xffa12345)); slots.set(2, valueTable(0xffffffff));
	const BuiltinArgsView args(slots.view().subspan(0, 3));
	require(args[0] == valueInteger(-1) && args[3] == valueNil(), "builtin arguments read compact planes and supply missing nil");
	require(args.tailFrom(1)[0] == valueFloatBits(0xffa12345) && args.tailFrom(4).empty(), "builtin tails retain word/tag ownership");
	const Value transported[] = {valueInteger(7), valueBool(true)};
	const BuiltinArgsView external(transported, 2);
	require(external.tailFrom(1)[0] == valueBool(true), "temporary transport arguments do not become persistent slots");
	auto borrowed = slots.view().subspan(1, 5);
	require(borrowed.get(0) == valueFloatBits(0xffa12345), "borrowed raw NaN bits");
	borrowed.copyFrom(slots.view(), 1, 0, 3);
	require(slots.get(2) == valueInteger(-1) && slots.get(3) == valueFloatBits(0xffa12345), "overlap copies both planes");
	slots.resize(29); require(slots.byteLength() == 145 && slots.get(28) == valueNil(), "growth zeros only new slots");
	require(slots.get(1) == valueFloatBits(0xffa12345), "resize does not materialize a Float");
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	auto& thread = *cpu.rootThread();
	thread.reserveFrame(thread.stackCapacity);
	auto* first = thread.acquireFrame(); first->writeControl(bmsx::FrameField::StackBase, 0); first->writeControl(bmsx::FrameField::StackCapacity, 8);
	thread.enterFrame(first); first->registers = thread.stack.subspan(0, 8);
	first->registers.set(3, valueFloatBits(0xffc00000));
	thread.resizeStack(64);
	require(thread.stackByteLength() == 320 && first->registers.get(3) == valueFloatBits(0xffc00000), "thread growth rebinds compact frame windows");
	require(thread.stack.ram() == &memory && reinterpret_cast<const u8*>(thread.stack.words()) == memory.ramData() + thread.stackOffset(), "the native payload plane borrows physical RAM");
	thread.reserveFrame(thread.stackCapacity);
	auto* second = thread.acquireFrame(); second->writeControl(bmsx::FrameField::StackBase, 4); second->writeControl(bmsx::FrameField::StackCapacity, 4);
	thread.enterFrame(second); second->registers = thread.stack.subspan(4, 4);
	second->registers.set(0, valueInteger(123)); thread.resizeStack(96);
	require(second->registers.get(0) == valueInteger(123) && first->registers.get(3) == valueFloatBits(0xffc00000), "nested frame windows survive relocation");
	thread.leaveFrame(); require(thread.currentFrame == first, "ordinary return retains caller");
	static_assert(closureRecordBytes(2) - closureRecordBytes(1) == sizeof(uint32_t));
}
void valuesAndText() {
	require(valueNil() == 0 && !isTruthy(valueBool(false)) && isTruthy(valueInteger(0)), "truth is by tag");
	require(valuesEqual(valueInteger(2), valueFloat(2.0f)), "cross-subtype equality");
	require(!valuesEqual(valueInteger(16777217), valueFloat(16777216.0f)), "Integer precision retained");
	require(!valuesEqual(valueFloatBits(BLUA32_FLOAT_NAN), valueFloatBits(BLUA32_FLOAT_NAN)), "NaN is not equal to itself");
	require(valueIsNaN(valueFloatBits(0xffa12345)) && !valueIsNaN(valueFloatBits(0x7f800000)),
		"the raw Float discriminator rejects NaN keys without rejecting infinity");
	require(ValueEq{}(valueInteger(0), valueFloatBits(0x80000000)), "zero keys canonicalize");
	require(hashCanonicalTableKey(valueInteger(2)) == hashCanonicalTableKey(canonicalTableKey(valueFloat(2.0f))), "equal numeric keys share hash");
	require(hashCanonicalTableKey(valueTable(0x81234564u)) == hashCanonicalTableKey(valueInteger(0x81234564u)),
		"record identity still hashes its full raw address word");
	require(formatInteger(-2147483647 - 1) == "-2147483648", "signed Integer text");
	require(formatFloat(2.0f) == "2.0" && formatFloat(10000000.0f) == "1e+07", "Float notation");
	require(formatFloat(f32BitsToNumber(1)) == "1.401298e-45", "subnormal Float text");
	require(formatFloat(f32BitsToNumber(0x7f7fffff)) == "3.402823e+38", "maximum Float text");
}
void vectors() {
	char operation; uint32_t first, second;
	while (std::cin >> operation >> std::hex >> first >> second) {
		if (operation == 'V') {
			const Value value = valueFromTag(static_cast<ValueTag>(first), second);
			std::cout << std::hex << value << ' ' << canonicalTableKey(value) << '\n';
		} else if (operation == 'H') std::cout << std::hex << hashCanonicalTableKey(canonicalTableKey(valueFromTag(static_cast<ValueTag>(first), second))) << '\n';
		else if (operation == 'F') std::cout << formatFloat(f32BitsToNumber(first)) << '\n';
		else if (operation == 'I') std::cout << formatInteger(static_cast<int32_t>(first)) << '\n';
		else throw std::runtime_error("unknown Value test operation");
	}
}
}
int main(int argc, char** argv) {
	try {
		storageAndFrames(); valuesAndText();
		if (argc == 2 && std::string_view(argv[1]) == "--vectors") vectors();
		else std::cout << "compact Value/frame tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
