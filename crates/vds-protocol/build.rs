fn main() {
    println!("cargo:rerun-if-changed=../../proto/vds.proto");

    let protoc = protoc_bin_vendored::protoc_bin_path().expect("failed to locate vendored protoc");
    let mut config = prost_build::Config::new();
    config.protoc_executable(protoc);
    config
        .compile_protos(&["../../proto/vds.proto"], &["../../proto"])
        .expect("failed to compile VDS4E protobuf schema");
}
