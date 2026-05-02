import { useState } from "react";
import "./index.css";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Campaign Data ─────────────────────────────────────────────────────────────

const CREATIVES = [
  { id: 1, file: "creative-01-before-after.png", label: "Before / After", ratio: "9:16", placement: "Stories, Reels", type: "Transformation" },
  { id: 2, file: "creative-02-one-video-7-formats.png", label: "One Video → 7 Formats", ratio: "9:16", placement: "Stories, Reels", type: "Feature Showcase" },
  { id: 3, file: "creative-03-time-saving.png", label: "Save 10 Hours/Week", ratio: "1:1", placement: "Feed", type: "Pain Point" },
  { id: 4, file: "creative-04-product-demo.png", label: "Product Demo Explode", ratio: "16:9", placement: "Feed, Right Column", type: "Product Demo" },
  { id: 5, file: "creative-05-testimonial.png", label: "Testimonial – Alex M.", ratio: "1:1", placement: "Feed", type: "Social Proof" },
  { id: 6, file: "creative-06-comparison.png", label: "Manual vs. Rocket", ratio: "9:16", placement: "Stories, Reels", type: "Comparison" },
  { id: 7, file: "creative-07-lifestyle.png", label: "Creator Lifestyle", ratio: "16:9", placement: "Feed, Right Column", type: "Aspirational" },
  { id: 8, file: "creative-08-roi-value.png", label: "$49 vs $3,000", ratio: "1:1", placement: "Feed", type: "ROI / Value" },
  { id: 9, file: "creative-09-hook-scroll-stopper.png", label: "Scroll Stopper Hook", ratio: "9:16", placement: "Stories, Reels", type: "Attention Hook" },
  { id: 10, file: "creative-10-brand-launch.png", label: "Brand Launch", ratio: "1:1", placement: "Feed", type: "Brand Awareness" },
];

const AD_SETS = [
  {
    name: "Content Creators – Core",
    objective: "Conversions (Purchase)",
    budget: "$30/day",
    age: "25–44",
    gender: "All",
    locations: "US, UK, Canada, Australia",
    interests: [
      "YouTube creators", "Content creation", "Video editing",
      "TikTok", "Instagram Reels", "Social media marketing",
      "Canva", "Adobe Premiere Pro", "DaVinci Resolve",
    ],
    behaviours: ["Small business owners", "Content creators", "Engaged shoppers"],
    customAudiences: ["Website visitors (last 30d)", "Video viewers (75%)"],
    placements: "Automatic (Advantage+)",
    notes: "Best-performing cold audience. Run creative-01, creative-03, creative-06.",
  },
  {
    name: "YouTubers & Podcasters",
    objective: "Conversions (Purchase)",
    budget: "$25/day",
    age: "22–45",
    gender: "All",
    locations: "US, UK, Canada, Australia",
    interests: [
      "YouTube", "Podcasting", "Podcast editing",
      "VidIQ", "TubeBuddy", "Descript", "Repurpose.io",
      "Content marketing", "Digital marketing tools",
    ],
    behaviours: ["Online buyers", "Small business owners"],
    customAudiences: [],
    placements: "Feed + Stories",
    notes: "Highly intent-driven. Use creative-02, creative-04, creative-08.",
  },
  {
    name: "Marketing Agencies & Freelancers",
    objective: "Conversions (Lead + Purchase)",
    budget: "$20/day",
    age: "28–50",
    gender: "All",
    locations: "US, UK",
    interests: [
      "Social media management", "HubSpot", "Buffer",
      "Hootsuite", "Sprout Social", "Content strategy",
      "Digital agency", "Freelance marketing",
    ],
    behaviours: ["Business decision makers", "IT decision makers"],
    customAudiences: ["Lookalike (1%) of past purchasers"],
    placements: "Feed + Right Column",
    notes: "Higher LTV customers. Use creative-07, creative-08, creative-05.",
  },
  {
    name: "Retargeting – Warm Audience",
    objective: "Conversions (Purchase)",
    budget: "$15/day",
    age: "18–55",
    gender: "All",
    locations: "All visited locations",
    interests: [],
    behaviours: [],
    customAudiences: [
      "Website visitors – last 14d (no purchase)",
      "Pricing page visitors – last 7d",
      "Add to cart / started checkout",
    ],
    placements: "All placements",
    notes: "Highest ROAS ad set. Use creative-05 (testimonial) + creative-06 (comparison). Frequency cap: 3/week.",
  },
  {
    name: "Lookalike – 1% Purchasers",
    objective: "Conversions (Purchase)",
    budget: "$20/day",
    age: "24–50",
    gender: "All",
    locations: "US, UK, Canada",
    interests: [],
    behaviours: [],
    customAudiences: ["1% Lookalike of customer email list"],
    placements: "Automatic (Advantage+)",
    notes: "Scale with proven buyers as seed. Use creative-03, creative-09, creative-10.",
  },
];

const ADS = [
  {
    id: 1,
    name: "The Transformation",
    creative: "creative-01-before-after.png",
    primaryText: `Imagine posting on 7 platforms — every single week — without writing a word.\n\nMost content creators spend 10+ hours turning ONE video into blogs, Shorts, newsletters, carousels, and social posts.\n\nContent Rocket does it in 5 minutes.\n\nPaste your YouTube URL. In minutes, you get:\n✦ YouTube Shorts (ready to post)\n✦ Full blog post with SEO headings\n✦ Email newsletter\n✦ Instagram carousel\n✦ Social captions for X, LinkedIn, Threads\n✦ Podcast audio file\n✦ Quote graphics\n\nCreators using Content Rocket are posting 5× more without burning out.\n\n🚀 Start your free trial — $49/mo`,
    headline: "Stop Spending 10 Hours Repurposing Content",
    description: "Paste one YouTube URL. Get a full content pack in minutes.",
    cta: "Learn More",
    adSetFit: "Content Creators – Core",
  },
  {
    id: 2,
    name: "The Problem Agitation",
    creative: "creative-03-time-saving.png",
    primaryText: `You recorded an amazing video.\n\nBut nobody saw it.\n\nBecause you didn't have time to:\n❌ Cut it into Shorts\n❌ Write the blog post\n❌ Design the carousel\n❌ Record the podcast\n❌ Send the newsletter\n\nYou're leaving thousands of views — and hundreds of leads — on the table every month.\n\nContent Rocket turns that one video into everything, automatically.\n\nYouTubers, podcasters, and marketers are using it to 10× their content output without hiring a team.\n\n👇 See how it works — try it free today`,
    headline: "Your Best Videos Aren't Reaching Enough People",
    description: "One upload. 7 content formats. Zero extra hours.",
    cta: "Get Started",
    adSetFit: "YouTubers & Podcasters",
  },
  {
    id: 3,
    name: "The ROI Play",
    creative: "creative-08-roi-value.png",
    primaryText: `Hiring a content team costs $3,000–$8,000/month.\n\nContent Rocket costs $49/month.\n\nHere's what you get at $49/mo:\n💎 Unlimited YouTube Shorts\n💎 AI blog posts (SEO-ready)\n💎 Email newsletters\n💎 Instagram carousels (4 slides)\n💎 Podcast audio extracts\n💎 X / LinkedIn / Threads captions\n💎 Quote graphics\n💎 Multi-brand support\n\nOne YouTube video in → full content pack out.\n\nUsed by 500+ content creators, agencies, and businesses.\n\n📊 Calculate your ROI below 👇`,
    headline: "$49/Month. What a Content Agency Charges $3,000 For.",
    description: "Unlimited Shorts, blogs, newsletters, carousels & more from every video.",
    cta: "Sign Up",
    adSetFit: "Marketing Agencies & Freelancers",
  },
  {
    id: 4,
    name: "Social Proof / Testimonial",
    creative: "creative-05-testimonial.png",
    primaryText: `"I used to spend my entire Sunday repurposing content. Now I do it in 5 minutes on Friday." — Alex M., 250K Subscribers\n\nContent Rocket automatically turns your YouTube videos into:\n→ Vertical Shorts (with captions & title cards)\n→ A full blog post\n→ Your email newsletter\n→ Instagram carousel slides\n→ Podcast episode\n→ Thread posts for X & LinkedIn\n\nAI-powered. Brand-consistent. Takes minutes.\n\nJoin hundreds of creators who've reclaimed their weekends.\n\n✅ No contract. Cancel any time.\n🚀 From $49/month`,
    headline: "Creators Are Reclaiming 10 Hours Every Week",
    description: "See why 500+ creators trust Content Rocket to grow on every platform.",
    cta: "Learn More",
    adSetFit: "Retargeting – Warm Audience",
  },
  {
    id: 5,
    name: "The Direct Comparison",
    creative: "creative-06-comparison.png",
    primaryText: `How long does it take you to repurpose one YouTube video?\n\n📌 Writing a blog post: 2 hours\n📌 Cutting Shorts: 1.5 hours\n📌 Designing a carousel: 1 hour\n📌 Writing a newsletter: 1 hour\n📌 Writing social captions: 45 min\n\nTotal: ~6–8 hours of work. Every. Single. Video.\n\nOR — paste your URL into Content Rocket and get all of the above in under 5 minutes.\n\nAI handles the transcription, content writing, video rendering, and design. You just review and post.\n\nBuilt for serious creators, agencies, and businesses who publish consistently.\n\n⚡ Try it free → contentrocket.app`,
    headline: "8 Hours of Work → 5 Minutes With Content Rocket",
    description: "AI repurposing for YouTube creators who want to dominate every platform.",
    cta: "Try It Free",
    adSetFit: "Lookalike – 1% Purchasers",
  },
];

const CAMPAIGN_STRUCTURE = {
  objective: "Sales / Conversions",
  optimisationEvent: "Purchase",
  bidStrategy: "Lowest cost (scale) → Cost cap at $25 CPA",
  pixelEvents: ["PageView", "ViewContent (Pricing Page)", "InitiateCheckout", "Purchase"],
  abTests: [
    "Creative format: Static image vs. Reels/video version",
    "Hook copy: Pain-point lead vs. Transformation lead",
    "CTA: 'Get Started' vs. 'Try It Free' vs. 'Learn More'",
    "Audience: Broad interest vs. Narrow interest vs. Lookalike",
  ],
  weeklyBudget: "$770 total across all ad sets",
  expectedCPA: "$18–$40 (estimated, content SaaS average)",
  kpis: [
    { metric: "Click-Through Rate (CTR)", target: "> 1.5%" },
    { metric: "Cost Per Click (CPC)", target: "< $1.50" },
    { metric: "Cost Per Lead (CPL)", target: "< $8" },
    { metric: "Cost Per Acquisition (CPA)", target: "< $30" },
    { metric: "Return on Ad Spend (ROAS)", target: "> 3×" },
    { metric: "Video View Rate (Reels)", target: "> 25% to 15s" },
  ],
};

// ── Components ────────────────────────────────────────────────────────────────

function Badge({ children, color = "pink" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    pink: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    purple: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[color] ?? colors.pink}`}>
      {children}
    </span>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function CreativeCard({ c }: { c: typeof CREATIVES[0] }) {
  return (
    <div className="bg-[#111] rounded-xl overflow-hidden border border-white/8 group hover:border-pink-500/40 transition-colors">
      <div className="aspect-square overflow-hidden bg-[#0a0a0a]">
        <img
          src={`${BASE}/${c.file}`}
          alt={c.label}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-white leading-tight">{c.label}</p>
          <span className="text-[10px] font-mono text-slate-500 shrink-0">{c.id.toString().padStart(2, "0")}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge color="purple">{c.ratio}</Badge>
          <Badge color="blue">{c.type}</Badge>
        </div>
        <p className="text-xs text-slate-500 mt-2">{c.placement}</p>
        <a
          href={`${BASE}/${c.file}`}
          download={c.file}
          className="mt-3 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 hover:text-white transition-colors border border-white/8"
        >
          ↓ Download PNG
        </a>
      </div>
    </div>
  );
}

function AdCard({ ad }: { ad: typeof ADS[0] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-[#111] rounded-xl border border-white/8 overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500">AD {ad.id.toString().padStart(2, "0")}</span>
            <h3 className="text-sm font-bold text-white">{ad.name}</h3>
          </div>
          <Badge color="green">↗ {ad.cta}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Headline</p>
            <p className="text-sm font-bold text-pink-300">{ad.headline}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Description</p>
            <p className="text-sm text-slate-300">{ad.description}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Primary Text</p>
            <div className={`text-sm text-slate-300 whitespace-pre-line leading-relaxed ${!expanded ? "line-clamp-4" : ""}`}>
              {ad.primaryText}
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-pink-400 hover:text-pink-300 mt-1"
            >
              {expanded ? "Show less ↑" : "Read full copy ↓"}
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/8 flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500">Best for:</span>
          <Badge color="amber">{ad.adSetFit}</Badge>
          <span className="text-xs text-slate-500 ml-auto">Creative: {ad.creative.split("-")[1]}–{ad.creative.split("-")[2]?.replace(".png", "")}</span>
        </div>
      </div>
    </div>
  );
}

function AdSetCard({ set }: { set: typeof AD_SETS[0] }) {
  return (
    <div className="bg-[#111] rounded-xl border border-white/8 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">{set.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{set.objective}</p>
        </div>
        <Badge color="green">{set.budget}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500 mb-1">Age Range</p>
          <p className="text-white font-medium">{set.age}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-1">Gender</p>
          <p className="text-white font-medium">{set.gender}</p>
        </div>
        <div className="col-span-2">
          <p className="text-slate-500 mb-1">Locations</p>
          <p className="text-white font-medium">{set.locations}</p>
        </div>
        <div className="col-span-2">
          <p className="text-slate-500 mb-1">Placements</p>
          <p className="text-white font-medium">{set.placements}</p>
        </div>
      </div>

      {set.interests.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-2">Interests & Keywords</p>
          <div className="flex flex-wrap gap-1.5">
            {set.interests.map(i => <Badge key={i} color="purple">{i}</Badge>)}
          </div>
        </div>
      )}

      {set.behaviours.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-2">Behaviours</p>
          <div className="flex flex-wrap gap-1.5">
            {set.behaviours.map(b => <Badge key={b} color="blue">{b}</Badge>)}
          </div>
        </div>
      )}

      {set.customAudiences.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-2">Custom / Lookalike Audiences</p>
          <div className="flex flex-wrap gap-1.5">
            {set.customAudiences.map(a => <Badge key={a} color="pink">{a}</Badge>)}
          </div>
        </div>
      )}

      <div className="pt-3 border-t border-white/8">
        <p className="text-xs text-amber-300/80">💡 {set.notes}</p>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

const TABS = ["Overview", "Creatives", "Ad Copy", "Targeting", "KPIs"] as const;
type Tab = typeof TABS[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div className="min-h-screen bg-[#080614] text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#080614]/90 backdrop-blur border-b border-white/8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold">🚀</div>
            <div>
              <p className="text-xs text-slate-500 leading-none">TAW Media</p>
              <p className="text-sm font-bold text-white leading-none mt-0.5">Meta Ads Campaign</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge color="green">5 Ad Sets</Badge>
            <Badge color="pink">10 Creatives</Badge>
            <Badge color="purple">5 Ad Copies</Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1 pb-0 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t
                  ? "border-pink-500 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">

        {/* ── Overview Tab ── */}
        {tab === "Overview" && (
          <div className="space-y-10">
            {/* Hero */}
            <div className="rounded-2xl bg-gradient-to-br from-pink-600/20 to-violet-700/20 border border-pink-500/20 p-8">
              <p className="text-xs font-semibold tracking-widest text-pink-400 uppercase mb-3">Campaign Brief</p>
              <h1 className="text-3xl font-bold text-white mb-3">Content Rocket — Meta Ads Campaign</h1>
              <p className="text-slate-300 max-w-3xl leading-relaxed">
                Full-funnel Meta (Facebook + Instagram) advertising campaign to drive subscriptions for TAW Media Content Rocket — the AI-powered platform that turns a single YouTube video into a complete content pack across 7 formats.
              </p>
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Monthly Budget", value: "$770/mo" },
                  { label: "Target CPA", value: "< $30" },
                  { label: "Target ROAS", value: "> 3×" },
                  { label: "Product Price", value: "$49/mo" },
                ].map(s => (
                  <div key={s.label} className="bg-white/5 rounded-xl p-4">
                    <p className="text-xs text-slate-400">{s.label}</p>
                    <p className="text-2xl font-bold text-white mt-1">{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Product Summary */}
            <Section title="Product Summary" subtitle="What you're advertising">
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="bg-[#111] rounded-xl border border-white/8 p-5 space-y-3">
                  <p className="text-sm font-semibold text-white">What Content Rocket Does</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Paste any YouTube URL → AI downloads, transcribes, picks the best moments, renders vertical Shorts with captions & title cards, then generates a full blog post, email newsletter, Instagram carousel, podcast episode, and social captions — all in under 5 minutes.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {["YouTube Shorts", "Blog Posts", "Newsletters", "Carousels", "Podcast Audio", "Social Threads", "Quote Graphics"].map(f => (
                      <Badge key={f} color="purple">{f}</Badge>
                    ))}
                  </div>
                </div>
                <div className="bg-[#111] rounded-xl border border-white/8 p-5 space-y-4">
                  <p className="text-sm font-semibold text-white">Pricing</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Monthly Plan</span>
                      <span className="text-lg font-bold text-white">$49<span className="text-xs text-slate-400">/mo</span></span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Annual Plan</span>
                      <div className="flex items-center gap-2">
                        <Badge color="green">32% off</Badge>
                        <span className="text-lg font-bold text-white">$399<span className="text-xs text-slate-400">/yr</span></span>
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-white/8">
                    <p className="text-xs text-slate-400">Ad strategy: Lead with monthly price ($49) to reduce friction. Upsell to annual on thank-you page.</p>
                  </div>
                </div>
              </div>
            </Section>

            {/* Campaign Structure */}
            <Section title="Campaign Structure" subtitle="Full-funnel architecture">
              <div className="bg-[#111] rounded-xl border border-white/8 overflow-hidden">
                <div className="grid grid-cols-3 divide-x divide-white/8">
                  {[
                    { stage: "TOFU", label: "Awareness", sets: ["Content Creators – Core", "YouTubers & Podcasters"], creatives: "01, 02, 03, 09", color: "text-blue-300" },
                    { stage: "MOFU", label: "Consideration", sets: ["Marketing Agencies & Freelancers", "Lookalike – 1% Purchasers"], creatives: "04, 07, 08, 10", color: "text-purple-300" },
                    { stage: "BOFU", label: "Conversion", sets: ["Retargeting – Warm Audience"], creatives: "05, 06", color: "text-pink-300" },
                  ].map(f => (
                    <div key={f.stage} className="p-5">
                      <p className={`text-xs font-bold tracking-widest ${f.color}`}>{f.stage}</p>
                      <p className="text-sm font-semibold text-white mt-1">{f.label}</p>
                      <div className="mt-3 space-y-1">
                        {f.sets.map(s => <p key={s} className="text-xs text-slate-400">• {s}</p>)}
                      </div>
                      <div className="mt-3 pt-3 border-t border-white/8">
                        <p className="text-xs text-slate-500">Creatives: #{f.creatives}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {/* A/B Tests */}
            <Section title="Recommended A/B Tests">
              <div className="grid sm:grid-cols-2 gap-3">
                {CAMPAIGN_STRUCTURE.abTests.map((t, i) => (
                  <div key={i} className="bg-[#111] rounded-xl border border-white/8 p-4 flex gap-3">
                    <span className="text-pink-400 font-bold text-sm shrink-0">Test {i + 1}</span>
                    <p className="text-sm text-slate-300">{t}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Pixel Events */}
            <Section title="Pixel Events to Implement">
              <div className="flex flex-wrap gap-2">
                {CAMPAIGN_STRUCTURE.pixelEvents.map(e => (
                  <div key={e} className="bg-[#111] border border-white/8 rounded-lg px-4 py-2.5 text-sm font-mono text-slate-300">
                    {e}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ── Creatives Tab ── */}
        {tab === "Creatives" && (
          <Section title="10 Ad Creatives" subtitle="All formats: 1:1 Feed · 9:16 Stories/Reels · 16:9 Landscape">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {CREATIVES.map(c => <CreativeCard key={c.id} c={c} />)}
            </div>
            <div className="mt-8 bg-[#111] rounded-xl border border-white/8 p-5">
              <p className="text-sm font-semibold text-white mb-3">Creative Usage Guide</p>
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500 mb-2">9:16 Stories & Reels</p>
                  <p className="text-slate-300">Creatives #01, #02, #06, #09</p>
                  <p className="text-xs text-slate-500 mt-1">Best for mobile-first, cold audiences</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">1:1 Feed</p>
                  <p className="text-slate-300">Creatives #03, #05, #08, #10</p>
                  <p className="text-xs text-slate-500 mt-1">Best for social proof + retargeting</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">16:9 Feed / Right Column</p>
                  <p className="text-slate-300">Creatives #04, #07</p>
                  <p className="text-xs text-slate-500 mt-1">Best for desktop & awareness</p>
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* ── Ad Copy Tab ── */}
        {tab === "Ad Copy" && (
          <Section title="5 Ad Copies" subtitle="Primary text, headline, description, and CTA for each ad">
            <div className="space-y-5">
              {ADS.map(ad => <AdCard key={ad.id} ad={ad} />)}
            </div>
            <div className="mt-8 bg-[#111] rounded-xl border border-white/8 p-5">
              <p className="text-sm font-semibold text-white mb-3">Copy Best Practices for SaaS Content Tools</p>
              <div className="grid sm:grid-cols-2 gap-4 text-sm text-slate-300">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">What Works</p>
                  {["Lead with the time/pain point (10 hours → 5 minutes)", "Specific numbers outperform vague claims", "Feature lists with emoji increase scannability", "Social proof + subscriber counts build trust", "End with price anchor to reduce checkout friction"].map(i => (
                    <p key={i} className="flex gap-2"><span className="text-emerald-400">✓</span>{i}</p>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">What to Avoid</p>
                  {["Generic 'AI-powered' claims without specifics", "Asking a question and not answering it", "Too many CTAs in one ad", "Long paragraphs without line breaks", "Superlatives without proof ('best', '#1')"].map(i => (
                    <p key={i} className="flex gap-2"><span className="text-red-400">✗</span>{i}</p>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* ── Targeting Tab ── */}
        {tab === "Targeting" && (
          <Section title="5 Ad Sets & Targeting" subtitle="Full demographic, interest, and audience breakdown">
            <div className="space-y-5">
              {AD_SETS.map(set => <AdSetCard key={set.name} set={set} />)}
            </div>
            <div className="mt-8 bg-[#111] rounded-xl border border-white/8 p-5">
              <p className="text-sm font-semibold text-white mb-4">Launch Order Recommendation</p>
              <ol className="space-y-2 text-sm text-slate-300">
                {[
                  "Week 1–2: Launch 'Content Creators – Core' + 'YouTubers & Podcasters' to gather purchase data",
                  "Week 2: Add Pixel retargeting as data accumulates (need ~100 events for optimisation)",
                  "Week 3: Build 1% Lookalike from purchaser email list, launch that ad set",
                  "Week 4+: Pause underperforming ad sets (CTR < 0.8%), scale winners by 20%/day",
                  "Ongoing: Refresh creatives every 4–6 weeks to combat ad fatigue",
                ].map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-pink-400 font-bold shrink-0">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Section>
        )}

        {/* ── KPIs Tab ── */}
        {tab === "KPIs" && (
          <div className="space-y-10">
            <Section title="Performance KPIs" subtitle="Targets for a healthy $49/month SaaS product on Meta">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {CAMPAIGN_STRUCTURE.kpis.map(k => (
                  <div key={k.metric} className="bg-[#111] rounded-xl border border-white/8 p-5">
                    <p className="text-xs text-slate-400 mb-1">{k.metric}</p>
                    <p className="text-2xl font-bold text-pink-300">{k.target}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Budget Breakdown">
              <div className="bg-[#111] rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Ad Set</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Daily</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Monthly</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Objective</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AD_SETS.map((s, i) => (
                      <tr key={s.name} className={`border-b border-white/5 ${i % 2 === 0 ? "bg-white/[0.02]" : ""}`}>
                        <td className="px-5 py-3 text-white font-medium">{s.name}</td>
                        <td className="px-5 py-3 text-right text-slate-300">{s.budget}</td>
                        <td className="px-5 py-3 text-right text-slate-300">
                          ${(parseInt(s.budget.replace("$", "")) * 30).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-slate-400 hidden sm:table-cell">{s.objective}</td>
                      </tr>
                    ))}
                    <tr className="bg-pink-500/10 border-t border-pink-500/20">
                      <td className="px-5 py-3 text-white font-bold">Total</td>
                      <td className="px-5 py-3 text-right text-white font-bold">$110/day</td>
                      <td className="px-5 py-3 text-right text-white font-bold">$3,300/mo</td>
                      <td className="px-5 py-3 hidden sm:table-cell"></td>
                    </tr>
                  </tbody>
                </table>
                <div className="px-5 py-4 border-t border-white/8 bg-white/[0.02]">
                  <p className="text-xs text-slate-400">💡 Start with a reduced test budget of $30–$50/day across 2 ad sets before scaling. Aim for 50+ purchase events before switching to CBO (Campaign Budget Optimisation).</p>
                </div>
              </div>
            </Section>

            <Section title="Estimated Monthly Projections">
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="bg-[#111] rounded-xl border border-white/8 p-5 space-y-4">
                  <p className="text-sm font-semibold text-white">Conservative Scenario</p>
                  <div className="space-y-2 text-sm">
                    {[
                      ["Monthly Ad Spend", "$770"],
                      ["Est. Clicks", "~1,200"],
                      ["Est. Trials Started", "~80"],
                      ["Est. New Subscribers (40% conv.)", "~32"],
                      ["Revenue (monthly)", "~$1,568"],
                      ["ROAS", "~2.0×"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-slate-400">{k}</span>
                        <span className="text-white font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-pink-600/10 to-violet-600/10 rounded-xl border border-pink-500/20 p-5 space-y-4">
                  <p className="text-sm font-semibold text-white">Optimised Scenario (Month 3+)</p>
                  <div className="space-y-2 text-sm">
                    {[
                      ["Monthly Ad Spend", "$3,300"],
                      ["Est. Clicks", "~6,000"],
                      ["Est. Trials Started", "~450"],
                      ["Est. New Subscribers (45% conv.)", "~200"],
                      ["Revenue (monthly)", "~$9,800"],
                      ["ROAS", "~3.0×"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-slate-400">{k}</span>
                        <span className="text-pink-200 font-bold">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>
          </div>
        )}

      </main>
    </div>
  );
}
