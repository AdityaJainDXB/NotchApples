## Notch Apple for Windows 2.2.58 (BETA)

- Changed: Do It has a new engine, a big change under the hood. On Windows it now reads the UI through Windows UI Automation, tells you the outcome of every step, notices when it is stuck, and retries with backoff
- New: Do It has a progress budget instead of the flat 80-step cap; when it runs out you get a Continue button
- New: Do It detects an elevated (administrator) window it cannot control and tells you, instead of failing silently
- Better: scrolling and menus are more reliable in Do It
- Real-world runs of the new engine on Windows are still limited, so feedback is very welcome
