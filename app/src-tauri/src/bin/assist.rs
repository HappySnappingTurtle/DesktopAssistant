//! PTY 包装器：assist run [--agent NAME] -- <cmd> [args...]
//! 透传终端 I/O，旁路检测审批提示 → 上报伴侣进程；/inject 接收按键注入。

use app_lib::agent::detector::{PromptDetector, QUIET_MS};
use app_lib::agent::event::AgentEvent;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const COMPANION: &str = "http://127.0.0.1:7321";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (agent_name, cmd_args) = parse_args(&args).unwrap_or_else(|e| {
        eprintln!("用法: assist run [--agent NAME] -- <cmd> [args...]\n{e}");
        std::process::exit(2);
    });

    let session_id = format!("assist-{}-{}", std::process::id(), now_ms() / 1000);
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    // PTY 创建
    let pty_system = NativePtySystem::default();
    let (cols, rows) = crossterm::terminal::size().unwrap_or((120, 40));
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .expect("openpty 失败");

    let mut cmd = CommandBuilder::new(&cmd_args[0]);
    cmd.args(&cmd_args[1..]);
    cmd.cwd(&cwd);
    let mut child = pair.slave.spawn_command(cmd).expect("子进程启动失败");
    drop(pair.slave);

    let writer = Arc::new(Mutex::new(pair.master.take_writer().expect("PTY writer")));
    let mut reader = pair.master.try_clone_reader().expect("PTY reader");

    // 注入控制端（随机端口）
    let inject_server =
        tiny_http::Server::http("127.0.0.1:0").expect("inject 服务启动失败");
    let inject_port = inject_server.server_addr().to_ip().unwrap().port();
    let inject_url = format!("http://127.0.0.1:{inject_port}/inject");
    {
        let writer = writer.clone();
        std::thread::spawn(move || {
            for mut req in inject_server.incoming_requests() {
                let mut body = String::new();
                let _ = req.as_reader().take(4096).read_to_string(&mut body);
                let keys = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|v| v["keys"].as_str().map(String::from));
                match keys {
                    Some(k) => {
                        let _ = writer.lock().unwrap().write_all(k.as_bytes());
                        let _ = req.respond(tiny_http::Response::from_string("ok"));
                    }
                    None => {
                        let _ = req
                            .respond(tiny_http::Response::from_string("bad").with_status_code(400));
                    }
                }
            }
        });
    }

    if std::env::var("ASSIST_DEBUG").is_ok() {
        eprintln!("[assist] session={session_id} inject={inject_url}");
    }

    // 注册到伴侣（失败仅警告，不影响透传）
    let reg = serde_json::json!({ "session_id": session_id, "inject_url": inject_url });
    if let Err(e) = app_lib::agent::post_json(&format!("{COMPANION}/pty/register"), &reg) {
        eprintln!("[assist] 伴侣未连接（{e}），继续以透传模式运行");
    }

    // stdin → PTY
    {
        let writer = writer.clone();
        std::thread::spawn(move || {
            let mut stdin = std::io::stdin();
            let mut buf = [0u8; 1024];
            loop {
                match stdin.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if writer.lock().unwrap().write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }

    // raw mode（失败不致命，比如非 TTY 环境）
    let raw_ok = crossterm::terminal::enable_raw_mode().is_ok();

    // PTY 输出 → stdout + 检测器
    let detector = Arc::new(Mutex::new(PromptDetector::new()));
    let last_output = Arc::new(AtomicU64::new(now_ms()));
    {
        let detector = detector.clone();
        let last_output = last_output.clone();
        let session_id = session_id.clone();
        let agent_name = agent_name.clone();
        let cwd = cwd.clone();
        // 静默检测定时器
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let quiet = now_ms().saturating_sub(last_output.load(Ordering::Relaxed));
            if quiet >= QUIET_MS {
                let prompt = detector.lock().unwrap().check(quiet);
                if let Some(p) = prompt {
                    let event = AgentEvent::ApprovalNeeded {
                        agent: agent_name.clone(),
                        session_id: session_id.clone(),
                        cwd: cwd.clone(),
                        tool: "terminal".into(),
                        prompt_text: p.prompt_text,
                        ts: now_ms(),
                    };
                    let _ = app_lib::agent::post_json(
                        &format!("{COMPANION}/agent-event"),
                        &serde_json::to_value(&event).unwrap(),
                    );
                }
            }
        });
    }

    let mut stdout = std::io::stdout();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let _ = stdout.write_all(&buf[..n]);
                let _ = stdout.flush();
                last_output.store(now_ms(), Ordering::Relaxed);
                detector
                    .lock()
                    .unwrap()
                    .feed(&String::from_utf8_lossy(&buf[..n]));
            }
        }
    }

    let status = child.wait().map(|s| s.exit_code()).unwrap_or(1);
    if raw_ok {
        let _ = crossterm::terminal::disable_raw_mode();
    }
    // 任务结束事件
    let done = AgentEvent::TaskCompleted {
        agent: agent_name,
        session_id,
        cwd,
        summary: format!("进程退出（code {status}）"),
        ts: now_ms(),
    };
    let _ = app_lib::agent::post_json(
        &format!("{COMPANION}/agent-event"),
        &serde_json::to_value(&done).unwrap(),
    );
    std::process::exit(status as i32);
}

fn parse_args(args: &[String]) -> Result<(String, Vec<String>), String> {
    if args.first().map(String::as_str) != Some("run") {
        return Err("第一个参数必须是 run".into());
    }
    let mut agent = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--agent" => {
                agent = args.get(i + 1).cloned();
                i += 2;
            }
            "--" => {
                let cmd = args[i + 1..].to_vec();
                if cmd.is_empty() {
                    return Err("-- 后缺少命令".into());
                }
                let name = agent.unwrap_or_else(|| {
                    std::path::Path::new(&cmd[0])
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| cmd[0].clone())
                });
                return Ok((name, cmd));
            }
            other => return Err(format!("未知参数: {other}")),
        }
    }
    Err("缺少 -- <cmd>".into())
}
