use std::{fs, path::Path, sync::Arc};

use vds_core::{clock::ManualClock, registry::DeviceRegistry};
use vds_device_model::DeviceModel;
use vds_scenario::{RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioExecutor};

const MODEL: &str =
    include_str!("../../../device-models/examples/micron-mt25ql256aba8esf-0sit/model/device.yaml");

fn executor() -> ScenarioExecutor<RegistryRuntime> {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(MODEL)
        .expect("reference model must parse")
        .into_spi_device_with_clock(clock.clone())
        .expect("reference model must build");
    let registry = DeviceRegistry::new();
    registry.register(Arc::new(device)).unwrap();
    ScenarioExecutor::new(RegistryRuntime::new(Arc::new(registry), clock))
}

#[test]
fn micron_model_runs_every_package_scenario() {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../device-models/examples/micron-mt25ql256aba8esf-0sit/scenarios");
    let mut paths = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    paths.sort();
    assert_eq!(paths.len(), 4);
    for path in paths {
        let yaml = fs::read_to_string(&path).unwrap();
        let document = ScenarioDocument::from_yaml(&yaml)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let result = executor().run(&document);
        assert_eq!(
            result.status,
            ResultStatus::Passed,
            "{} failed:\n{result:#?}",
            path.display()
        );
    }
}
