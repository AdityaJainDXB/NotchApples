cask "notch-apple" do
  version "2.1.63"
  sha256 "e1d11e2262886ad501f945a44ef9420a3c840b8d44f9bb0dd6d42cb3c98cdbd4"

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
