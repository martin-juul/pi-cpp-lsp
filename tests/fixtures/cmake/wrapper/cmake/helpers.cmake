function(wrapper_add_library name)
  add_library(${name} STATIC ${ARGN})
endfunction()
