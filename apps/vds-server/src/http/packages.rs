use super::*;

const MAX_PACKAGE_FILES: usize = 1_024;
const MAX_PACKAGE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ImportPackageRequest {
    files: Vec<ImportPackageFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ImportPackageFile {
    path: PathBuf,
    content_base64: String,
}

#[derive(Serialize)]
pub(super) struct ImportedPackage {
    id: String,
    name: String,
    version: String,
    bus: String,
}

pub(super) async fn device_packages() -> ApiResult<Json<Vec<ImportedPackage>>> {
    let packages = installed_device_packages()
        .map_err(|error| ApiError::internal("device_package_list_failed", error.to_string()))?;
    Ok(Json(
        packages
            .into_iter()
            .map(|package| ImportedPackage {
                id: package.manifest().metadata.id.clone(),
                name: package.manifest().metadata.display_name.clone(),
                version: package.manifest().metadata.version.clone(),
                bus: package.manifest().spec.bus.kind.as_str().to_owned(),
            })
            .collect(),
    ))
}

pub(super) struct TemporaryPackage(PathBuf);

impl Drop for TemporaryPackage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) async fn import_device_package(
    Json(request): Json<ImportPackageRequest>,
) -> ApiResult<(StatusCode, Json<ImportedPackage>)> {
    if request.files.is_empty() || request.files.len() > MAX_PACKAGE_FILES {
        return Err(ApiError::bad_request(
            "device_package_file_count_invalid",
            format!("a package must contain between 1 and {MAX_PACKAGE_FILES} files"),
        ));
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| ApiError::internal("device_package_clock_failed", error.to_string()))?
        .as_nanos();
    let temporary = TemporaryPackage(std::env::temp_dir().join(format!(
        "vds4e-package-import-{}-{nonce}",
        std::process::id()
    )));
    fs::create_dir(&temporary.0)
        .map_err(|error| ApiError::internal("device_package_stage_failed", error.to_string()))?;

    let mut total_bytes = 0_usize;
    for file in request.files {
        if file.path.is_absolute()
            || file.path.as_os_str().is_empty()
            || file
                .path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(ApiError::bad_request(
                "device_package_path_invalid",
                format!("package path '{}' is not safe", file.path.display()),
            ));
        }
        let content = BASE64.decode(file.content_base64).map_err(|_| {
            ApiError::bad_request(
                "device_package_content_invalid",
                format!("package file '{}' is not valid base64", file.path.display()),
            )
        })?;
        total_bytes = total_bytes.saturating_add(content.len());
        if total_bytes > MAX_PACKAGE_BYTES {
            return Err(ApiError::bad_request(
                "device_package_too_large",
                format!("package exceeds the {MAX_PACKAGE_BYTES} byte limit"),
            ));
        }
        let destination = temporary.0.join(&file.path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                ApiError::internal("device_package_stage_failed", error.to_string())
            })?;
        }
        fs::write(&destination, content).map_err(|error| {
            ApiError::internal("device_package_stage_failed", error.to_string())
        })?;
    }

    let package = DevicePackage::load(&temporary.0)
        .map_err(|error| ApiError::bad_request("device_package_invalid", error.to_string()))?;
    let model = crate::load_package_runtime_model(&package).map_err(|error| {
        ApiError::bad_request("device_package_runtime_invalid", error.to_string())
    })?;
    crate::validate_device_package_model(&package, &model)
        .map_err(|error| ApiError::bad_request("device_package_contract_invalid", error))?;
    let manifest = package.manifest().clone();
    install_device_package(&temporary.0).map_err(|error| {
        if error.to_string().contains("already installed") {
            ApiError::conflict("device_package_already_installed", error.to_string())
        } else {
            ApiError::internal("device_package_install_failed", error.to_string())
        }
    })?;
    Ok((
        StatusCode::CREATED,
        Json(ImportedPackage {
            id: manifest.metadata.id,
            name: manifest.metadata.display_name,
            version: manifest.metadata.version,
            bus: manifest.spec.bus.kind.as_str().to_owned(),
        }),
    ))
}
