//! HTTP endpoints for device-package discovery and installation.

use super::*;

const MAX_PACKAGE_FILES: usize = 1_024;
const MAX_PACKAGE_BYTES: usize = 32 * 1024 * 1024;
/// HTTP body ceiling: base64 inflates by 4/3, plus JSON framing for up to 1024 paths.
pub(super) const IMPORT_BODY_LIMIT_BYTES: usize = MAX_PACKAGE_BYTES / 3 * 4 + 1024 * 1024;

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
    image_url: Option<String>,
}

pub(super) async fn device_packages() -> ApiResult<Json<Vec<ImportedPackage>>> {
    let packages = installed_device_packages()
        .map_err(|error| ApiError::internal("device_package_list_failed", error.to_string()))?;
    Ok(Json(
        packages
            .into_iter()
            .map(|package| {
                let id = package.manifest().metadata.id.clone();
                ImportedPackage {
                    image_url: package_image(&package)
                        .map(|_| format!("/api/v1/device-packages/{id}/image")),
                    id,
                    name: package.manifest().metadata.display_name.clone(),
                    version: package.manifest().metadata.version.clone(),
                    bus: package.manifest().spec.bus.kind.as_str().to_owned(),
                }
            })
            .collect(),
    ))
}

pub(super) fn package_image(package: &DevicePackage) -> Option<(PathBuf, &'static str)> {
    let assets = package.manifest().spec.assets.as_ref()?;
    let directory = package.root().join(assets);
    let mut candidates = fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let path = entry.path();
            let mime = match path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
            {
                Some("png") => "image/png",
                Some("jpg" | "jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                Some("svg") => "image/svg+xml",
                _ => return None,
            };
            Some((path, mime))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.0.cmp(&right.0));
    candidates.into_iter().next()
}

pub(super) async fn device_package_image(Path(id): Path<String>) -> ApiResult<Response> {
    let packages = installed_device_packages()
        .map_err(|error| ApiError::internal("device_package_list_failed", error.to_string()))?;
    let package = packages
        .into_iter()
        .find(|package| package.manifest().metadata.id == id)
        .ok_or_else(|| {
            ApiError::not_found(
                "device_package_not_found",
                format!("device package '{id}' was not found"),
            )
        })?;
    let (path, content_type) = package_image(&package).ok_or_else(|| {
        ApiError::not_found(
            "device_package_image_not_found",
            format!("device package '{id}' has no image asset"),
        )
    })?;
    let bytes = fs::read(&path).map_err(|error| {
        ApiError::internal(
            "device_package_image_read_failed",
            format!("failed to read '{}': {error}", path.display()),
        )
    })?;
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(axum::body::Body::from(bytes))
        .map_err(|error| ApiError::internal("device_package_image_failed", error.to_string()))
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
    let mut seen_paths = std::collections::HashSet::new();
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
        if !seen_paths.insert(file.path.clone()) {
            return Err(ApiError::bad_request(
                "device_package_path_duplicate",
                format!(
                    "package path '{}' appears more than once",
                    file.path.display()
                ),
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
    let image_url = package_image(&package)
        .map(|_| format!("/api/v1/device-packages/{}/image", manifest.metadata.id));
    Ok((
        StatusCode::CREATED,
        Json(ImportedPackage {
            id: manifest.metadata.id,
            name: manifest.metadata.display_name,
            version: manifest.metadata.version,
            bus: manifest.spec.bus.kind.as_str().to_owned(),
            image_url,
        }),
    ))
}
