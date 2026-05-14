import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Message, Agent, Team } from "@shared/schema";
import { useTenantContext } from "@/tenant/TenantContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Hash, MessageSquare, Users, Zap, Download, FileCode, FolderDown } from "lucide-react";
import { cn, agentCardStatus } from "@/lib/utils";

const MSG_TYPE_CONFIG: Record<string, { label: string; class: string }> = {
  chat: { label: "", class: "" },
  heartbeat: { label: "heartbeat", class: "msg-heartbeat bg-accent/5" },
  decision: { label: "decision", class: "msg-decision bg-primary/5" },
  tool_call: { label: "tool call", class: "msg-tool_call bg-green-500/5" },
  system: { label: "system", class: "msg-system bg-muted/40" },
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseMeta(msg: Message): Record<string, any> {
  if (!msg.metadata) return {};
  if (typeof msg.metadata === "object") return msg.metadata as any;
  try { return JSON.parse(msg.metadata as string); } catch { return {}; }
}

function RenderedContent({ content }: { content: string }) {
  const parts = useMemo(() => {
    const result: { type: "text" | "code"; lang?: string; value: string }[] = [];
    const lines = content.split("\n");
    let inCode = false;
    let codeLang = "";
    let codeLines: string[] = [];
    let textLines: string[] = [];

    for (const line of lines) {
      if (!inCode && line.startsWith("```")) {
        if (textLines.length > 0) {
          result.push({ type: "text", value: textLines.join("\n") });
          textLines = [];
        }
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else if (inCode && line.trimEnd() === "```") {
        result.push({ type: "code", lang: codeLang, value: codeLines.join("\n") });
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else if (inCode) {
        codeLines.push(line);
      } else {
        textLines.push(line);
      }
    }
    if (inCode && codeLines.length > 0) {
      result.push({ type: "code", lang: codeLang, value: codeLines.join("\n") });
    }
    if (textLines.length > 0) {
      result.push({ type: "text", value: textLines.join("\n") });
    }
    return result;
  }, [content]);

  return (
    <div className="space-y-2">
      {parts.map((p, i) =>
        p.type === "code" ? (
          <div key={i} className="relative rounded-lg overflow-hidden border border-border bg-[#1e1e2e]">
            {p.lang && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-border">
                <span className="text-[10px] font-mono text-muted-foreground uppercase">{p.lang}</span>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => navigator.clipboard.writeText(p.value)}
                >
                  Copy
                </button>
              </div>
            )}
            <pre className="px-3 py-2.5 overflow-x-auto text-xs font-mono leading-relaxed text-[#cdd6f4]">
              <code>{p.value}</code>
            </pre>
          </div>
        ) : (
          <div key={i} className="whitespace-pre-wrap">
            {p.value.split("\n").map((line, j) => {
              if (line.startsWith("# ")) return <h2 key={j} className="text-base font-bold mt-2 mb-1">{line.slice(2)}</h2>;
              if (line.startsWith("## ")) return <h3 key={j} className="text-sm font-bold mt-2 mb-0.5">{line.slice(3)}</h3>;
              if (line.startsWith("### ")) return <h4 key={j} className="text-sm font-semibold mt-1.5">{line.slice(4)}</h4>;
              if (line.startsWith("- ") || line.startsWith("* ")) return <div key={j} className="pl-3 flex gap-1.5"><span className="text-muted-foreground">•</span><span>{renderInline(line.slice(2))}</span></div>;
              if (line.match(/^\d+\.\s/)) return <div key={j} className="pl-3">{renderInline(line)}</div>;
              if (line.startsWith("✅") || line.startsWith("🚀") || line.startsWith("📁") || line.startsWith("📋") || line.startsWith("🎯")) return <div key={j}>{renderInline(line)}</div>;
              if (line.trim() === "") return <div key={j} className="h-1.5" />;
              return <div key={j}>{renderInline(line)}</div>;
            })}
          </div>
        ),
      )}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="px-1 py-0.5 rounded bg-muted text-xs font-mono text-primary">{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });
}

function DeliverableDownloadButton({ tenantId, taskId, fileCount }: { tenantId: number; taskId: number; fileCount: number }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/tasks/${taskId}/deliverables/download`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? `task-${taskId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download error:", e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className={cn(
        "mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
        "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20",
        downloading && "opacity-50 cursor-wait",
      )}
    >
      <FolderDown className="w-3.5 h-3.5" />
      {downloading ? "Downloading..." : `Download ${fileCount} file${fileCount !== 1 ? "s" : ""} (.zip)`}
    </button>
  );
}

interface ChannelDef {
  id: string;
  label: string;
  icon: any;
  type: "general" | "team" | "dm";
}

export default function Collab() {
  const { activeTenantId, activeTenant } = useTenantContext();
  const tid = activeTenantId ?? 0;
  const [activeChannel, setActiveChannel] = useState("general");
  const [inputVal, setInputVal] = useState("");
  const [senderName, setSenderName] = useState("You");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: agents = [] } = useQuery<(Agent & { displayStatus?: string })[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
    enabled: tid > 0,
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/tenants", tid, "teams"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams`).then(r => r.json()),
    enabled: tid > 0,
  });

  const messagesQuery = useQuery<Message[]>({
    queryKey: ["/api/tenants", tid, "messages", activeChannel],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/messages?channelId=${activeChannel}`).then(r => r.json()),
    enabled: tid > 0,
    refetchInterval: 5000,
  });
  const messages = messagesQuery.data ?? [];

  const sendMessage = useMutation({
    mutationFn: (content: string) => apiRequest("POST", `/api/tenants/${tid}/messages`, {
      channelId: activeChannel,
      channelType: activeChannel === "general" ? "general" : activeChannel.startsWith("team") ? "team" : "dm",
      senderName,
      senderEmoji: "👤",
      content,
      messageType: "chat",
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages"] });
      setInputVal("");
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const channels: ChannelDef[] = [
    { id: "general", label: "general", icon: Hash, type: "general" },
    ...teams.map(t => ({ id: `team-${t.id}`, label: t.name.toLowerCase(), icon: Users, type: "team" as const })),
    ...agents
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(a => ({ id: `dm-${a.id}`, label: a.displayName.toLowerCase(), icon: MessageSquare, type: "dm" as const })),
  ];

  const activeChannelDef = channels.find(c => c.id === activeChannel);
  const runningAgents = agents.filter((a) => agentCardStatus(a) === "running");

  return (
    <div className="flex h-[calc(100vh-60px)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 border-r border-border bg-card/40 flex flex-col">
        <div className="px-4 py-3 border-b border-border space-y-1">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channels</h2>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Task / run output → often under <span className="text-foreground/90">team</span>, not #general.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {channels.map(ch => {
            const Icon = ch.icon;
            return (
              <button
                key={ch.id}
                onClick={() => setActiveChannel(ch.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-all text-left",
                  activeChannel === ch.id
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                data-testid={`channel-${ch.id}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{ch.label}</span>
              </button>
            );
          })}
        </div>

        {/* Online agents */}
        <div className="border-t border-border px-4 py-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Running ({runningAgents.length})
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug mb-2">
            Status = &ldquo;running&rdquo; in My Agents, not live chat presence.
          </p>
          <div className="space-y-1.5">
            {runningAgents.map(a => (
              <div key={a.id} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 status-running flex-shrink-0" />
                <span className="text-xs text-muted-foreground">{a.displayName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        <div className="px-6 py-3 border-b border-border flex items-center justify-between bg-card/20">
          <div className="flex items-center gap-2">
            {activeChannelDef && <activeChannelDef.icon className="w-4 h-4 text-muted-foreground" />}
            <span className="text-sm font-semibold text-foreground">{activeChannelDef?.label ?? activeChannel}</span>
            <Badge variant="outline" className="text-xs py-0">{activeChannelDef?.type}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {activeTenant && (
              <Badge variant="outline" className="text-[10px] py-0 h-5">
                org: {activeTenant.name} (#{activeTenant.id})
              </Badge>
            )}
            <div className="flex flex-col items-end text-[10px] text-muted-foreground max-w-[220px] leading-tight text-right">
              <span className="inline-flex items-center gap-1">
                <Zap className="w-3 h-3 text-primary shrink-0" />
                Tenant SSE
              </span>
              <span className="mt-0.5">
                Refreshes on a short poll and when the server pushes updates. Sending as{" "}
                <span className="text-foreground/80">You</span> triggers a Cortex agent reply (OpenClaw or Hermes); use Run / heartbeat for deeper work.
              </span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messagesQuery.isError ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">Can’t load messages for this channel</p>
              <p className="text-xs mt-1">{(messagesQuery.error as Error)?.message ?? "Unknown error"}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-4">
              <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
              {activeChannel === "general" && teams.length > 0 ? (
                <>
                  <p className="text-sm text-foreground font-medium text-center">No messages in #general yet</p>
                  <p className="text-xs mt-2 max-w-md text-center leading-relaxed">
                    Agent runs and task output usually go to a <span className="text-foreground font-medium">team channel</span>, not here.
                    Pick your team on the left (e.g. <span className="font-mono text-foreground">financial</span>) to see CFO/engineer posts.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-5 justify-center">
                    {teams.map(t => (
                      <Button
                        key={t.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-xs"
                        onClick={() => setActiveChannel(`team-${t.id}`)}
                      >
                        Open #{t.name.toLowerCase()}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm">No messages in this channel yet</p>
                  <p className="text-xs mt-1">Be the first to say something</p>
                </>
              )}
            </div>
          ) : (
            messages.map((msg, i) => {
              const tc = MSG_TYPE_CONFIG[msg.messageType] ?? MSG_TYPE_CONFIG.chat;
              const prevMsg = messages[i - 1];
              const sameAuthor = prevMsg && prevMsg.senderName === msg.senderName;
              return (
                <div
                  key={msg.id}
                  className={cn("group flex gap-3", sameAuthor && "mt-0.5")}
                  data-testid={`msg-${msg.id}`}
                >
                  {!sameAuthor ? (
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-base flex-shrink-0 mt-0.5">
                      {msg.senderEmoji}
                    </div>
                  ) : (
                    <div className="w-8 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    {!sameAuthor && (
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-foreground">{msg.senderName}</span>
                        {tc.label && (
                          <Badge variant="outline" className="text-xs py-0 h-4">{tc.label}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{formatTime(msg.createdAt)}</span>
                      </div>
                    )}
                    <div className={cn("text-sm text-foreground leading-relaxed rounded-md px-0", tc.class && `${tc.class} px-3 py-2`)}>
                      {(() => {
                        const meta = parseMeta(msg);
                        const hasCode = msg.content.includes("```");
                        const deliverableFiles = meta.deliverableFiles as string[] | undefined;
                        const taskId = meta.taskId as number | undefined;
                        return (
                          <>
                            {hasCode ? <RenderedContent content={msg.content} /> : msg.content}
                            {deliverableFiles && deliverableFiles.length > 0 && taskId && (
                              <DeliverableDownloadButton tenantId={tid} taskId={taskId} fileCount={deliverableFiles.length} />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-border bg-card/20">
          <div className="flex gap-2 items-center">
            <select
              value={senderName}
              onChange={e => setSenderName(e.target.value)}
              className="bg-muted border border-border rounded-md text-xs text-foreground px-2 py-2 outline-none flex-shrink-0"
              data-testid="sender-select"
            >
              <option value="You">You</option>
              {agents.map(a => <option key={a.id} value={`${a.displayName} (${a.role})`}>{a.displayName}</option>)}
            </select>
            <div className="flex-1 flex gap-2">
              <Input
                placeholder={`Message #${activeChannelDef?.label ?? activeChannel}...`}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && inputVal.trim()) { e.preventDefault(); sendMessage.mutate(inputVal.trim()); } }}
                className="flex-1"
                data-testid="message-input"
              />
              <Button
                size="sm"
                onClick={() => inputVal.trim() && sendMessage.mutate(inputVal.trim())}
                disabled={!inputVal.trim() || sendMessage.isPending}
                data-testid="send-btn"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
