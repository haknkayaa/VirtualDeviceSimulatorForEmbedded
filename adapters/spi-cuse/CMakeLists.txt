cmake_minimum_required(VERSION 3.16)
project(vds4e_spi_cuse VERSION 0.1.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FUSE3 REQUIRED IMPORTED_TARGET fuse3)

set(VDS4E_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_executable(vds4e-spi-cuse
    src/main.c
    "${VDS4E_ROOT}/adapters/bridge/src/adapter_bridge.c"
)
target_compile_definitions(vds4e-spi-cuse PRIVATE FUSE_USE_VERSION=31)
target_include_directories(vds4e-spi-cuse PRIVATE
    "${VDS4E_ROOT}/adapters/bridge/include"
)
target_compile_options(vds4e-spi-cuse PRIVATE
    -Wall -Wextra -Wpedantic -Werror
)
target_link_libraries(vds4e-spi-cuse PRIVATE
    PkgConfig::FUSE3
    pthread
)

enable_testing()
add_test(NAME spi-cuse-help COMMAND vds4e-spi-cuse --help)
add_test(
    NAME spi-cuse-rejects-invalid-device-name
    COMMAND vds4e-spi-cuse --name /dev/spidev0.0 --device-id spi-flash-0
)
set_tests_properties(spi-cuse-rejects-invalid-device-name PROPERTIES
    WILL_FAIL TRUE
)
