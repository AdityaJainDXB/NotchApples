cask "notch-apple" do
  version "1.17.0"
  sha256 "d7a0ea684378c7a0d365c814bcb11c068adf4b8ce6f7c3a60fb600ee5a8f67a9"

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
  EOS
end
