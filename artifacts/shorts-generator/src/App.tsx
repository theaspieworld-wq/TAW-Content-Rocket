import { useEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignIn, SignUp, UserProfile, Show, useClerk, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import PricingPage from "@/pages/pricing";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: "#f21178",
    colorForeground: "#f8fafc",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#ef4444",
    colorBackground: "#0d0920",
    colorInput: "#16102a",
    colorInputForeground: "#f8fafc",
    colorNeutral: "#2a1e4a",
    fontFamily: "'Poppins', 'Inter', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#0d0920] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#2a1e4a] shadow-2xl shadow-black/60",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-white font-medium",
    formFieldLabel: "text-slate-300 text-sm",
    footerActionLink: "text-[#f21178] hover:text-[#f21178] font-medium",
    footerActionText: "text-slate-400",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-[#f21178]",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-slate-200",
    logoBox: "flex justify-center mb-2",
    logoImage: "h-14",
    socialButtonsBlockButton: "border-[#2a1e4a] bg-[#16102a] hover:bg-[#1e1638] text-white",
    formButtonPrimary: "bg-[#f21178] hover:bg-[#d91068] text-white font-semibold shadow-lg shadow-[#f21178]/25",
    formFieldInput: "bg-[#16102a] border-[#2a1e4a] text-white",
    footerAction: "bg-[#090717]",
    dividerLine: "bg-[#2a1e4a]",
    alert: "border-red-500/30 bg-red-500/10",
    otpCodeFieldInput: "bg-[#16102a] border-[#2a1e4a] text-white",
    formFieldRow: "",
    main: "",
  },
};

function ThemeEnforcer() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  return null;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#080614] px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#080614] px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-[100dvh] bg-[#080614] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#f21178]/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-[350px] h-[350px] bg-violet-700/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 text-center max-w-2xl w-full">
        <div className="flex flex-col items-center gap-3 mb-10">
          <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-28 w-28 rounded-2xl object-cover shadow-xl shadow-[#f21178]/20" />
          <div className="text-center">
            <p className="text-[10px] font-semibold tracking-[0.25em] text-slate-500 uppercase">TAW Media</p>
            <p className="text-xl font-bold text-white leading-tight">Content Rocket</p>
          </div>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-5 leading-tight tracking-tight">
          Turn one video into a<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f21178] to-violet-500">
            full content pack
          </span>
        </h1>

        <p className="text-slate-400 text-lg mb-10 leading-relaxed max-w-xl mx-auto">
          AI-powered YouTube Shorts, blog posts, newsletters, carousels, podcast audio, and more — all from a single YouTube video.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
          <Button
            size="lg"
            className="w-full sm:w-auto bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white font-semibold px-8 h-12 text-base shadow-lg shadow-[#f21178]/20 border-0"
            onClick={() => setLocation("/sign-up")}
          >
            Get Started
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto border-slate-700 text-slate-300 hover:bg-slate-800/60 hover:text-white px-8 h-12 text-base"
            onClick={() => setLocation("/sign-in")}
          >
            Sign In
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {["YouTube Shorts", "Blog Posts", "Newsletters", "Carousels", "Podcast Audio", "Social Threads", "Quote Graphics"].map((f) => (
            <span key={f} className="px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-slate-400 border border-white/8">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function useSubscriptionStatus() {
  const { user } = useUser();
  const [status, setStatus] = useState<"loading" | "active" | "inactive">("loading");

  useEffect(() => {
    if (!user) return;
    fetch(`${basePath}/api/stripe/subscription`)
      .then((r) => r.json())
      .then((d) => setStatus(d.active ? "active" : "inactive"))
      .catch(() => setStatus("inactive"));
  }, [user?.id]);

  return status;
}

function AppPage() {
  const subStatus = useSubscriptionStatus();
  const [, setLocation] = useLocation();

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
      <Show when="signed-in">
        {subStatus === "loading" ? (
          <div className="min-h-[100dvh] bg-[#080614] flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#f21178]" />
          </div>
        ) : subStatus === "inactive" ? (
          <div className="min-h-[100dvh] bg-[#080614] flex flex-col items-center justify-center px-4 relative overflow-hidden">
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#f21178]/6 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 text-center max-w-md">
              <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-20 w-20 rounded-2xl object-cover mx-auto mb-6 shadow-xl shadow-[#f21178]/20" />
              <h2 className="text-2xl font-bold text-white mb-3">Subscription required</h2>
              <p className="text-slate-400 mb-8">
                You need an active Content Rocket subscription to use the app. Get started with a plan below.
              </p>
              <Button
                size="lg"
                className="bg-gradient-to-r from-[#f21178] to-violet-600 hover:from-[#d91068] hover:to-violet-700 text-white font-semibold px-8 h-12 border-0 shadow-lg shadow-[#f21178]/20"
                onClick={() => setLocation("/pricing")}
              >
                View Plans
              </Button>
            </div>
          </div>
        ) : (
          <Home />
        )}
      </Show>
    </>
  );
}

function ProfilePage() {
  return (
    <>
      <Show when="signed-in">
        <div className="min-h-[100dvh] bg-[#080614] flex items-start justify-center px-4 py-10">
          <div className="w-full max-w-3xl">
            <UserProfile
              routing="path"
              path={`${basePath}/app/profile`}
              appearance={{
                elements: {
                  rootBox: "w-full",
                  cardBox: "w-full bg-[#0d0920] rounded-2xl border border-[#2a1e4a] shadow-2xl shadow-black/60",
                  card: "!shadow-none !border-0 !bg-transparent",
                  navbar: "border-r border-[#2a1e4a]",
                  navbarButton: "text-slate-300 hover:text-white hover:bg-[#16102a]",
                  navbarButtonActive: "text-[#f21178] bg-[#1e0a1e]",
                  pageScrollBox: "bg-transparent",
                  profileSectionTitle: "text-white font-semibold",
                  profileSectionContent: "text-slate-300",
                  formButtonPrimary: "bg-[#f21178] hover:bg-[#d91068] text-white",
                  formFieldInput: "bg-[#16102a] border-[#2a1e4a] text-white",
                  formFieldLabel: "text-slate-300",
                  headerTitle: "text-white",
                  headerSubtitle: "text-slate-400",
                },
              }}
            />
          </div>
        </div>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      {...(!clerkProxyUrl && {
        clerkJSUrl: "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
      })}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/app`}
      signUpFallbackRedirectUrl={`${basePath}/app`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to your Content Rocket account",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Start generating content at scale",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Toaster />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/app" component={AppPage} />
            <Route path="/app/profile/*?" component={ProfilePage} />
            <Route path="/pricing" component={PricingPage} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ThemeEnforcer />
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
