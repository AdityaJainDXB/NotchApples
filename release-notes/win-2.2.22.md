## Notch Apple for Windows 2.2.22 (BETA)

- Fix: on Windows the model list in AI chat showed squashed, unreadable rows, so it was easy to pick the wrong model. It is readable again, and (like the Mac) it only lists Gemini chat models, never image, voice or embedding ones. If one of those was picked earlier, Gemini Do It and chat now use the default instead of failing
- New default: everyone who hasn't chosen a Gemini model now gets Gemini 3.5 Flash-Lite (Mac and Windows). A model you picked yourself stays
