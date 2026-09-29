cask "notch-apple" do
  version "1.12.0"
  sha256 "e59db0b35e89849010a40ca85310321c07286c961953f5f3fc90160e109cd098"

  url "https://github.com/AdityaJainDXB/NotchApples/releases/download/v#{version}/NotchApple-#{version}.dmg"
  name "Notch apple"
  desc "Turns the MacBook notch into a productivity hub"
  homepage "https://github.com/AdityaJainDXB/NotchApples"

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
  EOS
end
