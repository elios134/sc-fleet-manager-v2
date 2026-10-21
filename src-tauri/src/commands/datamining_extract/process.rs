// Exécution de StarBreaker : résolution du binaire, lancement / annulation des processus, construction des arguments, parsing de dcb query.
use super::*;

/* ─────────────────────────── Résolution du binaire ─────────────────────────── */

/// Chemin du binaire StarBreaker. Dev : sources (CARGO_MANIFEST_DIR/resources/…).
/// Packagé : dossier resources Tauri (cf. bundle.resources). Réplique resolveBinaryPath V1.
pub(crate) fn resolve_binary_path(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("starbreaker")
            .join("starbreaker.exe")
    } else {
        app.path()
            .resolve("resources/starbreaker/starbreaker.exe", BaseDirectory::Resource)
            .unwrap_or_else(|_| PathBuf::from("starbreaker.exe"))
    }
}

/* ─────────────────────────── Exécution de processus ────────────────────────── */

pub(crate) fn base_command(program: &Path) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Lance starbreaker en capturant stdout (dcb query). Stocke le PID (pour kill).
pub(crate) fn run_capture(bin: &Path, args: &[String]) -> Result<String, String> {
    let child = base_command(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = Some(child.id());
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = None;
    if !out.status.success() {
        let code = out.status.code().map(|c| c.to_string()).unwrap_or_else(|| "null".into());
        let detail = String::from_utf8_lossy(&out.stderr);
        return Err(format!("code {code}: {}", detail.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Lance starbreaker en ignorant stdout (p4k/dcb extract). Stocke le PID.
pub(crate) fn run_extract(bin: &Path, args: &[String]) -> Result<(), String> {
    let child = base_command(bin)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = Some(child.id());
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = None;
    if !out.status.success() {
        let code = out.status.code().map(|c| c.to_string()).unwrap_or_else(|| "null".into());
        let detail = String::from_utf8_lossy(&out.stderr);
        return Err(format!("code {code}: {}", detail.trim()));
    }
    Ok(())
}

/// Tue le processus StarBreaker courant (annulation). Best-effort, via taskkill /T /F.
pub(crate) fn kill_current() {
    let pid = *CURRENT_PID.lock().unwrap();
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let _ = base_command(Path::new("taskkill"))
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

/* ───────────────────────────── Construction d'args ─────────────────────────── */

pub(crate) fn dcb_query_args(class_name: &str, p4k: &str) -> Vec<String> {
    vec![
        "dcb".into(),
        "query".into(),
        "EntityClassDefinition".into(),
        "--filter".into(),
        format!("*{class_name}*"),
        "--p4k".into(),
        p4k.into(),
    ]
}

pub(crate) fn p4k_extract_args(p4k: &str, out: &str, filter: &str) -> Vec<String> {
    vec![
        "p4k".into(),
        "extract".into(),
        "--p4k".into(),
        p4k.into(),
        "-o".into(),
        out.into(),
        "--filter".into(),
        filter.into(),
    ]
}

pub(crate) fn dcb_extract_args(p4k: &str, out: &str, filter: &str) -> Vec<String> {
    vec![
        "dcb".into(),
        "extract".into(),
        "--p4k".into(),
        p4k.into(),
        "--format".into(),
        "json".into(),
        "-o".into(),
        out.into(),
        "--filter".into(),
        filter.into(),
    ]
}

/* ──────────────────────── Parsing stdout dcb query (V1) ────────────────────── */

/// Découpe le stdout (objets JSON top-level concaténés) en enregistrements.
pub(crate) fn parse_starbreaker_records(stdout: &str) -> Vec<Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed.starts_with('[') {
        if let Ok(Value::Array(a)) = serde_json::from_str::<Value>(trimmed) {
            return a;
        }
    }
    let mut records = Vec::new();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;
    let bytes = stdout.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == b'\\' {
            escaped = true;
            continue;
        }
        if c == b'"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if c == b'{' {
            if depth == 0 {
                start = Some(i);
            }
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start.take() {
                    if let Ok(v) = serde_json::from_str::<Value>(&stdout[s..=i]) {
                        records.push(v);
                    }
                }
            }
        }
    }
    records
}

/// JSON de l'enregistrement dont _RecordName_ == EntityClassDefinition.<class>. None sinon.
pub(crate) fn parse_exact_record(stdout: &str, class_name: &str) -> Option<String> {
    let target = format!("EntityClassDefinition.{class_name}");
    parse_starbreaker_records(stdout)
        .into_iter()
        .find(|r| r.get("_RecordName_").and_then(|v| v.as_str()) == Some(target.as_str()))
        .map(|r| r.to_string())
}
