fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("build_helpers/window_helper.m")
            .flag("-fobjc-arc")
            .compile("window_helper");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
}
