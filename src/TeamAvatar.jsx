function initials(name = "") {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "TM";
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words.at(-1)[0]}`).toUpperCase();
}

export default function TeamAvatar({ team, size = 32, className = "" }) {
  const label = team?.name || "Team";
  return <span className={`team-avatar ${className}`.trim()} style={{ "--team-avatar-size": `${size}px` }} aria-label={label} title={label}>
    {team?.iconDataUrl ? <img src={team.iconDataUrl} alt="" /> : <span aria-hidden="true">{initials(label)}</span>}
  </span>;
}
