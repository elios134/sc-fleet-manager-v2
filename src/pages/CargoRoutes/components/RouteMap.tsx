import { ArrowRight, MapPin } from "lucide-react";

function RouteMap({ from, to }: { from: string; to: string }) {
  return (
    <div className="relative h-[190px] overflow-hidden rounded-t-2xl border-b border-white/10" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(99,102,241,.12), transparent 70%)" }}>
      <svg viewBox="0 0 400 190" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="lane2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#2ee9a5" />
          </linearGradient>
        </defs>
        <g fill="#fff" opacity="0.5">
          <circle cx="46" cy="30" r="1.2" /><circle cx="140" cy="55" r="1" /><circle cx="320" cy="34" r="1.4" /><circle cx="250" cy="130" r="1" /><circle cx="80" cy="150" r="1.2" /><circle cx="360" cy="150" r="1" />
        </g>
        <path d="M70 140 C 150 100, 210 125, 320 55" fill="none" stroke="url(#lane2)" strokeWidth="2.2" strokeDasharray="1 7" strokeLinecap="round" />
        <circle cx="70" cy="140" r="15" fill="rgba(245,158,11,.16)" stroke="#f59e0b" strokeWidth="1.1" /><circle cx="70" cy="140" r="4" fill="#f59e0b" />
        <circle cx="320" cy="55" r="18" fill="rgba(46,233,165,.16)" stroke="#2ee9a5" strokeWidth="1.1" /><circle cx="320" cy="55" r="4.5" fill="#2ee9a5" />
        <circle cx="196" cy="107" r="4.5" fill="#fff" /><circle cx="196" cy="107" r="9" fill="none" stroke="#fff" strokeOpacity="0.4" />
      </svg>
      <span className="absolute left-3.5 top-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
        <MapPin className="h-3 w-3 text-amber-400" /> <span className="capitalize text-white/80">{from}</span>
        <ArrowRight className="h-3 w-3" /> <span className="capitalize text-emerald-300">{to}</span>
      </span>
    </div>
  );
}

export { RouteMap };
