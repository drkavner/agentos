import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Message, Agent, Team } from "@shared/schema";
import { ACTIVE_TENANT_ID } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Hash, MessageSquare, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface ChannelDef {
  id: string;
  label: string;
  icon: any;
  type: "general" | "team" | "dm";
}

export default function Collab() {
  const tid = ACTIVE_TENANT_ID;
  const [activeChannel, setActiveChannel] = useState("general");
  const [inputVal, setInputVal] = useState("");
  const [senderName, setSenderName] = useState("You");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/tenants", tid, "agents"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/agents`).then(r => r.json()),
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/tenants", tid, "teams"],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/teams`).then(r => r.json()),
  });

  const { data: messages = [], refetch } = useQuery<Message[]>({
    queryKey: ["/api/tenants", tid, "messages", activeChannel],
    queryFn: () => apiRequest("GET", `/api/tenants/${tid}/messages?channelId=${activeChannel}`).then(r => r.json()),
    refetchInterval: 3000,
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tid, "messages", activeChannel] });
      setInputVal("");
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const channels: ChannelDef[] = [
    { id: "general", label: "general", icon: Hash, type: "general" },
    ...teams.map(t => ({ id: `team-${t.id}`, label: t.name.toLowerCase(), icon: Users, type: "team" as const })),
    ...agents.slice(0, 3).map(a => ({ id: `dm-${a.id}`, label: a.displayName.toLowerCase(), icon: MessageSquare, type: "dm" as const })),
  ];

  const activeChannelDef = channels.find(c => c.id === activeChannel);
  const runningAgents = agents.filter(a => a.status === "running");

  return (
    <div className="flex h-[calc(100vh-60px)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 border-r border-border bg-card/40 flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channels</h2>
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
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Online ({runningAgents.length})
          </div>
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
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span>Live · refreshing every 3s</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">No messages in this channel yet</p>
              <p className="text-xs mt-1">Be the first to say something</p>
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
                      {msg.content}
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
