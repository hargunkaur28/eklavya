import { User } from 'lucide-react';

// Phase 7.5: renders a profile photo when present, otherwise a generic icon
// fallback. Used read-only in the header, parent dashboard, and admin console;
// editable only on the student's own profile page.
export default function Avatar({ url, name = '', size = 40 }) {
  const dimension = { width: size, height: size };
  if (url) {
    return (
      <img
        className="avatar-img"
        src={url}
        alt={name ? `${name}'s profile photo` : 'Profile photo'}
        style={dimension}
        loading="lazy"
      />
    );
  }
  return (
    <span className="avatar-fallback" style={dimension} aria-hidden="true">
      <User size={Math.round(size * 0.55)} />
    </span>
  );
}
