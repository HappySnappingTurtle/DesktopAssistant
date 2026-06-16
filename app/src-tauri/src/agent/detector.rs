use regex::Regex;
use std::sync::OnceLock;

pub const QUIET_MS: u64 = 800;
const TAIL_WINDOW: usize = 2000;
const PROMPT_TEXT_MAX: usize = 300;

#[derive(Debug, Clone, PartialEq)]
pub struct DetectedPrompt {
    pub prompt_text: String,
    pub suggested_keys: Vec<String>,
}

/// 剥离 ANSI 转义序列（CSI、OSC、单字符 ESC 序列）
pub fn strip_ansi(input: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r"(?x)
            \x1b\[[0-9;?]*[A-Za-z]      # CSI
          | \x1b\][^\x07\x1b]*(\x07|\x1b\\)  # OSC (BEL 或 ST 终止)
          | \x1b[@-Z\\-_]               # 单字符 ESC
          ",
        )
        .unwrap()
    });
    re.replace_all(input, "").to_string()
}

fn approval_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"(?i)do you want to (proceed|continue|run|allow|make this edit)",
            r"(?i)allow (this )?(command|tool|action|edit)\??",
            r"(?i)\((y/n|yes/no)\)",
            r"(?i)\[(y/n|y/N|Y/n)\]",
            r"(?i)press enter to (confirm|continue)",
            r"(?i)needs? your (approval|permission|confirmation)",
            r"是否(继续|允许|执行)",
            r"(允许|确认)吗",
        ]
        .iter()
        .map(|p| Regex::new(p).unwrap())
        .collect()
    })
}

pub struct PromptDetector {
    tail: String,
    last_fired: Option<String>,
}

impl PromptDetector {
    pub fn new() -> Self {
        Self { tail: String::new(), last_fired: None }
    }

    /// 追加新输出（原始字节流文本，内部剥 ANSI）
    pub fn feed(&mut self, chunk: &str) {
        self.tail.push_str(&strip_ansi(chunk));
        if self.tail.len() > TAIL_WINDOW {
            let cut = self.tail.len() - TAIL_WINDOW;
            // 按字符边界截断
            let cut = self
                .tail
                .char_indices()
                .map(|(i, _)| i)
                .find(|&i| i >= cut)
                .unwrap_or(0);
            self.tail = self.tail[cut..].to_string();
        }
    }

    /// quiet_ms：自最后一次 feed 的毫秒数。仅静默后才检测（防滚动误报）。
    pub fn check(&mut self, quiet_ms: u64) -> Option<DetectedPrompt> {
        if quiet_ms < QUIET_MS {
            return None;
        }
        let text = self.tail.trim_end();
        if text.is_empty() {
            return None;
        }
        let matched = approval_patterns().iter().any(|re| re.is_match(text));
        if !matched {
            return None;
        }
        if self.last_fired.as_deref() == Some(text) {
            return None; // 同一画面去重
        }
        self.last_fired = Some(text.to_string());

        let prompt_text: String = text
            .chars()
            .rev()
            .take(PROMPT_TEXT_MAX)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        let lower = prompt_text.to_lowercase();
        let suggested_keys = if lower.contains("press enter") {
            vec!["\r".to_string()]
        } else {
            vec!["y".to_string(), "n".to_string()]
        };

        Some(DetectedPrompt { prompt_text, suggested_keys })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a01_csi_color() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m"), "red");
    }

    #[test]
    fn a02_osc_title() {
        assert_eq!(strip_ansi("\x1b]0;title\x07text"), "text");
    }

    #[test]
    fn a03_mixed() {
        let s = "\x1b[2J\x1b[Hhello \x1b[1;32mworld\x1b[0m\x1b]0;t\x1b\\!";
        assert_eq!(strip_ansi(s), "hello world!");
    }

    #[test]
    fn a04_plain_unchanged() {
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    fn fired(chunks: &[&str], quiet: u64) -> Option<DetectedPrompt> {
        let mut d = PromptDetector::new();
        for c in chunks {
            d.feed(c);
        }
        d.check(quiet)
    }

    #[test]
    fn d01_yn_prompt_fires_with_keys() {
        let p = fired(&["Do you want to proceed? (y/n)"], 1000).unwrap();
        assert_eq!(p.suggested_keys, vec!["y", "n"]);
        assert!(p.prompt_text.contains("proceed"));
    }

    #[test]
    fn d02_still_streaming_no_fire() {
        assert!(fired(&["Do you want to proceed? (y/n)"], 100).is_none());
    }

    #[test]
    fn d03_press_enter_keys() {
        let p = fired(&["Press enter to continue"], 1000).unwrap();
        assert_eq!(p.suggested_keys, vec!["\r"]);
    }

    #[test]
    fn d04_allow_command_bracket() {
        assert!(fired(&["Allow this command? [Y/n]"], 1000).is_some());
    }

    #[test]
    fn d05_chinese_prompt() {
        assert!(fired(&["是否继续执行？"], 1000).is_some());
        assert!(fired(&["允许吗？"], 1000).is_some());
    }

    #[test]
    fn d06_plain_log_no_fire() {
        assert!(fired(&["user said yes and no in the log"], 1000).is_none());
    }

    #[test]
    fn d07_literal_in_scrolling_output_no_fire() {
        // 含 (y/n) 字面量但仍在输出（quiet 不满足）
        assert!(fired(&["printf(\"(y/n)\");\nmore output..."], 200).is_none());
    }

    #[test]
    fn d08_same_screen_dedup() {
        let mut d = PromptDetector::new();
        d.feed("Do you want to proceed? (y/n)");
        assert!(d.check(1000).is_some());
        assert!(d.check(1000).is_none()); // 无新输出，同画面
    }

    #[test]
    fn d09_new_prompt_after_output_fires_again() {
        let mut d = PromptDetector::new();
        d.feed("Do you want to proceed? (y/n)");
        assert!(d.check(1000).is_some());
        d.feed("\nrunning...\nDo you want to continue? (y/n)");
        assert!(d.check(1000).is_some());
    }

    #[test]
    fn d10_prompt_text_truncated() {
        let long = "x".repeat(5000) + " Do you want to proceed? (y/n)";
        let p = fired(&[&long], 1000).unwrap();
        assert!(p.prompt_text.chars().count() <= 300);
        assert!(p.prompt_text.contains("(y/n)"));
    }

    #[test]
    fn d11_needs_approval_template() {
        assert!(fired(&["The agent needs your approval to run rm -rf"], 1000).is_some());
    }
}
