import React from 'react';

interface ExamXLogoProps {
  size?: number | 'sm' | 'md' | 'lg';
  className?: string;
}

export const ExamXLogo: React.FC<ExamXLogoProps> = ({ size = 42, className = '' }) => {
  const numericSize =
    typeof size === 'number'
      ? size
      : size === 'sm'
        ? 28
        : size === 'md'
          ? 36
          : size === 'lg'
            ? 44
            : 42;

  return (
    <svg 
      width={numericSize} 
      height={numericSize} 
      style={{
        width: `${numericSize}px`,
        height: `${numericSize}px`,
        minWidth: `${numericSize}px`,
        minHeight: `${numericSize}px`
      }}
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      aria-label="ExamX Assessment Platform Logo"
    >
      <defs>
        {/* Main Squircle Background Gradient */}
        <linearGradient id="examx-bg-grad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="55%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>

        {/* Subtle Top-Lighting Radial Aura */}
        <radialGradient id="examx-top-glow" cx="50%" cy="15%" r="65%">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" />
          <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
        </radialGradient>

        {/* Border Stroke Gradient */}
        <linearGradient id="examx-border-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="40%" stopColor="#93c5fd" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
        </linearGradient>

        {/* Blue Crossing Diagonal Bar (Counter-leg of the X) */}
        <linearGradient id="examx-blue-bar" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="35%" stopColor="#0ea5e9" />
          <stop offset="70%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>

        {/* Graduation Cap Base Gradient */}
        <linearGradient id="examx-cap-base" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>

        {/* Clean Drop Shadow for Foreground Checkmark */}
        <filter id="examx-check-shadow" x="-20%" y="-20%" width="150%" height="150%">
          <feDropShadow dx="0.5" dy="3" stdDeviation="2.8" floodColor="#0c2340" floodOpacity="0.5" />
        </filter>

        {/* Subtle Shadow under Mortarboard */}
        <filter id="examx-cap-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0c2340" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Squircle Base with 3D Depth */}
      <rect 
        x="3" 
        y="3" 
        width="94" 
        height="94" 
        rx="23" 
        fill="url(#examx-bg-grad)" 
        stroke="url(#examx-border-grad)" 
        strokeWidth="1.2" 
      />

      {/* Top Surface Light Reflection */}
      <rect 
        x="3" 
        y="3" 
        width="94" 
        height="94" 
        rx="23" 
        fill="url(#examx-top-glow)" 
      />

      {/* Blue Diagonal Counter-Arm of the 'X' (Runs behind the checkmark) */}
      <path 
        d="M34 42.5 L79.5 88" 
        stroke="url(#examx-blue-bar)" 
        strokeWidth="14" 
        strokeLinecap="round" 
      />

      {/* Graduation Cap Base (Under the diamond, above the intersection) */}
      <path 
        d="M44 32 L44 38 C44 42.5 56 42.5 56 38 L56 32 Z" 
        fill="url(#examx-cap-base)" 
      />

      {/* White Verification Checkmark (Hero Foreground Arm of the 'X') */}
      <path 
        d="M20.5 57 L40 76.5 L78 38.5" 
        stroke="#ffffff" 
        strokeWidth="14" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        filter="url(#examx-check-shadow)"
      />

      {/* Graduation Cap Diamond / Mortarboard */}
      <g filter="url(#examx-cap-shadow)">
        {/* Diamond Edge Shading (Thickness) */}
        <path 
          d="M31 27.5 L50 36 L69 27.5 L69 29.5 L50 38 L31 29.5 Z" 
          fill="#cbd5e1" 
        />
        {/* Mortarboard Diamond Top */}
        <polygon 
          points="50,19 69,27.5 50,36 31,27.5" 
          fill="#ffffff" 
        />
      </g>

      {/* Mortarboard Tassel Button & Cord */}
      <circle cx="50" cy="27.5" r="2" fill="#38bdf8" />
      <path 
        d="M50 27.5 C57 27 65 27.5 68.5 28.5" 
        stroke="#38bdf8" 
        strokeWidth="1.5" 
        fill="none" 
        strokeLinecap="round" 
      />
      {/* Hanging Tassel */}
      <path 
        d="M68.5 28.5 L68.5 34" 
        stroke="#38bdf8" 
        strokeWidth="1.5" 
        strokeLinecap="round" 
      />
      <circle cx="68.5" cy="35" r="1.6" fill="#38bdf8" />
    </svg>
  );
};

export default ExamXLogo;
