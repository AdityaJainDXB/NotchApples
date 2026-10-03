cask "notch-apple" do
  version "1.15.3"
  sha256 "2b57dd79928e1413575013d13bc0599211517a8c462465eccf31fba682ace4f4"

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
