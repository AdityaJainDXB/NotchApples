//
//  NotchAIVisualScene.swift
//  Notch Apple
//
//  Builds the SceneKit scene for a validated illustration spec (see NotchAIVisualLogic). No model, no UI: it only turns
//  parts into shapes, so it can be rendered to an image and checked without any window.
//

import AppKit
import SceneKit

enum VisualSceneBuilder {
    /// Builds the SceneKit scene for a validated spec. Each part's node is named after the part so a click can find it.
    static func scene(for spec: VisualSpec) -> SCNScene {
        let scene = SCNScene()
        scene.background.contents = NSColor(srgbRed: 0.08, green: 0.04, blue: 0.18, alpha: 1)
        for part in spec.parts {
            let node = SCNNode(geometry: geometry(for: part))
            node.name = part.name
            node.position = SCNVector3(part.position[0], part.position[1], part.position[2])
            let c = VisualLogic.rgb(fromHex: part.color) ?? (0.7, 0.7, 0.7)
            let m = SCNMaterial()
            m.diffuse.contents = NSColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
            m.specular.contents = NSColor(white: 0.5, alpha: 1)
            m.lightingModel = .blinn
            node.geometry?.materials = [m]
            scene.rootNode.addChildNode(node)
        }
        let camera = SCNNode(); camera.camera = SCNCamera(); camera.name = "camera"
        camera.position = SCNVector3(0, 0, VisualLogic.cameraDistance(for: spec))
        scene.rootNode.addChildNode(camera)
        let light = SCNNode(); light.light = SCNLight(); light.light?.type = .omni
        light.position = SCNVector3(8, 12, 14); scene.rootNode.addChildNode(light)
        let ambient = SCNNode(); ambient.light = SCNLight(); ambient.light?.type = .ambient; ambient.light?.intensity = 450
        scene.rootNode.addChildNode(ambient)
        return scene
    }

    private static func geometry(for p: VisualPart) -> SCNGeometry {
        let s = p.size.map { CGFloat($0) }
        switch p.shape {
        case .sphere: return SCNSphere(radius: s[0])
        case .box: return SCNBox(width: s[0], height: s[1], length: s[2], chamferRadius: 0)
        case .cylinder: return SCNCylinder(radius: s[0], height: s[1])
        case .cone: return SCNCone(topRadius: 0, bottomRadius: s[0], height: s[1])
        case .torus: return SCNTorus(ringRadius: s[0], pipeRadius: min(s[1], s[0] * 0.9))
        case .capsule: return SCNCapsule(capRadius: min(s[0], s[1] / 2 - 0.001), height: max(s[1], s[0] * 2 + 0.01))
        }
    }
}
