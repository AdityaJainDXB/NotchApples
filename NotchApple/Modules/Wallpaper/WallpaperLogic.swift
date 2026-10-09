//
//  WallpaperLogic.swift
//  Notch apple
//
//  Live wallpaper (Pro): the rules, with no screens or video in them so they can be tested. What video is accepted (up to
//  60 seconds, up to 4K, up to a size), when the wallpaper plays or pauses to save battery, safe file names, and the small
//  free library of NASA clips (public domain: NASA's media policy lets anyone use its videos, images and audio).
//

import Foundation

enum WallpaperLogic {
    static let maxSeconds = 60.5
    static let maxBytes: Int64 = 800 * 1_048_576
    /// 4K is 3840 x 2160; a little extra covers 4096-wide cinema 4K and rotated phone video.
    static let maxLongSide = 4096
    static let maxShortSide = 2304
    static let videoExtensions = ["mp4", "mov", "m4v"]

    enum Problem: Error, Equatable {
        case notVideo, tooLong(Int), tooBig(Int), tooLarge(Int, Int), unreadable

        var message: String {
            switch self {
            case .notVideo: "That isn't a video file. Use an .mp4, .mov or .m4v."
            case .unreadable: "This video couldn't be read. Try exporting it again as H.264 or HEVC."
            case .tooLong(let s): "This video is \(s) seconds long. Wallpapers can be up to 60 seconds: trim it first (QuickTime Player → Edit → Trim)."
            case .tooBig(let mb): "This file is \(mb) MB. The limit is \(Int(maxBytes / 1_048_576)) MB: export it at a lower bitrate."
            case .tooLarge(let w, let h): "This video is \(w) × \(h). The most is 4K (3840 × 2160): export it smaller."
            }
        }
    }

    /// Nil if the video is fine. Width and height are the picture's size as you see it (rotation already applied).
    static func validate(hasVideo: Bool, seconds: Double?, bytes: Int64, width: Int, height: Int) -> Problem? {
        guard hasVideo, let seconds, seconds.isFinite, seconds > 0 else { return hasVideo ? .unreadable : .notVideo }
        if seconds > maxSeconds { return .tooLong(Int(seconds.rounded())) }
        if bytes > maxBytes { return .tooBig(Int(bytes / 1_048_576)) }
        if max(width, height) > maxLongSide || min(width, height) > maxShortSide { return .tooLarge(width, height) }
        return nil
    }

    static func isVideoFile(_ name: String) -> Bool { videoExtensions.contains((name as NSString).pathExtension.lowercased()) }

    /// A name safe to show and to keep in a file name: letters, digits, spaces and a few marks, 60 characters at most.
    static func cleanName(_ raw: String) -> String {
        var base = raw
        for ext in videoExtensions where base.lowercased().hasSuffix("." + ext) { base = String(base.dropLast(ext.count + 1)) }
        let kept = base.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || " -_()".unicodeScalars.contains($0) ? Character($0) : " " }
        let name = String(String(kept).split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ").prefix(60)).trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "My wallpaper" : name
    }

    /// What the wallpaper should be doing right now.
    struct Conditions: Equatable {
        var onBattery = false
        var lowPowerMode = false
        var pauseOnBattery = true
        var screensAsleep = false
        var screenLocked = false
        /// This display's wallpaper is completely covered by windows (nobody can see it).
        var covered = false
    }

    static func shouldPlay(_ c: Conditions) -> Bool {
        if c.screensAsleep || c.screenLocked || c.covered || c.lowPowerMode { return false }
        if c.onBattery && c.pauseOnBattery { return false }
        return true
    }

    // MARK: The free library

    struct Curated: Identifiable, Equatable {
        let id: String
        let title: String
        let blurb: String
        let credit: String
        let url: String
        let seconds: Int
        let megabytes: Int
    }

    /// NASA clips that loop well. They are public domain (see https://www.nasa.gov/nasa-brand-center/images-and-media/),
    /// downloaded straight from NASA only when you press Get, never bundled in the app.
    static let curated: [Curated] = [
        Curated(id: "nasa-lunar-flyby", title: "Lunar flyby", blurb: "A slow pass over the Moon's surface, from LRO.", credit: "NASA / LRO",
                url: "https://images-assets.nasa.gov/video/lunarflyby_1min_2160p30/lunarflyby_1min_2160p30~large.mp4", seconds: 57, megabytes: 38),
        Curated(id: "nasa-goodnight-earth", title: "Goodnight Earth", blurb: "Earth, small and bright, from the Artemis II Orion capsule.", credit: "NASA / Artemis II",
                url: "https://images-assets.nasa.gov/video/art002m1200962241_Goodnight-Earth/art002m1200962241_Goodnight-Earth~large.mp4", seconds: 53, megabytes: 35),
        Curated(id: "nasa-supermoon", title: "Supermoon timelapse", blurb: "A supermoon rising over Louisiana in a timelapse.", credit: "NASA / Michoud",
                url: "https://images-assets.nasa.gov/video/MAF_20230801_SupermoonTL/MAF_20230801_SupermoonTL~large.mp4", seconds: 11, megabytes: 7),
        Curated(id: "nasa-rollout", title: "Artemis II rollout", blurb: "The rocket's slow ride to the launch pad, sped up.", credit: "NASA / Kennedy",
                url: "https://images-assets.nasa.gov/video/KSC-20260117-MH-DNS01-0001-Artemis_II_Rollout_Timelapse_LC_39_Press_Site-M18870/KSC-20260117-MH-DNS01-0001-Artemis_II_Rollout_Timelapse_LC_39_Press_Site-M18870~large.mp4", seconds: 12, megabytes: 9),
        Curated(id: "nasa-airglow", title: "Airglow from the ISS", blurb: "The faint glow of the upper atmosphere seen from orbit.", credit: "NASA / GOLD",
                url: "https://images-assets.nasa.gov/video/GSFC_20180124_m12825_ISS_Airglow/GSFC_20180124_m12825_ISS_Airglow~medium.mp4", seconds: 29, megabytes: 8),
        Curated(id: "nasa-cme", title: "Sun storm (3D CME)", blurb: "A coronal mass ejection leaving the Sun, in 3D.", credit: "NASA / Goddard",
                url: "https://images-assets.nasa.gov/video/GSFC_20180309_CME_m12890_3DCME/GSFC_20180309_CME_m12890_3DCME~large.mp4", seconds: 25, megabytes: 20),
    ]

    /// Only NASA's own media host is trusted for the free library.
    static func isTrustedDownload(_ url: URL) -> Bool { url.scheme == "https" && url.host == "images-assets.nasa.gov" }
}
