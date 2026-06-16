use super::event::AgentEvent;
use serde::Serialize;
use std::collections::HashMap;

pub const DEDUP_WINDOW_MS: u64 = 2_000;
pub const MAX_PER_SEC: u32 = 5;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishResult {
    Emitted,
    Deduped,
    RateLimited,
}

pub trait EventSink: Send {
    fn emit(&self, event: &AgentEvent);
}

pub struct EventBus {
    sink: Box<dyn EventSink>,
    now_ms: Box<dyn Fn() -> u64 + Send>,
    seen: HashMap<String, u64>,
    rate: HashMap<String, (u64, u32)>, // session → (窗口起点秒, 计数)
    pub dropped_count: u64,
}

impl EventBus {
    pub fn new(sink: Box<dyn EventSink>, now_ms: Box<dyn Fn() -> u64 + Send>) -> Self {
        Self {
            sink,
            now_ms,
            seen: HashMap::new(),
            rate: HashMap::new(),
            dropped_count: 0,
        }
    }

    pub fn publish(&mut self, event: AgentEvent) -> PublishResult {
        let now = (self.now_ms)();

        let key = event.dedup_key();
        if let Some(&last) = self.seen.get(&key) {
            if now.saturating_sub(last) < DEDUP_WINDOW_MS {
                return PublishResult::Deduped;
            }
        }

        let session = event.session_id().to_string();
        let sec = now / 1_000;
        let entry = self.rate.entry(session).or_insert((sec, 0));
        if entry.0 != sec {
            *entry = (sec, 0);
        }
        if entry.1 >= MAX_PER_SEC {
            self.dropped_count += 1;
            return PublishResult::RateLimited;
        }
        entry.1 += 1;

        self.seen.insert(key, now);
        // 清理过期去重项，防止无界增长
        self.seen.retain(|_, &mut t| now.saturating_sub(t) < DEDUP_WINDOW_MS * 10);

        self.sink.emit(&event);
        PublishResult::Emitted
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct VecSink(Arc<Mutex<Vec<AgentEvent>>>);
    impl EventSink for VecSink {
        fn emit(&self, e: &AgentEvent) {
            self.0.lock().unwrap().push(e.clone());
        }
    }

    fn approval(session: &str, prompt: &str, ts: u64) -> AgentEvent {
        AgentEvent::ApprovalNeeded {
            agent: "claude-code".into(),
            session_id: session.into(),
            cwd: "/tmp".into(),
            tool: "Bash".into(),
            prompt_text: prompt.into(),
            ts,
        }
    }

    fn bus_with_clock(
        clock: Arc<Mutex<u64>>,
    ) -> (EventBus, Arc<Mutex<Vec<AgentEvent>>>) {
        let collected = Arc::new(Mutex::new(Vec::new()));
        let c = clock.clone();
        let bus = EventBus::new(
            Box::new(VecSink(collected.clone())),
            Box::new(move || *c.lock().unwrap()),
        );
        (bus, collected)
    }

    #[test]
    fn b01_single_event_emitted() {
        let clock = Arc::new(Mutex::new(1_000u64));
        let (mut bus, sink) = bus_with_clock(clock);
        assert_eq!(bus.publish(approval("s1", "rm?", 1)), PublishResult::Emitted);
        assert_eq!(sink.lock().unwrap().len(), 1);
    }

    #[test]
    fn b02_duplicate_within_window_deduped() {
        let clock = Arc::new(Mutex::new(1_000u64));
        let (mut bus, sink) = bus_with_clock(clock.clone());
        bus.publish(approval("s1", "rm?", 1));
        *clock.lock().unwrap() = 2_500;
        assert_eq!(bus.publish(approval("s1", "rm?", 2)), PublishResult::Deduped);
        assert_eq!(sink.lock().unwrap().len(), 1);
    }

    #[test]
    fn b03_duplicate_after_window_emitted() {
        let clock = Arc::new(Mutex::new(1_000u64));
        let (mut bus, sink) = bus_with_clock(clock.clone());
        bus.publish(approval("s1", "rm?", 1));
        *clock.lock().unwrap() = 3_100; // > 2s 后
        assert_eq!(bus.publish(approval("s1", "rm?", 2)), PublishResult::Emitted);
        assert_eq!(sink.lock().unwrap().len(), 2);
    }

    #[test]
    fn b04_rate_limit_sixth_in_second() {
        let clock = Arc::new(Mutex::new(10_000u64));
        let (mut bus, sink) = bus_with_clock(clock);
        for i in 0..5 {
            assert_eq!(
                bus.publish(approval("s1", &format!("p{i}"), i)),
                PublishResult::Emitted
            );
        }
        assert_eq!(
            bus.publish(approval("s1", "p5", 5)),
            PublishResult::RateLimited
        );
        assert_eq!(sink.lock().unwrap().len(), 5);
    }

    #[test]
    fn b05_rate_limit_per_session() {
        let clock = Arc::new(Mutex::new(10_000u64));
        let (mut bus, sink) = bus_with_clock(clock);
        for i in 0..5 {
            bus.publish(approval("s1", &format!("a{i}"), i));
            bus.publish(approval("s2", &format!("b{i}"), i));
        }
        assert_eq!(sink.lock().unwrap().len(), 10);
    }

    #[test]
    fn b06_different_content_not_deduped() {
        let clock = Arc::new(Mutex::new(1_000u64));
        let (mut bus, sink) = bus_with_clock(clock);
        bus.publish(approval("s1", "p1", 1));
        assert_eq!(bus.publish(approval("s1", "p2", 2)), PublishResult::Emitted);
        assert_eq!(sink.lock().unwrap().len(), 2);
    }

    #[test]
    fn b07_serde_snake_case_tag() {
        let json = serde_json::to_string(&approval("s1", "p", 42)).unwrap();
        assert!(json.contains(r#""kind":"approval_needed""#));
        assert!(json.contains(r#""prompt_text":"p""#));
        let back: AgentEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(back.session_id(), "s1");
    }

    #[test]
    fn b08_dropped_count_accumulates() {
        let clock = Arc::new(Mutex::new(10_000u64));
        let (mut bus, _sink) = bus_with_clock(clock);
        for i in 0..8 {
            bus.publish(approval("s1", &format!("p{i}"), i));
        }
        assert_eq!(bus.dropped_count, 3);
    }
}
