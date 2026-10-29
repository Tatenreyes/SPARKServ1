/** Decorative repair toolkit artwork for the customer dashboard hero. */
export default function DashboardServiceIllustration() {
  return (
    <svg
      viewBox="0 0 280 220"
      fill="none"
      className="h-auto w-full max-w-[260px] overflow-visible"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="140" cy="124" r="88" fill="white" fillOpacity=".055" />
      <circle cx="140" cy="124" r="70" stroke="white" strokeOpacity=".08" strokeWidth="1.5" />
      <path d="M52 183h176" stroke="white" strokeOpacity=".14" strokeWidth="2" strokeLinecap="round" />

      <g className="service-art-float">
        {/* Toolbox handle */}
        <path d="M105 99V76c0-7 5-12 12-12h47c7 0 12 5 12 12v23" stroke="#F7B267" strokeWidth="10" strokeLinecap="round" />
        <path d="M119 92V79h43v13" stroke="#17325E" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Tool case */}
        <rect x="56" y="91" width="168" height="98" rx="20" fill="#DCEBFF" />
        <path d="M56 119h168v51c0 10-8 19-19 19H75c-11 0-19-9-19-19v-51Z" fill="#397BEE" />
        <path d="M56 121h168" stroke="#17325E" strokeOpacity=".55" strokeWidth="5" />
        <rect x="117" y="128" width="46" height="32" rx="9" fill="#17325E" />
        <path d="M139 135v18m-8-9h16" stroke="#F7B267" strokeWidth="4" strokeLinecap="round" />
        <rect x="72" y="101" width="17" height="9" rx="4.5" fill="#17325E" fillOpacity=".55" />
        <rect x="191" y="101" width="17" height="9" rx="4.5" fill="#17325E" fillOpacity=".55" />
        <path d="M78 187v8m124-8v8" stroke="#17325E" strokeWidth="8" strokeLinecap="round" />
      </g>

      {/* A small spark keeps the illustration connected to the SPARKServ brand. */}
      <g className="service-art-spark">
        <path d="m211 50 5 12 12 5-12 5-5 12-5-12-12-5 12-5 5-12Z" fill="#F7B267" />
        <path d="m71 65 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#78A9FF" />
      </g>
      <circle cx="230" cy="112" r="3" fill="#78A9FF" />
      <circle cx="53" cy="139" r="2.5" fill="#F7B267" />
    </svg>
  );
}
