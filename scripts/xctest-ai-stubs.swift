//
//  xctest-ai-stubs.swift
//  Notch Apple tests (scripts/run-app-tests.sh only; Xcode's own test target does not use this file)
//
//  AIStreaming.swift reads the answer-effort setting from AIEffort, which lives in ModelPicker.swift next to the
//  SwiftUI picker. The no-Xcode test runner can't compile that view, so this stands in for just the one enum the
//  AI request code needs. It has no part in the app.
//

import Foundation

enum AIEffort: String {
    case medium
    var hint: String { "" }
    static var current: AIEffort { .medium }
}
