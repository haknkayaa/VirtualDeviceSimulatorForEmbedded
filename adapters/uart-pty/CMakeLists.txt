cmake_minimum_required(VERSION 3.16)
project(vds4e_uart_pty VERSION 0.1.0 LANGUAGES C)

add_executable(vds4e-uart-pty main.c)
target_compile_features(vds4e-uart-pty PRIVATE c_std_11)
target_compile_definitions(vds4e-uart-pty PRIVATE _DEFAULT_SOURCE _XOPEN_SOURCE=600)
target_compile_options(vds4e-uart-pty PRIVATE -Wall -Wextra -Wpedantic -Werror)
target_include_directories(vds4e-uart-pty PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../bridge")
target_link_libraries(vds4e-uart-pty PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/../../build/bridge/libvds4e_adapter_bridge.a")
