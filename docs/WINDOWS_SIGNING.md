# Signing the Windows builds

Windows shows an "unknown publisher" warning for an installer that is not signed with a code-signing certificate. This file is the plan for fixing that with **SignPath Foundation**, which signs open-source projects for free.

## Where this stands

- The Windows app (`NotchWindows/`) is under the **MIT licence** from 14 October 2026 (`NotchWindows/LICENSE`, `NotchWindows/NOTICE.md`).
- **Not done yet, and needed before applying:** SignPath Foundation signs only builds made from open-source code. The official Windows build today also adds the private **Ultimate modules** (`scripts/fetch-premium.sh --require` in `.github/workflows/windows-build.yml`). The installer that is submitted for signing must be built **without** them. Decide how the Windows Ultimate modules are delivered instead (for example downloaded after a key check, like the server-held content), or ship the signed build without them.
- **You apply**, as the project owner: https://signpath.org/foundation (project name, homepage, repository, licence, a short description, a maintainer contact). SignPath reviews it and, if accepted, gives you an organisation id and a project to configure.

## Then, in the build

1. Add the repository secrets `SIGNPATH_API_TOKEN` (and put the organisation id and project slug in the workflow as variables, not secrets).
2. In `windows-build.yml`: build the installer, upload it with `actions/upload-artifact`, then add a step with `signpath/github-action-submit-signing-request` that waits for the signed file and downloads it, and attach the signed file to the release.
3. SignPath requires the build to run on GitHub-hosted runners from a tagged commit, which it already does.

Until a certificate exists, nothing here is signed and Windows will warn.

## "It's flagged as a virus" (Defender / SmartScreen)

The cause is almost always that the installer and `notch-apple.exe` are **unsigned and new**, and the app does things antivirus heuristics watch for: a keyboard hook (key sounds), `SendInput` and screen capture (Do It), and an update helper script that waits for the app to close and runs the downloaded installer. Code cannot remove that. What works, in order:

1. **Sign the build** (plan above). This is the real fix and the only one that lasts.
2. **Report the false positive** to Microsoft for each new release: https://www.microsoft.com/wdsi/filesubmission (choose "Software developer", upload the `-setup.exe`). Other vendors have similar forms. This usually clears Defender within a day or two.
3. Already done in code: PowerShell is no longer started with `-ExecutionPolicy Bypass` for the file converter.
