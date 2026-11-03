add_executable(app main.cpp ../libs/legacy/shared.cpp)
set_target_properties(app PROPERTIES CXX_STANDARD 20)
target_link_libraries(app PRIVATE legacy)
