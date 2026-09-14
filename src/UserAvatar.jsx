function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

export default function UserAvatar({ user, className = "", size, decorative = true }) {
  const label = user?.displayName || user?.name || "User";
  const avatar = user?.avatarDataUrl || "";
  return <span
    className={`user-avatar ${className}`.trim()}
    aria-hidden={decorative ? "true" : undefined}
    aria-label={decorative ? undefined : label}
    style={size ? { width: size, height: size } : undefined}
  >{avatar ? <img src={avatar} alt="" /> : initials(label)}</span>;
}
