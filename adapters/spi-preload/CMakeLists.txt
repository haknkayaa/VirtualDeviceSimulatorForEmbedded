cmake_minimum_required(VERSION 3.16)
project(vds4e_spi_preload VERSION 0.1.0 LANGUAGES C)

option(VDS4E_SPI_PRELOAD_BUILD_TESTS "Build preload adapter tests" ON)
option(VDS4E_SPI_PRELOAD_SANITIZERS "Enable Address/Undefined sanitizers" OFF)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(VDS4E_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")

add_library(vds4e-spi-preload SHARED
    src/preload.c
    src/real_symbols.c
    src/fd_table.c
    src/device_map.c
    src/ioctl_spi.c
    src/logging.c
    "${VDS4E_ROOT}/client/c/src/client.c"
)

target_include_directories(vds4e-spi-preload PRIVATE
    include
    "${VDS4E_ROOT}/client/c/include"
)
target_compile_options(vds4e-spi-preload PRIVATE
    -Wall -Wextra -Wpedantic -Werror
    -fvisibility=hidden
)
target_link_libraries(vds4e-spi-preload PRIVATE dl pthread)
set_target_properties(vds4e-spi-preload PROPERTIES
    OUTPUT_NAME "vds4e-spi-preload"
    C_VISIBILITY_PRESET hidden
)

if(VDS4E_SPI_PRELOAD_SANITIZERS)
    target_compile_options(vds4e-spi-preload PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(vds4e-spi-preload PRIVATE -fsanitize=address,undefined)
endif()

add_executable(native-spidev-read-id examples/native_spidev_read_id.c)
target_compile_definitions(native-spidev-read-id PRIVATE _GNU_SOURCE)
target_compile_options(native-spidev-read-id PRIVATE -Wall -Wextra -Wpedantic -Werror)

if(VDS4E_SPI_PRELOAD_BUILD_TESTS)
    enable_testing()

    add_executable(spi-preload-unit-tests
        tests/unit_tests.c
        src/device_map.c
        src/fd_table.c
        src/ioctl_spi.c
        src/logging.c
        "${VDS4E_ROOT}/client/c/src/client.c"
    )
    target_compile_definitions(spi-preload-unit-tests PRIVATE VDS4E_TESTING)
    target_include_directories(spi-preload-unit-tests PRIVATE
        include
        "${VDS4E_ROOT}/client/c/include"
    )
    target_compile_options(spi-preload-unit-tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_libraries(spi-preload-unit-tests PRIVATE pthread)
    if(VDS4E_SPI_PRELOAD_SANITIZERS)
        target_compile_options(spi-preload-unit-tests PRIVATE
            -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_link_options(spi-preload-unit-tests PRIVATE
            -fsanitize=address,undefined)
    endif()
    add_test(NAME spi-preload-unit-tests COMMAND spi-preload-unit-tests)

    add_executable(spi-preload-abi-probe tests/abi_probe.c)
    target_compile_options(spi-preload-abi-probe PRIVATE -Wall -Wextra -Wpedantic -Werror)

    add_executable(spi-preload-transfer-error-probe tests/transfer_error_probe.c)
    target_compile_options(spi-preload-transfer-error-probe PRIVATE
        -Wall -Wextra -Wpedantic -Werror)

    add_executable(spi-preload-transfer-success-probe
        tests/transfer_success_probe.c)
    target_compile_options(spi-preload-transfer-success-probe PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    target_link_libraries(spi-preload-transfer-success-probe PRIVATE pthread)
    add_test(
        NAME spi-preload-forward-and-config
        COMMAND "${CMAKE_COMMAND}" -E env
            "LD_PRELOAD=$<TARGET_FILE:vds4e-spi-preload>"
            "VDS4E_SPI_MAP=/dev/spidev0.0=test-device"
            "$<TARGET_FILE:spi-preload-abi-probe>"
    )

    set(VDS4E_SERVER_EXECUTABLE "" CACHE FILEPATH
        "Optional vds-server binary used for LD_PRELOAD end-to-end testing")
    if(VDS4E_SERVER_EXECUTABLE)
        add_test(
            NAME spi-preload-read-id-e2e
            COMMAND sh
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/run_e2e.sh"
                "$<TARGET_FILE:vds4e-spi-preload>"
                "$<TARGET_FILE:native-spidev-read-id>"
                "$<TARGET_FILE:spi-preload-transfer-error-probe>"
                "$<TARGET_FILE:spi-preload-transfer-success-probe>"
                "${VDS4E_SERVER_EXECUTABLE}"
        )
    endif()
endif()
