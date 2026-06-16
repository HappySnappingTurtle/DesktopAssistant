use super::claude_hook::parse_hook_payload;
use super::{now_ms, BusState};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use tauri::Manager;

pub const DEFAULT_PORT: u16 = 7321;
const MAX_BODY: usize = 64 * 1024;

/// 实际监听端口（供安装向导/前端查询）
pub struct EndpointState(pub Mutex<Option<u16>>);

/// PTY 包装器会话注册表：session_id → inject URL
pub struct PtyRegistry(pub Mutex<HashMap<String, String>>);

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut server = None;
        let mut bound_port = 0u16;
        for offset in 0..20u16 {
            let port = DEFAULT_PORT + offset;
            match tiny_http::Server::http(("127.0.0.1", port)) {
                Ok(s) => {
                    server = Some(s);
                    bound_port = port;
                    break;
                }
                Err(_) => continue,
            }
        }
        let Some(server) = server else {
            eprintln!("[hook-server] 无可用端口（{DEFAULT_PORT}..+20）");
            return;
        };
        if let Some(state) = app.try_state::<EndpointState>() {
            *state.0.lock().unwrap() = Some(bound_port);
        }
        println!("[hook-server] listening on 127.0.0.1:{bound_port}");

        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().clone();

            let respond = |request: tiny_http::Request, code: u16, body: &str| {
                let resp = tiny_http::Response::from_string(body).with_status_code(code);
                let _ = request.respond(resp);
            };

            match (method, url.as_str()) {
                (tiny_http::Method::Get, "/health") => respond(request, 200, "ok"),
                #[cfg(debug_assertions)]
                (tiny_http::Method::Post, "/dev/ui") => {
                    // 开发调试：驱动前端 UI（open-settings / open-menu / tap）
                    let mut body = String::new();
                    let _ = request
                        .as_reader()
                        .take(MAX_BODY as u64)
                        .read_to_string(&mut body);
                    use tauri::Emitter;
                    let _ = app.emit(
                        "dev://ui",
                        serde_json::json!({ "action": body.trim() }),
                    );
                    respond(request, 200, "emitted");
                }
                #[cfg(debug_assertions)]
                (tiny_http::Method::Post, "/dev/transcript") => {
                    // 开发调试：模拟语音转写结果（等价 voice://transcript）；release 不编译
                    let mut body = String::new();
                    let _ = request
                        .as_reader()
                        .take(MAX_BODY as u64)
                        .read_to_string(&mut body);
                    use tauri::Emitter;
                    let _ = app.emit(
                        "voice://transcript",
                        serde_json::json!({ "text": body.trim() }),
                    );
                    respond(request, 200, "emitted");
                }
                (tiny_http::Method::Post, "/pty/register") => {
                    let mut body = String::new();
                    if request
                        .as_reader()
                        .take(MAX_BODY as u64)
                        .read_to_string(&mut body)
                        .is_err()
                    {
                        respond(request, 400, "unreadable body");
                        continue;
                    }
                    #[derive(serde::Deserialize)]
                    struct Reg {
                        session_id: String,
                        inject_url: String,
                    }
                    match serde_json::from_str::<Reg>(&body) {
                        Ok(reg) => {
                            if let Some(r) = app.try_state::<PtyRegistry>() {
                                r.0.lock()
                                    .unwrap()
                                    .insert(reg.session_id, reg.inject_url);
                            }
                            respond(request, 200, "registered");
                        }
                        Err(e) => respond(request, 400, &format!("invalid: {e}")),
                    }
                }
                (tiny_http::Method::Post, "/agent-event") => {
                    // PTY 包装器等来源：直接投递 AgentEvent JSON
                    let mut body = String::new();
                    if request
                        .as_reader()
                        .take(MAX_BODY as u64)
                        .read_to_string(&mut body)
                        .is_err()
                    {
                        respond(request, 400, "unreadable body");
                        continue;
                    }
                    match serde_json::from_str::<super::event::AgentEvent>(&body) {
                        Ok(event) => {
                            if let Some(bus) = app.try_state::<BusState>() {
                                if let Ok(mut b) = bus.0.lock() {
                                    let r = b.publish(event);
                                    respond(request, 200, &format!("{r:?}"));
                                    continue;
                                }
                            }
                            respond(request, 500, "bus unavailable");
                        }
                        Err(e) => respond(request, 400, &format!("invalid AgentEvent: {e}")),
                    }
                }
                (tiny_http::Method::Post, "/event") => {
                    let mut body = String::new();
                    let ok = request
                        .as_reader()
                        .take(MAX_BODY as u64)
                        .read_to_string(&mut body)
                        .is_ok();
                    if !ok {
                        respond(request, 400, "unreadable body");
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) else {
                        respond(request, 400, "invalid json");
                        continue;
                    };
                    match parse_hook_payload(&value, now_ms()) {
                        Some(event) => {
                            if let Some(bus) = app.try_state::<BusState>() {
                                if let Ok(mut b) = bus.0.lock() {
                                    let r = b.publish(event);
                                    respond(request, 200, &format!("{r:?}"));
                                    continue;
                                }
                            }
                            respond(request, 500, "bus unavailable");
                        }
                        None => respond(request, 200, "ignored"),
                    }
                }
                _ => respond(request, 404, "not found"),
            }
        }
    });
}
