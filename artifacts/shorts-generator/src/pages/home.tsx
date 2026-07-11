import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
  useListBrandDocuments,
  useUploadBrandDocument,
  useDeleteBrandDocument,
  useListBrandCarouselTemplates,
  useUploadBrandCarouselTemplate,
  useDeleteBrandCarouselTemplate,
  getGetJobQueryKey,
  getListJobsQueryKey,
  getHealthCheckQueryKey,
  getListOutrosQueryKey,
  getListBrandsQueryKey,
  getGetJobContentQueryKey,
  getListBrandDocumentsQueryKey,
  getListBrandCarouselTemplatesQueryKey,
  type Brand,
  type BrandDocument,
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
  Smartphone,
  LayoutGrid,
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
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CLIP_DURATIONS = [15, 30, 45, 60, 90] as const;

const GOOGLE_FONTS = [
  "Poppins", "Montserrat", "Inter", "Roboto", "Oswald",
  "Raleway", "Lato", "Open Sans", "Nunito", "Playfair Display",
  "Space Grotesk", "DM Sans", "Bebas Neue", "Syne", "Plus Jakarta Sans",
] as const;

const formSchema = z.object({
  clipCount: z.coerce.number().min(0).max(10).default(5),
  clipDurationSeconds: z.coerce.number().default(45),
  clipMode: z.enum(["ai", "chapters"]).default("ai"),
  captionsEnabled: z.boolean().default(true),
  captionStyle: z.enum(["classic", "bold", "boxed", "brand"]).default("classic"),
  showTitle: z.boolean().default(true),
  showWatermark: z.boolean().default(true),
  contentCta: z.string().optional(),
  outroId: z.string().optional(),
  brandId: z.string().min(1, { message: "Please select a brand before running" }),
  includeShorts: z.boolean().default(true),
  generatePodcast: z.boolean().default(true),
  manualTranscript: z.string().optional(),
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
  const [mobileFormOpen, setMobileFormOpen] = useState(true);
  const [isUploadingOutro, setIsUploadingOutro] = useState(false);
  const [editingOutroId, setEditingOutroId] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appendCta, setAppendCta] = useState(false);
  const [expandedBrandId, setExpandedBrandId] = useState<number | null>(null);
  const [editingBrandId, setEditingBrandId] = useState<number | null>(null);
  const [isAddingBrand, setIsAddingBrand] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<number | null>(null);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [showMobileInstall, setShowMobileInstall] = useState(false);
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);
  const { canInstall, isIos, isInStandaloneMode, isInstalled, triggerInstall } = usePwaInstall();

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
  const [outroFileName, setOutroFileName] = useState("");
  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState<"beginning" | "end">("end");
  const [editCtaText, setEditCtaText] = useState("");
  const [editCtaStartSeconds, setEditCtaStartSeconds] = useState<number | "">("");
  const [sourceType, setSourceType] = useState<"upload" | "transcript">("upload");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [userVideoTitle, setUserVideoTitle] = useState("");
  const [userVideoDescription, setUserVideoDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeedBps, setUploadSpeedBps] = useState(0);
  const uploadStartTimeRef = useRef<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [playingClipId, setPlayingClipId] = useState<number | null>(null);
  const [chapters, setChapters] = useState<{ title: string; start: string; end: string }[]>([
    { title: "", start: "", end: "" },
  ]);
  const [chaptersPasteText, setChaptersPasteText] = useState("");

  const timecodeToSeconds = (tc: string): number | null => {
    const trimmed = tc.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(":").map((p) => Number(p));
    if (parts.some((p) => isNaN(p))) return null;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  };

  const secondsToTimecode = (totalSeconds: number): string => {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  };

  // Parses pasted YouTube-style chapter lists, e.g. "00:00 Introduction" or
  // "1:03:08 - Why Autistic Adults Collect Toys" — one chapter per line. The
  // end of each chapter is inferred as the start of the next one; the final
  // chapter's end is left open (large sentinel) and clamped server-side to
  // the actual video duration.
  const parseChaptersPasteText = (text: string): { title: string; start: string; end: string }[] => {
    const lineRegex = /^\s*(\d{1,2}(?::\d{1,2}){1,2})\s*[-–—:.)]?\s*(.+?)\s*$/;
    const parsed: { title: string; startSeconds: number }[] = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = line.match(lineRegex);
      if (!match) continue;
      const startSeconds = timecodeToSeconds(match[1]);
      const title = match[2].trim();
      if (startSeconds === null || !title) continue;
      parsed.push({ title, startSeconds });
    }
    if (parsed.length === 0) return [];
    parsed.sort((a, b) => a.startSeconds - b.startSeconds);
    return parsed.map((c, idx) => ({
      title: c.title,
      start: secondsToTimecode(c.startSeconds),
      end: idx < parsed.length - 1 ? secondsToTimecode(parsed[idx + 1].startSeconds) : secondsToTimecode(c.startSeconds + 999999),
    }));
  };

  const handleParseChaptersPaste = () => {
    const result = parseChaptersPasteText(chaptersPasteText);
    if (result.length === 0) {
      toast({ title: "Couldn't parse chapters", description: "Paste lines like \"00:00 Chapter title\", one per line.", variant: "destructive" });
      return;
    }
    setChapters(result);
    toast({ title: "Chapters parsed", description: `Added ${result.length} chapter${result.length === 1 ? "" : "s"} from your paste.` });
  };

  const { toast } = useToast();

  const downloadFile = async (url: string, filename?: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        let msg = "File not available — try reprocessing the job.";
        try { const j = await res.json(); msg = j.error ?? msg; } catch {}
        toast({ title: "Download failed", description: msg, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      if (filename) a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch {
      toast({ title: "Download failed", description: "Network error — please try again.", variant: "destructive" });
    }
  };

  // For large binary files (ZIP, MP3, MP4) use direct browser navigation so the
  // browser streams the download natively instead of buffering the entire file as
  // a blob in JavaScript memory (which silently fails for files > ~100 MB).
  const downloadDirect = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
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
  const uploadBrandDoc = useUploadBrandDocument();
  const deleteBrandDocMutation = useDeleteBrandDocument();
  const uploadCarouselTemplate = useUploadBrandCarouselTemplate();
  const deleteCarouselTemplateMutation = useDeleteBrandCarouselTemplate();

  // Load documents for whichever brand is currently expanded
  const { data: brandDocuments } = useListBrandDocuments(
    expandedBrandId ?? 0,
    { query: { enabled: expandedBrandId !== null, queryKey: getListBrandDocumentsQueryKey(expandedBrandId ?? 0) } }
  );

  // Load carousel template images for whichever brand is currently expanded
  const { data: carouselTemplates } = useListBrandCarouselTemplates(
    expandedBrandId ?? 0,
    { query: { enabled: expandedBrandId !== null, queryKey: getListBrandCarouselTemplatesQueryKey(expandedBrandId ?? 0) } }
  );

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
    resolver: zodResolver(formSchema),
    defaultValues: {
      clipCount: 5,
      clipDurationSeconds: 45,
      clipMode: "ai",
      captionsEnabled: true,
      captionStyle: "classic",
      showTitle: true,
      showWatermark: true,
      contentCta: "",
      outroId: "none",
      brandId: "",
      includeShorts: true,
      generatePodcast: true,
      manualTranscript: "",
    },
  });

  const includeShorts = form.watch("includeShorts");
  const generatePodcast = form.watch("generatePodcast");
  const selectedDuration = form.watch("clipDurationSeconds");
  const selectedBrandId = form.watch("brandId");
  const clipMode = form.watch("clipMode");
  const captionsEnabled = form.watch("captionsEnabled");
  const captionStyle = form.watch("captionStyle");
  const showTitle = form.watch("showTitle");
  const showWatermark = form.watch("showWatermark");

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

  // Auto-collapse the form on mobile when a job is selected so results get full screen
  useEffect(() => {
    if (selectedJobId) {
      setMobileFormOpen(false);
    }
  }, [selectedJobId]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const sharedReset = {
      clipCount: 5,
      clipDurationSeconds: values.clipDurationSeconds,
      clipMode: values.clipMode,
      captionsEnabled: values.captionsEnabled,
      captionStyle: values.captionStyle,
      showTitle: values.showTitle,
      showWatermark: values.showWatermark,
      contentCta: values.contentCta,
      outroId: values.outroId,
      brandId: values.brandId,
      includeShorts: values.includeShorts,
      generatePodcast: values.generatePodcast,
      manualTranscript: "",
    };

    if (sourceType === "transcript") {
      const transcript = (values.manualTranscript ?? "").trim();
      if (!transcript) {
        form.setError("manualTranscript", { message: "Please paste the video transcript" });
        return;
      }
      const payload = {
        clipCount: 0,
        clipDurationSeconds: values.clipDurationSeconds ?? 45,
        contentCta: values.contentCta?.trim() || undefined,
        outroId: null as number | null,
        brandId: values.brandId && values.brandId !== "none" ? parseInt(values.brandId, 10) : null as number | null,
        manualTranscript: transcript,
        generatePodcast: false,
      };
      createJob.mutate({ data: payload }, {
        onSuccess: (newJob) => {
          form.reset(sharedReset);
          setSelectedJobId(newJob.id);
          toast({ title: "Job Created 🚀", description: "Generating content from your transcript…" });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        },
        onError: (error: any) => {
          const message = error?.data?.error || error?.message?.replace(/^HTTP \d+ [^:]+:\s*/, "") || "Failed to create job.";
          toast({ title: "Error", description: message, variant: "destructive" });
        },
      });
      return;
    }

    // Upload path (video file, optional thumbnail, optional manual chapters)
    if (!uploadFile) {
      toast({ title: "No file selected", description: "Please choose a video file to upload.", variant: "destructive" });
      return;
    }

    let manualChaptersJson: string | undefined;
    if (values.clipMode === "chapters") {
      const parsedChapters = chapters
        .map((c) => ({
          title: c.title.trim(),
          startSeconds: timecodeToSeconds(c.start),
          endSeconds: timecodeToSeconds(c.end),
        }))
        .filter((c) => c.title && c.startSeconds !== null && c.endSeconds !== null);
      if (!parsedChapters.length) {
        toast({ title: "No chapters entered", description: "Add at least one chapter with a title, start, and end time.", variant: "destructive" });
        return;
      }
      manualChaptersJson = JSON.stringify(parsedChapters);
    }

    setIsUploading(true);
    setUploadProgress(0);

    const basePath = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

    const resetUploadState = () => {
      setUploadFile(null);
      setThumbnailFile(null);
      setChapters([{ title: "", start: "", end: "" }]);
      setChaptersPasteText("");
      setUserVideoTitle("");
      setUserVideoDescription("");
      form.reset(sharedReset);
    };

    const failUpload = (description: string) => {
      setIsUploading(false);
      toast({ title: "Upload failed", description, variant: "destructive" });
    };

    // Uploads a file directly to the server streaming proxy (no CORS, no GCS presigned URL),
    // tracking progress within the [progressStart, progressEnd] range of the overall bar.
    uploadStartTimeRef.current = null;
    setUploadSpeedBps(0);

    const uploadToServer = (
      file: File,
      progressStart: number,
      progressEnd: number,
    ): Promise<{ objectPath: string }> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const now = Date.now();
            if (!uploadStartTimeRef.current) uploadStartTimeRef.current = now;
            const elapsed = (now - uploadStartTimeRef.current) / 1000;
            if (elapsed > 0 && e.loaded > 0) {
              setUploadSpeedBps(e.loaded / elapsed);
            }
            const frac = e.loaded / e.total;
            setUploadProgress(Math.round(progressStart + frac * (progressEnd - progressStart)));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let msg = `Upload failed (${xhr.status})`;
            try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload — check your connection and try again"));
        xhr.ontimeout = () => reject(new Error("Upload timed out — file may be too large for your connection speed"));
        xhr.timeout = 14400000;
        xhr.open("PUT", `${basePath}/api/storage/uploads/stream`);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("X-File-Name", file.name);
        xhr.withCredentials = true;
        xhr.send(file);
      });
    };

    (async () => {
      try {
        // Reserve the tail of the progress bar for the thumbnail (if any) so the
        // bar still reads sensibly when there are two uploads in sequence.
        const videoProgressEnd = thumbnailFile ? 90 : 100;
        const { objectPath: videoObjectPath } = await uploadToServer(uploadFile, 0, videoProgressEnd);

        let thumbnailObjectPath: string | undefined;
        if (thumbnailFile) {
          const { objectPath: thumbObjectPath } = await uploadToServer(thumbnailFile, videoProgressEnd, 100);
          thumbnailObjectPath = thumbObjectPath;
        }

        const payload: Record<string, unknown> = {
          videoObjectPath,
          videoFileName: uploadFile.name,
          clipCount: String(values.includeShorts ? (values.clipCount ?? 5) : 0),
          clipDurationSeconds: String(values.clipDurationSeconds ?? 45),
          clipMode: values.clipMode ?? "ai",
          captionsEnabled: String(values.captionsEnabled ?? true),
          captionStyle: values.captionStyle ?? "classic",
          showTitle: String(values.showTitle ?? true),
          showWatermark: String(values.showWatermark ?? true),
        };
        if (thumbnailObjectPath) payload.thumbnailObjectPath = thumbnailObjectPath;
        if (values.contentCta?.trim()) payload.contentCta = values.contentCta.trim();
        if (values.outroId && values.outroId !== "none") payload.outroId = values.outroId;
        if (values.brandId && values.brandId !== "none") payload.brandId = values.brandId;
        if (manualChaptersJson) payload.manualChapters = manualChaptersJson;
        if (userVideoTitle.trim()) payload.userVideoTitle = userVideoTitle.trim();
        if (userVideoDescription.trim()) payload.userVideoDescription = userVideoDescription.trim();

        const createRes = await fetch(`${basePath}/api/jobs/upload-from-storage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });

        setIsUploading(false);
        if (createRes.status === 201) {
          const newJob = await createRes.json();
          resetUploadState();
          setSelectedJobId(newJob.id);
          toast({ title: "Job Created 🚀", description: "Video uploaded and processing has started." });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        } else {
          const err = await createRes.json().catch(() => ({}) as { error?: string });
          toast({ title: "Upload failed", description: err.error ?? "Unknown error", variant: "destructive" });
        }
      } catch (e) {
        failUpload(e instanceof Error ? e.message : "Network error — please try again.");
      }
    })();
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

  const handleUploadOutro = async (e: React.FormEvent, _brandId?: number) => {
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
      setUploadName(""); setUploadPosition("end"); setUploadCtaText(""); setUploadCtaStartSeconds(""); setOutroFileName("");
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

  const handleBrandFileUpload = async (brandId: number, type: "logo" | "short-form-outro" | "intro-audio" | "outro-audio" | "carousel-end-slide", file: File) => {
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
            <TabsList className="w-full grid grid-cols-2 bg-muted/50 border border-border/50 h-9">
              <TabsTrigger value="projects" className="text-[11px] font-semibold">Projects</TabsTrigger>
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
                      {/* YouTube / source URL — always visible, copyable */}
                      {job.youtubeUrl && !job.youtubeUrl.startsWith("upload://") && !job.youtubeUrl.startsWith("transcript://") && (
                        <div className="flex items-center gap-1 mb-1.5 group/url">
                          <span className="text-[10px] font-mono text-muted-foreground/55 truncate flex-1 min-w-0">
                            {job.youtubeUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "")}
                          </span>
                          <button
                            className="opacity-0 group-hover/url:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-muted/60"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(job.youtubeUrl ?? "");
                              toast({ title: "Copied!", description: "Source URL copied to clipboard." });
                            }}
                          >
                            <Copy className="w-2.5 h-2.5 text-muted-foreground/70" />
                          </button>
                        </div>
                      )}
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


          {/* Brands tab */}
          <TabsContent value="brands" className="flex-1 overflow-hidden m-0 border-none outline-none">
            <ScrollArea className="h-full">
              <div className="pt-4 pl-4 pb-4 pr-5 space-y-4">
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

                            {/* Brand Guide Documents */}
                            <div className="space-y-2 pt-1">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Brand Guide</p>
                              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">Upload a PDF or text doc — AI uses it to match your brand voice, style, and terminology.</p>

                              {/* Existing docs */}
                              {expandedBrandId !== null && brandDocuments && brandDocuments.length > 0 && (
                                <div className="space-y-1">
                                  {(brandDocuments as BrandDocument[]).map((doc) => (
                                    <div key={doc.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                                      <FileText className="w-3 h-3 text-emerald-500 shrink-0" />
                                      <span className="text-[10px] text-foreground/80 truncate flex-1">{doc.name}</span>
                                      <Button
                                        variant="ghost" size="icon"
                                        className="h-5 w-5 shrink-0 hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => deleteBrandDocMutation.mutate(
                                          { id: expandedBrandId!, docId: doc.id },
                                          { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBrandDocumentsQueryKey(expandedBrandId!) }) }
                                        )}
                                      >
                                        <Trash2 className="w-2.5 h-2.5" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Upload */}
                              <label className={`flex items-center gap-2 p-2.5 rounded-lg border border-dashed cursor-pointer transition-all hover:bg-primary/5 hover:border-primary/30 ${uploadBrandDoc.isPending ? "opacity-60 pointer-events-none" : "border-border/50 bg-card/30"}`}>
                                {uploadBrandDoc.isPending
                                  ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                                  : <Upload className="w-3.5 h-3.5 text-muted-foreground" />
                                }
                                <span className="text-[10px] text-muted-foreground">{uploadBrandDoc.isPending ? "Uploading…" : "Upload PDF, TXT, or DOCX"}</span>
                                <input
                                  type="file"
                                  accept=".pdf,.txt,.md,.doc,.docx"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file || expandedBrandId === null) return;
                                    try {
                                      await uploadBrandDoc.mutateAsync({ id: expandedBrandId, data: { file } });
                                      queryClient.invalidateQueries({ queryKey: getListBrandDocumentsQueryKey(expandedBrandId) });
                                      toast({ title: "Brand guide uploaded", description: "AI will reference it in all content generation." });
                                    } catch {
                                      toast({ title: "Upload failed", variant: "destructive" });
                                    }
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>

                            {/* File uploads */}
                            <div className="space-y-2 pt-1">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Media Files</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {(["logo", "intro-audio", "outro-audio", "carousel-end-slide"] as const).map((type) => {
                                  const icons = { logo: Image, "intro-audio": Mic, "outro-audio": Mic, "carousel-end-slide": LayoutGrid };
                                  const labels = { logo: "Logo", "intro-audio": "Podcast Intro", "outro-audio": "Podcast Outro", "carousel-end-slide": "Carousel End Slide" };
                                  const accepts = { logo: "image/*", "intro-audio": "audio/*", "outro-audio": "audio/*", "carousel-end-slide": "image/*" };
                                  const Icon = icons[type];
                                  const hasFile = type === "logo" ? !!brand.logoPath : type === "intro-audio" ? !!brand.introAudioPath : type === "outro-audio" ? !!brand.outroAudioPath : !!(brand as any).carouselEndSlidePath;
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

                            {/* Carousel Slide Templates */}
                            <div className="space-y-2 pt-1">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Carousel Slide Templates</p>
                              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">Upload background images to use for carousel slides instead of AI-generated art. They'll be cycled through in order across the slides.</p>

                              {expandedBrandId !== null && carouselTemplates && carouselTemplates.length > 0 && (
                                <div className="grid grid-cols-3 gap-1.5">
                                  {carouselTemplates.map((tpl) => (
                                    <div key={tpl.id} className="relative group rounded-lg border border-emerald-500/20 bg-emerald-500/5 aspect-square overflow-hidden">
                                      <img src={`/api/brands/${expandedBrandId}/carousel-templates/${tpl.id}/image`} alt={tpl.name} className="w-full h-full object-cover" />
                                      <Button
                                        variant="ghost" size="icon"
                                        className="absolute top-0.5 right-0.5 h-5 w-5 bg-black/60 hover:bg-destructive/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => deleteCarouselTemplateMutation.mutate(
                                          { id: expandedBrandId!, templateId: tpl.id },
                                          { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBrandCarouselTemplatesQueryKey(expandedBrandId!) }) }
                                        )}
                                      >
                                        <Trash2 className="w-2.5 h-2.5" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <label className={`flex items-center gap-2 p-2.5 rounded-lg border border-dashed cursor-pointer transition-all hover:bg-primary/5 hover:border-primary/30 ${uploadCarouselTemplate.isPending ? "opacity-60 pointer-events-none" : "border-border/50 bg-card/30"}`}>
                                {uploadCarouselTemplate.isPending
                                  ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                                  : <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
                                }
                                <span className="text-[10px] text-muted-foreground">{uploadCarouselTemplate.isPending ? "Uploading…" : "Upload template image"}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file || expandedBrandId === null) return;
                                    try {
                                      await uploadCarouselTemplate.mutateAsync({ id: expandedBrandId, data: { file, name: file.name } });
                                      queryClient.invalidateQueries({ queryKey: getListBrandCarouselTemplatesQueryKey(expandedBrandId) });
                                      toast({ title: "Carousel template uploaded" });
                                    } catch {
                                      toast({ title: "Upload failed", variant: "destructive" });
                                    }
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>

                            {/* ── Outros ──────────────────────────────── */}
                            <div className="space-y-2 pt-1">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Short-Form Outros</p>

                              {/* Upload row */}
                              <form
                                onSubmit={(e) => { e.preventDefault(); handleUploadOutro(e as any, brand.id); }}
                                className="space-y-2 p-2.5 rounded-lg border border-dashed border-border/50 bg-card/20"
                              >
                                <div className="flex gap-1.5">
                                  <Input
                                    value={uploadName}
                                    onChange={e => setUploadName(e.target.value)}
                                    placeholder="Outro name"
                                    className="h-7 text-xs flex-1"
                                  />
                                  <Select value={uploadPosition} onValueChange={v => setUploadPosition(v as "beginning" | "end")}>
                                    <SelectTrigger className="h-7 text-xs w-24 shrink-0"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="end">End</SelectItem>
                                      <SelectItem value="beginning">Beginning</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <Input value={uploadCtaText} onChange={e => setUploadCtaText(e.target.value)} placeholder="CTA text (optional)" className="h-7 text-xs" />
                                {uploadCtaText && (
                                  <Input type="number" min={0} value={uploadCtaStartSeconds} onChange={e => setUploadCtaStartSeconds(e.target.value === "" ? "" : Number(e.target.value))} placeholder="CTA start (secs)" className="h-7 text-xs" />
                                )}
                                <div className="flex gap-1.5 items-center">
                                  <label className="flex-1 flex items-center gap-1.5 h-7 px-2 rounded border border-dashed border-border/50 bg-card/30 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all">
                                    <Film className="w-3 h-3 text-muted-foreground shrink-0" />
                                    <span className="text-[10px] text-muted-foreground truncate">
                                      {outroFileName || "Choose video file…"}
                                    </span>
                                    <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={e => setOutroFileName(e.target.files?.[0]?.name ?? "")} />
                                  </label>
                                  <Button type="submit" size="sm" className="h-7 text-xs shrink-0" disabled={isUploadingOutro}>
                                    {isUploadingOutro ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                  </Button>
                                </div>
                              </form>

                              {/* Outro list — filtered to this brand */}
                              {isOutrosLoading ? (
                                <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-primary/50" /></div>
                              ) : (outros ?? []).filter(o => (o as any).brandId === brand.id || !(o as any).brandId).length > 0 ? (
                                <div className="space-y-1.5">
                                  {(outros ?? []).map(o => (
                                    <div key={o.id} className="rounded border border-border/40 bg-card/20 px-2.5 py-1.5">
                                      {editingOutroId === o.id ? (
                                        <form onSubmit={handleUpdateOutro} className="space-y-1.5">
                                          <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" className="h-6 text-xs" />
                                          <Select value={editPosition} onValueChange={v => setEditPosition(v as "beginning" | "end")}>
                                            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="end">End</SelectItem>
                                              <SelectItem value="beginning">Beginning</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          <Input value={editCtaText} onChange={e => setEditCtaText(e.target.value)} placeholder="CTA text (optional)" className="h-6 text-xs" />
                                          {editCtaText && (
                                            <Input type="number" min={0} value={editCtaStartSeconds} onChange={e => setEditCtaStartSeconds(e.target.value === "" ? "" : Number(e.target.value))} placeholder="CTA start secs" className="h-6 text-xs" />
                                          )}
                                          <div className="flex gap-1">
                                            <Button type="submit" size="sm" className="flex-1 h-6 text-[10px]">Save</Button>
                                            <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditingOutroId(null)}>Cancel</Button>
                                          </div>
                                        </form>
                                      ) : (
                                        <div className="flex items-center justify-between gap-1">
                                          <div className="min-w-0">
                                            <p className="text-[11px] font-medium truncate leading-tight">
                                              {o.name}
                                              {o.isDefault && <span className="ml-1 text-[9px] text-primary">✦</span>}
                                            </p>
                                            <p className="text-[9px] text-muted-foreground capitalize">{o.position} · {o.ctaText ? `CTA: ${o.ctaText}` : "no CTA"}</p>
                                          </div>
                                          <div className="flex items-center gap-0.5 shrink-0">
                                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setEditingOutroId(o.id); setEditName(o.name); setEditPosition(o.position as "beginning" | "end"); setEditCtaText(o.ctaText ?? ""); setEditCtaStartSeconds(o.ctaStartSeconds ?? ""); }}>
                                              <Edit2 className="w-2.5 h-2.5" />
                                            </Button>
                                            {!o.isDefault && (
                                              <Button variant="ghost" size="icon" className="h-5 w-5" title="Set as default" onClick={() => handleSetDefaultOutro(o.id)}>
                                                <Star className="w-2.5 h-2.5" />
                                              </Button>
                                            )}
                                            <Button variant="ghost" size="icon" className="h-5 w-5 hover:text-destructive" onClick={() => handleDeleteOutro(o.id)}>
                                              <Trash2 className="w-2.5 h-2.5" />
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[10px] text-muted-foreground/60 text-center py-2">No outros yet — upload one above.</p>
                              )}
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
          {/* Content360 promo */}
          <a
            href="https://get.content360.io/lifetime?am_id=TAW"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2.5 px-3 py-2 mb-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all text-left group"
          >
            <div className="w-7 h-7 rounded-md bg-emerald-500/15 flex items-center justify-center shrink-0">
              <span className="text-sm">🚀</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold leading-tight text-emerald-400">Content360 — $67 once</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Social media manager + sales bot</p>
            </div>
            <svg className="w-3 h-3 shrink-0 text-emerald-500/60 group-hover:text-emerald-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </a>
          {!isInStandaloneMode && !isInstalled && (
            <button
              onClick={canInstall ? triggerInstall : isIos ? () => setShowIosInstall(true) : () => setShowMobileInstall(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 mb-2 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-all text-left group"
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold leading-tight">Get the App</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Install on your phone or tablet</p>
              </div>
              <Plus className="w-3.5 h-3.5 shrink-0 opacity-40 group-hover:opacity-80 transition-opacity" />
            </button>
          )}
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
        <div className="border-b border-border bg-card/20 backdrop-blur-md sticky top-[57px] md:top-0 z-20">
          {/* Mobile form toggle bar */}
          <div className={`md:hidden flex items-center justify-between px-4 py-2.5${mobileFormOpen ? " border-b border-border/40" : ""}`}>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {selectedJobId && jobWithClips?.videoTitle
                ? jobWithClips.videoTitle
                : "Start a new job"}
            </span>
            <button
              type="button"
              onClick={() => setMobileFormOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all shrink-0 ml-2"
            >
              {mobileFormOpen
                ? <><ChevronUp className="w-3.5 h-3.5" /> Hide</>
                : <><Plus className="w-3.5 h-3.5" /> New Job</>}
            </button>
          </div>
          <div className={`${mobileFormOpen ? "" : "hidden md:block"} p-4 md:p-5`}>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, (errors) => {
                const firstError = Object.values(errors)[0] as { message?: string } | undefined;
                toast({
                  title: "Can't submit yet",
                  description: firstError?.message || "Please fill in the required fields before submitting.",
                  variant: "destructive",
                });
              })}
              className="flex flex-col gap-3 max-w-4xl mx-auto w-full"
            >

              {/* Row 1: Source selector + input + submit */}
              <div className="flex flex-col gap-2.5 w-full">
                {/* Source type pills */}
                <div className="flex items-center gap-1 bg-background/60 border border-border/60 rounded-xl p-1 w-fit">
                  {([ 
                    { type: "upload" as const,      label: "Upload File",     Icon: Upload },
                    { type: "transcript" as const,  label: "Paste Transcript", Icon: FileText },
                  ]).map(({ type, label, Icon }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setSourceType(type); setUploadFile(null); form.clearErrors("manualTranscript"); }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        sourceType === type
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* URL input / file dropzone / transcript textarea + submit button */}
                <div className="flex flex-col sm:flex-row gap-3 items-start w-full">
                  {sourceType === "transcript" ? (
                    <FormField
                      control={form.control}
                      name="manualTranscript"
                      render={({ field }) => (
                        <FormItem className="flex-1 w-full">
                          <FormControl>
                            <Textarea
                              placeholder="Paste the video transcript here… The AI will generate your full content pack from this text."
                              className="bg-background border-border/60 hover:border-border focus-visible:ring-primary/30 focus-visible:border-primary/50 text-sm shadow-sm transition-all rounded-xl min-h-[88px] resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage className="text-xs ml-1" />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="flex-1 w-full flex flex-col gap-1.5">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <label
                          htmlFor="video-file-input"
                          className={`flex items-center justify-center gap-2 flex-1 h-13 rounded-xl border-2 border-dashed cursor-pointer transition-all text-sm font-medium px-4 ${
                            uploadFile
                              ? "border-primary/60 bg-primary/5 text-primary"
                              : "border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5 text-muted-foreground"
                          }`}
                        >
                          <input
                            id="video-file-input"
                            type="file"
                            accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.wmv"
                            className="hidden"
                            onChange={(e) => { setUploadFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                          />
                          {uploadFile
                            ? <span className="truncate max-w-full">{uploadFile.name}</span>
                            : <><Upload className="w-4 h-4 shrink-0" /> Choose a video file (MP4, MOV, MKV…)</>
                          }
                        </label>
                        <label
                          htmlFor="thumbnail-file-input"
                          className={`flex items-center justify-center gap-2 h-13 rounded-xl border-2 border-dashed cursor-pointer transition-all text-sm font-medium px-4 shrink-0 ${
                            thumbnailFile
                              ? "border-primary/60 bg-primary/5 text-primary"
                              : "border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5 text-muted-foreground"
                          }`}
                        >
                          <input
                            id="thumbnail-file-input"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => { setThumbnailFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                          />
                          {thumbnailFile
                            ? <span className="truncate max-w-[140px]">{thumbnailFile.name}</span>
                            : <><Upload className="w-4 h-4 shrink-0" /> Thumbnail (optional)</>
                          }
                        </label>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          placeholder="Video title (optional — overrides the filename)"
                          value={userVideoTitle}
                          onChange={(e) => setUserVideoTitle(e.target.value)}
                          className="h-9 text-xs bg-background border-border/60"
                        />
                      </div>
                      <Textarea
                        placeholder="Video description (optional) — extra context about the video to help the AI write more accurate content"
                        value={userVideoDescription}
                        onChange={(e) => setUserVideoDescription(e.target.value)}
                        className="bg-background border-border/60 text-xs min-h-[52px] resize-none"
                      />
                      {isUploading && (
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-2">
                              <span>Uploading…</span>
                              {uploadSpeedBps > 0 && (
                                <span className="font-mono">
                                  {uploadSpeedBps >= 1048576
                                    ? `${(uploadSpeedBps / 1048576).toFixed(1)} MB/s`
                                    : `${(uploadSpeedBps / 1024).toFixed(0)} KB/s`}
                                </span>
                              )}
                            </span>
                            <span>{uploadProgress}%</span>
                          </div>
                          <Progress value={uploadProgress} className="h-1.5" />
                          <p className="text-[10px] text-muted-foreground/60 pt-0.5">Large files can take several minutes — keep this tab open until complete.</p>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    type="submit"
                    size="lg"
                    disabled={createJob.isPending || isUploading}
                    style={{ background: "linear-gradient(135deg, #7c3aed, #c026d3, #f21178)" }}
                    className="h-13 px-7 text-base shadow-[0_4px_20px_0_rgba(124,58,237,0.35)] hover:shadow-[0_6px_24px_rgba(242,17,120,0.4)] hover:-translate-y-0.5 transition-all rounded-xl font-bold active:translate-y-0 shrink-0 text-white border-0 w-full sm:w-auto whitespace-nowrap"
                  >
                    {createJob.isPending || isUploading
                      ? <><Loader2 className="w-5 h-5 animate-spin mr-2" />{isUploading ? `Uploading ${uploadProgress}%` : "Starting…"}</>
                      : <><Zap className="w-5 h-5 mr-2" />Multiply My Content 🚀</>
                    }
                  </Button>
                </div>
              </div>

              {/* Row 2: Options */}
              <div className="flex flex-wrap gap-3 items-center">

                {/* Clip duration pills — hidden in transcript mode */}
                {sourceType !== "transcript" && (
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
                )}

                {sourceType !== "transcript" && <div className="h-4 w-px bg-border/60 hidden sm:block" />}

                {/* Clip selection mode — hidden in transcript mode */}
                {sourceType !== "transcript" && (
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground font-medium shrink-0">Snippets:</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => form.setValue("clipMode", "ai")}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                          clipMode === "ai"
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        AI Auto-Pick
                      </button>
                      <button
                        type="button"
                        onClick={() => form.setValue("clipMode", "chapters")}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                          clipMode === "chapters"
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        Manual Chapters
                      </button>
                    </div>
                  </div>
                )}

                {sourceType !== "transcript" && <div className="h-4 w-px bg-border/60 hidden sm:block" />}

                {/* Shorts toggle — hidden in transcript mode */}
                {sourceType !== "transcript" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => form.setValue("includeShorts", !includeShorts)}
                      disabled={clipMode === "chapters"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${includeShorts ? "bg-primary border-primary" : "bg-muted border-muted-foreground/30"}`}
                    >
                      <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${includeShorts ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-xs text-muted-foreground font-medium">Shorts clips</span>
                    {includeShorts && clipMode === "ai" && (
                      <FormField
                        control={form.control}
                        name="clipCount"
                        render={({ field }) => (
                          <FormItem className="w-16 m-0">
                            <FormControl>
                              <Input
                                type="number"
                                min={3}
                                max={6}
                                className="h-7 text-xs text-center px-2 font-mono bg-background border-border/60"
                                {...field}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                )}

                {/* Podcast toggle — hidden in transcript mode */}
                {sourceType !== "transcript" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => form.setValue("generatePodcast", !generatePodcast)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none ${generatePodcast ? "bg-primary border-primary" : "bg-muted border-muted-foreground/30"}`}
                    >
                      <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${generatePodcast ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-xs text-muted-foreground font-medium">Podcast</span>
                  </div>
                )}

                {sourceType !== "transcript" && <div className="h-4 w-px bg-border/60 hidden sm:block" />}

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

              {/* Row 3: Snippet styling — hidden in transcript mode */}
              {sourceType !== "transcript" && (includeShorts || clipMode === "chapters") && (
                <div className="flex flex-wrap gap-3 items-center pt-1">
                  {/* Captions toggle + style */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => form.setValue("captionsEnabled", !captionsEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none ${captionsEnabled ? "bg-primary border-primary" : "bg-muted border-muted-foreground/30"}`}
                    >
                      <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${captionsEnabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-xs text-muted-foreground font-medium">Captions</span>
                    {captionsEnabled && (
                      <Select value={captionStyle} onValueChange={(v) => form.setValue("captionStyle", v as any)}>
                        <SelectTrigger className="h-7 w-28 bg-background border-border/60 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="classic">Classic</SelectItem>
                          <SelectItem value="bold">Bold</SelectItem>
                          <SelectItem value="boxed">Boxed</SelectItem>
                          <SelectItem value="brand">Brand</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="h-4 w-px bg-border/60 hidden sm:block" />

                  {/* Title overlay toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => form.setValue("showTitle", !showTitle)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none ${showTitle ? "bg-primary border-primary" : "bg-muted border-muted-foreground/30"}`}
                    >
                      <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${showTitle ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-xs text-muted-foreground font-medium">Title overlay</span>
                  </div>

                  <div className="h-4 w-px bg-border/60 hidden sm:block" />

                  {/* Watermark toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => form.setValue("showWatermark", !showWatermark)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none ${showWatermark ? "bg-primary border-primary" : "bg-muted border-muted-foreground/30"}`}
                    >
                      <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${showWatermark ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-xs text-muted-foreground font-medium">Logo watermark</span>
                  </div>
                </div>
              )}

              {/* Manual chapters editor — upload mode only, chapters clip mode */}
              {sourceType === "upload" && clipMode === "chapters" && (
                <div className="flex flex-col gap-2 pt-1 border border-border/60 rounded-xl p-3 bg-background/40">
                  <span className="text-xs text-muted-foreground font-medium">
                    Chapters (title, start, end — mm:ss or hh:mm:ss)
                  </span>

                  <div className="flex flex-col gap-1.5 pb-1 border-b border-border/60">
                    <span className="text-xs text-muted-foreground">
                      Or paste a full chapter list at once — one per line, e.g. "00:00 Introduction":
                    </span>
                    <Textarea
                      placeholder={"00:00 Introduction: Is It Really Immaturity?\n00:13 Childish Fears & Phobias in Autism\n03:08 Why Autistic Adults Collect Toys & Objects"}
                      value={chaptersPasteText}
                      onChange={(e) => setChaptersPasteText(e.target.value)}
                      className="bg-background border-border/60 text-xs min-h-[70px] resize-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleParseChaptersPaste}
                      disabled={!chaptersPasteText.trim()}
                      className="self-start px-2.5 py-1 rounded-full text-xs font-semibold border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Parse chapters from paste
                    </button>
                  </div>

                  {chapters.map((chapter, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2">
                      <Input
                        placeholder="Chapter title"
                        value={chapter.title}
                        onChange={(e) => {
                          const next = [...chapters];
                          next[idx] = { ...next[idx], title: e.target.value };
                          setChapters(next);
                        }}
                        className="h-8 text-xs flex-1 min-w-[140px] bg-background border-border/60"
                      />
                      <Input
                        placeholder="Start (mm:ss)"
                        value={chapter.start}
                        onChange={(e) => {
                          const next = [...chapters];
                          next[idx] = { ...next[idx], start: e.target.value };
                          setChapters(next);
                        }}
                        className="h-8 text-xs w-28 bg-background border-border/60"
                      />
                      <Input
                        placeholder="End (mm:ss)"
                        value={chapter.end}
                        onChange={(e) => {
                          const next = [...chapters];
                          next[idx] = { ...next[idx], end: e.target.value };
                          setChapters(next);
                        }}
                        className="h-8 text-xs w-28 bg-background border-border/60"
                      />
                      <button
                        type="button"
                        onClick={() => setChapters(chapters.filter((_, i) => i !== idx))}
                        disabled={chapters.length === 1}
                        className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setChapters([...chapters, { title: "", start: "", end: "" }])}
                    className="self-start px-2.5 py-1 rounded-full text-xs font-semibold border border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
                  >
                    + Add chapter
                  </button>
                </div>
              )}
            </form>
          </Form>
          </div>
        </div>

        {/* ── Content area ── */}
        <ScrollArea className="flex-1 p-3 md:p-5 lg:p-8">
          {!selectedJobId ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground max-w-md mx-auto text-center mt-16">
              <div className="w-24 h-24 bg-card/50 rounded-2xl flex items-center justify-center mb-8 border border-border/50 shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-violet-500/10 via-transparent to-[#f21178]/10" />
                <FileVideo className="w-10 h-10 text-muted-foreground/40 relative z-10" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-3">Workspace Empty</h2>
              <p className="text-sm text-muted-foreground/70 leading-relaxed">
                Upload a video and hit <span className="text-foreground font-semibold">Multiply My Content</span>. The AI will analyse the video, extract the best moments as vertical shorts, and generate a full content pack — blog, newsletter, social posts, carousel slides, and more.
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
                      {jobWithClips.youtubeUrl?.startsWith("upload://") ? (
                        <span className="text-muted-foreground flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg font-medium text-xs">
                          <FileVideo className="w-3.5 h-3.5" /> {jobWithClips.youtubeUrl.slice(9)}
                        </span>
                      ) : (
                        <a
                          href={jobWithClips.youtubeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary/90 hover:text-primary flex items-center gap-1.5 bg-primary/10 px-2.5 py-1 rounded-lg font-medium transition-colors text-xs"
                        >
                          <PlayCircle className="w-3.5 h-3.5" /> Source Video
                        </a>
                      )}
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
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300" onClick={() => downloadDirect(`/api/jobs/${jobWithClips.id}/download-all`)}>
                        <Package className="w-3.5 h-3.5" /> Export All (.zip)
                      </Button>
                    )}
                    {/* Podcast download */}
                    {(jobWithClips as any).hasPodcast && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" onClick={() => downloadDirect(`/api/jobs/${jobWithClips.id}/download-podcast`)}>
                        <Mic className="w-3.5 h-3.5" /> Podcast MP3
                      </Button>
                    )}
                    {/* Facebook video */}
                    {(jobWithClips as any).hasFacebookVideo && (
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-[#1877F2]/40 text-[#1877F2] hover:bg-[#1877F2]/10" onClick={() => downloadDirect(`/api/jobs/${jobWithClips.id}/download-facebook`)}>
                        <Download className="w-3.5 h-3.5" /> Facebook 1:1
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
                        {((jobWithClips as any).hasPodcast || jobContent.podcastShowNotes) && (
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
                                    <Button size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1.5 border-border/50" onClick={() => downloadFile(`/api/images/${filename}`, `slide_${i + 1}.png`)}>
                                      <Download className="w-3 h-3" /> Download
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </TabsContent>
                      )}

                      {/* Podcast */}
                      {((jobWithClips as any).hasPodcast || jobContent.podcastShowNotes) && (
                        <TabsContent value="podcast" className="m-0">
                          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                            {/* Header */}
                            <div className="flex items-center gap-2">
                              <div className="bg-emerald-500/10 p-2 rounded-lg">
                                <Mic className="w-5 h-5 text-emerald-400" />
                              </div>
                              <div>
                                <h3 className="text-sm font-bold">Podcast</h3>
                                <p className="text-xs text-muted-foreground">SEO show notes + MP3 audio file</p>
                              </div>
                            </div>

                            {/* MP3 download — only when file exists */}
                            {(jobWithClips as any).hasPodcast && (
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
                                <Button variant="outline" className="gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 shrink-0" onClick={() => downloadDirect(`/api/jobs/${jobWithClips.id}/download-podcast`)}>
                                  <Download className="w-4 h-4" /> Download MP3
                                </Button>
                              </div>
                            )}

                            {/* Show notes */}
                            {jobContent.podcastShowNotes && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-semibold">Show Notes</p>
                                    <p className="text-xs text-muted-foreground">SEO-ready — copy and paste into your podcast uploader (Buzzsprout, Spotify, Apple Podcasts…)</p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5 h-8 text-xs shrink-0"
                                    onClick={() => {
                                      navigator.clipboard.writeText(jobContent.podcastShowNotes ?? "");
                                      toast({ title: "Copied!", description: "Show notes copied to clipboard." });
                                    }}
                                  >
                                    <Copy className="w-3.5 h-3.5" /> Copy All
                                  </Button>
                                </div>
                                <pre className="bg-muted/40 border border-border/60 rounded-xl p-4 text-xs text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed max-h-[520px] overflow-y-auto select-all">
                                  {jobContent.podcastShowNotes}
                                </pre>
                              </div>
                            )}
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
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-5">
                    {jobWithClips.clips.map((clip) => (
                      <Card key={clip.id} className="overflow-hidden border-border/60 shadow-sm hover:shadow-lg transition-all duration-300 bg-card group relative flex flex-col">
                        <div className="aspect-[9/16] bg-black/90 relative flex items-center justify-center overflow-hidden border-b border-border/30">
                          {clip.status === "completed" ? (
                            playingClipId === clip.id ? (
                              <>
                                <video
                                  src={`${(import.meta.env.BASE_URL as string).replace(/\/$/, "")}/api/clips/${clip.id}/stream`}
                                  autoPlay
                                  controls
                                  playsInline
                                  className="absolute inset-0 w-full h-full object-contain bg-black"
                                  onEnded={() => setPlayingClipId(null)}
                                />
                                <button
                                  className="absolute top-2 right-2 z-30 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 transition-colors"
                                  onClick={() => setPlayingClipId(null)}
                                  aria-label="Close"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <button
                                className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none"
                                onClick={() => setPlayingClipId(clip.id)}
                                aria-label="Play clip"
                              >
                                <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent z-10 opacity-60 group-hover:opacity-90 transition-opacity" />
                                <div className="absolute inset-0 z-20 flex items-center justify-center">
                                  <div className="w-14 h-14 rounded-full bg-primary/90 text-white flex items-center justify-center shadow-xl border border-white/20 opacity-0 group-hover:opacity-100 transition-all duration-300">
                                    <PlayCircle className="w-7 h-7 ml-0.5" />
                                  </div>
                                </div>
                              </button>
                            )
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
                            <Button className="w-full gap-2 h-9 font-medium text-sm" onClick={() => downloadFile(`/api/clips/${clip.id}/download`)}>
                              <Download className="w-4 h-4" /> Download (9:16)
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
      {/* ── iOS Install Instructions ────────────────────────────── */}
      {/* ── Desktop / Generic Install Instructions ──────────────── */}
      <Dialog open={showMobileInstall} onOpenChange={setShowMobileInstall}>
        <DialogContent className="max-w-sm bg-[#0d0920] border-[#2a1e4a]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Smartphone className="w-5 h-5 text-[#f21178]" />
              Get the App
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-400">
            <p>Open Content Rocket on your phone or tablet to install it as a home screen app.</p>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Your app URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-[#16102a] border border-[#2a1e4a] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono truncate select-all">
                  {window.location.origin}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.origin);
                    setCopiedAppUrl(true);
                    setTimeout(() => setCopiedAppUrl(false), 2000);
                  }}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#16102a] border border-[#2a1e4a] text-xs text-slate-400 hover:text-white hover:border-[#f21178]/40 transition-all"
                >
                  {copiedAppUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedAppUrl ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-[#f21178]/10 text-[#f21178] text-[10px] font-bold flex items-center justify-center">A</span>
                <p><strong className="text-white">Android:</strong> Open the URL in Chrome, tap the menu <span className="font-bold">⋮</span> and choose <strong className="text-white">"Add to Home Screen"</strong></p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-[#f21178]/10 text-[#f21178] text-[10px] font-bold flex items-center justify-center">i</span>
                <p><strong className="text-white">iPhone / iPad:</strong> Open in Safari, tap Share <span className="text-blue-400 font-bold">⬆</span> then <strong className="text-white">"Add to Home Screen"</strong></p>
              </div>
            </div>
            <p className="text-xs text-slate-500 border-t border-[#2a1e4a] pt-3">The app runs full-screen with no browser bar, just like a native app.</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showIosInstall} onOpenChange={setShowIosInstall}>
        <DialogContent className="max-w-sm bg-[#0d0920] border-[#2a1e4a]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Smartphone className="w-5 h-5 text-[#f21178]" />
              Add to Home Screen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-400">
            <p>Install Content Rocket on your iPhone or iPad in 3 quick steps:</p>
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#f21178]/10 text-[#f21178] text-xs font-bold flex items-center justify-center">1</span>
                <span>Tap the <strong className="text-white">Share</strong> button <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-500/15 text-blue-400 rounded text-xs font-bold">⬆</span> in Safari's bottom toolbar</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#f21178]/10 text-[#f21178] text-xs font-bold flex items-center justify-center">2</span>
                <span>Scroll down and tap <strong className="text-white">"Add to Home Screen"</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#f21178]/10 text-[#f21178] text-xs font-bold flex items-center justify-center">3</span>
                <span>Tap <strong className="text-white">"Add"</strong> in the top-right corner</span>
              </li>
            </ol>
            <p className="text-xs text-slate-500 border-t border-[#2a1e4a] pt-3">Content Rocket will appear as a native-feeling app icon on your home screen.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
