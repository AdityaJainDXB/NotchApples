//
//  NotchAIRoutineTests.swift
//  Notch Apple tests
//
//  Routine scheduling and failure rules: next run times (including across a day and a week), catching up once after the
//  Mac was off, no overlap, offline waiting, three failures pausing, an unapproved run expiring, and a restart not
//  counting as a failure.
//

import XCTest

final class NotchAIRoutineTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.locale = Locale(identifier: "en_US")
        return c
    }()

    /// 2026-11-12 is a Thursday.
    private func date(_ y: Int, _ mo: Int, _ d: Int, _ h: Int = 0, _ mi: Int = 0) -> Date {
        cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
    }

    private func routine(_ s: RoutineSchedule, action: RoutineAction = .research(question: "ion news")) -> Routine {
        Routine(name: "Morning", action: action, schedule: s)
    }

    // MARK: Schedules

    func testEveryNMinutesAddsExactlyThat() {
        let t = date(2026, 11, 12, 9)
        XCTAssertEqual(RoutineSchedule.everyMinutes(30).next(after: t, calendar: cal), date(2026, 11, 12, 9, 30))
    }

    func testDailyIsTodayIfNotYetPassedElseTomorrow() {
        let s = RoutineSchedule.daily(hour: 8, minute: 30)
        XCTAssertEqual(s.next(after: date(2026, 11, 12, 7), calendar: cal), date(2026, 11, 12, 8, 30))
        XCTAssertEqual(s.next(after: date(2026, 11, 12, 8, 30), calendar: cal), date(2026, 11, 13, 8, 30))   // strictly after
        XCTAssertEqual(s.next(after: date(2026, 11, 12, 20), calendar: cal), date(2026, 11, 13, 8, 30))
    }

    func testWeeklyPicksTheNearestChosenDay() {
        // Monday (2) and Friday (6) at 09:00; the 12th is a Thursday.
        let s = RoutineSchedule.weekly(weekdays: [2, 6], hour: 9, minute: 0)
        XCTAssertEqual(s.next(after: date(2026, 11, 12, 10), calendar: cal), date(2026, 11, 13, 9))          // Friday
        XCTAssertEqual(s.next(after: date(2026, 11, 13, 10), calendar: cal), date(2026, 11, 16, 9))          // Monday
        XCTAssertEqual(RoutineSchedule.weekly(weekdays: [5], hour: 9, minute: 0).next(after: date(2026, 11, 12, 10), calendar: cal), date(2026, 11, 19, 9))
    }

    func testInvalidSchedulesHaveNoNextRun() {
        for s in [RoutineSchedule.everyMinutes(5), .everyMinutes(100_000), .daily(hour: 24, minute: 0), .daily(hour: 8, minute: 60),
                  .weekly(weekdays: [], hour: 8, minute: 0), .weekly(weekdays: [0], hour: 8, minute: 0), .weekly(weekdays: [8], hour: 8, minute: 0)] {
            XCTAssertFalse(s.isValid)
            XCTAssertNil(s.next(after: Date(), calendar: cal))
        }
    }

    func testDescriptions() {
        XCTAssertEqual(RoutineSchedule.everyMinutes(30).describe(calendar: cal), "Every 30 minutes")
        XCTAssertEqual(RoutineSchedule.everyMinutes(60).describe(calendar: cal), "Every hour")
        XCTAssertEqual(RoutineSchedule.everyMinutes(180).describe(calendar: cal), "Every 3 hours")
        XCTAssertEqual(RoutineSchedule.everyMinutes(1440).describe(calendar: cal), "Every day")
        XCTAssertEqual(RoutineSchedule.daily(hour: 8, minute: 5).describe(calendar: cal), "Daily at 08:05")
        XCTAssertEqual(RoutineSchedule.weekly(weekdays: [6, 2], hour: 9, minute: 0).describe(calendar: cal), "Monday, Friday at 09:00")
    }

    // MARK: Validation

    func testValidation() {
        XCTAssertNil(RoutineLogic.validate(routine(.daily(hour: 8, minute: 0))))
        var r = routine(.daily(hour: 8, minute: 0)); r.name = "  "
        XCTAssertNotNil(RoutineLogic.validate(r))
        r.name = String(repeating: "x", count: 61); XCTAssertNotNil(RoutineLogic.validate(r))
        XCTAssertNotNil(RoutineLogic.validate(routine(.daily(hour: 8, minute: 0), action: .research(question: " "))))
        XCTAssertNotNil(RoutineLogic.validate(routine(.daily(hour: 8, minute: 0), action: .agents(request: String(repeating: "a", count: 501)))))
        XCTAssertTrue(RoutineLogic.validate(routine(.everyMinutes(5)))!.contains("15 minutes"))
        XCTAssertNotNil(RoutineLogic.validate(routine(.daily(hour: 8, minute: 0)), existingCount: RoutineLogic.maxRoutines))
    }

    // MARK: Deciding

    func testNotDueUntilItsTimeAndNeverWhenDisabledOrPaused() {
        var r = RoutineLogic.scheduled(routine(.daily(hour: 8, minute: 0)), after: date(2026, 11, 12, 7), calendar: cal)
        XCTAssertEqual(RoutineLogic.decide(r, now: date(2026, 11, 12, 7, 59), online: true, previousRunActive: false), .notDue)
        XCTAssertEqual(RoutineLogic.decide(r, now: date(2026, 11, 12, 8), online: true, previousRunActive: false), .run)
        r.enabled = false
        XCTAssertEqual(RoutineLogic.decide(r, now: date(2026, 11, 12, 8), online: true, previousRunActive: false), .notDue)
        r.enabled = true; r.pausedReason = "x"
        XCTAssertEqual(RoutineLogic.decide(r, now: date(2026, 11, 12, 8), online: true, previousRunActive: false), .notDue)
    }

    func testWaitsOfflineAndWhileThePreviousRunIsGoingWithoutBeingAFailure() {
        let r = RoutineLogic.scheduled(routine(.everyMinutes(30)), after: date(2026, 11, 12, 7), calendar: cal)
        let now = date(2026, 11, 12, 8)
        XCTAssertEqual(RoutineLogic.decide(r, now: now, online: false, previousRunActive: false), .wait("Waiting for the internet."))
        XCTAssertEqual(RoutineLogic.decide(r, now: now, online: true, previousRunActive: true), .wait("The last run is still going."))
        XCTAssertEqual(r.failures, 0)
    }

    func testARunMissedForTooLongIsSkippedNotPiledUp() {
        let r = RoutineLogic.scheduled(routine(.daily(hour: 8, minute: 0)), after: date(2026, 11, 12, 7), calendar: cal)
        XCTAssertEqual(RoutineLogic.decide(r, now: date(2026, 11, 12, 13), online: true, previousRunActive: false), .run)         // 5 h late: still run
        XCTAssertEqual(RoutineLogic.decide(r, now: date(2026, 11, 12, 15), online: true, previousRunActive: false), .skipMissed)  // 7 h late
        let skipped = RoutineLogic.afterSkip(r, now: date(2026, 11, 12, 15), calendar: cal)
        XCTAssertEqual(skipped.nextRun, date(2026, 11, 13, 8))
        XCTAssertEqual(skipped.failures, 0)
    }

    func testAnIntervalRoutineAfterALongSleepRunsOnceThenResumesItsRhythm() {
        let r = RoutineLogic.scheduled(routine(.everyMinutes(30)), after: date(2026, 11, 12, 7), calendar: cal)   // due 07:30
        let wake = date(2026, 11, 14, 9)
        XCTAssertEqual(RoutineLogic.decide(r, now: wake, online: true, previousRunActive: false), .run)
        let done = RoutineLogic.finished(RoutineLogic.started(r, taskID: UUID(), now: wake), outcome: .success, now: wake, calendar: cal)
        XCTAssertEqual(done.nextRun, date(2026, 11, 14, 9, 30))                     // one run, then the normal rhythm
    }

    // MARK: Outcomes

    func testSuccessResetsFailuresAndSchedulesTheNextRun() {
        var r = RoutineLogic.scheduled(routine(.daily(hour: 8, minute: 0)), after: date(2026, 11, 12, 7), calendar: cal)
        r.failures = 2
        let done = RoutineLogic.finished(r, outcome: .success, now: date(2026, 11, 12, 8, 1), calendar: cal)
        XCTAssertEqual(done.failures, 0)
        XCTAssertEqual(done.nextRun, date(2026, 11, 13, 8))
        XCTAssertEqual(done.lastOutcome, "Done")
    }

    func testThreeFailuresInARowPauseTheRoutine() {
        var r = RoutineLogic.scheduled(routine(.daily(hour: 8, minute: 0)), after: date(2026, 11, 12, 7), calendar: cal)
        let now = date(2026, 11, 12, 8)
        r = RoutineLogic.finished(r, outcome: .failure("timeout"), now: now, calendar: cal)
        XCTAssertEqual(r.failures, 1); XCTAssertFalse(r.isPaused)
        XCTAssertEqual(r.nextRun, now.addingTimeInterval(600))                       // retried in 10 minutes
        r = RoutineLogic.finished(r, outcome: .failure("timeout"), now: now, calendar: cal)
        XCTAssertEqual(r.nextRun, now.addingTimeInterval(1200))
        r = RoutineLogic.finished(r, outcome: .failure("timeout"), now: now, calendar: cal)
        XCTAssertTrue(r.isPaused)
        XCTAssertNil(r.nextRun)
        XCTAssertTrue(r.pausedReason!.contains("3 failed runs"))
        XCTAssertEqual(RoutineLogic.decide(r, now: now.addingTimeInterval(86_400), online: true, previousRunActive: false), .notDue)
    }

    func testARetryIsNeverLaterThanTheNormalNextRun() {
        var r = RoutineLogic.scheduled(routine(.everyMinutes(15)), after: date(2026, 11, 12, 7), calendar: cal)
        r.failures = 1
        let now = date(2026, 11, 12, 8)
        let f = RoutineLogic.finished(r, outcome: .failure("x"), now: now, calendar: cal)      // retry would be +20, normal is +15
        XCTAssertEqual(f.nextRun, now.addingTimeInterval(15 * 60))
    }

    func testASuccessBetweenFailuresStartsTheCountAgain() {
        var r = RoutineLogic.scheduled(routine(.daily(hour: 8, minute: 0)), after: date(2026, 11, 12, 7), calendar: cal)
        let now = date(2026, 11, 12, 8)
        r = RoutineLogic.finished(r, outcome: .failure("a"), now: now, calendar: cal)
        r = RoutineLogic.finished(r, outcome: .failure("b"), now: now, calendar: cal)
        r = RoutineLogic.finished(r, outcome: .success, now: now, calendar: cal)
        r = RoutineLogic.finished(r, outcome: .failure("c"), now: now, calendar: cal)
        XCTAssertFalse(r.isPaused)
        XCTAssertEqual(r.failures, 1)
    }

    func testARestartIsNotAFailureAndRunsAgain() {
        var r = RoutineLogic.scheduled(routine(.daily(hour: 8, minute: 0)), after: date(2026, 11, 12, 7), calendar: cal)
        r.failures = 2
        let now = date(2026, 11, 12, 9)
        let x = RoutineLogic.finished(r, outcome: .interrupted, now: now, calendar: cal)
        XCTAssertEqual(x.failures, 2)
        XCTAssertEqual(x.nextRun, now)
        XCTAssertFalse(x.isPaused)
    }

    func testResumeClearsThePauseAndSchedulesFromNow() {
        var r = routine(.daily(hour: 8, minute: 0))
        r = RoutineLogic.paused(r, reason: "Paused after 3 failed runs in a row.")
        let back = RoutineLogic.resumed(r, now: date(2026, 11, 12, 10), calendar: cal)
        XCTAssertFalse(back.isPaused); XCTAssertEqual(back.failures, 0)
        XCTAssertEqual(back.nextRun, date(2026, 11, 13, 8))
    }

    // MARK: Reading a task

    func testTaskStatesMapToOutcomes() {
        XCTAssertEqual(RoutineLogic.outcome(taskState: .completed, error: nil), .success)
        XCTAssertEqual(RoutineLogic.outcome(taskState: .failed, error: "no network"), .failure("no network"))
        XCTAssertEqual(RoutineLogic.outcome(taskState: .failed, error: nil), .failure("a step failed"))
        XCTAssertEqual(RoutineLogic.outcome(taskState: .cancelled, error: nil), .failure("the run was cancelled"))
        XCTAssertEqual(RoutineLogic.outcome(taskState: .paused, error: nil), .interrupted)
        for s in [TaskState.queued, .running, .waitingApproval] { XCTAssertNil(RoutineLogic.outcome(taskState: s, error: nil)) }
    }

    func testAnUnapprovedRunExpiresAfterAnHour() {
        let since = date(2026, 11, 12, 8)
        XCTAssertFalse(RoutineLogic.approvalExpired(taskState: .waitingApproval, waitingSince: since, now: date(2026, 11, 12, 8, 59)))
        XCTAssertTrue(RoutineLogic.approvalExpired(taskState: .waitingApproval, waitingSince: since, now: date(2026, 11, 12, 9, 1)))
        XCTAssertFalse(RoutineLogic.approvalExpired(taskState: .running, waitingSince: since, now: date(2026, 11, 13)))
        XCTAssertFalse(RoutineLogic.approvalExpired(taskState: .waitingApproval, waitingSince: nil, now: date(2026, 11, 13)))
    }

    // MARK: What a run does

    func testResearchRunSearchesThenReadsThenAnswersAndIsValidAsATask() {
        let steps = RoutineLogic.steps(for: .research(question: "ion news"), engine: "DuckDuckGo")
        XCTAssertEqual(steps.map(\.tool), ["search_web", "fetch_search_hit", "fetch_search_hit", "fetch_search_hit", "ask_model"])
        XCTAssertTrue(steps[0].title.contains("DuckDuckGo"))
        XCTAssertTrue(steps.allSatisfy { $0.risk == .readOnly })
        XCTAssertNil(TaskLogic.validate(NotchAITask(title: "t", agent: "research", steps: steps)))
    }

    func testAgentRunIsThePlannerChain() {
        let steps = RoutineLogic.steps(for: .agents(request: "summarise my day"), engine: "x")
        XCTAssertEqual(steps.map(\.tool), ["plan_request", "run_plan", "answer_request"])
        XCTAssertNil(TaskLogic.validate(NotchAITask(title: "t", agent: "planner", steps: steps)))
    }

    func testRoutinesSurviveBeingSavedAndLoaded() throws {
        var r = RoutineLogic.scheduled(routine(.weekly(weekdays: [2, 4], hour: 7, minute: 15), action: .agents(request: "plan")), after: date(2026, 11, 12, 7), calendar: cal)
        r.failures = 1; r.lastOutcome = "Failed: x"
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        let back = try dec.decode([Routine].self, from: try enc.encode([r]))
        XCTAssertEqual(back.first?.schedule, r.schedule)
        XCTAssertEqual(back.first?.action, r.action)
        XCTAssertEqual(back.first?.failures, 1)
        XCTAssertEqual(back.first?.id, r.id)
    }

    func testTheTaskTitleNamesTheRoutine() {
        XCTAssertEqual(RoutineLogic.taskTitle(for: routine(.daily(hour: 8, minute: 0))), "Routine: Morning")
    }
}
