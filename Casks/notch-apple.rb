cask "notch-apple" do
  version "2.0.44"
  sha256 "d73c5ce443cdad9fd5fae6fb20cf9b492d40d544ee5baad0e71eb04f1ce2e6fe"

  url "https://github.com/AdityaJainDXB/NotchApples/releases/download/v#{version}/NotchApple-#{version}.dmg"
  name "Notch apple"
  desc "Turns the MacBook notch into a productivity hub"
  homepage "https://virajsinghchadha.github.io/notchapples-site/"

  depends_on macos: :sonoma

  app "Notch apple.app"

  zap trash: [
    "~/Library/Application Support/Notch apple",
    "~/Library/Containers/com.notchapple.app",
    "~/Library/Containers/com.notchapple.app.widget",
    "~/Library/Preferences/com.notchapple.app.plist",
  ]

  caveats <<~EOS
    Notch apple is free and open source but not notarized by Apple.
    The first time you open it, macOS may block it. To allow it, go to
    System Settings → Privacy & Security and click "Open Anyway".

    The free version is complete. Pro ($1) and Ultimate ($5) are optional
    one-time upgrades (no subscription, every 1.x update included):
      https://virajsinghchadha.github.io/notchapples-site/pro.html
    The app has no ads and no tracking. Updates also arrive inside the app.
  EOS
end
