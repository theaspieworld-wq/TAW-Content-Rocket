import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4";
import {
  useListJobs,
  useCreateJob,
  useGetJob,
  useDeleteJob,
  useHealthCheck,
  useListOutros,
  useUpdateOutro,
  useDeleteOutro,
  useSetDefaultOutro,
  useGetJobContent,
  useRegenerateJobContent,
  useListBrands,
  useCreateBrand,
  useUpdateBrand,
  useDeleteBrand,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getHealthCheckQueryKey,
  getListOutrosQueryKey,
  getListBrandsQueryKey,
  getGetJobContentQueryKey,
  type Brand,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import {
  Video,
  Scissors,
  Trash2,
  Loader2,
  Download,
  AlertCircle,
  PlayCircle,
  FileVideo,
  Layers,
  Activity,
  Upload,
  Settings,
  Star,
  Film,
  Edit2,
  FileText,
  Copy,
  Check,
  RefreshCw,
  Mail,
  AtSign,
  Globe,
  BookOpen,
  Menu,
  X,
  MessageSquareQuote,
  Building2,
  Mic,
  Package,
  Clock,
  Zap,
  Image,
  ChevronDown,
  ChevronUp,
  Plus,
  Megaphone,
  FolderOpen,
  User,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { UserButton, useUser } from "@clerk/react";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CLIP_DURATIONS = [15, 30, 45, 60, 90] as const;

const GOOGLE_FONTS = [
  "Poppins", "Montserrat", "Inter", "Roboto", "Oswald",
  "Raleway", "Lato", "Open Sans", "Nunito", "Playfair Display",
  "Space Grotesk", "DM Sans", "Bebas Neue", "Syne", "Plus Jakarta Sans",
] as const;

const formSchema = z.object({
  youtubeUrl: z.string().url({ message: "Please enter a valid YouTube URL" }),
  clipCount: z.coerce.number().min(0).max(10).default(9),
  clipDurationSeconds: z.coerce.number().default(45),
  contentCta: z.string().optional(),
  outroId: z.string().optional(),
  brandId: z.string().min(1, { message: "Please select a brand before running" }),
  includeShorts: z.boolean().default(true),
});

function getStatusProgress(status: string) {
  switch (status) {
    case "pending": return 8;
    case "downloading": return 28;
    case "transcribing": return 50;
    case "analyzing": return 68;
    case "rendering": return 88;
    case "completed": return 100;
    case "failed": return 100;
    default: return 0;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "pending": return "bg-muted text-muted-foreground";
    case "downloading": return "bg-violet-500/20 text-violet-400 border-violet-500/30";
    case "transcribing": return "bg-violet-500/20 text-violet-400 border-violet-500/30";
    case "analyzing": return "bg-[#f21178]/20 text-[#f21178] border-[#f21178]/30";
    case "rendering": return "bg-[#f21178]/20 text-[#f21178] border-[#f21178]/30";
    case "completed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "failed": return "bg-destructive/20 text-destructive border-destructive/30";
    default: return "bg-muted text-muted-foreground border-transparent";
  }
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pending",
    downloading: "Downloading",
    transcribing: "Transcribing",
    analyzing: "Analysing",
    rendering: "Rendering",
    completed: "Completed",
    failed: "Failed",
  };
  return labels[status] ?? status;
}

export default function Home({ isAdmin = false }: { isAdmin?: boolean }) {
  const [, setLocation] = useLocation();
  const { user } = useUser();

  // Persist selectedJobId across page reloads (HMR reconnects, proxy drops, etc.)
  const [selectedJobId, setSelectedJobIdState] = useState<number | null>(() => {
    const stored = sessionStorage.getItem("cr_selectedJobId");
    return stored ? parseInt(stored, 10) : null;
  });
  const setSelectedJobId = (id: number | null) => {
    setSelectedJobIdState(id);
    if (id !== null) {
      sessionStorage.setItem("cr_selectedJobId", String(id));
    } else {
      sessionStorage.removeItem("cr_selectedJobId");
    }
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isUploadingOutro, setIsUploadingOutro] = useState(false);
  const [editingOutroId, setEditingOutroId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appendCta, setAppendCta] = useState(false);
  const [expandedBrandId, setExpandedBrandId] = useState<number | null>(null);
  const [editingBrandId, setEditingBrandId] = useState<number | null>(null);
  const [isAddingBrand, setIsAddingBrand] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<number | null>(null);

  // Brand form state
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandVoice, setNewBrandVoice] = useState("");
  const [newBrandCta, setNewBrandCta] = useState("");
  const [newBrandAppendCta, setNewBrandAppendCta] = useState(false);
  const [newBrandWebsite, setNewBrandWebsite] = useState("");
  const [newBrandExportFolder, setNewBrandExportFolder] = useState("");
  const [newBrandFont, setNewBrandFont] = useState("Poppins");
  const [newBrandPrimary, setNewBrandPrimary] = useState("#f21178");
  const [newBrandSecondary, setNewBrandSecondary] = useState("#7c3aed");
  const [editBrandName, setEditBrandName] = useState("");
  const [editBrandVoice, setEditBrandVoice] = useState("");
  const [editBrandCta, setEditBrandCta] = useState("");
  const [editBrandAppendCta, setEditBrandAppendCta] = useState(false);
  const [editBrandWebsite, setEditBrandWebsite] = useState("");
  const [editBrandExportFolder, setEditBrandExportFolder] = useState("");
  const [editBrandFont, setEditBrandFont] = useState("Poppins");
  const [editBrandPrimary, setEditBrandPrimary] = useState("#f21178");
  const [editBrandSecondary, setEditBrandSecondary] = useState("#7c3aed");

  // Outro form state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadPosition, setUploadPosition] = useState<"beginning" | "end">("end");
  const [uploadCtaText, setUploadCtaText] = useState("");
  const [uploadCtaStartSeconds, setUploadCtaStartSeconds] = useState<number | "">("");
  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState<"beginning" | "end">("end");
  const [editCtaText, setEditCtaText] = useState("");
  const [editCtaStartSeconds, setEditCtaStartSeconds] = useState<number | "">("");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: health } = useHealthCheck({
    query: { refetchInterval: 30000, queryKey: getHealthCheckQueryKey() },
  });

  const { data: jobs, isLoading: isJobsLoading } = useListJobs({
    query: { refetchInterval: 5000, queryKey: getListJobsQueryKey() },
  });

  const { data: outros, isLoading: isOutrosLoading } = useListOutros({
    query: { queryKey: getListOutrosQueryKey() },
  });

  const { data: brands, isLoading: isBrandsLoading } = useListBrands({
    query: { queryKey: getListBrandsQueryKey() },
  });

  const { data: jobWithClips } = useGetJob(selectedJobId as number, {
    query: {
      enabled: selectedJobId !== null,
      queryKey: getGetJobQueryKey(selectedJobId as number),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status && !["completed", "failed"].includes(status) ? 2000 : false;
      },
    },
  });

  const createJob = useCreateJob();
  const deleteJob = useDeleteJob();
  const updateOutro = useUpdateOutro();
  const deleteOutro = useDeleteOutro();
  const setDefaultOutro = useSetDefaultOutro();
  const regenerateContent = useRegenerateJobContent();
  const createBrand = useCreateBrand();
  const updateBrand = useUpdateBrand();
  const deleteBrand = useDeleteBrand();

  const { data: jobContent, isLoading: isContentLoading } = useGetJobContent(
    selectedJobId as number,
    {
      query: {
        enabled: selectedJobId !== null && jobWithClips?.status === "completed" && jobWithClips?.hasContent === true,
        queryKey: getGetJobContentQueryKey(selectedJobId as number),
      },
    }
  );

  useEffect(() => {
    if (
      jobWithClips?.status === "completed" &&
      jobWithClips?.hasContent === false &&
      !regenerateContent.isPending
    ) {
      regenerateContent.mutate({ id: jobWithClips.id }, {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetJobContentQueryKey(jobWithClips.id), data);
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        },
        throwOnError: false,
      });
    }
  }, [jobWithClips?.id, jobWithClips?.status, jobWithClips?.hasContent]);

  // Auto-set appendCta from the job's brand preference when switching jobs
  useEffect(() => {
    if (!jobWithClips || !brands) return;
    const jobBrand = brands.find((b: Brand) => String(b.id) === String((jobWithClips as any).brandId));
    setAppendCta((jobBrand as any)?.appendCtaToCopies === true);
  }, [jobWithClips?.id, brands]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const copyWithCta = (text: string, key: string) => {
    const cta = (jobWithClips as any)?.contentCta as string | null | undefined;
    const final = appendCta && cta?.trim() ? `${text}\n\n${cta.trim()}` : text;
    copyToClipboard(final, key);
  };

  const handleRegenerateContent = () => {
    if (!selectedJobId) return;
    regenerateContent.mutate({ id: selectedJobId }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetJobContentQueryKey(selectedJobId), data);
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        toast({ title: "Content Regenerated", description: "All content has been refreshed." });
      },
      onError: () => {
        toast({ title: "Error", description: "Could not regenerate content.", variant: "destructive" });
      },
      throwOnError: false,
    });
  };

  const defaultOutro = outros?.find(o => o.isDefault);

  const form = useForm<z.infer<typeof formSchema>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      youtubeUrl: "",
      clipCount: 9,
      clipDurationSeconds: 45,
      contentCta: "",
      outroId: "none",
      brandId: "",
      includeShorts: true,
    },
  });

  const includeShorts = form.watch("includeShorts");
  const selectedDuration = form.watch("clipDurationSeconds");
  const selectedBrandId = form.watch("brandId");

  // Auto-fill CTA from selected brand
  useEffect(() => {
    if (selectedBrandId && selectedBrandId !== "none") {
      const brand = brands?.find((b: Brand) => String(b.id) === selectedBrandId);
      if (brand?.defaultCta && !form.getValues("contentCta")) {
        form.setValue("contentCta", brand.defaultCta);
      }
    }
  }, [selectedBrandId]);

  useEffect(() => {
    if (defaultOutro && form.getValues("outroId") === "none" && !form.formState.isDirty) {
      form.setValue("outroId", String(defaultOutro.id));
    }
  }, [defaultOutro?.id]);

  // Load Google Fonts for live preview in the font picker
  useEffect(() => {
    const families = GOOGLE_FONTS
      .filter(f => f !== "Poppins")
      .map(f => f.replace(/ /g, "+") + ":wght@400;700")
      .join("&family=");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const payload = {
      youtubeUrl: values.youtubeUrl,
      clipCount: values.includeShorts ? (values.clipCount ?? 9) : 0,
      clipDurationSeconds: values.clipDurationSeconds ?? 45,
      contentCta: values.contentCta?.trim() || undefined,
      outroId: values.outroId && values.outroId !== "none" ? parseInt(values.outroId, 10) : null,
      brandId: values.brandId && values.brandId !== "none" ? parseInt(values.brandId, 10) : null,
    };

    createJob.mutate({ data: payload }, {
      onSuccess: (newJob) => {
        form.reset({
          youtubeUrl: "",
          clipCount: 9,
          clipDurationSeconds: values.clipDurationSeconds,
          contentCta: values.contentCta,
          outroId: values.outroId,
          brandId: values.brandId,
          includeShorts: values.includeShorts,
        });
        setSelectedJobId(newJob.id);
        toast({ title: "Job Created 🚀", description: "Video processing has started." });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      },
      onError: (error: any) => {
        const message =
          error?.data?.error ||
          error?.message?.replace(/^HTTP \d+ [^:]+:\s*/, "") ||
          "Failed to create job.";
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
      },
      throwOnError: false,
    });
  };

  const handleDeleteJob = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setJobToDelete(id);
  };

  const confirmDeleteJob = () => {
    if (jobToDelete === null) return;
    const id = jobToDelete;
    setJobToDelete(null);
    deleteJob.mutate({ id }, {
      onSuccess: () => {
        if (selectedJobId === id) setSelectedJobId(null);
        toast({ title: "Job deleted", description: "The job and all its files have been removed." });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      },
      throwOnError: false,
    });
  };

  const handleUploadOutro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileInputRef.current?.files?.[0]) {
      toast({ title: "Error", description: "Please select a video file.", variant: "destructive" });
      return;
    }
    setIsUploadingOutro(true);
    try {
      const formData = new FormData();
      formData.append("file", fileInputRef.current.files[0]);
      formData.append("name", uploadName || fileInputRef.current.files[0].name);
      formData.append("position", uploadPosition);
      if (uploadCtaText) formData.append("ctaText", uploadCtaText);
      if (uploadCtaStartSeconds !== "") formData.append("ctaStartSeconds", String(uploadCtaStartSeconds));
      const res = await fetch("/api/outros/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      toast({ title: "Outro Uploaded", description: "Your outro has been added." });
      queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      setUploadName(""); setUploadPosition("end"); setUploadCtaText(""); setUploadCtaStartSeconds("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      toast({ title: "Upload Failed", description: "Failed to upload outro.", variant: "destructive" });
    } finally {
      setIsUploadingOutro(false);
    }
  };

  const handleUpdateOutro = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOutroId) return;
    updateOutro.mutate({
      id: editingOutroId,
      data: {
        name: editName,
        position: editPosition,
        ctaText: editCtaText || null,
        ctaStartSeconds: editCtaStartSeconds !== "" ? editCtaStartSeconds : null,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Outro Updated" });
        setEditingOutroId(null);
        queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      },
      throwOnError: false,
    });
  };

  const handleDeleteOutro = (id: number) => {
    deleteOutro.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Outro Deleted" });
        queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      },
      throwOnError: false,
    });
  };

  const handleSetDefaultOutro = (id: number) => {
    setDefaultOutro.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Default Outro Set" });
        queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      },
      throwOnError: false,
    });
  };

  const handleCreateBrand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim()) return;
    createBrand.mutate({
      data: {
        name: newBrandName.trim(),
        voiceStyle: newBrandVoice.trim() || null,
        defaultCta: newBrandCta.trim() || null,
        appendCtaToCopies: newBrandAppendCta,
        website: newBrandWebsite.trim() || null,
        exportFolderUrl: newBrandExportFolder.trim() || null,
        fontFamily: newBrandFont,
        primaryColor: newBrandPrimary,
        secondaryColor: newBrandSecondary,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Brand Created", description: `${newBrandName} has been added.` });
        setNewBrandName(""); setNewBrandVoice(""); setNewBrandCta(""); setNewBrandAppendCta(false); setNewBrandWebsite(""); setNewBrandExportFolder("");
        setNewBrandFont("Poppins"); setNewBrandPrimary("#f21178"); setNewBrandSecondary("#7c3aed");
        setIsAddingBrand(false);
        queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to create brand.", variant: "destructive" }),
      throwOnError: false,
    });
  };

  const handleUpdateBrand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBrandId) return;
    updateBrand.mutate({
      id: editingBrandId,
      data: {
        name: editBrandName.trim() || undefined,
        voiceStyle: editBrandVoice.trim() || null,
        defaultCta: editBrandCta.trim() || null,
        appendCtaToCopies: editBrandAppendCta,
        website: editBrandWebsite.trim() || null,
        exportFolderUrl: editBrandExportFolder.trim() || null,
        fontFamily: editBrandFont,
        primaryColor: editBrandPrimary,
        secondaryColor: editBrandSecondary,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Brand Updated" });
        setEditingBrandId(null);
        queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      },
      throwOnError: false,
    });
  };

  const handleDeleteBrand = (id: number) => {
    deleteBrand.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Brand Deleted" });
        if (form.getValues("brandId") === String(id)) form.setValue("brandId", "");
        queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      },
      throwOnError: false,
    });
  };

  const openEditBrand = (brand: any) => {
    setEditingBrandId(brand.id);
    setEditBrandName(brand.name);
    setEditBrandVoice(brand.voiceStyle ?? "");
    setEditBrandCta(brand.defaultCta ?? "");
    setEditBrandAppendCta((brand as any).appendCtaToCopies === true);
    setEditBrandWebsite(brand.website ?? "");
    setEditBrandExportFolder((brand as any).exportFolderUrl ?? "");
    setEditBrandFont(brand.fontFamily ?? "Poppins");
    setEditBrandPrimary(brand.primaryColor ?? "#f21178");
    setEditBrandSecondary(brand.secondaryColor ?? "#7c3aed");
  };

  const handleBrandFileUpload = async (brandId: number, type: "logo" | "short-form-outro" | "intro-audio" | "outro-audio", file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/brands/${brandId}/${type}`, { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");
    queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
  };

  const isHealthy = health?.status === "ok";

  return (
    <>
    <AlertDialog open={jobToDelete !== null} onOpenChange={(open) => { if (!open) setJobToDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this job?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the job, all its clips, carousel images, and any other generated files. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={confirmDeleteJob}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <div className={`${sidebarOpen ? "flex" : "hidden"} md:flex fixed md:static inset-y-0 left-0 z-40 md:z-10 w-80 border-r border-border bg-card/95 md:bg-card/40 flex-col shrink-0`}>
        {/* Logo / header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Content Rocket" className="h-10 w-10 rounded-xl object-cover" />
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">TAW Media</span>
              <span className="text-sm font-bold text-foreground">Content Rocket</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="h-6 w-6 flex items-center justify-center rounded-full bg-muted/50 border border-border">
                  <Activity className={`w-3.5 h-3.5 ${isHealthy ? "text-emerald-500" : "text-muted-foreground"}`} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right"><p className="text-xs">{isHealthy ? "API Connected" : "Connecting..."}</p></TooltipContent>
            </Tooltip>
            <UserButton
              userProfileUrl={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/app/profile`}
              userProfileMode="navigation"
              appearance={{
                elements: {
                  avatarBox: "h-7 w-7",
                  userButtonPopoverCard: "bg-[#0d0920] border border-[#2a1e4a] shadow-2xl shadow-black/60",
                  userButtonPopoverMain: "bg-[#0d0920]",
                  userButtonPopoverFooter: "bg-[#090717] border-t border-[#2a1e4a]",
                  userButtonPopoverActionButton: "hover:bg-[#16102a] text-white",
                  userButtonPopoverActionButtonText: "!text-white font-medium",
                  userButtonPopoverActionButtonIcon: "text-slate-400",
                  userButtonPopoverUserPreview: "border-b border-[#2a1e4a]",
                  userPreviewMainIdentifier: "!text-white font-semibold",
                  userPreviewSecondaryIdentifier: "!text-slate-400",
                },
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="projects" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-4 pb-0">
            <TabsList className="w-full grid grid-cols-3 bg-muted/50 border border-border/50 h-9">
              <TabsTrigger value="projects" className="text-[11px] font-semibold">Projects</TabsTrigger>
              <TabsTrigger value="outros" className="text-[11px] font-semibold">Outros</TabsTrigger>
              <TabsTrigger value="brands" className="text-[11px] font-semibold">Brands</TabsTrigger>
            </TabsList>
          </div>

          {/* Projects tab */}
          <TabsContent value="projects" className="flex-1 overflow-hidden m-0 border-none outline-none">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-1.5">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-4 px-1 flex items-center gap-2">
                  Recent Projects <div className="h-px bg-border flex-1" />
                </div>
                {isJobsLoading ? (
                  <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary/50" /></div>
                ) : jobs && jobs.length > 0 ? (
                  jobs.map(job => (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-all duration-200 border group ${
                        selectedJobId === job.id
                          ? "bg-primary/5 border-primary/30 shadow-[inset_0_0_20px_rgba(242,17,120,0.04)]"
                          : "bg-card/30 border-transparent hover:bg-muted/40 hover:border-border/50"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1.5 gap-1">
                        <span className="font-medium text-sm min-w-0 flex-1 text-foreground/90 leading-snug">
                          {job.videoTitle || (
                            <span className="text-[11px] font-mono text-muted-foreground break-all">{job.youtubeUrl}</span>
                          )}
                        </span>
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 -mt-0.5 -mr-1 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-opacity"
                          onClick={(e) => handleDeleteJob(e, job.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <Badge variant="outline" className={`px-1.5 py-0.5 text-[10px] font-medium ${getStatusColor(job.status)}`}>
                          {getStatusLabel(job.status)}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground/60">
                          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      {!["completed", "failed"].includes(job.status) && (
                        <Progress value={getStatusProgress(job.status)} className="h-0.5 mt-3 bg-muted/50" indicatorClassName="bg-primary/70" />
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 px-4 text-sm text-muted-foreground/60 flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-3">
                      <Layers className="w-5 h-5 opacity-40" />
                    </div>
                    No projects yet.
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Outros tab */}
          <TabsContent value="outros" className="flex-1 overflow-hidden m-0 border-none outline-none">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1 flex items-center gap-2">
                  Outro Library <div className="h-px bg-border flex-1" />
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full border-dashed border-2 hover:bg-primary/5 hover:text-primary hover:border-primary/30 h-auto py-3 transition-all">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Upload className="w-4 h-4" />
                        <span className="text-xs font-semibold">Upload Outro</span>
                      </div>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader><DialogTitle>Upload New Outro</DialogTitle></DialogHeader>
                    <form onSubmit={handleUploadOutro} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Video File (MP4 or MOV)</Label>
                        <Input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" ref={fileInputRef} required className="cursor-pointer file:cursor-pointer file:bg-primary/10 file:text-primary file:border-0 file:rounded-md file:mr-4 file:px-3 file:py-1 text-sm" />
                      </div>
                      <div className="space-y-2">
                        <Label>Name (Optional)</Label>
                        <Input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="e.g. Subscribe Banner" />
                      </div>
                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={uploadPosition} onValueChange={(v: "beginning" | "end") => setUploadPosition(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="beginning">Beginning (Intro)</SelectItem>
                            <SelectItem value="end">End (Outro)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>CTA Text</Label>
                          <Input value={uploadCtaText} onChange={e => setUploadCtaText(e.target.value)} placeholder="Subscribe!" />
                        </div>
                        <div className="space-y-2">
                          <Label>CTA Start (sec)</Label>
                          <Input type="number" step="0.5" min="0" value={uploadCtaStartSeconds} onChange={e => setUploadCtaStartSeconds(e.target.value ? parseFloat(e.target.value) : "")} placeholder="2.5" />
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={isUploadingOutro}>
                        {isUploadingOutro ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                        {isUploadingOutro ? "Uploading..." : "Upload Outro"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>

                <div className="space-y-2">
                  {isOutrosLoading ? (
                    <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-primary/50" /></div>
                  ) : outros && outros.length > 0 ? (
                    outros.map(outro => (
                      <div key={outro.id} className={`p-3 rounded-lg border bg-card/30 group relative transition-all ${outro.isDefault ? "border-primary/40" : "border-border/50"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <h4 className="text-sm font-semibold truncate">{outro.name}</h4>
                              {outro.isDefault && <Star className="w-3.5 h-3.5 text-primary fill-primary shrink-0" />}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 uppercase bg-muted/60">{outro.position}</Badge>
                              {outro.ctaText && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border/50 text-muted-foreground truncate max-w-[100px]">
                                  CTA: {outro.ctaText}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2">
                          {!outro.isDefault && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-primary/10 hover:text-primary" onClick={() => handleSetDefaultOutro(outro.id)}>
                              <Star className="w-3 h-3" />
                            </Button>
                          )}
                          <Dialog open={editingOutroId === outro.id} onOpenChange={(open) => !open && setEditingOutroId(null)}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-muted" onClick={() => {
                                setEditingOutroId(outro.id);
                                setEditName(outro.name);
                                setEditPosition(outro.position as "beginning" | "end");
                                setEditCtaText(outro.ctaText ?? "");
                                setEditCtaStartSeconds(outro.ctaStartSeconds != null ? Number(outro.ctaStartSeconds) : "");
                              }}>
                                <Edit2 className="w-3 h-3" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                              <DialogHeader><DialogTitle>Edit Outro</DialogTitle></DialogHeader>
                              <form onSubmit={handleUpdateOutro} className="space-y-4 pt-4">
                                <div className="space-y-2">
                                  <Label>Name</Label>
                                  <Input value={editName} onChange={e => setEditName(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                  <Label>Position</Label>
                                  <Select value={editPosition} onValueChange={(v: "beginning" | "end") => setEditPosition(v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="beginning">Beginning (Intro)</SelectItem>
                                      <SelectItem value="end">End (Outro)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-2">
                                    <Label>CTA Text</Label>
                                    <Input value={editCtaText} onChange={e => setEditCtaText(e.target.value)} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>CTA Start (sec)</Label>
                                    <Input type="number" step="0.5" min="0" value={editCtaStartSeconds} onChange={e => setEditCtaStartSeconds(e.target.value ? parseFloat(e.target.value) : "")} />
                                  </div>
                                </div>
                                <Button type="submit" className="w-full" disabled={updateOutro.isPending}>
                                  {updateOutro.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Settings className="w-4 h-4 mr-2" />}
                                  Save Settings
                                </Button>
                              </form>
                            </DialogContent>
                          </Dialog>
                          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDeleteOutro(outro.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-xs text-muted-foreground/60 bg-card/20 rounded-lg border border-dashed border-border/50">
                      No outros uploaded.
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Brands tab */}
          <TabsContent value="brands" className="flex-1 overflow-hidden m-0 border-none outline-none">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1 flex items-center gap-2">
                  Brand Profiles <div className="h-px bg-border flex-1" />
                </div>

                {/* Add brand button / form */}
                {!isAddingBrand ? (
                  <Button
                    variant="outline"
                    className="w-full border-dashed border-2 hover:bg-primary/5 hover:text-primary hover:border-primary/30 h-auto py-3 transition-all"
                    onClick={() => setIsAddingBrand(true)}
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Plus className="w-4 h-4" />
                      <span className="text-xs font-semibold">Add Brand</span>
                    </div>
                  </Button>
                ) : (
                  <form onSubmit={handleCreateBrand} className="space-y-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                    <p className="text-xs font-semibold text-foreground">New Brand</p>
                    <div className="space-y-2">
                      <Label className="text-xs">Brand Name *</Label>
                      <Input value={newBrandName} onChange={e => setNewBrandName(e.target.value)} placeholder="e.g. TAW Media" className="h-8 text-xs" required />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Website URL</Label>
                      <Input value={newBrandWebsite} onChange={e => setNewBrandWebsite(e.target.value)} placeholder="e.g. https://tawmedia.com" className="h-8 text-xs" type="url" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Export Folder URL</Label>
                      <Input value={newBrandExportFolder} onChange={e => setNewBrandExportFolder(e.target.value)} placeholder="Google Drive or Dropbox folder link" className="h-8 text-xs" type="url" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Voice / Tone Style</Label>
                      <Textarea value={newBrandVoice} onChange={e => setNewBrandVoice(e.target.value)} placeholder="e.g. Direct, no-fluff, motivational. Write like a founder talking to peers." className="text-xs min-h-[60px] resize-none" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Default CTA</Label>
                      <Input value={newBrandCta} onChange={e => setNewBrandCta(e.target.value)} placeholder="e.g. Book a free strategy call →" className="h-8 text-xs" />
                      <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
                        <input type="checkbox" checked={newBrandAppendCta} onChange={e => setNewBrandAppendCta(e.target.checked)} className="w-3.5 h-3.5 accent-[#f21178] cursor-pointer" />
                        <span className="text-[11px] text-muted-foreground">Auto-append CTA to all copied text</span>
                      </label>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Font Family</Label>
                      <Select value={newBrandFont} onValueChange={setNewBrandFont}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {GOOGLE_FONTS.map(font => (
                            <SelectItem key={font} value={font} style={{ fontFamily: font }} className="text-xs">
                              {font}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Brand Colors</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Primary</p>
                          <div className="flex items-center gap-2">
                            <input type="color" value={newBrandPrimary} onChange={e => setNewBrandPrimary(e.target.value)} className="h-8 w-8 rounded cursor-pointer border border-border/50 p-0.5 bg-transparent" />
                            <span className="text-[10px] font-mono text-muted-foreground">{newBrandPrimary}</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Secondary</p>
                          <div className="flex items-center gap-2">
                            <input type="color" value={newBrandSecondary} onChange={e => setNewBrandSecondary(e.target.value)} className="h-8 w-8 rounded cursor-pointer border border-border/50 p-0.5 bg-transparent" />
                            <span className="text-[10px] font-mono text-muted-foreground">{newBrandSecondary}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" className="flex-1 h-8 text-xs" disabled={createBrand.isPending}>
                        {createBrand.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                        Save Brand
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setIsAddingBrand(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                {/* Brand list */}
                <div className="space-y-2">
                  {isBrandsLoading ? (
                    <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-primary/50" /></div>
                  ) : brands && brands.length > 0 ? (
                    brands.map((brand: Brand) => (
                      <div key={brand.id} className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
                        {/* Brand header row */}
                        <div
                          className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/30 transition-colors group"
                          onClick={() => setExpandedBrandId(expandedBrandId === brand.id ? null : brand.id)}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-[#f21178]/20 flex items-center justify-center shrink-0 border border-border/50">
                            {brand.logoPath ? (
                              <img src={`/api/brands/${brand.id}/logo`} alt={brand.name} className="w-full h-full rounded-full object-cover" />
                            ) : (
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{brand.name}</p>
                            {brand.voiceStyle && (
                              <p className="text-[10px] text-muted-foreground truncate">{brand.voiceStyle.slice(0, 40)}{brand.voiceStyle.length > 40 ? "…" : ""}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleDeleteBrand(brand.id); }}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                            {expandedBrandId === brand.id ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                          </div>
                        </div>

                        {/* Expanded brand detail */}
                        {expandedBrandId === brand.id && (
                          <div className="border-t border-border/50 p-3 bg-muted/10 space-y-3">
                            {editingBrandId === brand.id ? (
                              <form onSubmit={handleUpdateBrand} className="space-y-3">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Name</Label>
                                  <Input value={editBrandName} onChange={e => setEditBrandName(e.target.value)} className="h-7 text-xs" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Website URL</Label>
                                  <Input value={editBrandWebsite} onChange={e => setEditBrandWebsite(e.target.value)} placeholder="https://tawmedia.com" className="h-7 text-xs" type="url" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Export Folder URL</Label>
                                  <Input value={editBrandExportFolder} onChange={e => setEditBrandExportFolder(e.target.value)} placeholder="Google Drive or Dropbox folder link" className="h-7 text-xs" type="url" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Voice Style</Label>
                                  <Textarea value={editBrandVoice} onChange={e => setEditBrandVoice(e.target.value)} className="text-xs min-h-[50px] resize-none" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Default CTA</Label>
                                  <Input value={editBrandCta} onChange={e => setEditBrandCta(e.target.value)} className="h-7 text-xs" />
                                  <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
                                    <input type="checkbox" checked={editBrandAppendCta} onChange={e => setEditBrandAppendCta(e.target.checked)} className="w-3.5 h-3.5 accent-[#f21178] cursor-pointer" />
                                    <span className="text-[11px] text-muted-foreground">Auto-append CTA to all copied text</span>
                                  </label>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Font Family</Label>
                                  <Select value={editBrandFont} onValueChange={setEditBrandFont}>
                                    <SelectTrigger className="h-7 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-56">
                                      {GOOGLE_FONTS.map(font => (
                                        <SelectItem key={font} value={font} style={{ fontFamily: font }} className="text-xs">
                                          {font}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Brand Colors</Label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-0.5">
                                      <p className="text-[10px] text-muted-foreground">Primary</p>
                                      <div className="flex items-center gap-1.5">
                                        <input type="color" value={editBrandPrimary} onChange={e => setEditBrandPrimary(e.target.value)} className="h-7 w-7 rounded cursor-pointer border border-border/50 p-0.5 bg-transparent" />
                                        <span className="text-[9px] font-mono text-muted-foreground">{editBrandPrimary}</span>
                                      </div>
                                    </div>
                                    <div className="space-y-0.5">
                                      <p className="text-[10px] text-muted-foreground">Secondary</p>
                                      <div className="flex items-center gap-1.5">
                                        <input type="color" value={editBrandSecondary} onChange={e => setEditBrandSecondary(e.target.value)} className="h-7 w-7 rounded cursor-pointer border border-border/50 p-0.5 bg-transparent" />
                                        <span className="text-[9px] font-mono text-muted-foreground">{editBrandSecondary}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <Button type="submit" size="sm" className="flex-1 h-9 text-xs font-semibold bg-[#f21178] hover:bg-[#d91068] text-white border-0 shadow-md shadow-[#f21178]/20" disabled={updateBrand.isPending}>
                                    {updateBrand.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                                    {updateBrand.isPending ? "Saving…" : "Save Brand"}
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="h-9 text-xs px-3" onClick={() => setEditingBrandId(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              </form>
                            ) : (
                              <>
                                {brand.website && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Website</p>
                                    <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">{brand.website}</a>
                                  </div>
                                )}
                                {(brand as any).exportFolderUrl && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Export Folder</p>
                                    <a href={(brand as any).exportFolderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:underline truncate block flex items-center gap-1">
                                      <FolderOpen className="w-3 h-3 shrink-0" /> Open Folder
                                    </a>
                                  </div>
                                )}
                                {(brand.primaryColor || brand.secondaryColor || brand.fontFamily) && (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {brand.primaryColor && (
                                      <div className="flex items-center gap-1">
                                        <div className="w-3.5 h-3.5 rounded-full border border-border/50" style={{ backgroundColor: brand.primaryColor }} />
                                        <span className="text-[10px] font-mono text-muted-foreground">{brand.primaryColor}</span>
                                      </div>
                                    )}
                                    {brand.secondaryColor && (
                                      <div className="flex items-center gap-1">
                                        <div className="w-3.5 h-3.5 rounded-full border border-border/50" style={{ backgroundColor: brand.secondaryColor }} />
                                        <span className="text-[10px] font-mono text-muted-foreground">{brand.secondaryColor}</span>
                                      </div>
                                    )}
                                    {brand.fontFamily && (
                                      <span className="text-[10px] text-muted-foreground" style={{ fontFamily: brand.fontFamily }}>
                                        {brand.fontFamily}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {brand.defaultCta && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Default CTA</p>
                                    <p className="text-xs text-foreground/80">{brand.defaultCta}</p>
                                    {(brand as any).appendCtaToCopies && (
                                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                                        <Zap className="w-2.5 h-2.5" /> Auto-appended to copies
                                      </span>
                                    )}
                                  </div>
                                )}
                                <Button size="sm" variant="outline" className="h-7 text-[11px] w-full gap-1.5" onClick={() => openEditBrand(brand)}>
                                  <Edit2 className="w-3 h-3" /> Edit Settings
                                </Button>
                              </>
                            )}

                            {/* File uploads */}
                            <div className="space-y-2 pt-1">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Media Files</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {(["logo", "short-form-outro", "intro-audio", "outro-audio"] as const).map((type) => {
                                  const icons = { logo: Image, "short-form-outro": Film, "intro-audio": Mic, "outro-audio": Mic };
                                  const labels = { logo: "Logo", "short-form-outro": "Short Form Outro", "intro-audio": "Podcast Intro", "outro-audio": "Podcast Outro" };
                                  const accepts = { logo: "image/*", "short-form-outro": "video/*", "intro-audio": "audio/*", "outro-audio": "audio/*" };
                                  const Icon = icons[type];
                                  const hasFile = type === "logo" ? !!brand.logoPath : type === "short-form-outro" ? !!(brand as any).shortFormOutroPath : type === "intro-audio" ? !!brand.introAudioPath : !!brand.outroAudioPath;
                                  return (
                                    <label key={type} className={`flex flex-col items-center gap-1 p-2 rounded border cursor-pointer transition-all hover:bg-primary/5 hover:border-primary/30 ${hasFile ? "border-emerald-500/30 bg-emerald-500/5" : "border-dashed border-border/50 bg-card/30"}`}>
                                      <Icon className={`w-4 h-4 ${hasFile ? "text-emerald-500" : "text-muted-foreground"}`} />
                                      <span className="text-[9px] font-medium text-muted-foreground text-center leading-tight">{labels[type]}</span>
                                      <input type="file" accept={accepts[type]} className="hidden" onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        try {
                                          await handleBrandFileUpload(brand.id, type, file);
                                          toast({ title: `${labels[type]} uploaded` });
                                        } catch {
                                          toast({ title: "Upload failed", variant: "destructive" });
                                        }
                                        e.target.value = "";
                                      }} />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-xs text-muted-foreground/60 bg-card/20 rounded-lg border border-dashed border-border/50">
                      No brands yet. Add one to customise content voice.
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* ── Account footer ─────────────────────────────────────── */}
        <div className="border-t border-border p-3 shrink-0">
          <button
            onClick={() => setLocation("/app/profile")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-all group text-left"
          >
            <div className="relative shrink-0">
              {user?.imageUrl ? (
                <img src={user.imageUrl} alt="avatar" className="h-8 w-8 rounded-full object-cover ring-2 ring-border group-hover:ring-primary/40 transition-all" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center ring-2 ring-border group-hover:ring-primary/40 transition-all">
                  <User className="w-4 h-4 text-primary/70" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-foreground truncate leading-tight">
                  {user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "Account"}
                </p>
                {isAdmin && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase bg-[#f21178]/15 text-[#f21178] border border-[#f21178]/25">
                    Admin
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate leading-tight">
                {user?.primaryEmailAddress?.emailAddress ?? "Manage account"}
              </p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
          </button>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative z-0 bg-background/50 min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card/40 sticky top-0 z-20">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Content Rocket" className="h-8 w-8 rounded-lg object-cover" />
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">TAW Media</span>
              <span className="text-xs font-bold text-foreground">Content Rocket</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <UserButton
              userProfileUrl={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/app/profile`}
              userProfileMode="navigation"
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8",
                  userButtonPopoverCard: "bg-[#0d0920] border border-[#2a1e4a] shadow-2xl shadow-black/60",
                  userButtonPopoverMain: "bg-[#0d0920]",
                  userButtonPopoverFooter: "bg-[#090717] border-t border-[#2a1e4a]",
                  userButtonPopoverActionButton: "hover:bg-[#16102a] text-white",
                  userButtonPopoverActionButtonText: "!text-white font-medium",
                  userButtonPopoverActionButtonIcon: "text-slate-400",
                  userButtonPopoverUserPreview: "border-b border-[#2a1e4a]",
                  userPreviewMainIdentifier: "!text-white font-semibold",
                  userPreviewSecondaryIdentifier: "!text-slate-400",
                },
              }}
            />
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* ── Form panel ── */}
        <div className="p-4 md:p-5 border-b border-border bg-card/20 backdrop-blur-md sticky top-[57px] md:top-0 z-20">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3 max-w-4xl mx-auto w-full">

              {/* Row 1: URL + submit button */}
              <div className="flex flex-col sm:flex-row gap-3 items-start w-full">
                <FormField
                  control={form.control}
                  name="youtubeUrl"
                  render={({ field }) => (
                    <FormItem className="flex-1 w-full">
                      <FormControl>
                        <div className="relative group">
                          <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                          <Input
                            placeholder="Paste YouTube URL here..."
                            className="pl-12 bg-background border-border/60 hover:border-border focus-visible:ring-primary/30 focus-visible:border-primary/50 text-base h-13 shadow-sm transition-all rounded-xl"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-xs ml-1" />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  size="lg"
                  disabled={createJob.isPending}
                  style={{ background: "linear-gradient(135deg, #7c3aed, #c026d3, #f21178)" }}
                  className="h-13 px-7 text-base shadow-[0_4px_20px_0_rgba(124,58,237,0.35)] hover:shadow-[0_6px_24px_rgba(242,17,120,0.4)] hover:-translate-y-0.5 transition-all rounded-xl font-bold active:translate-y-0 shrink-0 text-white border-0 w-full sm:w-auto whitespace-nowrap"
                >
                  {createJob.isPending
                    ? <><Loader2 className="w-5 h-5 animate-spin mr-2" />Starting...</>
                    : <><Zap className="w-5 h-5 mr-2" />Multiply My Content 🚀</>
                  }
                </Button>
              </div>

              {/* Row 2: Options */}
              <div className="flex flex-wrap gap-3 items-center">

                {/* Clip duration pills */}
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground font-medium shrink-0">Clip length:</span>
                  <div className="flex gap-1">
                    {CLIP_DURATIONS.map(dur => (
                      <button
                        key={dur}
                        type="button"
                        onClick={() => form.setValue("clipDurationSeconds", dur)}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                          selectedDuration === dur
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        {dur}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-4 w-px bg-border/60 hidden sm:block" />

                {/* Shorts toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => form.setValue("includeShorts", !includeShorts)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none ${includeShorts ? "bg-primary border-primary" : "bg-muted border-muted-foreground/30"}`}
                  >
                    <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${includeShorts ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                  <span className="text-xs text-muted-foreground font-medium">Shorts clips</span>
                  {includeShorts && (
                    <FormField
                      control={form.control}
                      name="clipCount"
                      render={({ field }) => (
                        <FormItem className="w-16 m-0">
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              max={10}
                              className="h-7 text-xs text-center px-2 font-mono bg-background border-border/60"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <div className="h-4 w-px bg-border/60 hidden sm:block" />

                {/* Outro select */}
                <FormField
                  control={form.control}
                  name="outroId"
                  render={({ field }) => (
                    <FormItem className="w-40 m-0">
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-8 bg-background border-border/60 text-xs">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <Film className="w-3.5 h-3.5 shrink-0" />
                              <SelectValue placeholder="No Outro" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Outro</SelectItem>
                            {outros?.map(o => (
                              <SelectItem key={o.id} value={String(o.id)}>
                                {o.name}{o.isDefault ? " ✦" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Brand select — required */}
                <FormField
                  control={form.control}
                  name="brandId"
                  render={({ field }) => (
                    <FormItem className="w-44 m-0">
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className={`h-8 bg-background text-xs transition-colors ${!field.value ? "border-[#f21178]/60 ring-1 ring-[#f21178]/30" : "border-border/60"}`}>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <Building2 className={`w-3.5 h-3.5 shrink-0 ${!field.value ? "text-[#f21178]" : ""}`} />
                              <SelectValue placeholder="Select Brand *" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {brands?.map((b: Brand) => (
                              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                            ))}
                            {!brands?.length && (
                              <div className="px-3 py-2 text-xs text-muted-foreground">No brands yet — add one in the Brands tab</div>
                            )}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage className="text-[10px] ml-0.5" />
                    </FormItem>
                  )}
                />

                {/* CTA input */}
                <FormField
                  control={form.control}
                  name="contentCta"
                  render={({ field }) => (
                    <FormItem className="flex-1 min-w-[180px] m-0">
                      <FormControl>
                        <div className="relative group">
                          <Megaphone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                          <Input
                            placeholder="CTA text (optional)"
                            className="pl-9 h-8 text-xs bg-background border-border/60 hover:border-border focus-visible:ring-primary/30"
                            {...field}
                          />
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </div>

        {/* ── Content area ── */}
        <ScrollArea className="flex-1 p-5 lg:p-8">
          {!selectedJobId ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground max-w-md mx-auto text-center mt-16">
              <div className="w-24 h-24 bg-card/50 rounded-2xl flex items-center justify-center mb-8 border border-border/50 shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-violet-500/10 via-transparent to-[#f21178]/10" />
                <FileVideo className="w-10 h-10 text-muted-foreground/40 relative z-10" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-3">Workspace Empty</h2>
              <p className="text-sm text-muted-foreground/70 leading-relaxed">
                Paste a YouTube URL and hit <span className="text-foreground font-semibold">Multiply My Content</span>. The AI will analyse the video, extract the best moments as vertical shorts, and generate a full content pack — blog, newsletter, social posts, carousel slides, and more.
              </p>
            </div>
          ) : jobWithClips ? (
            <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

              {/* Job header */}
              <div className="mb-8">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2 text-foreground">
                      {jobWithClips.videoTitle || "Processing Video…"}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <a
                        href={jobWithClips.youtubeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary/90 hover:text-primary flex items-center gap-1.5 bg-primary/10 px-2.5 py-1 rounded-lg font-medium transition-colors text-xs"
                      >
                        <PlayCircle className="w-3.5 h-3.5" /> Source Video
                      </a>
                      <span className="text-muted-foreground text-xs flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg">
                        <Layers className="w-3.5 h-3.5" />
                        {(jobWithClips as any).clipCount === 0 ? "No shorts" : `${(jobWithClips as any).clipCount} clips`}
                      </span>
                      <span className="text-muted-foreground text-xs flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg">
                        <Clock className="w-3.5 h-3.5" />
                        {(jobWithClips as any).clipDurationSeconds ?? 45}s clips
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`${getStatusColor(jobWithClips.status)} px-3 py-1.5 text-xs font-semibold border`}>
                      {getStatusLabel(jobWithClips.status)}
                    </Badge>
                    {/* Export All ZIP */}
                    {jobWithClips.status === "completed" && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300" asChild>
                        <a href={`/api/jobs/${jobWithClips.id}/download-all`} download>
                          <Package className="w-3.5 h-3.5" /> Export All (.zip)
                        </a>
                      </Button>
                    )}
                    {/* Podcast download */}
                    {(jobWithClips as any).hasPodcast && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" asChild>
                        <a href={`/api/jobs/${jobWithClips.id}/download-podcast`} download>
                          <Mic className="w-3.5 h-3.5" /> Podcast MP3
                        </a>
                      </Button>
                    )}
                    {/* Facebook video */}
                    {(jobWithClips as any).hasFacebookVideo && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-[#1877F2]/40 text-[#1877F2] hover:bg-[#1877F2]/10" asChild>
                        <a href={`/api/jobs/${jobWithClips.id}/download-facebook`} download>
                          <Download className="w-3.5 h-3.5" /> Facebook 1:1
                        </a>
                      </Button>
                    )}
                    {/* Open Export Folder */}
                    {(() => {
                      const jobBrand = brands?.find((b: Brand) => String(b.id) === String((jobWithClips as any).brandId));
                      const folderUrl = (jobBrand as any)?.exportFolderUrl;
                      return folderUrl ? (
                        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" asChild>
                          <a href={folderUrl} target="_blank" rel="noopener noreferrer">
                            <FolderOpen className="w-3.5 h-3.5" /> Export Folder
                          </a>
                        </Button>
                      ) : null;
                    })()}
                  </div>
                </div>

                {!["completed", "failed"].includes(jobWithClips.status) && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground font-medium">{getStatusLabel(jobWithClips.status)}…</span>
                      <span className="text-xs font-mono text-muted-foreground">{getStatusProgress(jobWithClips.status)}%</span>
                    </div>
                    <Progress
                      value={getStatusProgress(jobWithClips.status)}
                      className="h-1.5 bg-muted/50"
                      indicatorClassName="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-[#f21178] transition-all duration-1000"
                    />
                  </div>
                )}

                {jobWithClips.status === "rendering" && jobWithClips.errorMessage && (
                  <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/15">
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    <p className="text-sm text-muted-foreground">{jobWithClips.errorMessage}</p>
                  </div>
                )}

                {jobWithClips.status === "failed" && (
                  <div className="mt-6 bg-destructive/5 border border-destructive/20 rounded-xl p-5 text-destructive flex gap-4">
                    <div className="bg-destructive/10 p-2 rounded-full h-fit">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">Processing Failed</h4>
                      <p className="text-sm text-destructive/80 leading-relaxed">{jobWithClips.errorMessage || "An unknown error occurred."}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Generated Content section */}
              {jobWithClips.status === "completed" && (
                <div className="mb-12">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <FileText className="w-5 h-5 text-primary" />
                      Generated Content Pack
                    </h3>
                    {jobWithClips.hasContent && (
                      <div className="flex items-center gap-2">
                        {(jobWithClips as any)?.contentCta && (
                          <Button
                            variant={appendCta ? "default" : "outline"}
                            size="sm"
                            className={`h-8 text-xs gap-1.5 transition-all ${appendCta ? "bg-[#f21178] hover:bg-[#d91068] text-white border-[#f21178] shadow-sm shadow-[#f21178]/20" : "border-border/60 text-muted-foreground"}`}
                            onClick={() => setAppendCta(prev => !prev)}
                            title={appendCta ? "CTA will be appended to copied text — click to disable" : "Click to auto-append your CTA to copied text"}
                          >
                            <Megaphone className="w-3.5 h-3.5" />
                            CTA {appendCta ? "On" : "Off"}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRegenerateContent}
                          disabled={regenerateContent.isPending}
                          className="h-8 text-xs gap-1.5 border-border/60"
                        >
                          {regenerateContent.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Regenerate
                        </Button>
                      </div>
                    )}
                  </div>

                  {!jobWithClips.hasContent ? (
                    <div className="rounded-xl border border-dashed border-border bg-card/20 p-10 flex flex-col items-center text-center gap-4">
                      <Loader2 className="w-8 h-8 animate-spin text-primary/60" />
                      <div>
                        <p className="font-semibold text-sm mb-1">Generating content…</p>
                        <p className="text-xs text-muted-foreground max-w-xs">Creating your full content pack: blog, thread, newsletter, social article, quotes, and carousel slides.</p>
                      </div>
                    </div>
                  ) : isContentLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-7 h-7 animate-spin text-primary/40" />
                    </div>
                  ) : jobContent ? (
                    <Tabs defaultValue="blog" className="w-full">
                      <TabsList className="bg-muted/50 border border-border/50 mb-6 h-10 flex flex-wrap gap-0.5">
                        <TabsTrigger value="blog" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                          <BookOpen className="w-3.5 h-3.5" /> Blog
                        </TabsTrigger>
                        <TabsTrigger value="thread" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                          <AtSign className="w-3.5 h-3.5" /> Thread
                        </TabsTrigger>
                        <TabsTrigger value="social" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                          <Globe className="w-3.5 h-3.5" /> Social
                        </TabsTrigger>
                        <TabsTrigger value="newsletter" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                          <Mail className="w-3.5 h-3.5" /> Newsletter
                        </TabsTrigger>
                        <TabsTrigger value="quotes" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                          <MessageSquareQuote className="w-3.5 h-3.5" /> Quotes
                        </TabsTrigger>
                        {jobContent.carouselImages?.length > 0 && (
                          <TabsTrigger value="carousel" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                            <Image className="w-3.5 h-3.5" /> Carousel
                          </TabsTrigger>
                        )}
                        {(jobWithClips as any).hasPodcast && (
                          <TabsTrigger value="podcast" className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background">
                            <Mic className="w-3.5 h-3.5" /> Podcast
                          </TabsTrigger>
                        )}
                      </TabsList>

                      {/* Blog */}
                      <TabsContent value="blog" className="m-0">
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                          {jobContent.thumbnailUrl && (
                            <img src={jobContent.thumbnailUrl} alt={jobContent.videoTitle} className="w-full h-44 object-cover border-b border-border" />
                          )}
                          <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">HTML Blog Post</span>
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => copyWithCta(jobContent.blogPost, "blog")}>
                                {copiedKey === "blog" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                {copiedKey === "blog" ? "Copied!" : "Copy HTML"}
                              </Button>
                            </div>
                            {/<(h[1-6]|p|strong|em|ul|li)\b/i.test(jobContent.blogPost) ? (
                              <div className="bg-muted/30 rounded-lg p-5 border border-border/40 max-h-96 overflow-y-auto prose prose-sm prose-invert max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-base prose-h2:mt-5 prose-h3:text-sm prose-h3:mt-4 prose-h3:text-primary prose-p:text-foreground/85 prose-p:leading-relaxed prose-li:text-foreground/85 prose-strong:text-foreground"
                                dangerouslySetInnerHTML={{ __html: jobContent.blogPost }}
                              />
                            ) : (
                              <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono bg-muted/30 rounded-lg p-4 max-h-96 overflow-y-auto text-foreground/80 border border-border/40">{jobContent.blogPost}</pre>
                            )}
                          </div>
                        </div>
                      </TabsContent>

                      {/* Thread */}
                      <TabsContent value="thread" className="m-0">
                        <div className="rounded-xl border border-border bg-card p-6">
                          <div className="flex items-center justify-between mb-5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">X / Threads Posts</span>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => copyWithCta(jobContent.threadPosts.map((p: string) => p.replace(/^Post\s+\d+\s*:\s*/i, "").trim()).join("\n\n---\n\n"), "thread-all")}>
                              {copiedKey === "thread-all" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              Copy All
                            </Button>
                          </div>
                          <div className="space-y-3">
                            {jobContent.threadPosts.map((post: string, i: number) => {
                              const clean = post.replace(/^Post\s+\d+\s*:\s*/i, "").trim();
                              return (
                                <div key={i} className="bg-muted/30 rounded-lg p-4 border border-border/40 group relative">
                                  <div className="flex items-start gap-3">
                                    <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary mt-0.5">{i + 1}</span>
                                    <p className="text-sm leading-relaxed flex-1 text-foreground/85">{clean}</p>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => copyWithCta(clean, `thread-${i}`)}>
                                      {copiedKey === `thread-${i}` ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                                    </Button>
                                  </div>
                                  <div className="flex justify-end mt-2">
                                    <span className={`text-[10px] font-mono ${clean.length > 260 ? "text-orange-500" : "text-muted-foreground/50"}`}>{clean.length} / 280</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </TabsContent>

                      {/* Social */}
                      <TabsContent value="social" className="m-0">
                        <div className="rounded-xl border border-border bg-card p-6">
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Facebook / Quora / LinkedIn</span>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => {
                              const plain = jobContent.socialArticle
                                .replace(/<h2[^>]*>/gi, "\n\n").replace(/<\/h2>/gi, "\n")
                                .replace(/<\/p>/gi, "\n\n").replace(/<li[^>]*>/gi, "• ").replace(/<\/li>/gi, "\n")
                                .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                                .replace(/\n{3,}/g, "\n\n").trim();
                              copyWithCta(plain, "social");
                            }}>
                              {copiedKey === "social" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              Copy Article
                            </Button>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-5 border border-border/40 max-h-[500px] overflow-y-auto">
                            {/<(h2|p|strong|ul|li)\b/i.test(jobContent.socialArticle) ? (
                              <div className="prose prose-sm prose-invert max-w-none prose-headings:font-bold prose-h2:text-base prose-h2:mt-5 prose-p:text-foreground/85 prose-p:leading-relaxed prose-li:text-foreground/85 prose-strong:text-foreground"
                                dangerouslySetInnerHTML={{ __html: jobContent.socialArticle }}
                              />
                            ) : (
                              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{jobContent.socialArticle}</p>
                            )}
                          </div>
                        </div>
                      </TabsContent>

                      {/* Newsletter */}
                      <TabsContent value="newsletter" className="m-0">
                        <div className="rounded-xl border border-border bg-card p-6 space-y-6">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Email Subject Line</span>
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(jobContent.newsletterEmail.subject, "subject")}>
                                {copiedKey === "subject" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                Copy
                              </Button>
                            </div>
                            <div className="bg-muted/30 rounded-lg px-4 py-3 border border-border/40">
                              <p className="text-sm font-semibold text-foreground">{jobContent.newsletterEmail.subject}</p>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">HTML Email Body</span>
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(jobContent.newsletterEmail.body, "newsletter")}>
                                {copiedKey === "newsletter" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                Copy HTML
                              </Button>
                            </div>
                            <div className="rounded-lg border border-border/40 overflow-hidden">
                              <div className="bg-muted/60 border-b border-border/40 px-4 py-2 text-[10px] font-mono text-muted-foreground">Preview (rendered)</div>
                              <div className="bg-white" dangerouslySetInnerHTML={{ __html: jobContent.newsletterEmail.body }} />
                            </div>
                          </div>
                        </div>
                      </TabsContent>

                      {/* Quotes */}
                      <TabsContent value="quotes" className="m-0">
                        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold flex items-center gap-2">
                              <MessageSquareQuote className="w-4 h-4 text-[#f21178]" />
                              Quotes &amp; Captions
                            </h3>
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => {
                              if (!jobContent.quotes?.length) return;
                              const rows = jobContent.quotes.map((q: string, i: number) => {
                                const caption = jobContent.instagramCaptions?.[i] ?? "";
                                return `"${q.replace(/"/g, '""')}","${caption.replace(/"/g, '""')}"`;
                              });
                              const csv = `"Quote","Instagram / TikTok Caption"\n${rows.join("\n")}`;
                              const blob = new Blob([csv], { type: "text/csv" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a"); a.href = url; a.download = `quotes-${jobWithClips.id}.csv`; a.click();
                              URL.revokeObjectURL(url);
                            }}>
                              <Download className="w-3 h-3" /> Export CSV
                            </Button>
                          </div>
                          {jobContent.quotes?.length > 0 ? (
                            <div className="space-y-5">
                              {jobContent.quotes.map((quote: string, i: number) => {
                                const caption = jobContent.instagramCaptions?.[i] ?? "";
                                return (
                                  <div key={i} className="rounded-xl border border-border/60 bg-muted/10 overflow-hidden">
                                    <div className="p-4 border-b border-border/40">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-foreground uppercase tracking-widest">Quote {i + 1}</span>
                                        <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => copyWithCta(quote, `quote-${i}`)}>
                                          {copiedKey === `quote-${i}` ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                                          Copy
                                        </Button>
                                      </div>
                                      <p className="text-sm leading-relaxed text-foreground font-medium italic border-l-2 pl-3" style={{ borderColor: i % 2 === 0 ? "#f21178" : "#7c3aed" }}>
                                        "{quote}"
                                      </p>
                                    </div>
                                    {caption && (
                                      <div className="p-4">
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-bold text-foreground uppercase tracking-widest">Instagram / TikTok Caption</span>
                                          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => copyWithCta(caption, `caption-${i}`)}>
                                            {copiedKey === `caption-${i}` ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                                            Copy
                                          </Button>
                                        </div>
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{caption}</p>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-center py-8 text-muted-foreground text-sm">No quotes available.</div>
                          )}
                        </div>
                      </TabsContent>

                      {/* Carousel */}
                      {jobContent.carouselImages?.length > 0 && (
                        <TabsContent value="carousel" className="m-0">
                          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-bold flex items-center gap-2">
                                <Image className="w-4 h-4 text-[#f21178]" />
                                Carousel Slides
                                <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">{jobContent.carouselImages.length} slides</Badge>
                              </h3>
                              {jobContent.carouselCaption && (
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => copyWithCta(jobContent.carouselCaption, "carousel-caption")}>
                                  {copiedKey === "carousel-caption" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                  Copy Caption
                                </Button>
                              )}
                            </div>

                            {/* Carousel caption */}
                            {jobContent.carouselCaption && (
                              <div className="bg-muted/30 rounded-lg p-4 border border-border/40">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Instagram Caption for Carousel</p>
                                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{jobContent.carouselCaption}</p>
                              </div>
                            )}

                            {/* Slide images grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              {jobContent.carouselImages.map((filename: string, i: number) => (
                                <div key={i} className="group rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
                                  <div className="aspect-square relative overflow-hidden bg-black">
                                    <img
                                      src={`/api/images/${filename}`}
                                      alt={`Carousel slide ${i + 1}`}
                                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                      loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                    <div className="absolute top-2 left-2">
                                      <Badge className="bg-black/60 text-white border-none text-[10px] px-1.5 py-0.5 font-mono">
                                        {i + 1}/{jobContent.carouselImages.length}
                                      </Badge>
                                    </div>
                                  </div>
                                  <div className="p-2">
                                    <Button size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1.5 border-border/50" asChild>
                                      <a href={`/api/images/${filename}`} download={`slide_${i + 1}.png`}>
                                        <Download className="w-3 h-3" /> Download
                                      </a>
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </TabsContent>
                      )}

                      {/* Podcast */}
                      {(jobWithClips as any).hasPodcast && (
                        <TabsContent value="podcast" className="m-0">
                          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                            <div className="flex items-center gap-2">
                              <div className="bg-emerald-500/10 p-2 rounded-lg">
                                <Mic className="w-5 h-5 text-emerald-400" />
                              </div>
                              <div>
                                <h3 className="text-sm font-bold">Podcast Audio</h3>
                                <p className="text-xs text-muted-foreground">Full-length MP3 with brand intro &amp; outro audio</p>
                              </div>
                            </div>
                            <div className="bg-muted/30 rounded-lg border border-border/40 p-4 flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                                  <Mic className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold truncate">{(jobWithClips as any).videoTitle ?? "Podcast Episode"}</p>
                                  <p className="text-xs text-muted-foreground">MP3 Audio File</p>
                                </div>
                              </div>
                              <Button variant="outline" className="gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 shrink-0" asChild>
                                <a href={`/api/jobs/${jobWithClips.id}/download-podcast`} download>
                                  <Download className="w-4 h-4" /> Download MP3
                                </a>
                              </Button>
                            </div>
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  ) : null}
                </div>
              )}

              {/* Clips grid */}
              {jobWithClips.clips && jobWithClips.clips.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Scissors className="w-5 h-5 text-primary" />
                      Vertical Shorts
                      <Badge variant="secondary" className="font-mono text-xs bg-muted/50 text-muted-foreground">
                        {jobWithClips.clips.filter(c => c.status === "completed").length} / {jobWithClips.clips.length}
                      </Badge>
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {jobWithClips.clips.map((clip) => (
                      <Card key={clip.id} className="overflow-hidden border-border/60 shadow-sm hover:shadow-lg transition-all duration-300 bg-card group relative flex flex-col">
                        <div className="aspect-[9/16] bg-black/90 relative flex items-center justify-center overflow-hidden border-b border-border/30">
                          {clip.status === "completed" ? (
                            <>
                              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent z-10 opacity-60 group-hover:opacity-90 transition-opacity" />
                              <div className="absolute inset-0 z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                                <div className="w-14 h-14 rounded-full bg-primary/90 text-white flex items-center justify-center shadow-xl border border-white/20">
                                  <PlayCircle className="w-7 h-7 ml-0.5" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground z-10">
                              <Loader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
                              <span className="text-[10px] font-semibold uppercase tracking-widest">{getStatusLabel(clip.status)}</span>
                            </div>
                          )}
                          <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
                            <Badge className="bg-background/80 text-foreground border border-border/50 font-mono text-[10px] px-2 py-0.5 backdrop-blur-md">
                              {Math.round(clip.durationSeconds)}s
                            </Badge>
                            {jobWithClips.outroId && (
                              <Badge className="bg-primary/90 text-white border-none text-[9px] px-1.5 py-0.5 uppercase">
                                + Outro
                              </Badge>
                            )}
                          </div>
                        </div>
                        <CardHeader className="p-4 pb-2 flex-1">
                          <CardTitle className="text-sm font-semibold line-clamp-2 leading-snug group-hover:text-primary transition-colors">{clip.title}</CardTitle>
                          <CardDescription className="text-xs font-mono text-muted-foreground/60 mt-1.5 flex items-center gap-1">
                            <Scissors className="w-3 h-3" />
                            {Math.floor(clip.startSeconds / 60)}:{String(Math.floor(clip.startSeconds % 60)).padStart(2, "0")} –
                            {Math.floor(clip.endSeconds / 60)}:{String(Math.floor(clip.endSeconds % 60)).padStart(2, "0")}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex flex-col gap-2">
                          {clip.status === "completed" && clip.filePath ? (
                            <Button className="w-full gap-2 h-9 font-medium text-sm" asChild>
                              <a href={`/api/clips/${clip.id}/download`} download>
                                <Download className="w-4 h-4" /> Download (9:16)
                              </a>
                            </Button>
                          ) : clip.status === "failed" ? (
                            <Button variant="outline" className="w-full text-destructive border-destructive/30 h-9" disabled>
                              <AlertCircle className="w-4 h-4 mr-2" /> Failed
                            </Button>
                          ) : (
                            <Button variant="secondary" className="w-full h-9 bg-muted/50 text-muted-foreground cursor-wait" disabled>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Processing
                            </Button>
                          )}
                          {clip.instagramCaption && (
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Instagram Caption</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] gap-1 hover:bg-primary/10 hover:text-primary"
                                  onClick={() => copyWithCta(clip.instagramCaption!, `ig-${clip.id}`)}
                                >
                                  {copiedKey === `ig-${clip.id}` ? (
                                    <><Check className="w-3 h-3" /> Copied</>
                                  ) : (
                                    <><Copy className="w-3 h-3" /> Copy</>
                                  )}
                                </Button>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">{clip.instagramCaption}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* No clips info */}
              {jobWithClips.status === "completed" && jobWithClips.clips && jobWithClips.clips.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/50 bg-card/20 p-8 text-center text-sm text-muted-foreground">
                  <Scissors className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p>No shorts were requested for this job — content only mode.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center mt-32">
              <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
    </>
  );
}
