import { Link } from 'react-router-dom'

const NAV = [
  { href: '#home', label: 'Home' },
  { href: '#about', label: 'About' },
  { href: '#focus', label: 'Focus Area' },
  { href: '#features', label: 'Features' },
]

const FOCUS_AREAS = [
  { icon: '🧭', title: 'Predict & Prevent', body: 'Trajectory prediction, dynamic risk forecasting, and safe-route recommendation warn a tourist before they reach danger — not after.' },
  { icon: '🚨', title: 'Respond Fast', body: 'AI-ranked dispatch, automatic SOS escalation, and a dedicated responder console close the loop from alert to resolution.' },
  { icon: '🪪', title: 'Protect the Tourist', body: 'A tamper-proof digital ID, silent duress SOS, trip guardian live-share, and offline safety cards keep working when it matters most.' },
  { icon: '🔐', title: 'Prove Its Integrity', body: 'A hash-chained ID ledger anchored externally, full incident replay, and a privacy dashboard make every decision explainable and verifiable.' },
]

const FEATURES = [
  { icon: '📍', title: 'Trajectory & Risk Forecast', body: 'Predicts where a tourist is heading and how their safety score will move over the next hour.' },
  { icon: '🚓', title: 'Intelligent Dispatch', body: 'Auto-ranks the nearest, best-suited responder with live ETA the moment an SOS fires.' },
  { icon: '🤖', title: 'AI Safety Copilot', body: 'A chat assistant that answers "why was this tourist flagged?" in plain English, for the control room and the tourist alike.' },
  { icon: '🛡️', title: 'Digital Safety Passport', body: 'One QR-scannable profile — ID, contacts, language, device, live risk — for a responder in the field.' },
  { icon: '👪', title: 'Trip Guardian', body: 'A family member can follow the trip and get notified on SOS — no account, just a secure link.' },
  { icon: '🤫', title: 'Silent / Duress SOS', body: 'A discreet PIN raises the same protected alert while the screen shows nothing unusual.' },
  { icon: '🌊', title: 'Disaster & Weather Feeds', body: 'Area-level flood, landslide, and storm advisories auto-warn every tourist in an affected zone.' },
  { icon: '🔗', title: 'Anchored Hash Chain', body: 'Every tourist ID chain is periodically fingerprinted and published externally — tamper-evidence anyone can verify.' },
]

export default function Landing() {
  return (
    <div className="resq-landing">
      <style>{`
        .resq-landing { background: #04070d; color: #e6f1ff; min-height: 100vh; }
        .resq-landing a { color: inherit; }
        .resq-nav { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(8px);
          background: rgba(4,7,13,0.75); border-bottom: 1px solid rgba(255,255,255,0.06); }
        .resq-glow { color: #22d3ee; text-shadow: 0 0 24px rgba(34,211,238,0.55); }
        .resq-btn { background: linear-gradient(135deg,#22d3ee,#0ea5e9); color:#04070d; font-weight:700; }
        .resq-btn:hover { filter: brightness(1.08); }
        .resq-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); }
        .resq-card:hover { border-color: rgba(34,211,238,0.4); }

        .globe { position: relative; width: 340px; height: 340px; border-radius: 50%;
          background: radial-gradient(circle at 32% 28%, #4fd1ff 0%, #0ea5e9 28%, #075985 55%, #03203a 78%, #01111f 100%);
          box-shadow: 0 0 90px rgba(14,165,233,0.45), inset -30px -20px 60px rgba(0,0,0,0.55);
          animation: spin 26s linear infinite;
          overflow: hidden;
        }
        .globe::before { content:''; position:absolute; inset:0; opacity:.5;
          background-image:
            radial-gradient(circle at 20% 40%, rgba(255,255,255,0.18) 0 3%, transparent 4%),
            radial-gradient(circle at 60% 20%, rgba(255,255,255,0.14) 0 5%, transparent 6%),
            radial-gradient(circle at 75% 65%, rgba(255,255,255,0.16) 0 4%, transparent 5%),
            radial-gradient(circle at 40% 75%, rgba(255,255,255,0.12) 0 6%, transparent 7%);
        }
        .globe-ring { position:absolute; border:1px solid rgba(34,211,238,0.35); border-radius:50%; }
        @keyframes spin { from { background-position: 0 0; } to { background-position: -340px 0; } }
        @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .orbit { position:absolute; inset:-40px; border:1px dashed rgba(34,211,238,0.25); border-radius:50%;
          animation: orbit 40s linear infinite; }
        .orbit-dot { position:absolute; top:-4px; left:50%; width:8px; height:8px; margin-left:-4px;
          border-radius:50%; background:#22d3ee; box-shadow:0 0 12px #22d3ee; }
      `}</style>

      <header id="home" className="resq-nav flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <span className="text-2xl">🛡️</span> Smart Tourist Safety
        </div>
        <nav className="hidden md:flex gap-6 text-sm text-slate-300">
          {NAV.map((n) => <a key={n.href} href={n.href} className="hover:text-cyan-300 transition">{n.label}</a>)}
        </nav>
        <Link to="/login" className="resq-btn text-sm px-4 py-2 rounded-lg">Login / Sign Up</Link>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div className="flex justify-center order-2 md:order-1">
          <div className="globe">
            <div className="orbit"><div className="orbit-dot"></div></div>
          </div>
        </div>
        <div className="order-1 md:order-2">
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">
            Secure Travels, <span className="resq-glow">Smart Protection.</span>
          </h1>
          <p className="mt-4 text-slate-300 max-w-md">
            Predictive AI, a tamper-evident digital ID, and real-time geofencing come together
            to create a safer, smarter travel experience — for tourists, their families, and
            the responders who protect them.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to="/login" className="resq-btn px-6 py-3 rounded-xl">Login / Sign Up</Link>
            <a href="#features" className="border border-slate-600 hover:border-cyan-400 px-6 py-3 rounded-xl transition">
              Explore Features
            </a>
          </div>
        </div>
      </section>

      <section id="about" className="max-w-6xl mx-auto px-6 py-16 border-t border-white/5">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">About the Platform</h2>
        <p className="text-slate-300 max-w-3xl">
          Smart Tourist Safety Monitoring &amp; Incident Response is a full-stack safety platform
          built around one idea: <em>detect and respond</em> is not enough — a system should
          <em> predict and prevent</em>. Every tourist gets a tamper-proof digital ID, live geofenced
          risk scoring, and one-tap SOS; every control room gets AI-ranked dispatch, automatic
          escalation, and a plain-English copilot that explains exactly why the model flagged
          someone.
        </p>
      </section>

      <section id="focus" className="max-w-6xl mx-auto px-6 py-16 border-t border-white/5">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Focus Areas</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {FOCUS_AREAS.map((f) => (
            <div key={f.title} className="resq-card rounded-2xl p-6 transition">
              <div className="text-3xl mb-2">{f.icon}</div>
              <h3 className="font-bold text-lg mb-1">{f.title}</h3>
              <p className="text-sm text-slate-300">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-16 border-t border-white/5">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="resq-card rounded-xl p-5 transition">
              <div className="text-2xl mb-2">{f.icon}</div>
              <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
              <p className="text-xs text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20 text-center border-t border-white/5">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">Ready to see it live?</h2>
        <p className="text-slate-400 mb-6">Sign in as a tourist, responder, or control-room admin.</p>
        <Link to="/login" className="resq-btn px-8 py-3 rounded-xl inline-block">Login / Sign Up</Link>
      </section>

      <footer className="text-center text-xs text-slate-500 py-8 border-t border-white/5">
        Smart Tourist Safety Monitoring &amp; Incident Response System
      </footer>
    </div>
  )
}
