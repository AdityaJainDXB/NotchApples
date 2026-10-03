"""Sample inputs for scripts/screenshots.sh (rendered locally, no personal data)."""
from PIL import Image, ImageDraw, ImageFont
import os
HERE = os.path.dirname(os.path.abspath(__file__))
def font(size, mono=False, bold=False):
    for p in (["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc"] if mono else
              ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"]):
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size, index=1 if bold and p.endswith(".ttc") else 0)
            except Exception: pass
    return ImageFont.load_default()

# 1. A maths worksheet question.
im = Image.new("RGB", (1200, 520), "#fbfaf7"); d = ImageDraw.Draw(im)
d.text((70, 60), "Algebra · Worksheet 3", font=font(30), fill="#8a8580")
d.text((70, 130), "Question 4", font=font(44, bold=True), fill="#1d1b19")
d.text((70, 220), "Solve for x:", font=font(40), fill="#1d1b19")
d.text((330, 205), "3x² − 12 = 0", font=font(64), fill="#1d1b19")
d.text((70, 330), "Give all solutions and show your working.", font=font(34), fill="#4a4743")
d.line((70, 430, 1130, 430), fill="#d9d5cf", width=3)
im.save(os.path.join(HERE, "math.png"))

# 2. Code with an error.
im = Image.new("RGB", (1300, 640), "#1e1e24"); d = ImageDraw.Draw(im); m = font(30, mono=True)
lines = [("def average(scores):", "#c792ea"), ("    total = 0", "#e6e6e6"), ("    for s in scores:", "#e6e6e6"),
         ("        total += s", "#e6e6e6"), ("    return total / len(scores)", "#e6e6e6"), ("", ""),
         ("print(average([]))", "#82aaff"), ("", ""),
         ("Traceback (most recent call last):", "#ff6b6b"), ('  File "grades.py", line 7, in <module>', "#ff6b6b"),
         ('  File "grades.py", line 5, in average', "#ff6b6b"), ("ZeroDivisionError: division by zero", "#ff6b6b")]
for i, (t, c) in enumerate(lines):
    if t: d.text((50, 40 + i * 46), t, font=m, fill=c)
im.save(os.path.join(HERE, "code.png"))

# 3. A desktop-sized "screen" for the capture overlay screenshot: a window holding the worksheet.
W, H = 3024, 1964
im = Image.new("RGB", (W, H), "#2b1a4a"); d = ImageDraw.Draw(im)
for y in range(H):
    t = y / H; d.line((0, y, W, y), fill=(int(43 + 30 * t), int(26 + 6 * t), int(74 + 40 * t)))
d.rounded_rectangle((520, 300, 2500, 1700), radius=40, fill="#fbfaf7")
d.rounded_rectangle((520, 300, 2500, 380), radius=40, fill="#ece9e4"); d.rectangle((520, 340, 2500, 380), fill="#ece9e4")
for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"]): d.ellipse((560 + i * 50, 322, 590 + i * 50, 352), fill=c)
d.text((1350, 318), "Worksheet 3.pdf", font=font(34), fill="#6b6762")
ws = Image.open(os.path.join(HERE, "math.png")).resize((1800, 780))
im.paste(ws, (610, 470))
d.text((640, 1330), "Question 5    Factorise  x² + 5x + 6", font=font(52), fill="#1d1b19")
im.save(os.path.join(HERE, "screen.png"))
print("ok")
