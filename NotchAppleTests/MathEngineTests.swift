//
//  MathEngineTests.swift
//  Notch apple tests
//
//  The calculator's algebra: arithmetic, variables, equations, systems, factoring and derivatives.
//

import XCTest

final class MathEngineTests: XCTestCase {
    private func run(_ lines: String...) -> [MathLine] {
        var s = MathSession()
        return lines.flatMap { s.run($0) }
    }
    private func last(_ lines: String...) -> String {
        var s = MathSession(), out: [MathLine] = []
        for l in lines { out += s.run(l) }
        return out.last?.output.joined(separator: " | ") ?? ""
    }

    // MARK: Arithmetic

    func testBracketsPowersAndImplicitMultiplication() {
        XCTAssertEqual(last("2(3+4)^2 / 7"), "14")
        XCTAssertEqual(last("2^3^2"), "512")
        XCTAssertEqual(last("-2^2"), "-4")
        XCTAssertEqual(last("3 * -2"), "-6")
    }

    func testFunctionsConstantsPercentAndFactorial() {
        XCTAssertEqual(last("sqrt(16) + abs(-3)"), "7")
        XCTAssertEqual(last("5!"), "120")
        XCTAssertEqual(last("50%"), "0.5")
        XCTAssertEqual(last("sin(pi/2)"), "1")
        XCTAssertEqual(last("0.1 + 0.2"), "0.3")
    }

    func testErrorsAreSentences() {
        XCTAssertEqual(run("1/0")[0].kind, .error)
        XCTAssertEqual(run("sqrt(-1)")[0].kind, .error)
        XCTAssertEqual(run("2 +")[0].kind, .error)
    }

    // MARK: Variables and functions (multi-step)

    func testVariablesAndAnsCarryOver() {
        XCTAssertEqual(last("a = 12", "b = a * 2", "a + b"), "36")
        XCTAssertEqual(last("2 + 3", "ans * 4"), "20")
    }

    func testUserFunctions() {
        XCTAssertEqual(last("f(x) = x^2 + 1", "f(3)"), "10")
        XCTAssertEqual(last("f(x) = 2x", "g(x) = f(x) + 1", "g(5)"), "11")
    }

    // MARK: Equations

    func testLinearEquation() {
        XCTAssertEqual(last("2x + 3 = 11"), "x = 4")
        XCTAssertEqual(last("3x - 1 = x + 6"), "x = 7/2")
    }

    func testQuadraticWithRationalRoots() {
        XCTAssertEqual(last("x^2 - 5x + 6 = 0"), "x = 2 | x = 3")
    }

    func testQuadraticWithSurds() {
        XCTAssertTrue(last("x^2 + 3x + 1 = 0").hasPrefix("x = (-3 ± √5)/2"), last("x^2 + 3x + 1 = 0"))
    }

    func testQuadraticWithComplexRoots() {
        XCTAssertTrue(last("x^2 + 1 = 0").contains("i"))
    }

    func testCubicNumerically() {
        let out = last("x^3 - 6x^2 + 11x - 6 = 0")
        XCTAssertTrue(out.contains("x = 1") && out.contains("x = 2") && out.contains("x = 3"), out)
    }

    func testSolveForOneLetterKeepingTheOthers() {
        XCTAssertEqual(last("solve(a x + b = c, x)"), "x = (-b + c)/(a)")
        XCTAssertEqual(last("solve(2y + 6 = x, y)"), "y = (1/2)x - 3")
    }

    func testEquationWithAFunctionIsSolvedNumerically() {
        XCTAssertTrue(last("2^x = 8").contains("x ≈ 3"), last("2^x = 8"))
    }

    func testSystemsOfLinearEquations() {
        XCTAssertEqual(last("x + y = 5; x - y = 1"), "x = 3 | y = 2")
        XCTAssertEqual(run("x + y = 5; x^2 = 1")[0].kind, .error)
    }

    // MARK: Algebra

    func testExpandAndSimplify() {
        XCTAssertEqual(last("expand((x+1)^3)"), "x^3 + 3x^2 + 3x + 1")
        XCTAssertEqual(last("(a+b)^2"), "a^2 + 2ab + b^2")
        XCTAssertEqual(last("simplify(2x + 3x - x)"), "4x")
    }

    func testFactor() {
        XCTAssertEqual(last("factor(x^2 - 5x + 6)"), "(x - 2)(x - 3)")
        XCTAssertEqual(last("factor(2x^2 + 5x + 2)"), "(2x + 1)(x + 2)")
        XCTAssertEqual(last("factor(x^3 - x)"), "x(x - 1)(x + 1)")
    }

    func testDerivatives() {
        XCTAssertEqual(last("diff(x^3 + 2x, x)"), "3x^2 + 2")
        XCTAssertEqual(last("diff(sin(x), x)"), "cos(x)")
        XCTAssertEqual(last("diff(x^2 y, y)"), "x^2")
    }

    func testAnUnknownLetterWithNoValueIsReported() {
        XCTAssertEqual(run("x + y = 5")[0].kind, .error)   // two letters, one equation
    }
}
