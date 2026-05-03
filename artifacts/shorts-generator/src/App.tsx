import { useEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignIn, SignUp, UserProfile, Show, useClerk, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, User, LogOut, Copy, Check } from "lucide-react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import PricingPage from "@/pages/pricing";
import LandingPage from "@/pages/landing";

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
    // UserButton popover dropdown
    userButtonPopoverCard: "bg-[#0d0920] border border-[#2a1e4a] shadow-2xl shadow-black/60",
    userButtonPopoverMain: "bg-[#0d0920]",
    userButtonPopoverFooter: "bg-[#090717] border-t border-[#2a1e4a]",
    userButtonPopoverActionButton: "hover:bg-[#16102a] text-white",
    userButtonPopoverActionButtonText: "text-white font-medium",
    userButtonPopoverActionButtonIcon: "text-slate-400",
    userButtonPopoverUserPreview: "border-b border-[#2a1e4a]",
    userButtonPopoverUserPreviewTextContainer: "text-white",
    userPreviewMainIdentifier: "text-white font-semibold",
    userPreviewSecondaryIdentifier: "text-slate-400",
  },
};

function ThemeEnforcer() {
  useEffect(() => {
    document.documentElement.classList.add("dark");

    // Hide Clerk's "Development mode" badge (injected by Clerk's own script).
    // We observe DOM mutations so it stays hidden even if Clerk re-renders it.
    function hideClerkDevBanner() {
      // Match by text content — works regardless of hashed class names
      document.querySelectorAll<HTMLElement>('[class*="cl-"]').forEach((el) => {
        if (
          el.children.length === 0 &&
          (el.textContent ?? "").trim().toLowerCase() === "development mode"
        ) {
          let node: HTMLElement | null = el;
          // Walk up to the nearest fixed-position ancestor and hide that
          while (node && node !== document.body) {
            if (window.getComputedStyle(node).position === "fixed") {
              node.style.setProperty("display", "none", "important");
              return;
            }
            node = node.parentElement;
          }
          el.style.setProperty("display", "none", "important");
        }
      });
    }

    hideClerkDevBanner();
    const observer = new MutationObserver(hideClerkDevBanner);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#080614] px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        appearance={{
          ...clerkAppearance,
          elements: {
            ...clerkAppearance.elements,
            // Hide the "use another method" link so email-OTP strategy is not surfaced
            alternativeMethodsBlockButton: { display: "none" },
          },
        }}
      />
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

  // Seed initial state from sessionStorage so page reloads skip the loading flash
  const [status, setStatus] = useState<"loading" | "active" | "inactive">(() => {
    const cached = sessionStorage.getItem("cr_subStatus");
    return cached === "active" || cached === "inactive" ? cached : "loading";
  });
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem("cr_isAdmin") === "1");

  useEffect(() => {
    if (!user) return;
    fetch(`${basePath}/api/stripe/subscription`)
      .then((r) => r.json())
      .then((d) => {
        const s: "active" | "inactive" = d.active ? "active" : "inactive";
        setStatus(s);
        setIsAdmin(!!d.isAdmin);
        sessionStorage.setItem("cr_subStatus", s);
        sessionStorage.setItem("cr_isAdmin", d.isAdmin ? "1" : "0");
      })
      .catch(() => {
        // Only downgrade to inactive if we don't already have a confirmed status
        if (status === "loading") setStatus("inactive");
      });
  }, [user?.id]);

  return { status, isAdmin };
}

function AppPage() {
  const { status: subStatus, isAdmin } = useSubscriptionStatus();
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
          <Home isAdmin={isAdmin} />
        )}
      </Show>
    </>
  );
}

function ProfilePage() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { isAdmin } = useSubscriptionStatus();
  const [copied, setCopied] = useState(false);

  function copyUserId() {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Show when="signed-in">
        <div className="min-h-[100dvh] bg-[#080614] flex flex-col">
          {/* Header */}
          <div className="sticky top-0 z-20 bg-[#080614]/95 backdrop-blur-md border-b border-[#2a1e4a]">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setLocation("/app")}
                  className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to app
                </button>
              </div>
              <div className="flex items-center gap-2.5">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="avatar" className="h-7 w-7 rounded-full object-cover ring-2 ring-[#2a1e4a]" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-[#f21178]/10 flex items-center justify-center ring-2 ring-[#2a1e4a]">
                    <User className="w-3.5 h-3.5 text-[#f21178]/70" />
                  </div>
                )}
                <span className="text-sm text-slate-300 font-medium hidden sm:block">
                  {user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0]}
                </span>
              </div>
            </div>
          </div>

          {/* Profile panel */}
          <div className="flex-1 flex flex-col items-center px-4 py-8">
            <div className="w-full max-w-3xl space-y-4">
              <div>
                <h1 className="text-xl font-bold text-white">Account settings</h1>
                <p className="text-slate-400 text-sm mt-0.5">Update your profile picture, name, email, and password.</p>
              </div>

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
                    formFieldInput: "bg-[#16102a] border-[#2a1e4a] text-white placeholder:text-slate-600",
                    formFieldLabel: "text-slate-300 text-sm",
                    headerTitle: "text-white",
                    headerSubtitle: "text-slate-400",
                    profileSectionPrimaryButton: "text-[#f21178] hover:text-[#f21178]",
                    accordionTriggerButton: "text-slate-300 hover:text-white",
                    badge: "bg-[#f21178]/10 text-[#f21178] border-[#f21178]/20",
                    avatarImageActionsUpload: "bg-[#f21178] hover:bg-[#d91068] text-white",
                  },
                }}
              />

              {/* Admin / User ID panel */}
              <div className="rounded-2xl border border-[#2a1e4a] bg-[#0d0920] p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">Account info</p>
                  {isAdmin && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-[#f21178]/15 text-[#f21178] border border-[#f21178]/25">
                      Admin
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Your user ID</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-[#16102a] border border-[#2a1e4a] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono truncate select-all">
                      {user?.id ?? "—"}
                    </code>
                    <button
                      onClick={copyUserId}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#16102a] border border-[#2a1e4a] text-xs text-slate-400 hover:text-white hover:border-[#f21178]/40 transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  {!isAdmin && (
                    <p className="text-[11px] text-slate-600 mt-1.5">Share this ID with your admin to grant full access.</p>
                  )}
                </div>
              </div>

              {/* Sign out */}
              <div className="flex justify-end pb-4">
                <button
                  onClick={() => signOut(() => setLocation("/"))}
                  className="flex items-center gap-2 text-slate-500 hover:text-red-400 transition-colors text-sm"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            </div>
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
      clerkJSUrl="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6/dist/clerk.browser.js"
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
