# BIOS math library: paragraph assignments

Reader target: a programmer new to BMSX can choose every installed Math
operation, distinguish Number results from register words and integer labels,
use the real angle and random-state interfaces, and build a complete ordinary
cartridge without importing standard-Lua or host-library assumptions.

1. Elementary facts-only author: twelve functions and four exported constants;
   exact arguments/results, arithmetic equations, selection and nonnumeric
   behavior, retained/public dependencies, errors and variable-work costs.
2. Transcendental facts-only author: the eleven angle, root, exponential and
   logarithm operations, actual approximations/conversions, arguments, errors,
   result counts and sourced work limits. The sine helper's real LUT path
   must not be replaced by an inferred GTE call or ideal library function.
3. Random facts-only author: both exported functions, actual state and update
   order, defaults, bounds, errors, seed conversion and reached return count.
   Do not infer independent per-cartridge/thread generators or statistical,
   cryptographic, reset or save-state properties.
4. Call-boundary author: the actual known-call source minimum versus reached
   parameter fill, and the cartridge-policy restriction on `math.floor`.
   Existing policy and diagnostics are documented, not bypassed or repaired.
5. Root: integrate the bounded sections and complete ordinary BLua program,
   typed BSS, explicit observations, manifest and build/check/playback route.
   No local codec, number formatter, ABI helper or replacement math library.
6. Nonauthors: independent actual-owner audits and listing/result comparison;
   public-only newcomer reconstruction; individual actual-PDF page inspection.

Each section consumes only its frozen source sheet. Historical documentation
is organization/style evidence only. The first elementary draft is not the
whole library: eleven transcendental and two random interfaces have their own
assignments. CPU7, Table length, BZ01 and LS01 remain open; finite library
examples do not waive them or establish whole-console acceptance. Keep the
existing publisher and review representation; add no framework or harness.
