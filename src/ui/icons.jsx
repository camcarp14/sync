// ─── The mark set ────────────────────────────────────────────────────────────
// One geometry for every glyph in the app: 24px viewBox, 1.75 stroke, round
// caps and joins, no fills. Size is the only knob; colour comes from
// currentColor so an icon always belongs to the text it sits beside.

function Ic({ size = 18, children, ...rest }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" {...rest}
    >
      {children}
    </svg>
  );
}

/* navigation */
export const IcConsole = (p) => <Ic {...p}><circle cx="12" cy="12" r="3" /><path d="M6.9 8.4a6 6 0 0 0 0 7.2M17.1 8.4a6 6 0 0 1 0 7.2" /><path d="M3.9 5.6a10 10 0 0 0 0 12.8M20.1 5.6a10 10 0 0 1 0 12.8" /></Ic>;
export const IcDay = (p) => <Ic {...p}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9.5h18M8 2.8v3.4M16 2.8v3.4" /><path d="M7.5 14h5" /></Ic>;
export const IcQueue = (p) => <Ic {...p}><path d="M4 6.5h11M4 12h11M4 17.5h7" /><path d="m17.5 15.6 1.8 1.9 3-3.6" /></Ic>;
export const IcBrief = (p) => <Ic {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9.5 12.5h5M9.5 16h3" /></Ic>;
export const IcMemory = (p) => <Ic {...p}><path d="M12 4.2a3.4 3.4 0 0 0-3.4 3.4A3 3 0 0 0 6 10.5a3 3 0 0 0 1.2 2.4A3 3 0 0 0 9 18.4a3 3 0 0 0 3 1.4V4.2Z" /><path d="M12 4.2a3.4 3.4 0 0 1 3.4 3.4A3 3 0 0 1 18 10.5a3 3 0 0 1-1.2 2.4A3 3 0 0 1 15 18.4a3 3 0 0 1-3 1.4" /></Ic>;

/* voice */
export const IcMic = (p) => <Ic {...p}><rect x="9" y="2.6" width="6" height="11.2" rx="3" /><path d="M5.5 11.2a6.5 6.5 0 0 0 13 0" /><path d="M12 17.8V21" /></Ic>;
export const IcMicOff = (p) => <Ic {...p}><path d="M15 5.6a3 3 0 0 0-6 0v4.2m0 3v.4a3 3 0 0 0 5.2 2" /><path d="M5.5 11.2a6.5 6.5 0 0 0 9.6 5.7M18.5 11.2v.6" /><path d="M12 17.8V21M3.5 3.5l17 17" /></Ic>;
export const IcSpeaker = (p) => <Ic {...p}><path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" /><path d="M15.6 9.4a3.6 3.6 0 0 1 0 5.2M18.2 6.8a7.2 7.2 0 0 1 0 10.4" /></Ic>;
export const IcSpeakerOff = (p) => <Ic {...p}><path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" /><path d="m16.5 9.8 4.2 4.4M20.7 9.8l-4.2 4.4" /></Ic>;
export const IcStop = (p) => <Ic {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2.4" /></Ic>;
export const IcSend = (p) => <Ic {...p}><path d="m4.2 11.6 15.4-6.9-6.9 15.4-2-6.3z" /></Ic>;

/* actions & state */
export const IcCheck = (p) => <Ic {...p}><path d="m4.8 12.6 4.6 4.6L19.2 6.8" /></Ic>;
export const IcCircle = (p) => <Ic {...p}><circle cx="12" cy="12" r="8" /></Ic>;
export const IcCheckCircle = (p) => <Ic {...p}><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.3 2.5 2.5 4.7-5" /></Ic>;
export const IcClose = (p) => <Ic {...p}><path d="M6 6l12 12M18 6 6 18" /></Ic>;
export const IcPlus = (p) => <Ic {...p}><path d="M12 5v14M5 12h14" /></Ic>;
export const IcChevronRight = (p) => <Ic {...p}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></Ic>;
export const IcChevronDown = (p) => <Ic {...p}><path d="m5.5 9 6.5 6.5L18.5 9" /></Ic>;
export const IcChevronLeft = (p) => <Ic {...p}><path d="M14.5 5.5 8 12l6.5 6.5" /></Ic>;
export const IcSettings = (p) => <Ic {...p}><circle cx="12" cy="12" r="2.9" /><path d="M19.2 14.6a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97H3.4a1.9 1.9 0 1 1 0-3.8h.09A1.6 1.6 0 0 0 4.95 8.9a1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 .97-1.46V3.1a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97h.17a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.97Z" /></Ic>;
export const IcSearch = (p) => <Ic {...p}><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.6 15.6 4 4" /></Ic>;
export const IcClock = (p) => <Ic {...p}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3 1.8" /></Ic>;
export const IcFocus = (p) => <Ic {...p}><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="3.4" /></Ic>;
export const IcPlay = (p) => <Ic {...p}><path d="M8.4 5.6 18 12l-9.6 6.4z" /></Ic>;
export const IcPause = (p) => <Ic {...p}><path d="M9.4 5.5v13M14.6 5.5v13" /></Ic>;
export const IcFlag = (p) => <Ic {...p}><path d="M5.5 21V4.2h9l-1.2 3.4 4.2 3.4H5.5" /></Ic>;
export const IcMail = (p) => <Ic {...p}><rect x="3" y="5.2" width="18" height="13.6" rx="2.6" /><path d="m3.6 7 7.4 5.4a1.8 1.8 0 0 0 2 0L20.4 7" /></Ic>;
export const IcNote = (p) => <Ic {...p}><rect x="4" y="3.4" width="16" height="17.2" rx="3" /><path d="M8.4 8.6h7.2M8.4 12.4h7.2M8.4 16.2h4.2" /></Ic>;
export const IcTrash = (p) => <Ic {...p}><path d="M4.6 6.6h14.8M9.4 6.6V4.8a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.8" /><path d="M17.6 6.6 17 19a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 19l-.6-12.4" /></Ic>;
export const IcUndo = (p) => <Ic {...p}><path d="M4 9.5h10.4a5.1 5.1 0 0 1 0 10.2H8" /><path d="m7.8 5.4-3.9 4.1 3.9 4" /></Ic>;
export const IcSparkle = (p) => <Ic {...p}><path d="M12 3.6 13.7 9 19 10.8 13.7 12.6 12 18l-1.7-5.4L5 10.8 10.3 9z" /><path d="M18.6 4v3M20.1 5.5h-3" /></Ic>;
export const IcGlobe = (p) => <Ic {...p}><circle cx="12" cy="12" r="8.2" /><path d="M3.9 12h16.2" /><path d="M12 3.8c2 2.2 3.1 5.1 3.1 8.2S14 18 12 20.2c-2-2.2-3.1-5.1-3.1-8.2S10 6 12 3.8Z" /></Ic>;
export const IcBolt = (p) => <Ic {...p}><path d="M13.2 2.8 5 13.4h5.6L10.2 21 18.4 10.4h-5.6z" /></Ic>;
export const IcKey = (p) => <Ic {...p}><circle cx="8.2" cy="15.8" r="3.8" /><path d="m10.9 13.1 8.3-8.3M16.6 7.4l2.2 2.2M14.4 9.6l2.2 2.2" /></Ic>;
export const IcDownload = (p) => <Ic {...p}><path d="M12 3.8v11M7.8 10.6 12 14.8l4.2-4.2" /><path d="M4.6 17.4v1.4a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8v-1.4" /></Ic>;
export const IcUpload = (p) => <Ic {...p}><path d="M12 15.2V4.2M7.8 8.4 12 4.2l4.2 4.2" /><path d="M4.6 17.4v1.4a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8v-1.4" /></Ic>;
export const IcAlert = (p) => <Ic {...p}><path d="M12 4.4 21 19.6H3z" /><path d="M12 10v3.6M12 16.6v.1" /></Ic>;
export const IcRefresh = (p) => <Ic {...p}><path d="M20 11.4a8 8 0 1 0-.7 4.6" /><path d="M20.4 4.6v6.4H14" /></Ic>;
export const IcSun = (p) => <Ic {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" /></Ic>;
export const IcMoon = (p) => <Ic {...p}><path d="M20.4 13.6A8.4 8.4 0 1 1 10.4 3.6a6.6 6.6 0 0 0 10 10Z" /></Ic>;
export const IcUser = (p) => <Ic {...p}><circle cx="12" cy="8.2" r="3.8" /><path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" /></Ic>;
export const IcLink = (p) => <Ic {...p}><path d="M10.2 13.8a3.8 3.8 0 0 0 5.6.3l2.6-2.6a3.8 3.8 0 0 0-5.4-5.4l-1.5 1.5" /><path d="M13.8 10.2a3.8 3.8 0 0 0-5.6-.3l-2.6 2.6a3.8 3.8 0 0 0 5.4 5.4l1.5-1.5" /></Ic>;
export const IcCommand = (p) => <Ic {...p}><path d="M8.5 15.5v2.2a2.2 2.2 0 1 1-2.2-2.2h11.4a2.2 2.2 0 1 1-2.2 2.2v-2.2m0-7v-2.2a2.2 2.2 0 1 1 2.2 2.2H6.3a2.2 2.2 0 1 1 2.2-2.2v2.2" /><rect x="8.5" y="8.5" width="7" height="7" rx="1.4" /></Ic>;

export default Ic;
