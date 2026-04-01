import { useState, useRef } from "react";
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
  getGetJobQueryKey,
  getListJobsQueryKey,
  getHealthCheckQueryKey,
  getListOutrosQueryKey
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
  Edit2
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormMessage,
  FormLabel
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const formSchema = z.object({
  youtubeUrl: z.string().url({ message: "Please enter a valid YouTube URL" }),
  clipCount: z.coerce.number().min(1).max(10).default(3),
  outroId: z.string().optional()
});

function getStatusProgress(status: string) {
  switch(status) {
    case 'pending': return 10;
    case 'downloading': return 30;
    case 'transcribing': return 50;
    case 'analyzing': return 70;
    case 'rendering': return 90;
    case 'completed': return 100;
    case 'failed': return 100;
    default: return 0;
  }
}

function getStatusColor(status: string) {
  switch(status) {
    case 'pending': return 'bg-muted text-muted-foreground';
    case 'downloading': return 'bg-[#9b4dca]/20 text-[#9b4dca] border-[#9b4dca]/30';
    case 'transcribing': return 'bg-[#9b4dca]/20 text-[#9b4dca] border-[#9b4dca]/30';
    case 'analyzing': return 'bg-[#f21178]/20 text-[#f21178] border-[#f21178]/30';
    case 'rendering': return 'bg-[#f21178]/20 text-[#f21178] border-[#f21178]/30';
    case 'completed': return 'bg-[#00c896]/20 text-[#00c896] border-[#00c896]/30';
    case 'failed': return 'bg-destructive/20 text-destructive border-destructive/30';
    default: return 'bg-muted text-muted-foreground border-transparent';
  }
}

function getStatusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function Home() {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [isUploadingOutro, setIsUploadingOutro] = useState(false);
  const [editingOutroId, setEditingOutroId] = useState<number | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadPosition, setUploadPosition] = useState<"beginning" | "end">("end");
  const [uploadCtaText, setUploadCtaText] = useState("");
  const [uploadCtaStartSeconds, setUploadCtaStartSeconds] = useState<number | "">("");

  const [editName, setEditName] = useState("");
  const [editPosition, setEditPosition] = useState<"beginning" | "end">("end");
  const [editCtaText, setEditCtaText] = useState("");
  const [editCtaStartSeconds, setEditCtaStartSeconds] = useState<number | "">("");

  const { data: health } = useHealthCheck({
    query: { refetchInterval: 30000, queryKey: getHealthCheckQueryKey() }
  });

  const { data: jobs, isLoading: isJobsLoading } = useListJobs({
    query: { refetchInterval: 5000, queryKey: getListJobsQueryKey() }
  });

  const { data: outros, isLoading: isOutrosLoading } = useListOutros({
    query: { queryKey: getListOutrosQueryKey() }
  });

  const { data: jobWithClips } = useGetJob(selectedJobId as number, {
    query: {
      enabled: selectedJobId !== null,
      queryKey: getGetJobQueryKey(selectedJobId as number),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status && !['completed', 'failed'].includes(status) ? 2000 : false;
      }
    }
  });

  const createJob = useCreateJob();
  const deleteJob = useDeleteJob();
  const updateOutro = useUpdateOutro();
  const deleteOutro = useDeleteOutro();
  const setDefaultOutro = useSetDefaultOutro();

  const defaultOutro = outros?.find(o => o.isDefault);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      youtubeUrl: "",
      clipCount: 3,
      outroId: defaultOutro ? String(defaultOutro.id) : "none"
    }
  });

  // Update default outro selection when loaded
  if (defaultOutro && form.getValues("outroId") === "none" && !form.formState.isDirty) {
    form.setValue("outroId", String(defaultOutro.id));
  }

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const payload = {
      youtubeUrl: values.youtubeUrl,
      clipCount: values.clipCount,
      outroId: values.outroId && values.outroId !== "none" ? parseInt(values.outroId, 10) : null
    };
    
    createJob.mutate({ data: payload }, {
      onSuccess: (newJob) => {
        form.reset({
          youtubeUrl: "",
          clipCount: 3,
          outroId: values.outroId
        });
        setSelectedJobId(newJob.id);
        toast({
          title: "Job Created",
          description: "Video processing has started.",
        });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.error || "Failed to create job.",
          variant: "destructive"
        });
      }
    });
  };

  const handleDeleteJob = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteJob.mutate({ id }, {
      onSuccess: () => {
        if (selectedJobId === id) setSelectedJobId(null);
        toast({ title: "Job Deleted", description: "The job has been removed." });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete job.", variant: "destructive" });
      }
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
      
      // Reset form
      setUploadName("");
      setUploadPosition("end");
      setUploadCtaText("");
      setUploadCtaStartSeconds("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
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
        ctaStartSeconds: editCtaStartSeconds !== "" ? editCtaStartSeconds : null
      }
    }, {
      onSuccess: () => {
        toast({ title: "Outro Updated", description: "Settings saved successfully." });
        setEditingOutroId(null);
        queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update outro.", variant: "destructive" });
      }
    });
  };

  const handleDeleteOutro = (id: number) => {
    deleteOutro.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Outro Deleted", description: "The outro has been removed." });
        queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      }
    });
  };

  const handleSetDefaultOutro = (id: number) => {
    setDefaultOutro.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Default Set", description: "The default outro has been updated." });
        queryClient.invalidateQueries({ queryKey: getListOutrosQueryKey() });
      }
    });
  };

  const openEditModal = (outro: any) => {
    setEditingOutroId(outro.id);
    setEditName(outro.name);
    setEditPosition(outro.position as "beginning" | "end");
    setEditCtaText(outro.ctaText || "");
    setEditCtaStartSeconds(outro.ctaStartSeconds !== null ? outro.ctaStartSeconds : "");
  };

  const isHealthy = health?.status === "ok";

  return (
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30 selection:text-primary-foreground">
      {/* Sidebar */}
      <div className="w-80 border-r border-border bg-card/40 flex flex-col z-10 relative shrink-0">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shadow-inner">
              <Scissors className="w-5 h-5 text-[#f21178]" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">TAW Studio</h1>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/50 border border-border">
                <Activity className={`w-3.5 h-3.5 ${isHealthy ? 'text-green-500' : 'text-muted-foreground'}`} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="text-xs">{isHealthy ? 'API Connected' : 'Connecting...'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        
        <Tabs defaultValue="projects" className="flex-1 flex flex-col">
          <div className="px-4 pt-4">
            <TabsList className="w-full grid grid-cols-2 bg-muted/50 border border-border/50">
              <TabsTrigger value="projects" className="text-xs font-semibold">Projects</TabsTrigger>
              <TabsTrigger value="outros" className="text-xs font-semibold">Outros</TabsTrigger>
            </TabsList>
          </div>
          
          <TabsContent value="projects" className="flex-1 overflow-hidden m-0 border-none outline-none">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-1.5">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-4 px-2 flex items-center gap-2">
                  Recent Projects
                  <div className="h-px bg-border flex-1" />
                </div>
                
                {isJobsLoading ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
                  </div>
                ) : jobs && jobs.length > 0 ? (
                  jobs.map(job => (
                    <div 
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-all duration-200 border ${
                        selectedJobId === job.id 
                          ? 'bg-primary/5 border-primary/30 shadow-[inset_0_0_20px_rgba(242,17,120,0.05)]' 
                          : 'bg-card/30 border-transparent hover:bg-muted/40 hover:border-border/50'
                      } group`}
                    >
                      <div className="flex justify-between items-start mb-1.5 gap-1">
                        <span className="font-medium text-sm min-w-0 flex-1 text-foreground/90 leading-snug">
                          {job.videoTitle ? (
                            job.videoTitle
                          ) : (
                            <span className="text-[11px] font-mono text-muted-foreground break-all">{job.youtubeUrl}</span>
                          )}
                        </span>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mt-0.5 -mr-1 hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                          onClick={(e) => handleDeleteJob(e, job.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between mt-2.5">
                        <Badge variant="outline" className={`px-1.5 py-0.5 text-[10px] font-medium ${getStatusColor(job.status)}`}>
                          {getStatusLabel(job.status)}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground/70">
                          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      {job.status !== 'completed' && job.status !== 'failed' && (
                        <Progress value={getStatusProgress(job.status)} className="h-1 mt-3 bg-muted/50" indicatorClassName="bg-primary/70" />
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 px-4 text-sm text-muted-foreground/60 flex flex-col items-center">
                    <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-3">
                      <Layers className="w-5 h-5 opacity-40" />
                    </div>
                    No projects yet. Create one to get started.
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="outros" className="flex-1 overflow-hidden m-0 border-none outline-none flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-2 flex items-center gap-2">
                  Outro Library
                  <div className="h-px bg-border flex-1" />
                </div>
                
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full border-dashed border-2 hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all h-auto py-4">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground group-hover:text-primary">
                        <Upload className="w-5 h-5" />
                        <span className="text-xs font-semibold">Upload Outro</span>
                      </div>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Upload New Outro</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleUploadOutro} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Video File (MP4)</Label>
                        <Input type="file" accept="video/mp4" ref={fileInputRef} required className="cursor-pointer file:cursor-pointer file:bg-primary/10 file:text-primary file:border-0 file:rounded-md file:mr-4 file:px-3 file:py-1 hover:file:bg-primary/20 text-sm" />
                      </div>
                      <div className="space-y-2">
                        <Label>Name (Optional)</Label>
                        <Input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="e.g. Subscribe Banner" />
                      </div>
                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={uploadPosition} onValueChange={(v: "beginning"|"end") => setUploadPosition(v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="beginning">Beginning (Intro)</SelectItem>
                            <SelectItem value="end">End (Outro)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>CTA Text</Label>
                          <Input value={uploadCtaText} onChange={e => setUploadCtaText(e.target.value)} placeholder="Subscribe!" />
                        </div>
                        <div className="space-y-2">
                          <Label>CTA Start (sec)</Label>
                          <Input type="number" step="0.5" min="0" value={uploadCtaStartSeconds} onChange={e => setUploadCtaStartSeconds(e.target.value ? parseFloat(e.target.value) : "")} placeholder="2.5" />
                        </div>
                      </div>
                      <Button type="submit" className="w-full mt-4" disabled={isUploadingOutro}>
                        {isUploadingOutro ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                        {isUploadingOutro ? "Uploading..." : "Upload Outro"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>

                <div className="space-y-2">
                  {isOutrosLoading ? (
                    <div className="flex justify-center p-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary/50" />
                    </div>
                  ) : outros && outros.length > 0 ? (
                    outros.map(outro => (
                      <div key={outro.id} className={`p-3 rounded-lg border bg-card/30 transition-all ${outro.isDefault ? 'border-primary/40 shadow-[0_0_15px_rgba(242,17,120,0.05)]' : 'border-border/50'} relative group`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-sm font-semibold truncate pr-2 flex items-center gap-1.5">
                                <Film className="w-3.5 h-3.5 text-muted-foreground" />
                                {outro.name}
                              </h4>
                              {outro.isDefault && <Star className="w-3.5 h-3.5 text-primary fill-primary shrink-0" />}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 uppercase bg-muted/60">{outro.position}</Badge>
                              {outro.ctaText && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border/50 text-muted-foreground font-normal truncate max-w-[100px]">
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
                              <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-muted" onClick={() => openEditModal(outro)}>
                                <Edit2 className="w-3 h-3" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                              <DialogHeader>
                                <DialogTitle>Edit Outro</DialogTitle>
                              </DialogHeader>
                              <form onSubmit={handleUpdateOutro} className="space-y-4 pt-4">
                                <div className="space-y-2">
                                  <Label>Name</Label>
                                  <Input value={editName} onChange={e => setEditName(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                  <Label>Position</Label>
                                  <Select value={editPosition} onValueChange={(v: "beginning"|"end") => setEditPosition(v)}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="beginning">Beginning (Intro)</SelectItem>
                                      <SelectItem value="end">End (Outro)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <Label>CTA Text</Label>
                                    <Input value={editCtaText} onChange={e => setEditCtaText(e.target.value)} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>CTA Start (sec)</Label>
                                    <Input type="number" step="0.5" min="0" value={editCtaStartSeconds} onChange={e => setEditCtaStartSeconds(e.target.value ? parseFloat(e.target.value) : "")} />
                                  </div>
                                </div>
                                <Button type="submit" className="w-full mt-4" disabled={updateOutro.isPending}>
                                  {updateOutro.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Settings className="w-4 h-4 mr-2" />}
                                  {updateOutro.isPending ? "Saving..." : "Save Settings"}
                                </Button>
                              </form>
                            </DialogContent>
                          </Dialog>
                          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive text-muted-foreground" onClick={() => handleDeleteOutro(outro.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 px-4 text-xs text-muted-foreground/60 bg-card/20 rounded-lg border border-dashed border-border/50">
                      No outros uploaded.
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative z-0 bg-background/50">
        <div className="p-6 border-b border-border bg-card/20 backdrop-blur-md sticky top-0 z-20">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 max-w-4xl mx-auto w-full">
              <div className="flex gap-4 items-start w-full">
                <FormField
                  control={form.control}
                  name="youtubeUrl"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <div className="relative group">
                          <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <Input 
                            placeholder="Paste YouTube URL here..." 
                            className="pl-12 bg-background border-border/60 hover:border-border focus-visible:ring-primary/30 focus-visible:border-primary/50 text-base h-14 shadow-sm transition-all rounded-xl"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-xs ml-1" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clipCount"
                  render={({ field }) => (
                    <FormItem className="w-32 shrink-0">
                      <FormControl>
                        <div className="relative group">
                          <Layers className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground transition-colors group-focus-within:text-primary" />
                          <Input 
                            type="number" 
                            min={1} 
                            max={10} 
                            className="pl-12 pr-4 bg-background border-border/60 hover:border-border focus-visible:ring-primary/30 focus-visible:border-primary/50 text-base h-14 shadow-sm transition-all rounded-xl font-mono"
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
                  style={{ background: 'linear-gradient(135deg, #fd9601, #f21178)' }}
                  className="h-14 px-8 text-base shadow-[0_4px_14px_0_rgba(242,17,120,0.2)] hover:shadow-[0_6px_20px_rgba(242,17,120,0.3)] hover:-translate-y-0.5 transition-all rounded-xl font-semibold active:translate-y-0 shrink-0 text-white border-0"
                >
                  {createJob.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Scissors className="w-5 h-5 mr-2" />}
                  {createJob.isPending ? "Starting..." : "Extract Clips"}
                </Button>
              </div>
              
              <div className="flex gap-4">
                <FormField
                  control={form.control}
                  name="outroId"
                  render={({ field }) => (
                    <FormItem className="w-64">
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-10 bg-background border-border/60">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Film className="w-4 h-4" />
                              <SelectValue placeholder="Select Outro" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Outro</SelectItem>
                            {outros && outros.length > 0 && outros.map(outro => (
                              <SelectItem key={outro.id} value={String(outro.id)}>
                                {outro.name} {outro.isDefault ? "(Default)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      {outros && outros.length === 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1 ml-1">No outros uploaded yet.</p>
                      )}
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </div>

        <ScrollArea className="flex-1 p-6 lg:p-10">
          {!selectedJobId ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground max-w-md mx-auto text-center mt-24">
              <div className="w-24 h-24 bg-card/50 rounded-2xl flex items-center justify-center mb-8 border border-border/50 shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent opacity-50" />
                <FileVideo className="w-10 h-10 text-muted-foreground/50 relative z-10" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-3 tracking-tight">Workspace Empty</h2>
              <p className="text-sm text-muted-foreground/80 leading-relaxed">
                Paste a YouTube URL above and define how many clips you want. Our AI will analyze the video, find the most engaging moments, and render vertical shorts automatically.
              </p>
            </div>
          ) : jobWithClips ? (
            <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-10">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2 text-foreground">
                      {jobWithClips.videoTitle || 'Processing Video...'}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <a 
                        href={jobWithClips.youtubeUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-primary/90 hover:text-primary transition-colors flex items-center gap-1.5 bg-primary/10 px-2 py-1 rounded-md font-medium"
                      >
                        <PlayCircle className="w-4 h-4" /> Source Video
                      </a>
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Layers className="w-4 h-4" />
                        Target: <span className="font-mono">{jobWithClips.clipCount}</span> clips
                      </span>
                      {jobWithClips.outroId && outros && (
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Film className="w-4 h-4 text-primary/70" />
                          Outro: <span className="font-medium text-foreground">{outros.find(o => o.id === jobWithClips.outroId)?.name || 'Unknown'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={`${getStatusColor(jobWithClips.status)} px-3 py-1.5 text-sm font-medium border shadow-sm`}>
                    {getStatusLabel(jobWithClips.status)}
                  </Badge>
                </div>

                {jobWithClips.status !== 'completed' && jobWithClips.status !== 'failed' && (
                  <div className="mt-8 bg-card border border-border rounded-xl p-6 shadow-sm relative overflow-hidden">
                    <div className="absolute inset-0 bg-primary/[0.02] animate-pulse pointer-events-none" />
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
                    <div className="flex justify-between text-sm font-medium mb-3 relative z-10">
                      <span className="text-foreground">Current Phase</span>
                      <span className="text-primary font-mono">{getStatusLabel(jobWithClips.status)}...</span>
                    </div>
                    <Progress value={getStatusProgress(jobWithClips.status)} className="h-2.5 relative z-10 bg-muted/50 overflow-hidden" indicatorClassName="bg-gradient-to-r from-[#f21178] to-[#9b4dca] shadow-[0_0_10px_rgba(242,17,120,0.5)] transition-all duration-1000" />
                    <p className="text-xs text-muted-foreground mt-4 relative z-10 flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin text-primary/70" />
                      This process involves downloading, AI analysis, transcription, and rendering.
                    </p>
                  </div>
                )}

                {jobWithClips.status === 'failed' && (
                  <div className="mt-8 bg-destructive/5 border border-destructive/20 rounded-xl p-6 text-destructive flex gap-4 shadow-sm">
                    <div className="mt-0.5 bg-destructive/10 p-2 rounded-full h-fit">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1 text-base">Processing Failed</h4>
                      <p className="text-sm text-destructive/80 leading-relaxed">{jobWithClips.errorMessage || 'An unknown error occurred during video processing.'}</p>
                    </div>
                  </div>
                )}
              </div>

              {jobWithClips.clips && jobWithClips.clips.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
                      Generated Clips
                      <Badge variant="secondary" className="font-mono text-xs bg-muted/50 text-muted-foreground">
                        {jobWithClips.clips.filter(c => c.status === 'completed').length} / {jobWithClips.clips.length}
                      </Badge>
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {jobWithClips.clips.map((clip, index) => (
                      <Card key={clip.id} className="overflow-hidden border-border/60 shadow-sm hover:shadow-md transition-all duration-300 bg-card group relative flex flex-col">
                        <div className="aspect-[9/16] bg-black/90 relative flex items-center justify-center overflow-hidden border-b border-border/30">
                          {clip.status === 'completed' ? (
                            <>
                              <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-background/5 z-10 opacity-60 group-hover:opacity-80 transition-opacity" />
                              <div className="absolute inset-0 z-20 flex flex-col justify-center items-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-95 group-hover:scale-100">
                                <div className="w-14 h-14 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lg border border-white/20 backdrop-blur-sm cursor-pointer">
                                  <PlayCircle className="w-7 h-7 ml-1" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-card/5 z-10 backdrop-blur-[2px]">
                              <div className="relative">
                                <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                                <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary relative z-10" />
                              </div>
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/70">{getStatusLabel(clip.status)}</span>
                            </div>
                          )}
                          <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
                             <Badge className="bg-background/80 hover:bg-background text-foreground border border-border/50 font-mono text-[10px] px-2 py-0.5 backdrop-blur-md shadow-sm">
                               {clip.durationSeconds}s
                             </Badge>
                             {jobWithClips.outroId && (
                               <Badge className="bg-primary/90 hover:bg-primary text-primary-foreground border-none text-[9px] px-1.5 py-0.5 backdrop-blur-md shadow-sm uppercase">
                                 + Outro
                               </Badge>
                             )}
                          </div>
                        </div>
                        <CardHeader className="p-4 pb-3 relative z-20 bg-card flex-1">
                          <CardTitle className="text-sm font-semibold line-clamp-2 leading-snug group-hover:text-primary transition-colors h-10">
                            {clip.title}
                          </CardTitle>
                          <CardDescription className="text-xs font-mono text-muted-foreground/60 mt-2 flex items-center gap-1.5">
                            <Scissors className="w-3 h-3" />
                            {Math.floor(clip.startSeconds / 60)}:{(Math.floor(clip.startSeconds % 60)).toString().padStart(2, '0')} - 
                            {Math.floor(clip.endSeconds / 60)}:{(Math.floor(clip.endSeconds % 60)).toString().padStart(2, '0')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 mt-auto relative z-20 bg-card">
                          {clip.status === 'completed' && clip.filePath ? (
                            <Button className="w-full shadow-sm hover:shadow transition-all gap-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 font-medium" asChild>
                              <a href={`/api/clips/${clip.id}/download`} download>
                                <Download className="w-4 h-4" /> Download Clip
                              </a>
                            </Button>
                          ) : clip.status === 'failed' ? (
                            <Button variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive h-10" disabled>
                              <AlertCircle className="w-4 h-4 mr-2" /> Failed
                            </Button>
                          ) : (
                            <Button variant="secondary" className="w-full h-10 bg-muted/50 text-muted-foreground cursor-wait" disabled>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Processing
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
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
  );
}

