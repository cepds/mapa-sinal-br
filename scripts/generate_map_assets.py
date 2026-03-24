from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "public" / "assets" / "map"


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")


def antenna_svg(primary: str, glow: str, accent: str, label: str) -> str:
    return f"""
<svg xmlns="http://www.w3.org/2000/svg" width="84" height="132" viewBox="0 0 84 132" fill="none">
  <defs>
    <linearGradient id="{label}-panel" x1="42" y1="12" x2="42" y2="120" gradientUnits="userSpaceOnUse">
      <stop stop-color="#10212D"/>
      <stop offset="1" stop-color="#08131B"/>
    </linearGradient>
    <linearGradient id="{label}-mast" x1="42" y1="28" x2="42" y2="104" gradientUnits="userSpaceOnUse">
      <stop stop-color="{primary}"/>
      <stop offset="1" stop-color="{accent}"/>
    </linearGradient>
    <filter id="{label}-glow" x="0" y="0" width="84" height="132" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0.95
                0 0 0 0 0.65
                0 0 0 0.32 0"/>
    </filter>
  </defs>

  <g filter="url(#{label}-glow)">
    <rect x="13" y="12" width="58" height="108" rx="14" fill="{glow}" opacity="0.34"/>
  </g>
  <rect x="14" y="13" width="56" height="106" rx="13" fill="url(#{label}-panel)" stroke="white" stroke-width="3"/>
  <rect x="19" y="18" width="46" height="96" rx="10" fill="#0B1821" fill-opacity="0.88"/>

  <path d="M42 28L53 96H31L42 28Z" fill="url(#{label}-mast)"/>
  <path d="M42 28L57 102H51L42 60L33 102H27L42 28Z" fill="{primary}" fill-opacity="0.84"/>
  <path d="M42 28L46 104H38L42 28Z" fill="{accent}"/>
  <rect x="27" y="58" width="30" height="4.5" rx="2.25" fill="{primary}"/>

  <path d="M30 99L20 111" stroke="{primary}" stroke-width="4" stroke-linecap="round"/>
  <path d="M54 99L64 111" stroke="{primary}" stroke-width="4" stroke-linecap="round"/>
  <path d="M42 96L42 112" stroke="{primary}" stroke-width="4" stroke-linecap="round"/>

  <path d="M26 42C19 47 16 54 16 62" stroke="{primary}" stroke-width="4" stroke-linecap="round"/>
  <path d="M58 42C65 47 68 54 68 62" stroke="{primary}" stroke-width="4" stroke-linecap="round"/>
  <path d="M21 34C12 42 8 52 8 64" stroke="{accent}" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>
  <path d="M63 34C72 42 76 52 76 64" stroke="{accent}" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>

  <circle cx="42" cy="24" r="6" fill="{accent}" stroke="white" stroke-width="2"/>
</svg>
"""


def beacon_svg() -> str:
    return """
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none">
  <defs>
    <radialGradient id="beacon-core" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(48 48) rotate(90) scale(38)">
      <stop stop-color="#FFDDAB"/>
      <stop offset="1" stop-color="#FF9A3D" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="48" cy="48" r="38" fill="url(#beacon-core)"/>
  <circle cx="48" cy="48" r="16" fill="#FFB347" fill-opacity="0.24" stroke="#FFE8C2" stroke-width="4"/>
  <circle cx="48" cy="48" r="7" fill="#FFB347" stroke="white" stroke-width="4"/>
  <circle cx="48" cy="48" r="27" stroke="#FFB347" stroke-width="3" stroke-dasharray="8 10" opacity="0.66"/>
</svg>
"""


def overlay_svg() -> str:
    return """
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800" fill="none">
  <rect width="800" height="800" fill="#08131B"/>
  <g opacity="0.22" stroke="#8EB9D4" stroke-width="1">
    <path d="M0 120H800"/>
    <path d="M0 240H800"/>
    <path d="M0 360H800"/>
    <path d="M0 480H800"/>
    <path d="M0 600H800"/>
    <path d="M0 720H800"/>
    <path d="M120 0V800"/>
    <path d="M240 0V800"/>
    <path d="M360 0V800"/>
    <path d="M480 0V800"/>
    <path d="M600 0V800"/>
    <path d="M720 0V800"/>
  </g>
  <circle cx="620" cy="180" r="88" stroke="#005EFF" stroke-opacity="0.28" stroke-width="2"/>
  <circle cx="620" cy="180" r="128" stroke="#005EFF" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="188" cy="612" r="92" stroke="#00D67A" stroke-opacity="0.22" stroke-width="2"/>
  <circle cx="188" cy="612" r="138" stroke="#00D67A" stroke-opacity="0.12" stroke-width="2"/>
</svg>
"""


def main() -> None:
    write_file(ASSETS_DIR / "antenna-tim.svg", antenna_svg("#2D83FF", "#0A4BBA", "#8BC7FF", "tim"))
    write_file(ASSETS_DIR / "antenna-vivo.svg", antenna_svg("#00C36C", "#087A52", "#8EF5C3", "vivo"))
    write_file(ASSETS_DIR / "center-beacon.svg", beacon_svg())
    write_file(ASSETS_DIR / "map-overlay.svg", overlay_svg())
    print(f"Assets gerados em {ASSETS_DIR}")


if __name__ == "__main__":
    main()
