/* Ctrl+Z 팀 · Ctrl+Center 프로젝트 로고.
 *
 * 두 키캡(Z·C)이 겹쳐 붙은 모노그램입니다 — 팀명 Ctrl+Z 와 프로젝트명
 * Ctrl+Center 가 둘 다 "Ctrl+" 키 조합이라는 공통점을 형태로 만든 것입니다.
 * 왼쪽 어두운 키캡이 팀(Z), 오른쪽 파란 키캡이 프로젝트(C)이고, 겹침이
 * "한 세트"를 뜻합니다.
 *
 * 색은 하드코딩하지 않고 currentColor 와 토큰을 씁니다 — 네비(라이트)와
 * 로그인 카드에서 같은 마크를 쓰되 크기만 바뀝니다. */

interface LogoMarkProps {
  /** 키캡 한 변의 크기(px). 나머지 치수는 여기서 파생됩니다. */
  size?: number;
  className?: string;
}

/** 키캡 두 장만 있는 심볼. 파비콘·아바타처럼 글자가 들어갈 자리가 없을 때 씁니다. */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  // 겹침 폭은 키캡의 30%. 두 장이 붙어 보이되 글자는 가리지 않는 값입니다.
  const overlap = size * 0.3;
  const width = size * 2 - overlap;
  const radius = size * 0.26;
  const font = size * 0.56;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${width} ${size}`}
      className={className}
      role="img"
      aria-label="Ctrl+Center"
    >
      {/* 팀 Ctrl+Z — 어두운 키캡 */}
      <rect
        x="0"
        y="0"
        width={size}
        height={size}
        rx={radius}
        fill="var(--ct-logo-key-z)"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font}
        fontWeight="800"
        fill="var(--static-white)"
      >
        Z
      </text>

      {/* 프로젝트 Ctrl+Center — 파란 키캡. 배경색 테두리로 겹침을 분리합니다. */}
      <rect
        x={size - overlap}
        y="0"
        width={size}
        height={size}
        rx={radius}
        fill="var(--primary-normal)"
        stroke="var(--ct-logo-notch)"
        strokeWidth={size * 0.07}
      />
      <text
        x={size - overlap + size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font}
        fontWeight="800"
        fill="var(--static-white)"
      >
        C
      </text>
    </svg>
  );
}

interface LogoProps {
  /** 마크 옆 글자. 네비는 작게(sm), 로그인 카드는 크게(lg) 씁니다. */
  size?: "sm" | "lg";
  /** 글자 없이 마크만. */
  markOnly?: boolean;
  className?: string;
}

const MARK_SIZE = { sm: 24, lg: 40 } as const;

/** 마크 + CENTER 워드마크. 전 화면 공통 브랜드 락업입니다. */
export function Logo({ size = "sm", markOnly = false, className }: LogoProps) {
  if (markOnly) {
    return <LogoMark size={MARK_SIZE[size]} className={className} />;
  }

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size === "lg" ? 12 : 9,
      }}
    >
      <LogoMark size={MARK_SIZE[size]} />
      <span
        style={{
          fontSize: size === "lg" ? 22 : 16,
          fontWeight: 700,
          letterSpacing: "0.01em",
          color: "var(--label-normal)",
          lineHeight: 1,
        }}
      >
        Center
      </span>
    </span>
  );
}
