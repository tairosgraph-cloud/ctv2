/**
 * El robotcito del asistente, dibujado en SVG.
 *
 * Va en SVG y no como imagen para que se vea nítido a cualquier tamaño, use
 * los colores de marca y pueda parpadear y mover la boca al hablar.
 */
export function RobotAvatar({
  talking = false,
  className = '',
}: {
  talking?: boolean
  className?: string
}) {
  return (
    <svg viewBox="0 0 120 132" className={className} role="img" aria-label="Asistente Tairos">
      <defs>
        <linearGradient id="botSkin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="55%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#a3e635" />
        </linearGradient>
        <linearGradient id="botLimb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>

      <ellipse cx="60" cy="127" rx="24" ry="3.5" fill="#0f172a" opacity="0.09" />

      {/* antena */}
      <path d="M60 27V15" stroke="#2dd4bf" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="60" cy="10" r="5" fill="#4ade80" />
      <rect x="49" y="24" width="22" height="8" rx="3" fill="url(#botSkin)" />

      {/* cuerpo y brazos, por detrás de la cabeza */}
      <path
        d="M41 92c0-4 6-6 19-6s19 2 19 6l-5 24c-2 5-8 7-14 7s-12-2-14-7z"
        fill="url(#botSkin)"
      />
      <path d="M41 96c-10-5-19-1-21 4 4 5 15 7 23 3z" fill="url(#botLimb)" />
      <path d="M79 96c7 2 11 8 10 14-6 1-12-3-14-9z" fill="url(#botLimb)" />

      {/* cabeza */}
      <path
        d="M60 28c24 0 40 18 40 40 0 16-14 26-40 26S20 84 20 68c0-22 16-40 40-40z"
        fill="url(#botSkin)"
      />
      <ellipse
        cx="82"
        cy="44"
        rx="6"
        ry="3.5"
        fill="#ffffff"
        opacity="0.55"
        transform="rotate(-28 82 44)"
      />

      {/* visor */}
      <rect x="33" y="46" width="54" height="31" rx="15.5" fill="#0f172a" />

      {/* ojos, con parpadeo */}
      <g
        style={{
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: 'botBlink 5.5s ease-in-out infinite',
        }}
      >
        <circle cx="48" cy="59" r="7.5" fill="#ffffff" />
        <circle cx="72" cy="59" r="7.5" fill="#ffffff" />
        <circle cx="48" cy="60" r="3.4" fill="#0f172a" />
        <circle cx="72" cy="60" r="3.4" fill="#0f172a" />
        <circle cx="50.2" cy="56.6" r="1.5" fill="#ffffff" />
        <circle cx="74.2" cy="56.6" r="1.5" fill="#ffffff" />
      </g>

      {/* boca: sonríe callado, se abre al hablar */}
      <g
        style={{
          transformBox: 'fill-box',
          transformOrigin: 'center top',
          animation: talking ? 'botTalk 360ms ease-in-out infinite' : undefined,
        }}
      >
        {talking ? (
          <ellipse cx="60" cy="70" rx="8" ry="5.5" fill="#ffffff" />
        ) : (
          <path d="M52 68h16a8 8 0 0 1-16 0z" fill="#ffffff" />
        )}
      </g>
    </svg>
  )
}
