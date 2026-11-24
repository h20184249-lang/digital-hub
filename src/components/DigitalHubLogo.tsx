interface DigitalHubLogoProps {
  subtitle?: string;
  compact?: boolean;
  siteName?: string;
  logoUrl?: string;
}

export function DigitalHubLogo({ subtitle, compact = false, siteName, logoUrl }: DigitalHubLogoProps) {
  const cleanName = (siteName || 'DIGITAL HUB').trim();
  const parts = cleanName.split(/\s+/);
  const firstWord = parts[0] || 'DIGITAL';
  const restWords = parts.slice(1).join(' ');

  return (
    <div className="flex items-center gap-2 min-w-0 select-none shrink-0">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={cleanName}
          referrerPolicy="no-referrer"
          className={`${compact ? 'w-7 h-7 sm:w-8 sm:h-8' : 'w-10 h-10'} rounded-xl object-cover shrink-0 border border-[#E6ECFA] dark:border-slate-700`}
        />
      ) : (
        <svg
          width={compact ? 30 : 40}
          height={compact ? 30 : 40}
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
          <path d="M8 17L24 24L8 31V17Z" fill="#172033" />
          <path
            d="M17 15.5H24.5C29.7467 15.5 33.5 19.1 33.5 24C33.5 28.9 29.7467 32.5 24.5 32.5H17L26.5 24L17 15.5Z"
            fill="#FFFFFF"
          />
        </svg>
      )}
      <div className="min-w-0 leading-none">
        <div
          className={`flex items-center font-display font-extrabold tracking-tight whitespace-nowrap ${
            compact ? 'text-sm sm:text-[15px] xl:text-base' : 'text-base sm:text-lg'
          }`}
        >
          <span className="text-[#172033] dark:text-slate-100">{firstWord}</span>
          {restWords && <span className="text-[#FF8500] ml-1">{restWords}</span>}
        </div>
        {subtitle && (
          <p
            className={`${
              compact ? 'hidden 2xl:block max-w-[148px]' : 'block mt-0.5'
            } text-[10px] font-medium text-[#777777] dark:text-slate-400 truncate leading-tight`}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
