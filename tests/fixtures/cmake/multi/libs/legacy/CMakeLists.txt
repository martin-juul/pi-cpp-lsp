add_library(legacy STATIC legacy.cpp shared.cpp)
target_sources(legacy PRIVATE extra.cpp)
set_target_properties(legacy PROPERTIES CXX_STANDARD 14 CXX_STANDARD_REQUIRED ON)
target_include_directories(legacy PUBLIC include)
target_compile_definitions(legacy PUBLIC LEGACY_API=1)
configure_file(version.h.in ${CMAKE_CURRENT_BINARY_DIR}/version.h)
add_custom_command(
  OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/generated.cpp
  COMMAND ${CMAKE_COMMAND} -E echo "int generated_value() { return 1; }" > ${CMAKE_CURRENT_BINARY_DIR}/generated.cpp
  VERBATIM)
target_sources(legacy PRIVATE ${CMAKE_CURRENT_BINARY_DIR}/generated.cpp ${CMAKE_CURRENT_BINARY_DIR}/version.h)
