#import <AppKit/AppKit.h>

void set_window_level_for_pid(long level, long behavior) {
    dispatch_async(dispatch_get_main_queue(), ^{
        for (NSWindow *window in [NSApp windows]) {
            if ([window.title isEqualToString:@"DesktopAssistant"]) {
                [window setLevel:(NSWindowLevel)level];
                [window setCollectionBehavior:(NSWindowCollectionBehavior)behavior];
                // 关键：全屏 Space 中显示需要 ignoresMouseEvents 保持一致
                // 并且确保窗口不参与 Exposé
                [window setHidesOnDeactivate:NO];
                NSLog(@"[window-helper] set level=%ld behavior=%ld hidesOnDeactivate=NO for '%@'",
                      level, behavior, window.title);
            }
        }
    });
}

// 定时重新应用层级（防止系统事件重置）
void start_level_watchdog(long level, long behavior) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        // 3秒后再次设置，确保窗口管理器没有重置
        set_window_level_for_pid(level, behavior);

        // 之后每 30 秒检查一次
        dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
        dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 0), 30 * NSEC_PER_SEC, 1 * NSEC_PER_SEC);
        dispatch_source_set_event_handler(timer, ^{
            for (NSWindow *window in [NSApp windows]) {
                if ([window.title isEqualToString:@"DesktopAssistant"]) {
                    if (window.level != (NSWindowLevel)level) {
                        [window setLevel:(NSWindowLevel)level];
                        [window setCollectionBehavior:(NSWindowCollectionBehavior)behavior];
                        [window setHidesOnDeactivate:NO];
                        NSLog(@"[window-watchdog] re-applied level=%ld", level);
                    }
                }
            }
        });
        dispatch_resume(timer);
    });
}
