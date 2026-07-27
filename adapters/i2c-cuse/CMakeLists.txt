cmake_minimum_required(VERSION 3.16)
project(vds4e_i2c_cuse VERSION 0.1.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FUSE3 REQUIRED IMPORTED_TARGET fuse3)

set(VDS4E_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
add_executable(vds4e-i2c-cuse
    src/main.c
    "${VDS4E_ROOT}/client/c/src/client.c"
)
target_compile_definitions(vds4e-i2c-cuse PRIVATE FUSE_USE_VERSION=31)
target_include_directories(vds4e-i2c-cuse PRIVATE "${VDS4E_ROOT}/client/c/include")
target_compile_options(vds4e-i2c-cuse PRIVATE -Wall -Wextra -Wpedantic -Werror)
target_link_libraries(vds4e-i2c-cuse PRIVATE PkgConfig::FUSE3 pthread)

enable_testing()
add_test(NAME i2c-cuse-help COMMAND vds4e-i2c-cuse --help)
