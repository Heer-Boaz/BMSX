# Product assets stay binary in the repository. Generate the C++ initializer in
# the build tree, as with compiled shaders; no runtime filesystem dependency.
file(READ "${INPUT}" bytes HEX)
string(REPEAT "[0-9a-f][0-9a-f]" 32 row)
string(REGEX REPLACE "${row}" "\\0\n" bytes "${bytes}")
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," bytes "${bytes}")
file(WRITE "${OUTPUT}" "#pragma once\nnamespace bmsx {\nconstexpr unsigned char ${SYMBOL}[] = {${bytes}};\n}\n")
