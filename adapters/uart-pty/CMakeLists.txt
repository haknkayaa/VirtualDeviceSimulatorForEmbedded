cmake_minimum_required(VERSION 3.16)
project(vds4e_uart_pty VERSION 0.1.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(VDS4E_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
add_subdirectory("${VDS4E_ROOT}/adapters/bridge"
                 "${CMAKE_CURRENT_BINARY_DIR}/bridge")

add_executable(vds4e-uart-pty main.c)
target_compile_features(vds4e-uart-pty PRIVATE c_std_11)
target_compile_definitions(vds4e-uart-pty PRIVATE _DEFAULT_SOURCE _XOPEN_SOURCE=600)
target_compile_options(vds4e-uart-pty PRIVATE -Wall -Wextra -Wpedantic -Werror)
target_link_libraries(vds4e-uart-pty PRIVATE vds4e_adapter_bridge)

enable_testing()
# The adapter prints usage and exits non-zero without required arguments.
add_test(NAME uart-pty-requires-arguments COMMAND vds4e-uart-pty)
set_tests_properties(uart-pty-requires-arguments PROPERTIES
    PASS_REGULAR_EXPRESSION "usage:")
