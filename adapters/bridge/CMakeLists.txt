cmake_minimum_required(VERSION 3.16)
project(vds4e_adapter_bridge VERSION 0.1.0 LANGUAGES C)

add_library(vds4e_adapter_bridge STATIC
    adapter_bridge.c
    bridge_codec.c
    bridge_io.c
    spi_bridge.c
    i2c_bridge.c
    gpio_bridge.c
)
target_include_directories(vds4e_adapter_bridge PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_features(vds4e_adapter_bridge PUBLIC c_std_11)
target_compile_options(vds4e_adapter_bridge PRIVATE
    -Wall -Wextra -Wpedantic -Werror
)
