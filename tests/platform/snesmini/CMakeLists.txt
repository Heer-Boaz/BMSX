cmake_minimum_required(VERSION 3.18)

project(bmsx_snesmini_libretro_smoke C)

add_executable(bmsx_snesmini_libretro_smoke
	libretro_smoke.c
)
target_include_directories(bmsx_snesmini_libretro_smoke PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/../../../hosts/libretro
)
target_link_libraries(bmsx_snesmini_libretro_smoke PRIVATE dl)
