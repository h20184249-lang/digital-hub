interface DigitalHubLogoProps {
  subtitle?: string;
  compact?: boolean;
}

export function DigitalHubLogo({ subtitle, compact = false }: DigitalHubLogoProps) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg
        width={compact ? 34 : 40}
        height={compact ? 34 : 40}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0 drop-shadow-sm"
      >
        <defs>
          <linearGradient id="dhLogoOrange" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF9B19" />
            <stop offset="100%" stopColor="#FF7300" />
          </linearGradient>
        </defs>
        <path
          d="M8 10C8 7.79086 9.79086 6 12 6H25C36.0457 6 43 13.402 43 24C43 34.598 36.0457 42 25 42H12C9.79086 42 8 40.2091 8 38V31L22 24L8 17V10Z"
          fill="url(#dhLogoOrange)"
        />
        <path
          d="M8 17L24 24L8 31V17Z"
          fill="#172033"
        />
        <path
          d="M17 15.5H24.5C29.7467 15.5 33.5 19.1 33.5 24C33.5 28.9 29.7467 32.5 24.5 32.5H17L26.5 24L17 15.5Z"
          fill="#FFFFFF"
        />
      </svg>
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-0.5 font-display font-extrabold tracking-tight text-base sm:text-lg">
          <span className="text-[#172033]">DIGITAL</span>
          <span className="text-[#FF8500] ml-1">HUB</span>
        </div>
        {subtitle && (
          <p className="text-[10px] sm:text-[11px] font-medium text-[#777777] truncate max-w-[165px] sm:max-w-none">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
