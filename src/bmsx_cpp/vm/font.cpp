/*
 * font.cpp - VM font variants
 */

#include "font.h"

namespace bmsx {
namespace {

GlyphMap buildMsxCharMap() {
    const std::string prefix = "msx_6b_font";
    auto withPrefix = [&](const std::string& suffix) {
        return prefix + "_" + suffix;
    };

    GlyphMap map;
    map[static_cast<u32>(' ')] = withPrefix("space");
    map[static_cast<u32>('!')] = withPrefix("exclamation");
    map[static_cast<u32>('\"')] = withPrefix("code_0x22");
    map[static_cast<u32>('#')] = withPrefix("code_0x23");
    map[static_cast<u32>('$')] = withPrefix("code_0x24");
    map[static_cast<u32>('%')] = withPrefix("percent");
    map[static_cast<u32>('&')] = withPrefix("code_0x26");
    map[static_cast<u32>('\'')] = withPrefix("apostroph");
    map[static_cast<u32>('(')] = withPrefix("code_0x28");
    map[static_cast<u32>(')')] = withPrefix("code_0x29");
    map[static_cast<u32>('*')] = withPrefix("code_0x2a");
    map[static_cast<u32>('+')] = withPrefix("code_0x2b");
    map[static_cast<u32>(',')] = withPrefix("comma");
    map[static_cast<u32>('-')] = withPrefix("streep");
    map[static_cast<u32>('.')] = withPrefix("dot");
    map[static_cast<u32>('/')] = withPrefix("slash");
    map[static_cast<u32>(':')] = withPrefix("colon");
    map[static_cast<u32>(';')] = withPrefix("code_0x3b");
    map[static_cast<u32>('<')] = withPrefix("code_0x3c");
    map[static_cast<u32>('=')] = withPrefix("code_0x3d");
    map[static_cast<u32>('>')] = withPrefix("code_0x3e");
    map[static_cast<u32>('?')] = withPrefix("question");
    map[static_cast<u32>('@')] = withPrefix("at_sign");
    map[static_cast<u32>('[')] = withPrefix("code_0x5b");
    map[static_cast<u32>('\\')] = withPrefix("code_0x5c");
    map[static_cast<u32>(']')] = withPrefix("code_0x5d");
    map[static_cast<u32>('^')] = withPrefix("code_0x5e");
    map[static_cast<u32>('_')] = withPrefix("line");
    map[static_cast<u32>('`')] = withPrefix("code_0x60");
    map[static_cast<u32>('{')] = withPrefix("code_0x7b");
    map[static_cast<u32>('|')] = withPrefix("code_0x7c");
    map[static_cast<u32>('}')] = withPrefix("code_0x7d");
    map[static_cast<u32>('~')] = withPrefix("code_0x7e");
    map[0x2022] = withPrefix("ctrl_bel");
    map[0x00A1] = withPrefix("code_0x80");

    for (int i = 0; i < 10; ++i) {
        char digit = static_cast<char>('0' + i);
        map[static_cast<u32>(digit)] = withPrefix(std::string(1, digit));
    }

    for (char c = 'a'; c <= 'z'; ++c) {
        map[static_cast<u32>(c)] = withPrefix(std::string("low_") + c);
    }
    for (char c = 'A'; c <= 'Z'; ++c) {
        char lower = static_cast<char>(c - 'A' + 'a');
        map[static_cast<u32>(c)] = withPrefix(std::string(1, lower));
    }

    return map;
}

GlyphMap buildTinyCharMap() {
    const std::string prefix = "tiny_3b_font";
    auto withPrefix = [&](const std::string& suffix) {
        return prefix + "_" + suffix;
    };

    GlyphMap map;
    map[static_cast<u32>(' ')] = withPrefix("space");
    map[static_cast<u32>('!')] = withPrefix("exclamation");
    map[static_cast<u32>('@')] = withPrefix("at_sign");
    map[static_cast<u32>('#')] = withPrefix("hash");
    map[static_cast<u32>('$')] = withPrefix("dollar");
    map[static_cast<u32>('%')] = withPrefix("percent");
    map[static_cast<u32>('&')] = withPrefix("ampersand");
    map[static_cast<u32>('\"')] = withPrefix("quote");
    map[static_cast<u32>('\'')] = withPrefix("apostroph");
    map[static_cast<u32>('(')] = withPrefix("parenopen");
    map[static_cast<u32>(')')] = withPrefix("parenclose");
    map[static_cast<u32>('*')] = withPrefix("asterisk");
    map[static_cast<u32>('+')] = withPrefix("plus");
    map[static_cast<u32>(',')] = withPrefix("comma");
    map[static_cast<u32>('-')] = withPrefix("streep");
    map[static_cast<u32>('.')] = withPrefix("dot");
    map[static_cast<u32>('/')] = withPrefix("slash");
    map[static_cast<u32>(':')] = withPrefix("colon");
    map[static_cast<u32>(';')] = withPrefix("semicolon");
    map[static_cast<u32>('~')] = withPrefix("tilde");
    map[static_cast<u32>('<')] = withPrefix("lessthan");
    map[static_cast<u32>('=')] = withPrefix("equals");
    map[static_cast<u32>('>')] = withPrefix("greaterthan");
    map[static_cast<u32>('?')] = withPrefix("question");
    map[static_cast<u32>('[')] = withPrefix("bracketopen");
    map[static_cast<u32>('\\')] = withPrefix("backslash");
    map[static_cast<u32>(']')] = withPrefix("bracketclose");
    map[static_cast<u32>('^')] = withPrefix("caret");
    map[static_cast<u32>('_')] = withPrefix("line");
    map[static_cast<u32>('`')] = withPrefix("backtick");
    map[static_cast<u32>('{')] = withPrefix("braceopen");
    map[static_cast<u32>('|')] = withPrefix("pipe");
    map[static_cast<u32>('}')] = withPrefix("braceclose");
    map[0x2022] = withPrefix("bullet");
    map[0x00A1] = withPrefix("inverted_exclamation");
    map[0x00A4] = withPrefix("flower");
    map[0x00A6] = withPrefix("brokenbar");
    map[0x00A7] = withPrefix("section");
    map[0x00A3] = withPrefix("pound");
    map[0x00A5] = withPrefix("yen");
    map[0x20AC] = withPrefix("euro");
    map[0x00B5] = withPrefix("euler");
    map[0x0133] = withPrefix("low_ij");
    map[0x0132] = withPrefix("ij");

    for (int i = 0; i < 10; ++i) {
        char digit = static_cast<char>('0' + i);
        map[static_cast<u32>(digit)] = withPrefix(std::string(1, digit));
    }

    for (char c = 'a'; c <= 'z'; ++c) {
        map[static_cast<u32>(c)] = withPrefix(std::string("low_") + c);
    }
    for (char c = 'A'; c <= 'Z'; ++c) {
        char lower = static_cast<char>(c - 'A' + 'a');
        map[static_cast<u32>(c)] = withPrefix(std::string(1, lower));
    }

    return map;
}

} // namespace

VMFont::VMFont(RuntimeAssets& assets, VMFontVariant variant)
    : BFont(assets, variant == VMFontVariant::Tiny ? buildTinyCharMap() : buildMsxCharMap()) {
}

} // namespace bmsx
