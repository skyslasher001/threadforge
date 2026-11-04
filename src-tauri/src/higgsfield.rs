//! Higgsfield API bridge. Every network call happens here, in the native shell:
//! the API key never enters the web view, and it is stored in the OS credential vault
//! (Windows Credential Manager) rather than in project files or browser storage.

use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::ipc::{InvokeBody, Request, Response};

const DEFAULT_BASE: &str = "https://api.higgsfield.ai";

/// API root. Overridable for the integration test against a local mock server.
fn base() -> String {
    std::env::var("THREADFORGE_HF_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string())
}
const SERVICE: &str = "THREADFORGE Higgsfield";
const ACCOUNT: &str = "api-key";

fn entry() -> Result<&'static keyring::Entry, String> {
    static E: OnceLock<Result<keyring::Entry, String>> = OnceLock::new();
    E.get_or_init(|| keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Credential store unavailable: {e}")))
        .as_ref()
        .map_err(Clone::clone)
}

fn auth() -> Result<String, String> {
    let k = entry()?
        .get_password()
        .map_err(|_| "Add your Higgsfield API key first (Showcase → On-model render → API key).".to_string())?;
    Ok(format!("Key {k}"))
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("THREADFORGE/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("http client")
    })
}

/// Model paths look like `alibaba/qwen-image-3/edit`; reject anything else before it reaches a URL.
fn check_path(p: &str) -> Result<(), String> {
    let ok = !p.is_empty()
        && p.len() < 120
        && !p.contains("..")
        && !p.starts_with('/')
        && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'));
    if ok { Ok(()) } else { Err(format!("Invalid model path: {p}")) }
}

fn check_id(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.len() < 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err("Invalid request id".into())
    }
}

async fn read(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
    if status.is_success() {
        return Ok(body);
    }
    let detail = body
        .get("detail")
        .map(|d| if d.is_string() { d.as_str().unwrap_or_default().to_string() } else { d.to_string() })
        .or_else(|| body.get("error").map(|e| e.to_string()))
        .unwrap_or_else(|| text.chars().take(300).collect());
    Err(match status.as_u16() {
        401 | 403 => "Higgsfield rejected the API key. Check the key ID and secret.".into(),
        402 => "Not enough Higgsfield credits for this job.".into(),
        404 => format!("Not found on Higgsfield: {detail}"),
        422 => format!("Higgsfield couldn't accept these settings: {detail}"),
        429 => "Higgsfield is rate limiting requests. Wait a moment and try again.".into(),
        s => format!("Higgsfield error {s}: {detail}"),
    })
}

#[tauri::command]
pub fn hf_key_status() -> bool {
    entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

#[tauri::command]
pub fn hf_set_key(id: String, secret: String) -> Result<(), String> {
    let (id, secret) = (id.trim(), secret.trim());
    if id.is_empty() || secret.is_empty() || id.contains(':') || id.contains(char::is_whitespace) || secret.contains(char::is_whitespace) {
        return Err("Paste the API key ID and the secret exactly as Higgsfield shows them.".into());
    }
    entry()?.set_password(&format!("{id}:{secret}")).map_err(|e| format!("Couldn't save the key: {e}"))
}

#[tauri::command]
pub fn hf_clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Price of a job before it runs: `{"usd":"0.094"}`.
#[tauri::command]
pub async fn hf_estimate(model: String, body: Value) -> Result<Value, String> {
    check_path(&model)?;
    let r = client()
        .post(format!("{}/estimate/{model}", base()))
        .header("Authorization", auth()?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Higgsfield: {e}"))?;
    read(r).await
}

#[tauri::command]
pub async fn hf_submit(model: String, body: Value, idempotency_key: String) -> Result<Value, String> {
    check_path(&model)?;
    check_id(&idempotency_key)?;
    let r = client()
        .post(format!("{}/{model}", base()))
        .header("Authorization", auth()?)
        .header("Idempotency-Key", idempotency_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Higgsfield: {e}"))?;
    read(r).await
}

#[tauri::command]
pub async fn hf_status(request_id: String) -> Result<Value, String> {
    check_id(&request_id)?;
    let r = client()
        .get(format!("{}/requests/{request_id}/status", base()))
        .header("Authorization", auth()?)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Higgsfield: {e}"))?;
    read(r).await
}

#[tauri::command]
pub async fn hf_cancel(request_id: String) -> Result<(), String> {
    check_id(&request_id)?;
    let r = client()
        .post(format!("{}/requests/{request_id}/cancel", base()))
        .header("Authorization", auth()?)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Higgsfield: {e}"))?;
    if r.status().is_success() { Ok(()) } else { read(r).await.map(|_| ()) }
}

/// Upload image bytes (raw IPC body) and return the public URL Higgsfield models can read.
#[tauri::command]
pub async fn hf_upload(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected image bytes".into());
    };
    let content_type = request
        .headers()
        .get("x-content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    upload_bytes(bytes.clone(), content_type).await
}

async fn upload_bytes(bytes: Vec<u8>, content_type: String) -> Result<String, String> {
    if !matches!(content_type.as_str(), "image/png" | "image/jpeg" | "image/webp") {
        return Err("Only PNG, JPEG or WebP images can be uploaded".into());
    }
    let slot = read(
        client()
            .post(format!("{}/files/generate-upload-url", base()))
            .header("Authorization", auth()?)
            .json(&json!({ "content_type": content_type }))
            .send()
            .await
            .map_err(|e| format!("Couldn't reach Higgsfield: {e}"))?,
    )
    .await?;
    let upload_url = slot.get("upload_url").and_then(Value::as_str).ok_or("Upload slot had no URL")?;
    let public_url = slot.get("public_url").and_then(Value::as_str).ok_or("Upload slot had no public URL")?.to_string();
    // the signed upload URL takes the provided headers only, never the API key
    let mut put = client().put(upload_url).body(bytes);
    match slot.get("upload_headers").and_then(Value::as_object) {
        Some(h) => {
            for (k, v) in h {
                if let Some(v) = v.as_str() {
                    put = put.header(k.as_str(), v);
                }
            }
        }
        None => put = put.header("Content-Type", content_type.as_str()),
    }
    let r = put.send().await.map_err(|e| format!("Upload failed: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Upload failed with status {}", r.status()));
    }
    Ok(public_url)
}

/// Fetch a finished result (image or video) so it can be kept with the project.
#[tauri::command]
pub async fn hf_download(url: String) -> Result<Response, String> {
    download_bytes(url).await.map(Response::new)
}

async fn download_bytes(url: String) -> Result<Vec<u8>, String> {
    let u = reqwest::Url::parse(&url).map_err(|_| "Bad result URL".to_string())?;
    if u.scheme() != "https" && std::env::var("THREADFORGE_HF_BASE").is_err() {
        return Err("Results must come over HTTPS".into());
    }
    let r = client().get(u).send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Download failed with status {} (results expire; try again soon after they finish)", r.status()));
    }
    let bytes = r.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_and_ids_are_validated() {
        assert!(check_path("alibaba/qwen-image-3/edit").is_ok());
        assert!(check_path("kling-video/v2.6/pro/image-to-video").is_ok());
        assert!(check_path("../etc").is_err());
        assert!(check_path("/abs").is_err());
        assert!(check_path("a b").is_err());
        assert!(check_path("x?y=1").is_err());
        assert!(check_id("d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff").is_ok());
        assert!(check_id("a/b").is_err());
    }

    /// Full flow against tests/hf_mock.py (run with THREADFORGE_HF_BASE set; see tests/hf_bridge.sh).
    #[test]
    #[ignore]
    fn flow_against_mock_server() {
        // the container has no OS keyring; the in-memory mock store behaves the same way
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        tauri::async_runtime::block_on(async {
            hf_set_key("key-id".into(), "s3cret".into()).unwrap();
            assert!(hf_key_status());
            let est = hf_estimate("alibaba/qwen-image-3/edit".into(), json!({"prompt": "p", "image_urls": ["u"]})).await.unwrap();
            assert_eq!(est["usd"], "0.094");
            let url = upload_bytes(b"\x89PNG fake".to_vec(), "image/png".into()).await.unwrap();
            assert!(url.ends_with("/public/1.png"), "{url}");
            let job = hf_submit("alibaba/qwen-image-3/edit".into(), json!({"prompt": "p", "image_urls": [url]}), "idem-1".into()).await.unwrap();
            let id = job["request_id"].as_str().unwrap().to_string();
            let mut st = Value::Null;
            for _ in 0..10 {
                st = hf_status(id.clone()).await.unwrap();
                if st["status"] == "completed" { break; }
            }
            assert_eq!(st["status"], "completed");
            let img = download_bytes(st["images"][0]["url"].as_str().unwrap().into()).await.unwrap();
            assert_eq!(&img[..4], b"\x89PNG");
            hf_cancel(id).await.unwrap();
            let bad = hf_submit("kling-video/v2.6/pro/image-to-video".into(), json!({"prompt": "x"}), "idem-2".into()).await.unwrap_err();
            assert!(bad.contains("couldn't accept"), "{bad}");
            hf_clear_key().unwrap();
            assert!(!hf_key_status());
            let no_key = hf_estimate("alibaba/qwen-image-3/edit".into(), json!({})).await.unwrap_err();
            assert!(no_key.contains("API key"), "{no_key}");
        });
    }
}
