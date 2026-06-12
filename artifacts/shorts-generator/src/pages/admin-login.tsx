import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUser, useClerk, Show } from "@clerk/react";
import { Loader2, ShieldCheck, ShieldX, Copy, Check, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AdminLoginPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const [checking, setChecking] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isLoaded || !user) return;
    setChecking(true);
    fetch(`${basePath}/api/stripe/subscription`)
      .then((r) => r.json())
      .then((d) => {
        if (d.isAdmin) {
          setIsAdmin(true);
          setLocation("/app");
        } else {
          setIsAdmin(false);
        }
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setChecking(false));
  }, [user?.id, isLoaded]);

  function copyId() {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-[100dvh] bg-[#080614] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-700/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-[#f21178]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-10">
          <img src={`${basePath}/logo.png`} alt="Content Rocket" className="h-10 w-10 rounded-xl object-cover" />
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-slate-500 uppercase">TAW Media</p>
            <p className="text-sm font-bold text-white leading-tight">Content Rocket</p>
          </div>
        </div>

        <div className="bg-[#0d0920] border border-[#2a1e4a] rounded-2xl p-8 shadow-2xl shadow-black/60">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
              <ShieldCheck className="w-7 h-7 text-violet-400" />
            </div>
            <h1 className="text-xl font-bold text-white mb-1">Admin Access</h1>
            <p className="text-sm text-slate-400">Sign in to access the admin panel</p>
          </div>

          {/* Content */}
          <Show when="signed-out">
            <div className="space-y-3">
              <Button
                size="lg"
                className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white font-semibold border-0 shadow-lg shadow-violet-500/20 gap-2"
                onClick={() => setLocation(`/sign-in`)}
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </Button>
              <p className="text-center text-xs text-slate-600">
                Admin accounts bypass the subscription gate automatically.
              </p>
            </div>
          </Show>

          <Show when="signed-in">
            {!isLoaded || checking ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                <p className="text-sm text-slate-400">Checking admin status…</p>
              </div>
            ) : isAdmin === false ? (
              <div className="space-y-5">
                {/* Not-admin state */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/8 border border-red-500/20">
                  <ShieldX className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-300">Not in admin list</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Your account isn't configured as an admin. Add your user ID to the <code className="text-violet-300 bg-violet-500/10 px-1 rounded">ADMIN_USER_IDS</code> environment variable.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500">Your user ID</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-[#16102a] border border-[#2a1e4a] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono truncate select-all">
                      {user?.id ?? "—"}
                    </code>
                    <button
                      onClick={copyId}
                      className="shrink-0 h-9 px-3 rounded-lg bg-[#16102a] border border-[#2a1e4a] text-xs text-slate-400 hover:text-white hover:border-violet-500/40 transition-all flex items-center gap-1.5"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Add this to <code className="text-violet-300 bg-violet-500/10 px-0.5 rounded">ADMIN_USER_IDS</code> in the Secrets panel, then sign in again.
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-slate-400 border-[#2a1e4a] hover:text-white"
                  onClick={() => signOut(() => setLocation("/admin-login"))}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </Button>
              </div>
            ) : null}
          </Show>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          <button onClick={() => setLocation("/")} className="hover:text-slate-400 transition-colors">← Back to home</button>
        </p>
      </div>
    </div>
  );
}
