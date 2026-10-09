{
  "targets": [
    {
      "target_name": "omnifilter",
      "sources": [ "native/omnifilter.cpp" ],
      "include_dirs": [ "<!(node -p \"require('node-addon-api').include_dir\")" ],
      "defines": [ "NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "cflags_cc": [ "-std=c++17" ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          },
          "link_settings": {
            # OpenCL ships with macOS as a system framework.
            "libraries": [ "-framework OpenCL" ]
          }
        }],
        ["OS=='linux'", {
          # Links against the ICD loader (e.g. apt: ocl-icd-opencl-dev, which
          # also provides the CL/cl.h headers). The loader then dispatches to
          # whichever vendor driver is installed (NVIDIA, AMD, Intel, pocl).
          "link_settings": {
            "libraries": [ "-lOpenCL" ]
          }
        }],
        ["OS=='win'", {
          # Set OPENCL_SDK to an OpenCL SDK (e.g. the Khronos OpenCL-SDK release).
          "include_dirs": [ "$(OPENCL_SDK)/include" ],
          "link_settings": {
            "libraries": [ "$(OPENCL_SDK)/lib/OpenCL.lib" ]
          },
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }]
      ]
    }
  ]
}
