cask "notch-apple" do
  version "2.2.41"
  sha256 "46a38b33b364cc6612cfc0e1703c036b8277b2b4d931ae052f4b6cdb42163815"

  url "https://github.com/AdityaJainDXB/NotchApples/releases/download/v#{version}/NotchApple-#{version}.dmg"
  name "Notch Apple"
  desc "Turns the MacBook notch into a productivity hub"
  homepage "https://adityajaindxb.github.io/NotchApples/"

  depends_on macos: :sonoma

  app "Notch Apple.app"

  zap trash: [
    "~/Library/Application Support/Notch apple",
    "~/Library/Containers/com.notchapple.app",
    "~/Library/Containers/com.notchapple.app.widget",
    "~/Library/Preferences/com.notchapple.app.plist",
  ]

  caveats <<~EOS
    Notch Apple is free and open source but not notarized by Apple.
    The first time you open it, macOS may block it. To allow it, go to
    System Settings → Privacy & Security and click "Open Anyway".

    The free version is complete. Pro ($1) and Ultimate ($5) are optional
    one-time upgrades (no subscription, every 1.x update included):
      https://adityajaindxb.github.io/NotchApples/pro.html
    The app has no ads and no tracking. Updates also arrive inside the app.
  EOS
end
