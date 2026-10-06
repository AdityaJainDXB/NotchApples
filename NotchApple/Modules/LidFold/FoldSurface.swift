//
//  FoldSurface.swift
//  Notch apple, Lid Fold
//
//  Origin:  Still, native/Sources/Still/FoldSurface.swift
//           (MIT, Copyright (c) 2026 Akshay Sharma and Kavish Shah; LICENSES/Still-MIT.txt)
//  Changes: MODIFIED. The shader comes from `FoldShader.source` (no resource bundle); the SwiftUI
//           preview and the demo wallpaper are gone; the frame rate is capped at 60 and the view stops
//           drawing the moment `endContinuousDisplay()` is called; errors are reported, never fatal.
//

import AppKit
import MetalKit
import FoldCore

private struct FoldUniforms {
    var angle: Float
    var workingAngle: Float
    var perspective: Float
    var frost: Float
    var shade: Float
    var fadeAngle: Float
    var aspect: Float
    var padding: Float = 0
}

final class FoldSurface: MTKView {
    private var foldRenderer: FoldRenderer?
    private(set) var setupError: String?
    private var imageIdentity: CGImage?

    init() {
        let gpu = MTLCreateSystemDefaultDevice()
        super.init(frame: .zero, device: gpu)
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 1)
        isPaused = true
        enableSetNeedsDisplay = true
        framebufferOnly = true
        autoResizeDrawable = true
        do {
            guard let gpu else { throw FoldSurfaceError("Metal is not available on this Mac.") }
            foldRenderer = try FoldRenderer(device: gpu, format: colorPixelFormat)
            delegate = foldRenderer
        } catch { setupError = error.localizedDescription }
    }
    required init(coder: NSCoder) { fatalError("Use init()") }

    func update(image: CGImage?, angle: Double, tuning: FoldTuning) {
        if imageIdentity !== image {
            imageIdentity = image
            do { try foldRenderer?.setImage(image) }
            catch { setupError = error.localizedDescription }
        }
        foldRenderer?.angle = angle
        foldRenderer?.tuning = tuning.validated
        needsDisplay = true
    }

    /// Draws from the view's own clock while the overlay is on screen (on-demand drawing can miss the
    /// first frame and leave a black panel), capped at 60 frames a second.
    func beginContinuousDisplay() {
        enableSetNeedsDisplay = false
        isPaused = false
        preferredFramesPerSecond = 60
    }

    func endContinuousDisplay() {
        isPaused = true
        enableSetNeedsDisplay = true
    }

    /// Drops the snapshot and the GPU texture right away.
    func clearSnapshot() {
        imageIdentity = nil
        try? foldRenderer?.setImage(nil)
    }
}

struct FoldSurfaceError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

private final class FoldRenderer: NSObject, MTKViewDelegate {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private var texture: MTLTexture?
    var angle: Double = 105
    var tuning = FoldTuning()

    init(device: MTLDevice, format: MTLPixelFormat) throws {
        self.device = device
        guard let queue = device.makeCommandQueue() else { throw FoldSurfaceError("The GPU command queue could not be created.") }
        self.queue = queue
        let library = try device.makeLibrary(source: FoldShader.source, options: nil)
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "foldVertex")
        descriptor.fragmentFunction = library.makeFunction(name: "foldFragment")
        descriptor.colorAttachments[0].pixelFormat = format
        pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        super.init()
    }

    func setImage(_ image: CGImage?) throws {
        texture = nil
        guard let image else { return }
        texture = try MTKTextureLoader(device: device).newTexture(cgImage: image, options: [
            .SRGB: false, .generateMipmaps: true, .origin: MTKTextureLoader.Origin.topLeft
        ])
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let drawable = view.currentDrawable, let pass = view.currentRenderPassDescriptor,
              let commands = queue.makeCommandBuffer(), let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
        if let texture {
            var uniforms = FoldUniforms(angle: Float(angle), workingAngle: Float(tuning.workingAngle),
                perspective: Float(tuning.perspective), frost: Float(tuning.frost), shade: Float(tuning.shade),
                fadeAngle: Float(tuning.fadeAngle), aspect: Float(texture.width) / Float(texture.height))
            encoder.setRenderPipelineState(pipeline)
            encoder.setFragmentTexture(texture, index: 0)
            encoder.setFragmentBytes(&uniforms, length: MemoryLayout<FoldUniforms>.stride, index: 0)
            encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        }
        encoder.endEncoding()
        commands.present(drawable)
        commands.commit()
    }
}
