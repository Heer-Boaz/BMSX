#pragma once

namespace bmsx {

class Runtime;
class RuntimeRomPackage;

void configureVdpSlots(Runtime& runtime, const RuntimeRomPackage& systemRom, const RuntimeRomPackage& activeRom);

} // namespace bmsx
