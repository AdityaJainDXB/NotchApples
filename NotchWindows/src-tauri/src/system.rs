//! Live PC readings: memory, CPU, network, disk, battery and uptime.
//! `sysinfo` covers everything except the battery, which is read per-platform.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Disks, Networks, System};

#[derive(Serialize, Default)]
pub struct Stats {
    pub ram_used: u64,
    pub ram_total: u64,
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub cpu_name: String,
    pub down_bytes_per_sec: f64,
    pub up_bytes_per_sec: f64,
    pub net_interface: String,
    pub disk_free: u64,
    pub disk_total: u64,
    pub battery_percent: Option<u8>,
    pub battery_charging: bool,
    pub uptime_seconds: u64,
    pub host_name: String,
}

/// Kept between calls so network speed and CPU load can be measured as a rate.
pub struct Monitor {
    system: System,
    networks: Networks,
    last_net: Option<(u64, u64, Instant)>,
}

impl Monitor {
    pub fn new() -> Self {
        Self {
            system: System::new_all(),
            networks: Networks::new_with_refreshed_list(),
            last_net: None,
        }
    }

    pub fn read(&mut self) -> Stats {
        self.system.refresh_memory();
        self.system.refresh_cpu_usage();
        self.networks.refresh(true);

        let mut s = Stats {
            ram_used: self.system.used_memory(),
            ram_total: self.system.total_memory(),
            cpu_percent: self.system.global_cpu_usage(),
            cpu_cores: self.system.cpus().len(),
            cpu_name: self
                .system
                .cpus()
                .first()
                .map(|c| c.brand().trim().to_string())
                .unwrap_or_default(),
            uptime_seconds: System::uptime(),
            host_name: System::host_name().unwrap_or_default(),
            ..Default::default()
        };

        // Network: total bytes across real interfaces, turned into a per-second rate.
        let (mut down, mut up) = (0u64, 0u64);
        let mut busiest = ("", 0u64);
        for (name, data) in self.networks.iter() {
            if name.starts_with("lo") || name.contains("Loopback") {
                continue;
            }
            down += data.total_received();
            up += data.total_transmitted();
            if data.total_received() > busiest.1 {
                busiest = (name, data.total_received());
            }
        }
        s.net_interface = busiest.0.to_string();
        let now = Instant::now();
        if let Some((last_down, last_up, at)) = self.last_net {
            let seconds = now.duration_since(at).as_secs_f64();
            if seconds > 0.05 {
                s.down_bytes_per_sec = down.saturating_sub(last_down) as f64 / seconds;
                s.up_bytes_per_sec = up.saturating_sub(last_up) as f64 / seconds;
            }
        }
        self.last_net = Some((down, up, now));

        // Disk: the volume the OS is installed on.
        let disks = Disks::new_with_refreshed_list();
        let root = if cfg!(windows) { "C:\\" } else { "/" };
        if let Some(d) = disks
            .iter()
            .find(|d| d.mount_point().to_string_lossy() == root)
            .or_else(|| disks.iter().max_by_key(|d| d.total_space()))
        {
            s.disk_free = d.available_space();
            s.disk_total = d.total_space();
        }

        let (percent, charging) = battery();
        s.battery_percent = percent;
        s.battery_charging = charging;
        s
    }
}

pub static MONITOR: Mutex<Option<Monitor>> = Mutex::new(None);

#[derive(Serialize)]
pub struct Proc {
    pub name: String,
    pub cpu: f32,
    pub memory: u64,
}

impl Monitor {
    /// The busiest apps right now, by CPU (then memory). Like Activity Monitor's top rows.
    pub fn processes(&mut self, limit: usize) -> Vec<Proc> {
        self.system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        let cores = self.system.cpus().len().max(1) as f32;
        // Group helper processes (browsers run dozens) under their app name.
        let mut by_name: std::collections::HashMap<String, Proc> = std::collections::HashMap::new();
        for p in self.system.processes().values() {
            let name = p.name().to_string_lossy().trim_end_matches(".exe").to_string();
            if name.is_empty() || name == "System Idle Process" || name == "Idle" {
                continue;
            }
            let e = by_name.entry(name.clone()).or_insert(Proc { name, cpu: 0.0, memory: 0 });
            e.cpu += p.cpu_usage() / cores;
            e.memory += p.memory();
        }
        let mut list: Vec<Proc> = by_name.into_values().collect();
        list.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal).then(b.memory.cmp(&a.memory)));
        list.truncate(limit);
        list
    }
}

#[cfg(windows)]
fn battery() -> (Option<u8>, bool) {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut status = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
        return (None, false);
    }
    // 255 means "unknown"; a desktop PC with no battery reports that.
    let percent = (status.BatteryLifePercent != 255).then_some(status.BatteryLifePercent);
    (percent, status.ACLineStatus == 1 && status.BatteryFlag & 8 != 0)
}

#[cfg(target_os = "macos")]
fn battery() -> (Option<u8>, bool) {
    // Parses `pmset -g batt`, e.g. "  -InternalBattery-0 (id=...)  43%; discharging; ..."
    let out = match std::process::Command::new("/usr/bin/pmset").args(["-g", "batt"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return (None, false),
    };
    let percent = out
        .split_whitespace()
        .find(|w| w.ends_with("%;") || w.ends_with('%'))
        .and_then(|w| w.trim_end_matches(&[';', '%'][..]).parse::<u8>().ok());
    (percent, out.contains("AC Power") && !out.contains("discharging"))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn battery() -> (Option<u8>, bool) {
    (None, false)
}
