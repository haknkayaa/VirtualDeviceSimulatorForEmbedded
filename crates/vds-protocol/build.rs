fn main() {
    println!("cargo:rerun-if-changed=../../proto/vds.proto");
    prost_build::compile_protos(&["../../proto/vds.proto"], &["../../proto"])
        .expect("failed to compile VDS4E protobuf schema");
}
