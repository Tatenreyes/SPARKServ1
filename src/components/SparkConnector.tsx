interface SparkConnectorProps {
  className?: string;
}

/**
 * SPARKServ's signature visual motif: a dashed line linking a customer
 * node to a technician node, with a pulsing spark at the midpoint where
 * the recommendation engine "closes the connection." Used in the landing
 * hero and echoed subtly elsewhere (empty states, section dividers).
 */
export default function SparkConnector({ className = "" }: SparkConnectorProps) {
  return (
    <svg
      viewBox="0 0 600 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="A customer and a technician connected by a spark, representing SPARKServ's matching engine"
    >
      {/* connecting line */}
      <path
        d="M120 110 C 220 110, 260 60, 300 60 C 340 60, 380 110, 480 110"
        stroke="#B0BFF6"
        strokeWidth="2.5"
        strokeDasharray="2 10"
        strokeLinecap="round"
      />

      {/* customer node */}
      <circle cx="110" cy="112" r="46" fill="#FFFFFF" stroke="#DBE2FB" strokeWidth="2" />
      <path
        d="M92 128 v-20 a18 14 0 0136 0 v20"
        stroke="#2952E3"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="110" cy="98" r="9" stroke="#2952E3" strokeWidth="3" fill="#EEF1FD" />
      <text x="110" y="168" textAnchor="middle" className="fill-ink" fontSize="13" fontFamily="var(--font-body)" fontWeight={600}>
        Customer
      </text>

      {/* technician node */}
      <circle cx="490" cy="112" r="46" fill="#FFFFFF" stroke="#DBE2FB" strokeWidth="2" />
      <path
        d="M478 128 l14 -14 l6 6 l-14 14 z M470 136 l6 -6"
        stroke="#2952E3"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M496 92 a9 9 0 10-12 12 l3 3 l16 -16 z"
        stroke="#2952E3"
        strokeWidth="3"
        strokeLinejoin="round"
        fill="#EEF1FD"
      />
      <text x="490" y="168" textAnchor="middle" className="fill-ink" fontSize="13" fontFamily="var(--font-body)" fontWeight={600}>
        Technician
      </text>

      {/* the spark itself — the point the recommendation engine "closes" */}
      <g>
        <circle cx="300" cy="60" r="16" fill="#EEF5FF" className="animate-pulse" />
        <path
          d="M300 48 l-6 14 h5 l-2 10 l9 -15 h-5 z"
          fill="#397BEE"
        />
      </g>
    </svg>
  );
}
