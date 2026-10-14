//
//  BambuCameraLogic.swift
//  Notch Apple
//
//  The printer camera, as the community has documented it (Bambu publishes nothing): the P1 and A1 families send a stream of
//  JPEG pictures over TLS on port 6000 of the printer, after a 80-byte login (user bblp, the LAN access code); the X1, P2 and
//  H2 families send H.264 video over RTSPS on port 322, which this app can not play, so for those it offers the address to open
//  in a video player. Everything here is pure (no network), so it is tested: the Windows app has the same rules in Rust.
//

import Foundation

enum BambuCameraLogic {
    static let port: UInt16 = 6000
    static let maxFrame = 4 * 1024 * 1024

    /// The printer's address from its report: Bambu sends it as one little-endian number (192.168.1.100 is 1677830336).
    static func ipString(_ value: Int) -> String? {
        guard value > 0, value <= Int(UInt32.max) else { return nil }
        let v = UInt32(value)
        let parts = [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]
        guard parts[0] != 0, parts[0] != 255 else { return nil }
        return parts.map(String.init).joined(separator: ".")
    }

    /// The 80 bytes that open the JPEG stream: a fixed 16-byte header, then the user name and the access code, each in 32 bytes.
    static func authPacket(user: String, code: String) -> Data? {
        let u = Array(user.utf8), c = Array(code.utf8)
        guard !u.isEmpty, u.count <= 32, !c.isEmpty, c.count <= 32 else { return nil }
        var d = Data([0x40, 0, 0, 0, 0x00, 0x30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        d.append(contentsOf: u + [UInt8](repeating: 0, count: 32 - u.count))
        d.append(contentsOf: c + [UInt8](repeating: 0, count: 32 - c.count))
        return d
    }

    /// Takes every complete picture out of the front of `buffer` (a 16-byte header whose first four bytes, little-endian, are
    /// the picture's size, then the JPEG). Returns nil if the stream is not what it should be, so the caller can stop.
    static func takeFrames(_ buffer: inout Data) -> [Data]? {
        var frames: [Data] = []
        while buffer.count >= 16 {
            let b = buffer.startIndex
            let size = Int(buffer[b]) | Int(buffer[b + 1]) << 8 | Int(buffer[b + 2]) << 16 | Int(buffer[b + 3]) << 24
            if size <= 4 || size > maxFrame { return nil }
            if buffer.count < 16 + size { break }
            let frame = buffer.subdata(in: (b + 16)..<(b + 16 + size))
            buffer.removeSubrange(b..<(b + 16 + size))
            guard frame.first == 0xFF, frame.dropFirst().first == 0xD8, frame.last == 0xD9 else { return nil }
            frames.append(frame)
        }
        return frames
    }

    /// The address to open in a video player (VLC) for the printers whose camera is a video stream.
    static func rtspsAddress(ip: String, code: String) -> String? {
        guard !ip.isEmpty, !code.isEmpty, ip.allSatisfy({ $0.isNumber || $0 == "." || $0 == ":" }) else { return nil }
        let allowed = CharacterSet.alphanumerics
        guard let c = code.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return "rtsps://bblp:\(c)@\(ip):322/streaming/live/1"
    }
}
