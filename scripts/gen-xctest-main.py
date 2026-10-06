#!/usr/bin/env python3
"""Writes a main.swift that runs every `test*` method of every XCTestCase subclass in the given files
(the Objective-C runtime can't be used to find them when XCTest is the stand-in shim)."""
import re, sys
print("import Foundation\nimport XCTest\nsetvbuf(stdout, nil, _IONBF, 0)\nvar ran = 0")
for path in sys.argv[1:]:
    src = open(path).read()
    for m in re.finditer(r'class\s+(\w+)\s*:\s*XCTestCase\s*\{', src):
        cls, start = m.group(1), m.end()
        nxt = re.search(r'\nclass |\nfinal class |\nprivate final class |\nstruct |\nextension ', src[start:])
        body = src[start:start + (nxt.start() if nxt else len(src))]
        for t, thr in re.findall(r'func\s+(test\w+)\s*\(\s*\)\s*(throws\s*)?\{', body):
            call = f'try o.{t}()' if thr else f'o.{t}()'
            print(f'do {{ let before = __xctFailures; do {{ try MainActor.assumeIsolated {{ let o = {cls}(); o.setUp(); {call}; o.tearDown() }} }} catch {{ if !(error is XCTSkip) {{ __xctFailures += (__xctFailures == before ? 1 : 0); print("  threw", error) }} }}; ran += 1; print(__xctFailures == before ? "PASS" : "FAIL", "  {cls}.{t}") }}')
print('print("\\n\\(ran) tests, \\(__xctAssertions) assertions, \\(__xctFailures) failures")\nexit(__xctFailures == 0 && ran > 0 ? 0 : 1)')
