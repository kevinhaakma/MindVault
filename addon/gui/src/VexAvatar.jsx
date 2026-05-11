/**
 * Vex — the archivist. Tiny SVG figure with a green visor.
 * mood: "neutral" | "thumbsup" | "frown"
 */
export function VexAvatar({ mood = "neutral", size = 56 }) {
  const isUp    = mood === "thumbsup";
  const isDown  = mood === "frown";

  // mouth path varies by mood
  const mouth = isUp
    ? "M 22 26 Q 27 30 32 26"   // smile
    : isDown
      ? "M 22 29 Q 27 25 32 29" // frown
      : "M 23 27 L 31 27";      // neutral flat line

  // left arm: raised on thumbsup, drooped on frown, normal otherwise
  const leftArm = isUp
    ? "M 18 38 L 8 24"          // raised
    : isDown
      ? "M 18 38 L 10 52"       // drooped outward
      : "M 18 38 L 10 50";      // normal

  // thumbs-up fist + thumb when arm is raised
  const thumbPath = isUp
    ? "M 8 24 L 5 18 L 9 17 L 11 23 Z"
    : null;

  return (
    <svg
      width={size}
      height={Math.round(size * 1.45)}
      viewBox="0 0 54 78"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
      aria-label={`Vex is ${mood}`}
    >
      {/* visor cap — brim */}
      <rect x="13" y="15" width="28" height="4" rx="1.5" fill="#1a3d1a" />
      {/* visor cap — crown */}
      <ellipse cx="27" cy="11" rx="12" ry="8" fill="#2d7a2d" />
      {/* visor cap — band detail */}
      <rect x="15" y="15" width="24" height="2" rx="1" fill="#3aaa3a" opacity="0.4" />

      {/* head */}
      <circle cx="27" cy="22" r="10" fill="#e8d5b0" stroke="#7a6040" strokeWidth="0.8" />

      {/* eyes */}
      <circle cx="23" cy="21" r="1.4" fill="#3a3030" />
      <circle cx="31" cy="21" r="1.4" fill="#3a3030" />
      {/* eye gleam */}
      <circle cx="23.6" cy="20.4" r="0.5" fill="white" />
      <circle cx="31.6" cy="20.4" r="0.5" fill="white" />

      {/* mouth */}
      <path d={mouth} stroke="#7a5540" strokeWidth="1.2" strokeLinecap="round" />

      {/* body */}
      <rect x="18" y="33" width="18" height="20" rx="3" fill="#22223a" stroke="#333356" strokeWidth="0.6" />
      {/* shirt pocket — Vex's filing badge */}
      <rect x="20" y="36" width="6" height="5" rx="1" fill="#2d7a2d" opacity="0.7" />

      {/* left arm */}
      <line x1="18" y1="38" x2={leftArm.split(" ")[4]} y2={leftArm.split(" ")[5]}
            stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />
      {/* actual left arm path for non-straight geometry */}
      {isUp && (
        <line x1="18" y1="37" x2="8" y2="24"
              stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />
      )}
      {isDown && (
        <line x1="18" y1="38" x2="10" y2="52"
              stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />
      )}
      {!isUp && !isDown && (
        <line x1="18" y1="38" x2="10" y2="50"
              stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />
      )}

      {/* right arm — always hangs normally */}
      <line x1="36" y1="38" x2="44" y2="50"
            stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />

      {/* thumbs-up fist */}
      {isUp && (
        <g>
          <rect x="4" y="17" width="7" height="7" rx="1.5" fill="#e8d5b0" stroke="#7a6040" strokeWidth="0.6" />
          <line x1="7.5" y1="17" x2="5" y2="12" stroke="#e8d5b0" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      )}

      {/* legs */}
      <line x1="23" y1="53" x2="20" y2="68"
            stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="31" y1="53" x2="34" y2="68"
            stroke="#4a4060" strokeWidth="3.5" strokeLinecap="round" />

      {/* shoes */}
      <ellipse cx="19" cy="69" rx="4" ry="2" fill="#1a1a2a" />
      <ellipse cx="35" cy="69" rx="4" ry="2" fill="#1a1a2a" />
    </svg>
  );
}
