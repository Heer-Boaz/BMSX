# CPU opcode identity, format class and nominal charge facts

Frozen paired spec-only read, baseline 375de6170,2026-10-17. This sheet is not operation semantics.

CP-O01. Opcode values are zero-based in machine/ts/spec/blua32/opcode.ts:1-65;
mirror ordered opcode_list.inl:1-64 via machine/cpp/spec/blua32/opcode.h:9-13.
Nominal charges and Bx/displacement selectors are matching arrays in that TS
leaf and machine/cpp/spec/blua32/opcode.cpp. All64 identities and all3x64 array
entries were compared mechanically, no mismatch. Prefix WIDE nominal0 is not
a separately executed zero-cost program: decoding/body semantics are separate.

| Decimal | Hex | Mnemonic | Base cycles | Format selector |
|---|---|---|---|---|
| 0 | 00H | WIDE | 0 | ABC |
| 1 | 01H | MOV | 1 | ABC |
| 2 | 02H | LOADK | 1 | Bx |
| 3 | 03H | LOADNIL | 1 | ABC |
| 4 | 04H | LOAD_MEM_D | 2 | Displacement |
| 5 | 05H | KNIL | 1 | ABC |
| 6 | 06H | KFALSE | 1 | ABC |
| 7 | 07H | KTRUE | 1 | ABC |
| 8 | 08H | K0 | 1 | ABC |
| 9 | 09H | K1 | 1 | ABC |
| 10 | 0AH | KM1 | 1 | ABC |
| 11 | 0BH | KSMI | 1 | Bx |
| 12 | 0CH | STORE_MEM_D | 2 | Displacement |
| 13 | 0DH | STORE_MEM_WORDS_D | 2 | Displacement |
| 14 | 0EH | GETT | 1 | ABC |
| 15 | 0FH | SETT | 2 | ABC |
| 16 | 10H | NEWT | 1 | ABC |
| 17 | 11H | ADD | 1 | ABC |
| 18 | 12H | SUB | 1 | ABC |
| 19 | 13H | MUL | 1 | ABC |
| 20 | 14H | DIV | 1 | ABC |
| 21 | 15H | MOD | 1 | ABC |
| 22 | 16H | FLOORDIV | 1 | ABC |
| 23 | 17H | POW | 1 | ABC |
| 24 | 18H | BAND | 1 | ABC |
| 25 | 19H | BOR | 1 | ABC |
| 26 | 1AH | BXOR | 1 | ABC |
| 27 | 1BH | SHL | 1 | ABC |
| 28 | 1CH | SHR | 1 | ABC |
| 29 | 1DH | CONCAT | 1 | ABC |
| 30 | 1EH | CONCATN | 2 | ABC |
| 31 | 1FH | UNM | 1 | ABC |
| 32 | 20H | NOT | 1 | ABC |
| 33 | 21H | LEN | 1 | ABC |
| 34 | 22H | BNOT | 1 | ABC |
| 35 | 23H | EQ | 1 | ABC |
| 36 | 24H | LT | 1 | ABC |
| 37 | 25H | LE | 1 | ABC |
| 38 | 26H | MFC0 | 1 | ABC |
| 39 | 27H | MTC0 | 1 | ABC |
| 40 | 28H | JMP | 1 | Bx |
| 41 | 29H | JMPIF | 1 | Bx |
| 42 | 2AH | JMPIFNOT | 1 | Bx |
| 43 | 2BH | CLOSURE | 1 | Bx |
| 44 | 2CH | GETUP | 1 | ABC |
| 45 | 2DH | SETUP | 2 | ABC |
| 46 | 2EH | VARARG | 2 | ABC |
| 47 | 2FH | CALL | 2 | ABC |
| 48 | 30H | RET | 2 | ABC |
| 49 | 31H | LOAD_MEM | 2 | ABC |
| 50 | 32H | STORE_MEM | 2 | ABC |
| 51 | 33H | STORE_MEM_WORDS | 2 | ABC |
| 52 | 34H | RFE | 1 | ABC |
| 53 | 35H | LOADKR | 1 | ABC |
| 54 | 36H | GETSYS | 1 | Bx |
| 55 | 37H | SETSYS | 2 | Bx |
| 56 | 38H | GETGL | 1 | Bx |
| 57 | 39H | SETGL | 2 | Bx |
| 58 | 3AH | GETI | 1 | ABC |
| 59 | 3BH | SETI | 2 | ABC |
| 60 | 3CH | GETFIELD | 1 | ABC |
| 61 | 3DH | SETFIELD | 2 | ABC |
| 62 | 3EH | SELF | 1 | ABC |
| 63 | 3FH | HALT | 1 | ABC |
