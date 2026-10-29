#include "machine/devices/cartridge/card.h"
#include <array>
#include <cstdio>
int main() {
    const std::array<bmsx::u8,5> rom{0x10,0x11,0x12,0x13,0x14};
    bmsx::CartridgeCard card(bmsx::CartridgeCardMedia{rom,5u,true},0);
    constexpr bmsx::u32 ram=0x30000000, rombase=0x10000000, mmio=0x30f00000;
    const auto emit=[](bmsx::u32 x) { std::printf("%08x\n",x); };
    card.writeU32(ram+1,0x11223344);emit(card.readU32(ram+1));emit(card.readU16(ram+3));emit(card.readU8(ram+4));
    card.writeU32(ram+2,0xff00ff00);emit(card.readU32(ram+3));emit(card.readU32(rombase+3));
    card.writeU32(mmio,0x89abcdef);emit(card.readU32(mmio+1));emit(card.readU16(mmio+1));emit(card.readU8(mmio+1));
    card.writeU32(mmio+1,0x11223344);card.writeU16(mmio,0x1122);emit(card.readU32(mmio));
    card.writeU32(mmio+4,0x80000007);emit(card.readU32(mmio+4));emit(card.readU32(mmio+8));
    card.writeU32(mmio+12,0);emit(card.readU32(mmio+8));
    card.writeU32(mmio+12,1);emit(card.readU32(mmio+8));
}
