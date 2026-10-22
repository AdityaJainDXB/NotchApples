**Windows updates that survive**

- Windows: the update helper now breaks away from the app before the app closes. If the notch was started by a launcher or a task, Windows used to stop the helper when the app quit, so the installer never ran, the notch stayed closed and the old version came back when you reopened it. Now the installer runs, and the notch reopens (as the new version, or the old one if the installer failed, with a log in your Temp folder).
