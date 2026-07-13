import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { Check, Loader2, Zap, Crown, ExternalLink, Sparkles, Tag, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Price {
  id: string;
  unitAmount: number;
  currency: string;
  recurring: { interval: string } | null;
}

interface Product {
  id: string;
  name: string;
  description: string;
  prices: Price[];
}

interface CouponInfo {
  valid: boolean;
  promotionCodeId: string | null;
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  name: string | null;
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100);
}

export default function PricingPage() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [billing, setBilling] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponInfo, setCouponInfo] = useState<CouponInfo | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${basePath}/api/stripe/products`)
      .then((r) => r.json())
      .then((d) => setProducts(d.data ?? []))
      .catch(() => setFetchError("Failed to load plans"));
  }, []);

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    setCouponLoading(true);
    setCouponError(null);
    setCouponInfo(null);
    try {
      const res = await fetch(`${basePath}/api/stripe/validate-coupon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim() }),
      });
      const data: CouponInfo = await res.json();
      if (!data.valid) {
        setCouponError("Code not found or expired. Check your code and try again.");
      } else {
        setCouponInfo(data);
      }
    } catch {
      setCouponError("Couldn't validate the code. Please try again.");
    } finally {
      setCouponLoading(false);
    }
  }

  const isFree = couponInfo?.valid && couponInfo.percentOff === 100;

  async function handleCheckout(priceId: string) {
    if (!user) {
      setLocation("/sign-up");
      return;
    }
    setLoading(priceId);
    try {
      if (isFree && couponInfo?.promotionCodeId) {
        const res = await fetch(`${basePath}/api/stripe/checkout-free`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priceId, promotionCodeId: couponInfo.promotionCodeId }),
        });
        const data = await res.json();
        if (data.success) {
          setLocation("/app?subscribed=1");
        } else {
          setCouponError(data.error ?? "Failed to activate. Please try again.");
          setLoading(null);
        }
      } else {
        const res = await fetch(`${basePath}/api/stripe/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            priceId,
            ...(couponInfo?.promotionCodeId ? { promotionCodeId: couponInfo.promotionCodeId } : {}),
          }),
        });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
        else setLoading(null);
      }
    } catch {
      setLoading(null);
    }
  }

  const features = [
    "Unlimited YouTube Shorts generation",
    "AI-written blog posts & newsletters",
    "Social media carousels",
    "Podcast audio export",
    "Quote graphics",
    "Custom brand kits",
    "Priority processing",
  ];

  return (
    <div className="min-h-[100dvh] bg-[#080614] flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#f21178]/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-[350px] h-[350px] bg-violet-700/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl text-center">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-3 mx-auto mb-10 group"
        >
          <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-12 w-12 rounded-xl object-cover" />
          <div className="text-left">
            <p className="text-[10px] font-semibold tracking-[0.25em] text-slate-500 uppercase">TAW Media</p>
            <p className="text-base font-bold text-white leading-tight">Content Rocket</p>
          </div>
        </button>

        <div className="mb-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#f21178]/10 border border-[#f21178]/20 text-[#f21178] text-xs font-semibold">
          <Zap className="w-3 h-3" /> Unlock full access
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
          One plan. Unlimited content.
        </h1>
        <p className="text-slate-400 mb-8 text-base max-w-md mx-auto">
          Everything you need to turn one video into a full content machine.
        </p>

        <div className="flex items-center justify-center gap-3 mb-10">
          <button
            onClick={() => setBilling("week")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${billing === "week" ? "bg-[#f21178] text-white" : "text-slate-400 hover:text-white"}`}
          >
            Weekly
          </button>
          <button
            onClick={() => setBilling("month")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${billing === "month" ? "bg-[#f21178] text-white" : "text-slate-400 hover:text-white"}`}
          >
            Monthly
            <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">Save $70/mo</span>
          </button>
        </div>

        {fetchError ? (
          <p className="text-red-400 text-sm">{fetchError}</p>
        ) : !products ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#f21178]" /></div>
        ) : products.length === 0 ? (
          <p className="text-slate-400 text-sm">No plans available yet.</p>
        ) : (
          products.map((product) => {
            const intervalMap: Record<string, string> = { week: "week", month: "month" };
            const price = product.prices.find(
              (p) => p.recurring?.interval === intervalMap[billing]
            ) ?? product.prices[0];
            if (!price) return null;
            return (
              <div
                key={product.id}
                className="bg-[#0d0920] border border-[#2a1e4a] rounded-2xl p-8 shadow-2xl shadow-black/50 text-left relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#f21178]/5 via-transparent to-violet-700/5 pointer-events-none" />
                <div className="relative z-10">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Crown className="w-4 h-4 text-[#f21178]" />
                        <span className="text-xs font-semibold text-[#f21178] uppercase tracking-widest">Pro</span>
                      </div>
                      <h2 className="text-xl font-bold text-white">{product.name}</h2>
                      {product.description && (
                        <p className="text-slate-400 text-sm mt-1 max-w-sm">{product.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {isFree ? (
                        <>
                          <div className="text-3xl font-bold text-emerald-400">$0</div>
                          <div className="text-slate-500 text-sm line-through">
                            {formatPrice(price.unitAmount, price.currency)}/{price.recurring?.interval ?? "one-time"}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-3xl font-bold text-white">
                            {formatPrice(price.unitAmount, price.currency)}
                          </div>
                          <div className="text-slate-400 text-sm">
                            /{price.recurring?.interval ?? "one-time"}
                          </div>
                          {billing === "week" && (
                            <div className="text-slate-400 text-xs mt-0.5 font-medium">
                              ~{formatPrice(price.unitAmount * 4, price.currency)}/mo at 4 weeks
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <ul className="space-y-2.5 mb-6">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-slate-300 text-sm">
                        <div className="h-4 w-4 rounded-full bg-[#f21178]/15 flex items-center justify-center shrink-0">
                          <Check className="w-2.5 h-2.5 text-[#f21178]" />
                        </div>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* Coupon code section */}
                  <div className="mb-6 space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <Input
                          placeholder="Discount code"
                          value={couponInput}
                          onChange={(e) => {
                            setCouponInput(e.target.value.toUpperCase());
                            setCouponInfo(null);
                            setCouponError(null);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                          className="pl-9 bg-[#0a0618] border-[#2a1e4a] text-white placeholder:text-slate-600 focus:border-[#f21178]/50 h-10"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={applyCoupon}
                        disabled={couponLoading || !couponInput.trim()}
                        className="border-[#2a1e4a] text-slate-300 hover:text-white hover:border-[#f21178]/50 hover:bg-[#f21178]/10 h-10 px-4"
                      >
                        {couponLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
                      </Button>
                    </div>

                    {couponError && (
                      <div className="flex items-center gap-2 text-red-400 text-sm">
                        <XCircle className="w-4 h-4 shrink-0" />
                        {couponError}
                      </div>
                    )}

                    {couponInfo?.valid && (
                      <div className={`flex items-center gap-2 text-sm font-medium ${isFree ? "text-emerald-400" : "text-[#f21178]"}`}>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {isFree
                          ? "100% discount applied — no payment needed!"
                          : `${couponInfo.percentOff != null ? `${couponInfo.percentOff}% off` : couponInfo.amountOff != null ? `${formatPrice(couponInfo.amountOff, couponInfo.currency ?? "usd")} off` : "Discount"} applied`}
                      </div>
                    )}
                  </div>

                  <Button
                    size="lg"
                    disabled={!!loading}
                    onClick={() => handleCheckout(price.id)}
                    className={`w-full font-semibold h-12 text-base shadow-lg border-0 disabled:opacity-60 ${
                      isFree
                        ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 shadow-emerald-500/20"
                        : "bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 shadow-[#f21178]/20"
                    }`}
                  >
                    {loading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isFree ? "Activating…" : "Redirecting…"}</>
                    ) : isFree ? (
                      "Activate Free Account"
                    ) : (
                      "Subscribe Now"
                    )}
                  </Button>

                  <p className="text-center text-slate-500 text-xs mt-4">
                    {isFree
                      ? "Free access forever — no credit card required"
                      : "Secure payment via Stripe · Cancel anytime"}
                  </p>
                </div>
              </div>
            );
          })
        )}

        {/* Content360 upsell */}
        <div className="mt-6 bg-[#0d1a12] border border-emerald-500/25 rounded-2xl p-6 text-left relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">Bundle Deal</span>
                </div>
                <h3 className="text-lg font-bold text-white">Content360</h3>
                <p className="text-slate-400 text-sm mt-0.5">Social media manager + AI sales bot — lifetime access</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-white">$67</div>
                <div className="text-slate-400 text-xs">one-time</div>
              </div>
            </div>
            <ul className="space-y-1.5 mb-5">
              {["Manage all your social media in one place", "AI-powered sales bot", "Lifetime access — pay once, use forever", "Perfect companion to Content Rocket"].map((f) => (
                <li key={f} className="flex items-center gap-2 text-slate-300 text-sm">
                  <div className="h-4 w-4 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                  </div>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="https://get.content360.io/lifetime?am_id=TAW"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold h-12 text-base shadow-lg shadow-emerald-500/20 border-0 gap-2"
              >
                Get Lifetime Access — $67 <ExternalLink className="w-4 h-4" />
              </Button>
            </a>
          </div>
        </div>

        <button
          onClick={() => setLocation("/sign-in")}
          className="mt-6 text-slate-500 text-sm hover:text-slate-300 transition-colors"
        >
          Already have an account? Sign in
        </button>
      </div>
    </div>
  );
}
