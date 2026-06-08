/**
 * runon ロゴ。周回路（ループ）と走る推進力を表すマーク + ワードマーク。
 * 色は CSS 変数（--accent / --accent-2）を参照するためテーマに追従する。
 */
export const LogoMark = ({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}): React.JSX.Element => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id="runon-ember"
          x1="4"
          y1="28"
          x2="28"
          y2="4"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <filter id="runon-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* 周回ループ（始点で口が開いた軌道）＝ round trip。 */}
      <path
        d="M16 5.5a10.5 10.5 0 1 1-7.4 3.05"
        stroke="url(#runon-ember)"
        strokeWidth="3.2"
        strokeLinecap="round"
        filter="url(#runon-glow)"
      />
      {/* 推進する先頭（ランナーの現在地）。 */}
      <circle cx="16" cy="5.5" r="3" fill="var(--accent)" filter="url(#runon-glow)" />
    </svg>
  );
};

export const Logo = ({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}): React.JSX.Element => {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={size} />
      {/* 狭幅ではマークのみ（ヘッダーの横幅を確保）。sm 以上でワードマークを表示。 */}
      <span className="hidden font-display text-[1.15rem] font-extrabold tracking-tight text-fg sm:inline">
        run<span className="text-accent">on</span>
      </span>
    </span>
  );
};
