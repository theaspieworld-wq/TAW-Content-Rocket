import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Zap, CheckCircle2, ArrowRight, Play, FileText, Mail,
  Layers, Mic, MessageSquare, Image, Youtube, Clock,
  ChevronDown, ChevronUp, Star, TrendingUp, Users, Shield,
  Rocket, Brain, Package, Palette, Newspaper
} from "lucide-react";
import { useState } from "react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const FEATURES = [
  { icon: Youtube,       label: "YouTube Shorts",        desc: "AI-picked vertical clips at 30s, 45s or 60s — best moments only" },
  { icon: FileText,      label: "Blog Post",              desc: "Full SEO-ready long-form article written in your brand voice" },
  { icon: Newspaper,     label: "Email Newsletter",        desc: "Ready-to-send email newsletter with subject line and CTA" },
  { icon: Layers,        label: "Carousel Post",          desc: "Slide-by-slide carousel post for LinkedIn and Instagram" },
  { icon: Mic,           label: "Podcast Audio",          desc: "Clean MP3 extracted and trimmed for podcast distribution" },
  { icon: MessageSquare, label: "Social Threads",         desc: "Twitter/X and LinkedIn threads with hooks and hashtags" },
  { icon: Image,         label: "Quote Graphics",         desc: "Pull-quote images ready for Instagram and Stories" },
  { icon: Palette,       label: "Brand Voice",            desc: "Custom tone, CTA, colours, font and logo per brand" },
  { icon: Play,          label: "Outro Stitching",        desc: "Branded outro video appended automatically to every clip" },
  { icon: Package,       label: "ZIP Export",             desc: "One-click download of the entire content pack" },
];

const STEPS = [
  {
    number: "01",
    title: "Upload your video",
    desc: "No downloaders. No transcription tools. Just upload your video file — long-form, interview, tutorial, podcast episode — and hit go.",
    keyword: "Works with any video file you own",
  },
  {
    number: "02",
    title: "Pick your brand & settings",
    desc: "Choose your brand profile (voice, tone, CTA, colours, logo), select clip duration and count, and optionally attach a branded outro video.",
    keyword: "Fully customised to your brand",
  },
  {
    number: "03",
    title: "Download your full content pack",
    desc: "Content Rocket's AI analyses, extracts the best moments, writes all copy in your voice, and delivers everything as a single ZIP file or straight to your Google Drive folder.",
    keyword: "10+ pieces of content in minutes",
  },
];

const COMPARISON = [
  {
    feature: "YouTube Shorts clips",
    rocket: true,  opus: true,   descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Blog post generation",
    rocket: true,  opus: false,  descript: false, repurpose: false, vtb: true,
  },
  {
    feature: "Newsletter drafts",
    rocket: true,  opus: false,  descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Email newsletter",
    rocket: true,  opus: false,  descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Carousel post",
    rocket: true,  opus: false,  descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Podcast audio extraction",
    rocket: true,  opus: false,  descript: true,  repurpose: false, vtb: false,
  },
  {
    feature: "Social media threads",
    rocket: true,  opus: false,  descript: false, repurpose: true,  vtb: false,
  },
  {
    feature: "Quote graphic generation",
    rocket: true,  opus: false,  descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Custom brand voice",
    rocket: true,  opus: true,   descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Branded outro stitching",
    rocket: true,  opus: false,  descript: true,  repurpose: false, vtb: false,
  },
  {
    feature: "No video upload needed",
    rocket: true,  opus: false,  descript: false, repurpose: false, vtb: false,
  },
  {
    feature: "Starting price",
    rocket: "$49/mo", opus: "$15/mo", descript: "$24/mo", repurpose: "$25/mo", vtb: "$29/mo",
    isText: true,
  },
];

const FAQS = [
  {
    q: "What is Content Rocket?",
    a: "Content Rocket is an AI content repurposing platform by TAW Media that turns a single uploaded video into a complete multi-channel content pack — YouTube Shorts, blog post, email newsletter, carousel post, podcast audio, social media threads, and quote graphics. It's built for creators, coaches, and media teams who want to publish across every platform without spending 10+ hours repurposing each video manually.",
  },
  {
    q: "How does Content Rocket generate YouTube Shorts?",
    a: "Content Rocket uses AI to analyse your video's transcript and engagement signals, then identifies the highest-value moments. It extracts those moments as vertical 9:16 clips at your chosen duration (30s, 45s, or 60s), stitches on your branded outro, and packages them for YouTube Shorts, Instagram Reels, and TikTok.",
  },
  {
    q: "Do I need to upload my video file?",
    a: "Yes — Content Rocket works directly from a video file you upload (plus an optional thumbnail). Nothing is scraped from YouTube or Facebook, so you stay fully in control of the source file.",
  },
  {
    q: "How is Content Rocket different from Opus Clip?",
    a: "Opus Clip is excellent for short-form video clips. Content Rocket does that and goes much further — it also writes your blog post, email newsletter, carousel post, social threads, and produces podcast audio, all in your brand's voice. It's a complete content multiplication system, not just a clip tool.",
  },
  {
    q: "Can I use my own brand voice and colours?",
    a: "Yes. Brand Profiles let you define your brand name, tone and voice style, primary CTA, primary and secondary colours, font family, and logo. You can save multiple brand profiles and switch between them per job.",
  },
  {
    q: "How many videos can I process each month?",
    a: "There is no monthly video cap. Your Content Rocket Pro subscription gives you unlimited video processing — process as many videos as your content calendar demands.",
  },
  {
    q: "What formats does the exported content come in?",
    a: "Short clips are exported as MP4. Podcast audio as MP3. Written content (blog post, email newsletter, carousel post, social threads) is included as formatted text. Everything is packaged into a single ZIP download, and you can optionally sync exports directly to a Google Drive or Dropbox folder via your brand settings.",
  },
  {
    q: "How much does Content Rocket cost?",
    a: "Content Rocket Pro is $49/month or $399/year (saving $189 annually). Both plans include the full feature set and unlimited video processing.",
  },
];

const STATS = [
  { value: "10+",    label: "Content pieces per video" },
  { value: "~5 min", label: "Average processing time" },
  { value: "7×",     label: "Faster than manual repurposing" },
  { value: "100%",   label: "Branded to your voice" },
];

function Tick({ on }: { on: boolean | string }) {
  if (typeof on === "string") {
    return <span className="text-xs font-medium text-slate-300">{on}</span>;
  }
  return on
    ? <CheckCircle2 className="w-4 h-4 text-[#f21178] mx-auto" />
    : <span className="text-slate-700 text-lg leading-none mx-auto block text-center">–</span>;
}

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-[100dvh] bg-[#080614] flex flex-col relative overflow-x-hidden">

      {/* ── Ambient glows ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#f21178]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 w-[400px] h-[400px] bg-violet-700/5 rounded-full blur-3xl" />
        <div className="absolute top-2/3 right-1/4 w-[300px] h-[300px] bg-[#f21178]/4 rounded-full blur-3xl" />
      </div>

      {/* ── Nav ── */}
      <nav className="relative z-20 sticky top-0 backdrop-blur-xl bg-[#080614]/80 border-b border-white/5">
        <div className="flex items-center justify-between px-5 py-3.5 max-w-6xl mx-auto w-full">
          <a href={basePath || "/"} className="flex items-center gap-2.5">
            <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-8 w-8 rounded-lg object-cover shadow-md shadow-[#f21178]/20" />
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] font-semibold tracking-[0.2em] text-slate-500 uppercase">TAW Media</span>
              <span className="text-sm font-bold text-white">Content Rocket</span>
            </div>
          </a>
          <div className="hidden md:flex items-center gap-1">
            <a href="#how-it-works" className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">How It Works</a>
            <a href="#features" className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">Features</a>
            <a href="#compare" className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">Compare</a>
            <a href="#faq" className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">FAQ</a>
            <button onClick={() => setLocation("/pricing")} className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all">Pricing</button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-white/5 hidden sm:flex" onClick={() => setLocation("/sign-in")}>
              Sign In
            </Button>
            <Button size="sm" className="bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white font-semibold px-4 border-0 shadow-lg shadow-[#f21178]/20" onClick={() => setLocation("/sign-up")}>
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative z-10 pt-20 pb-16 px-4 max-w-4xl mx-auto w-full text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f21178]/10 border border-[#f21178]/20 text-[#f21178] text-xs font-semibold mb-8">
          <Zap className="w-3 h-3" />
          AI Content Repurposing — 10× your output from every video
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white mb-6 leading-[1.1] tracking-tight">
          Turn one video<br />into a{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f21178] to-violet-400">
            full content pack
          </span>
        </h1>

        <p className="text-slate-400 text-lg sm:text-xl mb-10 leading-relaxed max-w-2xl mx-auto">
          Content Rocket is the AI-powered repurposing platform built by <strong className="text-slate-300">TAW Media</strong>. Upload your video and get YouTube Shorts, a blog post, email newsletter, carousel post, podcast audio, social threads, and quote graphics — all in your brand voice, in minutes.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
          <Button
            size="lg"
            className="w-full sm:w-auto bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white font-bold px-8 h-13 text-base shadow-lg shadow-[#f21178]/25 border-0"
            onClick={() => setLocation("/sign-up")}
          >
            <Rocket className="w-5 h-5 mr-2" /> Start Multiplying My Content
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto border-slate-700 text-slate-300 hover:bg-slate-800/60 hover:text-white px-8 h-13 text-base"
            onClick={() => setLocation("/sign-in")}
          >
            Sign In
          </Button>
        </div>

        <button onClick={() => setLocation("/pricing")} className="text-sm text-slate-500 hover:text-[#f21178] transition-colors underline underline-offset-4 decoration-slate-700 hover:decoration-[#f21178]">
          See plans &amp; pricing →
        </button>

        {/* Output pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-10">
          {["YouTube Shorts", "Blog Posts", "Email Newsletter", "Carousel Post", "Podcast Audio", "Social Threads", "Quote Graphics"].map((f) => (
            <span key={f} className="px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-slate-400 border border-white/8">
              {f}
            </span>
          ))}
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="relative z-10 py-8 border-y border-white/5 bg-white/2">
        <div className="max-w-4xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-3xl font-extrabold text-white mb-1">{s.value}</p>
              <p className="text-xs text-slate-500 leading-snug">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── What Is Content Rocket ── */}
      <section id="what-is" className="relative z-10 py-20 px-4 max-w-5xl mx-auto w-full">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-[#f21178] uppercase mb-3">What Is Content Rocket?</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5 leading-tight">
              Your AI content team — for the price of a coffee a day
            </h2>
            <p className="text-slate-400 leading-relaxed mb-5">
              Most creators spend 10–15 hours manually repurposing each video into shorts, blog posts, emails, and social content. That's time you should spend creating, not copy-pasting.
            </p>
            <p className="text-slate-400 leading-relaxed mb-5">
              Content Rocket is a <strong className="text-slate-300">purpose-built AI platform</strong> that automates the entire repurposing workflow. You upload one video. The AI analyses it, identifies the best moments, writes all the copy in your brand voice, and hands you a complete content pack.
            </p>
            <p className="text-slate-400 leading-relaxed">
              Built by <strong className="text-slate-300">TAW Media</strong> and <strong className="text-slate-300">The Aspie World</strong> — a creator-run team that processes hundreds of videos per month and built this tool to solve their own problem first.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Brain,      title: "AI Analysis",   desc: "Transcription + smart moment detection" },
              { icon: Zap,        title: "Instant Output", desc: "Full pack delivered in under 5 minutes" },
              { icon: Palette,    title: "Brand Voice",   desc: "Every word written in your tone and style" },
              { icon: TrendingUp, title: "10× Output",    desc: "One video → 10+ pieces of content" },
              { icon: Shield,     title: "Your Data",     desc: "Per-user isolation — your content is private" },
              { icon: Users,      title: "Multi-Brand",   desc: "Manage multiple brands from one workspace" },
            ].map((c) => (
              <div key={c.title} className="p-4 rounded-xl bg-white/3 border border-white/8 hover:border-[#f21178]/25 hover:bg-[#f21178]/3 transition-all group">
                <c.icon className="w-5 h-5 text-[#f21178] mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-sm font-semibold text-white mb-0.5">{c.title}</p>
                <p className="text-[11px] text-slate-500 leading-snug">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative z-10 py-20 px-4 bg-white/1 border-y border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[10px] font-bold tracking-[0.2em] text-[#f21178] uppercase mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Three steps. Full content pack.</h2>
            <p className="text-slate-400 max-w-xl mx-auto">No video editing skills required. No uploading giant files. No juggling five different tools.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((step, i) => (
              <div key={step.number} className="relative group">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(100%+12px)] w-6 h-px bg-gradient-to-r from-[#f21178]/40 to-transparent z-10" />
                )}
                <div className="h-full p-6 rounded-2xl bg-[#0d0920] border border-white/8 hover:border-[#f21178]/30 transition-all hover:shadow-lg hover:shadow-[#f21178]/5">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#f21178]/20 to-violet-600/20 border border-[#f21178]/20 flex items-center justify-center mb-5">
                    <span className="text-lg font-extrabold text-[#f21178]">{step.number}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">{step.desc}</p>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#f21178] bg-[#f21178]/8 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> {step.keyword}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button
              size="lg"
              className="bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white font-bold px-10 h-13 text-base shadow-lg shadow-[#f21178]/20 border-0"
              onClick={() => setLocation("/sign-up")}
            >
              Try It Now — Paste Your First URL <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="features" className="relative z-10 py-20 px-4 max-w-5xl mx-auto w-full">
        <div className="text-center mb-14">
          <p className="text-[10px] font-bold tracking-[0.2em] text-[#f21178] uppercase mb-3">Everything Included</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Every piece of content your brand needs</h2>
          <p className="text-slate-400 max-w-xl mx-auto">One subscription. One YouTube URL. Your entire week of content, done.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex gap-4 p-5 rounded-xl bg-[#0d0920] border border-white/6 hover:border-[#f21178]/25 hover:bg-[#f21178]/2 transition-all group">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-[#f21178]/10 flex items-center justify-center group-hover:bg-[#f21178]/15 transition-colors">
                <f.icon className="w-4.5 h-4.5 text-[#f21178]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white mb-1">{f.label}</p>
                <p className="text-xs text-slate-500 leading-snug">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Competitor Comparison ── */}
      <section id="compare" className="relative z-10 py-20 px-4 bg-white/1 border-y border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[10px] font-bold tracking-[0.2em] text-[#f21178] uppercase mb-3">How We Compare</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Content Rocket vs the alternatives</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Most tools do one thing. Content Rocket replaces five tools with one.</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/8">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="text-left px-5 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider w-[30%]">Feature</th>
                  <th className="px-4 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[#f21178] font-bold text-sm">Content Rocket</span>
                      <span className="text-[10px] text-slate-500">TAW Media</span>
                    </div>
                  </th>
                  <th className="px-4 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-slate-300 font-semibold text-sm">Opus Clip</span>
                      <span className="text-[10px] text-slate-600">Clips only</span>
                    </div>
                  </th>
                  <th className="px-4 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-slate-300 font-semibold text-sm">Descript</span>
                      <span className="text-[10px] text-slate-600">Video editor</span>
                    </div>
                  </th>
                  <th className="px-4 py-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-slate-300 font-semibold text-sm">Repurpose.io</span>
                      <span className="text-[10px] text-slate-600">Cross-poster</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={`border-b border-white/5 last:border-0 ${i % 2 === 0 ? "bg-white/1" : ""}`}
                  >
                    <td className="px-5 py-3.5 text-slate-300 text-xs font-medium">{row.feature}</td>
                    <td className="px-4 py-3.5 text-center bg-[#f21178]/3">
                      <Tick on={row.rocket} />
                    </td>
                    <td className="px-4 py-3.5 text-center"><Tick on={row.opus} /></td>
                    <td className="px-4 py-3.5 text-center"><Tick on={row.descript} /></td>
                    <td className="px-4 py-3.5 text-center"><Tick on={row.repurpose} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center text-xs text-slate-600 mt-4">Feature comparison based on publicly available information as of 2025. Prices shown are starting tiers.</p>
        </div>
      </section>

      {/* ── Social Proof / Testimonial placeholder ── */}
      <section className="relative z-10 py-20 px-4 max-w-5xl mx-auto w-full text-center">
        <div className="inline-flex items-center gap-1.5 mb-6">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
          ))}
        </div>
        <blockquote className="text-xl sm:text-2xl font-medium text-white max-w-2xl mx-auto leading-relaxed mb-6">
          "I used to spend a full day turning each video into content for every channel. Content Rocket does it in 5 minutes. It's like having an extra team member."
        </blockquote>
        <p className="text-slate-500 text-sm">
          <strong className="text-slate-400">Dan Jones</strong> — Creator, The Aspie World (1M+ subscribers)
        </p>
      </section>

      {/* ── Pricing CTA ── */}
      <section className="relative z-10 py-20 px-4 bg-white/1 border-y border-white/5">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[10px] font-bold tracking-[0.2em] text-[#f21178] uppercase mb-3">Pricing</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5">One plan. Everything included.</h2>
          <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
            No feature tiers. No per-video credits. Unlimited processing for a flat monthly or annual fee.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 max-w-lg mx-auto mb-10">
            <div className="p-6 rounded-2xl bg-[#0d0920] border border-white/10 text-left">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Monthly</p>
              <p className="text-3xl font-extrabold text-white mb-1">$49<span className="text-base font-normal text-slate-500">/mo</span></p>
              <p className="text-xs text-slate-500 mb-5">Billed monthly. Cancel anytime.</p>
              <Button className="w-full bg-[#f21178] hover:bg-[#d91068] text-white border-0 font-semibold" onClick={() => setLocation("/pricing")}>
                Get Started
              </Button>
            </div>
            <div className="p-6 rounded-2xl bg-gradient-to-br from-[#f21178]/10 to-violet-600/10 border border-[#f21178]/30 text-left relative overflow-hidden">
              <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-[#f21178] text-white text-[10px] font-bold">BEST VALUE</div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Annual</p>
              <p className="text-3xl font-extrabold text-white mb-1">$399<span className="text-base font-normal text-slate-400">/yr</span></p>
              <p className="text-xs text-slate-500 mb-5">Save $189 — equivalent to $33/mo.</p>
              <Button className="w-full bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white border-0 font-semibold" onClick={() => setLocation("/pricing")}>
                Get Annual Plan
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-500">
            {["Unlimited video processing", "All content formats", "Brand profiles", "ZIP export", "Cancel anytime"].map((f) => (
              <span key={f} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="relative z-10 py-20 px-4 max-w-3xl mx-auto w-full">
        <div className="text-center mb-12">
          <p className="text-[10px] font-bold tracking-[0.2em] text-[#f21178] uppercase mb-3">FAQ</p>
          <h2 className="text-3xl font-bold text-white mb-3">Frequently asked questions</h2>
          <p className="text-slate-400">Everything you need to know about Content Rocket.</p>
        </div>

        <div className="space-y-2">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className="rounded-xl border border-white/8 bg-[#0d0920] overflow-hidden"
            >
              <button
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/2 transition-colors"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                aria-expanded={openFaq === i}
              >
                <span className="text-sm font-semibold text-white leading-snug">{faq.q}</span>
                {openFaq === i
                  ? <ChevronUp className="w-4 h-4 text-[#f21178] shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                }
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5 border-t border-white/5 pt-4">
                  <p className="text-sm text-slate-400 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 py-20 px-4 text-center border-t border-white/5">
        <div className="max-w-2xl mx-auto">
          <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-20 w-20 rounded-2xl object-cover mx-auto mb-8 shadow-2xl shadow-[#f21178]/20" />
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5">
            Stop repurposing manually.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f21178] to-violet-400">Start multiplying.</span>
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Paste your first YouTube URL and get your full content pack in minutes.
          </p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white font-bold px-10 h-13 text-base shadow-xl shadow-[#f21178]/25 border-0"
            onClick={() => setLocation("/sign-up")}
          >
            <Rocket className="w-5 h-5 mr-2" /> Get Started Free Trial
          </Button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-6 w-6 rounded-md object-cover" />
            <span className="text-xs text-slate-500">© {new Date().getFullYear()} TAW Media. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <button onClick={() => setLocation("/pricing")} className="hover:text-slate-400 transition-colors">Pricing</button>
            <a href="#faq" className="hover:text-slate-400 transition-colors">FAQ</a>
            <button onClick={() => setLocation("/sign-in")} className="hover:text-slate-400 transition-colors">Sign In</button>
            <button onClick={() => setLocation("/sign-up")} className="hover:text-slate-400 transition-colors">Sign Up</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
