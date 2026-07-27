cmake_minimum_required(VERSION 3.16)
project(vds4e_gpio_sim VERSION 0.1.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(VDS4E_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_executable(vds4e-gpio-sim
    src/main.c
    "${VDS4E_ROOT}/client/c/src/client.c"
)
target_include_directories(vds4e-gpio-sim PRIVATE
    "${VDS4E_ROOT}/client/c/include"
)
target_compile_options(vds4e-gpio-sim PRIVATE
    -Wall -Wextra -Wpedantic -Werror
)

enable_testing()
add_test(NAME gpio-sim-help COMMAND vds4e-gpio-sim --help)
add_test(NAME gpio-sim-rejects-invalid-lines COMMAND vds4e-gpio-sim --lines 0)
set_tests_properties(gpio-sim-rejects-invalid-lines PROPERTIES WILL_FAIL TRUE)
