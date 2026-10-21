**Windows Browser no longer freezes the notch**

- Opening a page in the Browser tab no longer freezes or crashes the notch: the window is now created off the main thread, where Windows used to deadlock.
- The lyrics overlay window had the same flaw and is fixed too.
