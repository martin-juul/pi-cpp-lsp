add_executable(unit_tests test_main.cpp)
target_link_libraries(unit_tests PRIVATE legacy)
add_test(NAME unit COMMAND unit_tests)
