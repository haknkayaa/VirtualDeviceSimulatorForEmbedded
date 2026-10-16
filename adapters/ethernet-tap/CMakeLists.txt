cmake_minimum_required(VERSION 3.16)
project(vds4e_ethernet_tap VERSION 0.1.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(VDS4E_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
add_subdirectory("${VDS4E_ROOT}/adapters/bridge"
                 "${CMAKE_CURRENT_BINARY_DIR}/bridge")

add_executable(vds4e-ethernet-tap main.c)
target_compile_features(vds4e-ethernet-tap PRIVATE c_std_11)
target_compile_definitions(vds4e-ethernet-tap PRIVATE _DEFAULT_SOURCE)
target_compile_options(vds4e-ethernet-tap PRIVATE -Wall -Wextra -Wpedantic -Werror)
target_link_libraries(vds4e-ethernet-tap PRIVATE vds4e_adapter_bridge)
