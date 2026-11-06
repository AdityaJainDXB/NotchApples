// The greeting window (see src-tauri/src/main.rs greeting_show): plays the chosen mascot, or the handwritten hello,
// across a drawing of the open notch. Notch Apple passes what to play in window.NOTCH_MASCOT before this runs.
(function () {
  var c = window.NOTCH_MASCOT || {};
  window.NotchMascots.play(document.getElementById('host'), { id: c.id, name: c.name, notchHeight: c.notchHeight, width: c.width, height: c.height });
})();
