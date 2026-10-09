//
//  RadarView.swift
//  Notch apple
//
//  Flight Radar: you in the middle of a round scope, north up, with every aircraft around you as a little plane
//  pointing the way it is flying, coloured by height. Click one (on the scope or in the list) to see its details.
//  See RadarModel for where the data comes from and RadarLogic for the maths.
//

import SwiftUI

struct RadarView: View {
    @StateObject private var model = RadarModel.shared
    @StateObject private var location = LocationProvider.shared

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard { scopeCard }
                .frame(minWidth: 0, maxWidth: .infinity)
            GlassCard { listCard }
                .frame(minWidth: 220, idealWidth: 290, maxWidth: 300)
        }
        .onAppear {
            model.viewing = true
            if location.useCurrentLocation && location.status == .notDetermined { location.requestLocation() }
        }
        .onDisappear { model.viewing = false }
        .onChange(of: location.cityName) { _, _ in model.refresh() }
    }

    // MARK: Scope

    private var scopeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "airplane").foregroundStyle(Theme.accentBright)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Flight Radar").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                    Text("Near \(location.cityName.isEmpty ? model.place.name : location.cityName) · \(model.visible.count) aircraft")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                Picker("", selection: $model.range) {
                    ForEach(RadarLogic.ranges, id: \.self) { Text("\($0) nm").tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 190)
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") { model.refresh() }
            }
            GeometryReader { geo in
                let side = min(geo.size.width, geo.size.height)
                Canvas { ctx, size in draw(ctx, size: size) }
                    .frame(width: side, height: side)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
                    .contentShape(Rectangle())
                    .gesture(SpatialTapGesture().onEnded { pick(at: $0.location, side: side, origin: CGPoint(x: (geo.size.width - side) / 2, y: (geo.size.height - side) / 2)) })
            }
            HStack(spacing: 10) {
                legend(.green, "under 5,000 ft"); legend(.yellow, "to FL180"); legend(.cyan, "above")
                if model.showGround { legend(.gray, "ground") }
                Spacer()
                Toggle("On the ground", isOn: $model.showGround).toggleStyle(.switch).controlSize(.mini).font(.system(size: 10))
            }
            if let e = model.error { Text(e).font(.system(size: 10)).foregroundStyle(.orange) }
        }
    }

    private func legend(_ colour: Color, _ text: String) -> some View {
        HStack(spacing: 4) { Circle().fill(colour).frame(width: 7, height: 7); Text(text).font(.system(size: 9)).foregroundStyle(Theme.textSecondary) }
    }

    private func colour(_ a: RadarAircraft) -> Color {
        switch RadarLogic.band(a.altitudeFt, onGround: a.onGround) {
        case .ground: .gray
        case .low: .green
        case .mid: .yellow
        case .high: .cyan
        }
    }

    private func screenPoint(_ a: RadarAircraft, size: CGSize) -> CGPoint {
        let p = RadarLogic.position(distanceNM: a.distanceNM, bearing: a.bearing, rangeNM: model.range)
        let r = min(size.width, size.height) / 2 - 12
        return CGPoint(x: size.width / 2 + p.x * r, y: size.height / 2 + p.y * r)
    }

    private func draw(_ ctx: GraphicsContext, size: CGSize) {
        let c = CGPoint(x: size.width / 2, y: size.height / 2), r = min(size.width, size.height) / 2 - 12
        // Rings at a third, two thirds and the edge, the cross hairs, and N.
        for f in [1.0 / 3, 2.0 / 3, 1.0] {
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r * f, y: c.y - r * f, width: r * 2 * f, height: r * 2 * f)),
                       with: .color(.white.opacity(f == 1 ? 0.35 : 0.15)), lineWidth: 1)
            let label = Text("\(Int(Double(model.range) * f)) nm").font(.system(size: 8)).foregroundStyle(.white.opacity(0.4))
            ctx.draw(label, at: CGPoint(x: c.x + 3 + 20, y: c.y - r * f + 6))
        }
        var cross = Path(); cross.move(to: CGPoint(x: c.x - r, y: c.y)); cross.addLine(to: CGPoint(x: c.x + r, y: c.y))
        cross.move(to: CGPoint(x: c.x, y: c.y - r)); cross.addLine(to: CGPoint(x: c.x, y: c.y + r))
        ctx.stroke(cross, with: .color(.white.opacity(0.1)), lineWidth: 1)
        ctx.draw(Text("N").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.accentBright), at: CGPoint(x: c.x, y: c.y - r - 6))
        // You.
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - 4, y: c.y - 4, width: 8, height: 8)), with: .color(.white))
        ctx.stroke(Path(ellipseIn: CGRect(x: c.x - 8, y: c.y - 8, width: 16, height: 16)), with: .color(.white.opacity(0.5)), lineWidth: 1)
        // Aircraft, farthest first so the near ones sit on top.
        for a in model.visible.reversed() {
            let p = screenPoint(a, size: size), isSel = model.selected == a.id
            var plane = Path()
            plane.move(to: CGPoint(x: 0, y: -7)); plane.addLine(to: CGPoint(x: 5, y: 6)); plane.addLine(to: CGPoint(x: 0, y: 3)); plane.addLine(to: CGPoint(x: -5, y: 6)); plane.closeSubpath()
            let t = CGAffineTransform(translationX: p.x, y: p.y).rotated(by: a.track * .pi / 180).scaledBy(x: isSel ? 1.5 : 1, y: isSel ? 1.5 : 1)
            ctx.fill(plane.applying(t), with: .color(colour(a)))
            if isSel {
                ctx.stroke(Path(ellipseIn: CGRect(x: p.x - 12, y: p.y - 12, width: 24, height: 24)), with: .color(.white), lineWidth: 1.5)
                ctx.draw(Text(a.callsign).font(.system(size: 10, weight: .bold)).foregroundStyle(.white), at: CGPoint(x: p.x, y: p.y - 20))
            }
        }
    }

    private func pick(at point: CGPoint, side: CGFloat, origin: CGPoint) {
        let size = CGSize(width: side, height: side)
        let local = CGPoint(x: point.x, y: point.y)
        let best = model.visible.min { hypot(screenPoint($0, size: size).x - local.x, screenPoint($0, size: size).y - local.y)
                                       < hypot(screenPoint($1, size: size).x - local.x, screenPoint($1, size: size).y - local.y) }
        if let b = best, hypot(screenPoint(b, size: size).x - local.x, screenPoint(b, size: size).y - local.y) < 22 { model.selected = b.id } else { model.selected = nil }
    }

    // MARK: List

    private var listCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Nearby").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                if model.loading { ProgressView().controlSize(.mini) }
                else if let u = model.updated { Text("Updated \(u.formatted(date: .omitted, time: .standard))").font(.system(size: 9)).foregroundStyle(Theme.textSecondary) }
            }
            if model.visible.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "airplane.departure").font(.system(size: 24)).foregroundStyle(Theme.accent)
                    Text(model.loading || model.updated == nil ? "Looking for aircraft…" : "No aircraft within \(model.range) nm").font(.system(size: 12)).foregroundStyle(.white)
                    Text("Try a bigger range. Your position is rounded to about 1 km before it is sent to adsb.lol.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(model.visible) { a in row(a) }
                    }
                }
            }
        }
    }

    private func row(_ a: RadarAircraft) -> some View {
        let on = model.selected == a.id
        return Button { model.selected = on ? nil : a.id } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Image(systemName: "airplane").font(.system(size: 10)).rotationEffect(.degrees(a.track - 90)).foregroundStyle(colour(a))
                    Text(a.callsign).font(.system(size: 12, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                    Spacer(minLength: 2)
                    Text(RadarLogic.altitudeLabel(a.altitudeFt, onGround: a.onGround)).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(colour(a))
                }
                Text("\(RadarLogic.typeName(a.type)) · \(a.speedKt) kt · \(Int(a.distanceNM.rounded())) nm \(RadarLogic.compass(a.bearing))")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                if on {
                    Text("\(a.registration.isEmpty ? "—" : a.registration) · heading \(Int(a.track.rounded()))° \(RadarLogic.compass(a.track)) · \(a.climbFpm == 0 ? "level" : a.climbFpm > 0 ? "climbing \(a.climbFpm) fpm" : "descending \(-a.climbFpm) fpm")")
                        .font(.system(size: 10)).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(on ? Theme.accent.opacity(0.3) : Theme.surface))
        }
        .buttonStyle(.plain)
    }
}
